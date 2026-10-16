/**
 * Saneador y normalizador profundo de JSON Schema para la API de Google Gemini (Protobuf Schema).
 * Limpia campos no soportados (additionalProperties, $schema, $defs, definitions, $ref, const, etc.),
 * resuelve referencias internas ($ref), normaliza uniones de tipos, alinea enums a strings
 * y asegura que los esquemas de herramientas cumplan estrictamente con OpenAPI 3.0 / Gemini Spec.
 */

export const GEMINI_ALLOWED_KEYS = new Set([
  'type',
  'format',
  'title',
  'description',
  'nullable',
  'enum',
  'maxItems',
  'minItems',
  'properties',
  'required',
  'minProperties',
  'maxProperties',
  'minLength',
  'maxLength',
  'pattern',
  'example',
  'anyOf',
  'propertyOrdering',
  'default',
  'items',
  'minimum',
  'maximum'
]);

/**
 * Resuelve recursivamente referencias $ref locales (#/definitions/..., #/$defs/..., etc.)
 * dentro del esquema raíz para evitar que se pierdan tipos complejos.
 */
export function resolveJsonSchemaRefs(root) {
  if (!root || typeof root !== 'object') return root;

  function resolvePointer(ptr, doc) {
    if (!ptr || typeof ptr !== 'string' || !ptr.startsWith('#/')) return null;
    const parts = ptr.slice(2).split('/').map(decodeURIComponent);
    let curr = doc;
    for (const part of parts) {
      if (curr && typeof curr === 'object' && Object.prototype.hasOwnProperty.call(curr, part)) {
        curr = curr[part];
      } else {
        return null;
      }
    }
    return curr;
  }

  function walk(node, visitedRefs = new Set()) {
    if (!node || typeof node !== 'object') return node;

    if (Array.isArray(node)) {
      return node.map(item => walk(item, new Set(visitedRefs)));
    }

    let current = { ...node };

    // Si tiene $ref, resolverlo
    if (typeof current.$ref === 'string') {
      const refPath = current.$ref;
      if (visitedRefs.has(refPath)) {
        // Romper ciclo para evitar recursión infinita
        const { $ref, ...rest } = current;
        return { type: 'object', ...rest };
      }

      const target = resolvePointer(refPath, root);
      if (target && typeof target === 'object') {
        const nextVisited = new Set(visitedRefs);
        nextVisited.add(refPath);
        const { $ref, ...rest } = current;
        // La referencia se fusiona con propiedades locales sobrescritas
        current = walk({ ...target, ...rest }, nextVisited);
      }
      delete current.$ref;
    }

    const res = {};
    for (const [k, v] of Object.entries(current)) {
      if (k === '$defs' || k === 'definitions') continue;
      res[k] = walk(v, new Set(visitedRefs));
    }
    return res;
  }

  const cloned = JSON.parse(JSON.stringify(root));
  const resolved = walk(cloned);
  delete resolved.$defs;
  delete resolved.definitions;
  return resolved;
}

/**
 * Limpia y normaliza un objeto JSON Schema para que sea 100% compatible con Google Gemini.
 */
