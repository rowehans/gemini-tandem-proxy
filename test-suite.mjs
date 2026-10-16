import assert from 'node:assert';
import { cleanJsonSchema, resolveJsonSchemaRefs, sanitizeToolDeclarations } from './schema-cleaner.mjs';

console.log('Iniciando suite de pruebas de schema-cleaner...');

// Caso 1: Entrada nula o vacía
{
  const r = cleanJsonSchema(null);
  assert.strictEqual(r.type, 'object');
  assert.deepStrictEqual(r.properties, {});
}

// Caso 2: Schema con additionalProperties y $schema en múltiples niveles
{
  const raw = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'testTool',
    type: 'object',
    additionalProperties: false,
    properties: {
      opts: {
        type: 'object',
        additionalProperties: false,
        properties: {
          flag: { type: 'boolean' }
        }
      },
      list: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' }
          }
        }
      }
    },
    required: ['opts', 'inexistente']
  };

  const c = cleanJsonSchema(raw);
  assert.strictEqual(c.$schema, undefined);
  assert.strictEqual(c.additionalProperties, undefined);
  assert.strictEqual(c.properties.opts.additionalProperties, undefined);
  assert.strictEqual(c.properties.list.items.additionalProperties, undefined);
  assert.deepStrictEqual(c.required, ['opts']);
  assert.strictEqual(c.properties.opts.type, 'object');
  assert.strictEqual(c.properties.list.items.type, 'object');
}

// Caso 3: Type con union ['string', 'null']
{
  const raw = {
    type: ['string', 'null'],
    description: 'Nombre opcional'
  };
  const c = cleanJsonSchema(raw);
  assert.strictEqual(c.type, 'string');
  assert.strictEqual(c.nullable, true);
  assert.strictEqual(c.description, 'Nombre opcional');
}

// Caso 4: allOf fusionado
{
  const raw = {
    type: 'object',
    allOf: [
      {
        properties: { a: { type: 'string' } },
        required: ['a']
      },
      {
        properties: { b: { type: 'number' } },
        required: ['b']
      }
    ]
  };
  const c = cleanJsonSchema(raw);
  assert.strictEqual(c.allOf, undefined);
  assert.ok(c.properties.a);
  assert.ok(c.properties.b);
  assert.deepStrictEqual(c.required.sort(), ['a', 'b'].sort());
}

// Caso 5: oneOf transformado a anyOf
{
  const raw = {
    oneOf: [
      { type: 'string', additionalProperties: false },
      { type: 'number' }
    ]
  };
  const c = cleanJsonSchema(raw);
  assert.strictEqual(c.oneOf, undefined);
  assert.ok(Array.isArray(c.anyOf));
  assert.strictEqual(c.anyOf.length, 2);
  assert.strictEqual(c.anyOf[0].additionalProperties, undefined);
  assert.strictEqual(c.anyOf[0].type, 'string');
}

// Caso 6: enum numérico convertido a strings
{
  const raw = {
    type: 'integer',
    enum: [1, 2, 3]
  };
  const c = cleanJsonSchema(raw);
  assert.deepStrictEqual(c.enum, ['1', '2', '3']);
}

// Caso 7: Array sin items o items sin type
{
  const raw1 = { type: 'array' };
  const c1 = cleanJsonSchema(raw1);
  assert.deepStrictEqual(c1.items, { type: 'string' });

  const raw2 = { type: 'array', items: { description: 'algo sin tipo' } };
  const c2 = cleanJsonSchema(raw2);
  assert.strictEqual(c2.items.type, 'string');
  assert.strictEqual(c2.items.description, 'algo sin tipo');
}

// Caso 8: Resolución de $defs y $ref (Pydantic / OpenAPI)
{
  const pydanticSchema = {
    $defs: {
      Mode: {
        type: 'string',
        enum: ['fast', 'slow'],
        description: 'Velocidad'
      },
      Config: {
        type: 'object',
        properties: {
          mode: { $ref: '#/$defs/Mode' },
          retries: { type: 'integer', default: 3 }
        },
        required: ['mode']
      }
    },
    type: 'object',
    properties: {
      cfg: { $ref: '#/$defs/Config' }
    },
    required: ['cfg']
  };

  const c = cleanJsonSchema(pydanticSchema);
  assert.strictEqual(c.$defs, undefined);
  assert.ok(c.properties.cfg);
  assert.strictEqual(c.properties.cfg.type, 'object');
  assert.strictEqual(c.properties.cfg.properties.mode.type, 'string');
  assert.deepStrictEqual(c.properties.cfg.properties.mode.enum, ['fast', 'slow']);
  assert.strictEqual(c.properties.cfg.properties.retries.type, 'integer');
  assert.deepStrictEqual(c.properties.cfg.required, ['mode']);
}

// Caso 9: Soporte de 'const' (transformado a enum + default)
{
  const raw = {
    type: 'object',
    properties: {
      action: { const: 'run_cmd' }
    }
  };
  const c = cleanJsonSchema(raw);
  assert.strictEqual(c.properties.action.const, undefined);
  assert.deepStrictEqual(c.properties.action.enum, ['run_cmd']);
  assert.strictEqual(c.properties.action.default, 'run_cmd');
  assert.strictEqual(c.properties.action.type, 'string');
}

// Caso 10: Referencia circular en $ref (debe cortar sin loop infinito)
{
  const circularSchema = {
    $defs: {
      Node: {
        type: 'object',
        properties: {
          val: { type: 'string' },
          next: { $ref: '#/$defs/Node' }
        }
      }
    },
    type: 'object',
    properties: {
      root: { $ref: '#/$defs/Node' }
    }
  };

  const c = cleanJsonSchema(circularSchema);
  assert.ok(c.properties.root);
  assert.strictEqual(c.properties.root.type, 'object');
  assert.ok(c.properties.root.properties.next);
  assert.strictEqual(c.properties.root.properties.next.type, 'object');
}

// Caso 11: sanitizeToolDeclarations con herramientas de OpenAI
{
  const tools = [
    {
      type: 'function',
      function: {
        name: 'test_func',
        description: 'Prueba',
        parameters: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          additionalProperties: false,
          properties: {
            arg1: { type: 'string' }
          }
        }
      }
    }
  ];

  const decls = sanitizeToolDeclarations(tools);
  assert.strictEqual(decls.length, 1);
  assert.strictEqual(decls[0].name, 'test_func');
  assert.strictEqual(decls[0].parameters.type, 'object');
  assert.strictEqual(decls[0].parameters.additionalProperties, undefined);
  assert.ok(decls[0].parameters.properties.arg1);
}

console.log('✅ ¡Todos los 11 tests unitarios de schema-cleaner pasaron exitosamente!');
