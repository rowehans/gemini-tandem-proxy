import assert from 'node:assert';
import { cleanJsonSchema } from './schema-cleaner.mjs';

console.log('--- Probando resolución con schema-cleaner mejorado ---');

// Schema con $defs y $ref
const pydanticSchema = {
  $defs: {
    OperationMode: {
      type: 'string',
      enum: ['read', 'write', 'execute'],
      description: 'El modo de operación'
    },
    FileInfo: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta del archivo' },
        mode: { $ref: '#/$defs/OperationMode' }
      },
      required: ['path', 'mode']
    }
  },
  title: 'file_tool_params',
  type: 'object',
  properties: {
    target: { $ref: '#/$defs/FileInfo' },
    note: { type: 'string' }
  },
  required: ['target']
};

const cleaned = cleanJsonSchema(pydanticSchema);
console.log('Resultado del limpiador mejorado:');
console.log(JSON.stringify(cleaned, null, 2));

const targetProp = cleaned.properties.target;
assert.ok(targetProp.properties, 'targetProp debe tener properties');
assert.strictEqual(targetProp.properties.path.type, 'string');
assert.strictEqual(targetProp.properties.mode.type, 'string');
assert.deepStrictEqual(targetProp.properties.mode.enum, ['read', 'write', 'execute']);
assert.deepStrictEqual(targetProp.required, ['path', 'mode']);

console.log('\n✅ ¡ÉXITO! $ref y $defs se resolvieron y sanearon perfectamente sin perder información.');