export function cleanJsonSchema(raw, isRootCall = true) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { type: 'object', properties: {} };
  }

  // Si es la llamada raíz, resolver referencias $ref y $defs antes de sanear
  const base = isRootCall ? resolveJsonSchemaRefs(raw) : raw;
  const copy = { ...base };

  // 1. Convertir 'const' a enum con un solo valor
  if (copy.const !== undefined) {
    if (!copy.enum) {
      copy.enum = [String(copy.const)];
    }
    if (!copy.type) {
      copy.type = typeof copy.const === 'number' ? 'number' : typeof copy.const === 'boolean' ? 'boolean' : 'string';
    }
    if (copy.default === undefined) {
      copy.default = copy.const;
    }
    delete copy.const;
  }

  // 2. Fusionar allOf si existe
  if (Array.isArray(copy.allOf)) {
    for (const sub of copy.allOf) {
      if (sub && typeof sub === 'object') {
        const cleanedSub = cleanJsonSchema(sub, false);
        if (cleanedSub.properties) {
          copy.properties = Object.assign({}, copy.properties || {}, cleanedSub.properties);
        }
        if (Array.isArray(cleanedSub.required)) {
          copy.required = Array.from(new Set([...(copy.required || []), ...cleanedSub.required]));
        }
        if (cleanedSub.description && !copy.description) {
          copy.description = cleanedSub.description;
        }
      }
    }
    delete copy.allOf;
  }

  // 3. Mapear oneOf a anyOf
  if (Array.isArray(copy.oneOf)) {
    if (!copy.anyOf) {
      copy.anyOf = copy.oneOf;
    }
    delete copy.oneOf;
  }

  const result = {};

  // 4. Normalizar type y nullable
  if (Array.isArray(copy.type)) {
    const nonNull = copy.type.filter(t => t !== 'null');
    if (copy.type.includes('null')) result.nullable = true;
    result.type = (nonNull[0] || 'string').toLowerCase();
  } else if (typeof copy.type === 'string') {
    if (copy.type.toLowerCase() === 'null') {
      result.type = 'string';
      result.nullable = true;
    } else {
      result.type = copy.type.toLowerCase();
    }
  } else if (copy.properties) {
    result.type = 'object';
  } else if (copy.items) {
    result.type = 'array';
  } else if (copy.enum) {
    result.type = 'string';
  } else if (!copy.anyOf) {
    // Si no tiene type ni anyOf, Gemini exige un tipo por defecto
    result.type = 'string';
  }

  // 5. Preservar nullable explícito si viene definido
  if (copy.nullable === true) {
    result.nullable = true;
  }

  // 6. Copiar y sanear recursivamente claves permitidas
  for (const [key, value] of Object.entries(copy)) {
    if (!GEMINI_ALLOWED_KEYS.has(key)) continue;
    if (key === 'type' || key === 'nullable') continue;

    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const cleanProps = {};
      for (const [pk, pv] of Object.entries(value)) {
        cleanProps[pk] = cleanJsonSchema(pv, false);
      }
      result.properties = cleanProps;
    } else if (key === 'items' && value) {
      if (Array.isArray(value)) {
        result.items = value.length > 0 ? cleanJsonSchema(value[0], false) : { type: 'string' };
      } else if (typeof value === 'object') {
        const cleanedItem = cleanJsonSchema(value, false);
        result.items = cleanedItem.type ? cleanedItem : { type: 'string', ...cleanedItem };
      }
    } else if (key === 'anyOf' && Array.isArray(value)) {
      result.anyOf = value.map(branch => cleanJsonSchema(branch, false));
    } else if (key === 'required' && Array.isArray(value)) {
      result.required = value.filter(r => typeof r === 'string');
    } else if (key === 'enum' && Array.isArray(value)) {
      result.enum = value.map(x => String(x));
    } else if (key === 'default') {
      if (value !== undefined && value !== null) {
        result.default = value;
      }
    } else if (['minItems', 'maxItems', 'minProperties', 'maxProperties', 'minLength', 'maxLength'].includes(key)) {
      const num = parseInt(value, 10);
      if (!Number.isNaN(num)) result[key] = num;
    } else if (['minimum', 'maximum'].includes(key)) {
      const num = parseFloat(value);
      if (!Number.isNaN(num)) result[key] = num;
    } else if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }

  // 7. Si es object y no tiene properties, asegurar properties vacío
  if (result.type === 'object' && !result.properties) {
    result.properties = {};
  }

  // 8. Si tiene required y properties, filtrar claves que realmente existan en properties
  if (result.type === 'object' && Array.isArray(result.required) && result.properties) {
    result.required = result.required.filter(r => Object.prototype.hasOwnProperty.call(result.properties, r));
    if (result.required.length === 0) {
      delete result.required;
    }
  }

  // 9. Si es array y no tiene items o items no tiene type, asegurar items válido
  if (result.type === 'array') {
    if (!result.items || typeof result.items !== 'object' || !result.items.type) {
      result.items = { type: 'string' };
    }
  }

  return result;
}

/**
 * Transforma y sanea una lista de herramientas (formato OpenAI) para Gemini functionDeclarations.
 */
export function sanitizeToolDeclarations(tools) {
  if (!tools || !Array.isArray(tools) || tools.length === 0) return [];

  return tools.map(t => {
    const fn = t.function || t;
    const cleanParams = cleanJsonSchema(fn.parameters || {}, true);
    if (cleanParams.type !== 'object') {
      cleanParams.type = 'object';
    }
    if (!cleanParams.properties || typeof cleanParams.properties !== 'object') {
      cleanParams.properties = {};
    }
    return {
      name: fn.name,
      description: fn.description || '',
      parameters: cleanParams
    };
  });
}
