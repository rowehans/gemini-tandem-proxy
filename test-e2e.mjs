import http from 'node:http';
import assert from 'node:assert';

function checkModels() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:3000/v1/models', (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          const model = json.data?.find(m => m.id === 'gemini-4-argon');
          assert.ok(model, 'El modelo gemini-4-argon debe estar en la lista de modelos');
          assert.strictEqual(model.context_window, 2000000, 'context_window debe ser 2000000');
          assert.strictEqual(model.max_tokens, 65536, 'max_tokens debe ser 65536');
          assert.strictEqual(model.max_completion_tokens, 65536, 'max_completion_tokens debe ser 65536');
          console.log('✅ Endpoint /v1/models validado correctamente:', model);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function checkChatCompletions() {
  return new Promise((resolve, reject) => {
    console.log('--- Iniciando prueba E2E contra Proxy Local en :3000 ---');

    const payload = {
      model: 'gemini-4-argon',
      messages: [
        {
          role: 'user',
          content: 'Ejecuta el comando git status para verificar el estado del repositorio.'
        }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'run_command',
            description: 'Ejecuta un comando en la shell del sistema',
            parameters: {
              $schema: 'http://json-schema.org/draft-07/schema#',
              $defs: {
                CommandConfig: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    cwd: { type: 'string', description: 'Directorio de trabajo' }
                  }
                }
              },
              title: 'run_command_args',
              type: 'object',
              additionalProperties: false,
              properties: {
                command: {
                  type: 'string',
                  description: 'El comando a ejecutar'
                },
                config: {
                  $ref: '#/$defs/CommandConfig'
                },
                args: {
                  type: 'array',
                  description: 'Argumentos adicionales',
                  items: {
                    type: 'string',
                    additionalProperties: false
                  }
                }
              },
              required: ['command'],
              additionalProperties: false
            }
          }
        }
      ],
      stream: false
    };

    const body = JSON.stringify(payload);

    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/v1/chat/completions',
      method: 'POST',
      agent: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        console.log('HTTP Status Code:', res.statusCode);
        try {
          const json = JSON.parse(raw);
          console.log('Respuesta del Servidor Proxy:');
          console.log(JSON.stringify(json, null, 2));

          // 1. Validar telemetría de tokens (usage)
          assert.ok(json.usage, 'Debe incluir el objeto usage en la raíz');
          assert.strictEqual(typeof json.usage.prompt_tokens, 'number', 'prompt_tokens debe ser numérico');
          assert.ok(json.usage.prompt_tokens > 0, 'prompt_tokens debe ser > 0');
          assert.strictEqual(typeof json.usage.completion_tokens, 'number', 'completion_tokens debe ser numérico');
          assert.ok(json.usage.completion_tokens > 0, 'completion_tokens debe ser > 0');
          assert.strictEqual(json.usage.total_tokens, json.usage.prompt_tokens + json.usage.completion_tokens, 'total_tokens debe ser la suma exacta');
          assert.ok(json.usage.prompt_tokens_details, 'Debe incluir prompt_tokens_details');
          assert.strictEqual(json.usage.prompt_tokens_details.cached_tokens, Math.floor(json.usage.prompt_tokens * 0.90), 'cached_tokens debe ser el 90% de prompt_tokens');
          console.log('✅ Validación de telemetría de tokens (usage) completada exitosamente:', json.usage);

          // 2. Validar estructura de tool_calls o respuesta
          const choice = json.choices?.[0];
          if (choice?.finish_reason === 'tool_calls' && choice?.message?.tool_calls?.length > 0) {
            console.log('\n✅ ¡ÉXITO ROTUNDO! Se recibió tool_calls correctamente:');
            for (const tc of choice.message.tool_calls) {
              console.log(` - Función: ${tc.function.name}, Argumentos: ${tc.function.arguments}`);
            }
            resolve();
          } else if (choice?.message?.content) {
            console.log('\n⚠️ El modelo devolvió contenido textual en vez de tool_calls. Contenido:', choice.message.content.slice(0, 300));
            reject(new Error('El modelo devolvió texto en vez de tool_calls'));
          } else {
            console.error('\n❌ Respuesta inesperada:', json);
            reject(new Error('Respuesta inesperada'));
          }
        } catch (e) {
          console.error('Error en validación:', e.message, raw);
          reject(e);
        }
      });
    });

    req.on('error', (err) => {
      console.error('Error conectando al proxy:', err.message);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

async function run() {
  try {
    await checkModels();
    await checkChatCompletions();
    console.log('✅ Todas las pruebas de test-e2e.mjs pasaron exitosamente.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Fallo en test-e2e.mjs:', err);
    process.exit(1);
  }
}

run();
