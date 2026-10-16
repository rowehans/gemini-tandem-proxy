import http from 'node:http';
import assert from 'node:assert';

function testStreamingToolCalls() {
  return new Promise((resolve, reject) => {
    console.log('--- [1/2] Iniciando prueba Streaming E2E con Tool Calls y Telemetría ---');

    const payload = {
      model: 'gemini-4-argon',
      messages: [
        {
          role: 'user',
          content: 'Ejecuta el comando git status para verificar el repositorio.'
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
              type: 'object',
              additionalProperties: false,
              properties: {
                command: {
                  type: 'string',
                  description: 'El comando a ejecutar'
                }
              },
              required: ['command'],
              additionalProperties: false
            }
          }
        }
      ],
      stream: true,
      stream_options: {
        include_usage: true
      }
    };

    const body = JSON.stringify(payload);
    const chunkArrivals = [];

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
      res.on('data', chunk => {
        chunkArrivals.push({ time: Date.now(), length: chunk.length });
        raw += chunk.toString();
      });
      res.on('end', () => {
        console.log(`Stream finalizado. Chunks de red recibidos: ${chunkArrivals.length}, Longitud total: ${raw.length} bytes.`);
        const lines = raw.split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]');

        let foundToolCalls = false;
        let foundContentDeltas = 0;
        let foundUsage = null;

        for (const line of lines) {
          try {
            const chunkJson = JSON.parse(line.replace('data: ', ''));
            const delta = chunkJson.choices?.[0]?.delta;
            if (delta?.content) {
              foundContentDeltas++;
            }
            if (delta?.tool_calls) {
              foundToolCalls = true;
              console.log('Chunk con tool_calls recibido:', JSON.stringify(delta.tool_calls, null, 2));
              for (const tc of delta.tool_calls) {
                assert.ok(typeof tc.index === 'number', 'Cada tool_call en delta debe tener un index numérico');
                assert.ok(tc.id, 'Cada tool_call debe tener un id');
                assert.ok(tc.function?.name, 'Cada tool_call debe tener function.name');
              }
            }
            if (chunkJson.usage) {
              foundUsage = chunkJson.usage;
            }
          } catch (e) {
            console.error('Error parseando chunk SSE:', e.message);
          }
        }

        assert.ok(foundToolCalls, 'Debe haber emitido tool_calls en el stream');
        assert.ok(foundUsage, 'Debe haber emitido el bloque usage en el stream');
        assert.ok(typeof foundUsage.prompt_tokens === 'number' && foundUsage.prompt_tokens > 0, 'prompt_tokens debe ser > 0');
        assert.ok(typeof foundUsage.completion_tokens === 'number' && foundUsage.completion_tokens > 0, 'completion_tokens debe ser > 0');
        assert.strictEqual(foundUsage.total_tokens, foundUsage.prompt_tokens + foundUsage.completion_tokens, 'total_tokens debe ser la suma exacta');
        assert.ok(foundUsage.prompt_tokens_details, 'Debe tener prompt_tokens_details');
        assert.strictEqual(foundUsage.prompt_tokens_details.cached_tokens, Math.floor(foundUsage.prompt_tokens * 0.90), 'cached_tokens debe ser ~90% de prompt_tokens');

        console.log(`✅ [1/2] Streaming con tool_calls verificado. Deltas de contenido previo: ${foundContentDeltas}. Usage verificado:`, foundUsage);
        resolve();
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function testStreamingPureText() {
  return new Promise((resolve, reject) => {
    console.log('--- [2/2] Iniciando prueba Streaming E2E de Texto Puro y Micro-cadencia ---');

    const payload = {
      model: 'gemini-4-argon',
      messages: [
        {
          role: 'user',
          content: 'Explica en 3 oraciones qué es Node.js.'
        }
      ],
      stream: true,
      stream_options: {
        include_usage: true
      }
    };

    const body = JSON.stringify(payload);
    const chunkArrivals = [];

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
      res.on('data', chunk => {
        chunkArrivals.push({ time: Date.now(), length: chunk.length });
        raw += chunk.toString();
      });
      res.on('end', () => {
        const lines = raw.split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]');
        let textPieces = 0;
        let reconstructedText = '';
        let foundUsage = null;

        for (const line of lines) {
          try {
            const chunkJson = JSON.parse(line.replace('data: ', ''));
            const delta = chunkJson.choices?.[0]?.delta;
            if (delta?.content) {
              textPieces++;
              reconstructedText += delta.content;
            }
            if (chunkJson.usage) {
              foundUsage = chunkJson.usage;
            }
          } catch (e) {}
        }

        console.log(`Deltas de texto recibidos: ${textPieces}. Longitud de texto: ${reconstructedText.length} caracteres.`);
        assert.ok(textPieces > 1, 'Debe haber entregado el texto fragmentado en múltiples deltas progresivos (micro-streaming)');
        assert.ok(reconstructedText.length > 10, 'El texto reconstruido debe tener contenido');
        assert.ok(foundUsage, 'Debe haber emitido el bloque usage en el stream');
        assert.ok(foundUsage.prompt_tokens > 0, 'prompt_tokens debe ser > 0');
        assert.ok(foundUsage.completion_tokens > 0, 'completion_tokens debe ser > 0');
        assert.strictEqual(foundUsage.total_tokens, foundUsage.prompt_tokens + foundUsage.completion_tokens);
        assert.strictEqual(foundUsage.prompt_tokens_details.cached_tokens, Math.floor(foundUsage.prompt_tokens * 0.90));

        console.log(`✅ [2/2] Micro-streaming de texto verificado exitosamente. Usage:`, foundUsage);
        resolve();
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  try {
    await testStreamingToolCalls();
    console.log('Esperando 2 segundos para cortesía con sesión web de Argon...');
    await new Promise(r => setTimeout(r, 2000));
    await testStreamingPureText();
    console.log('\n🎉 ¡TODAS LAS PRUEBAS DE STREAMING Y TELEMETRÍA PASARON EXITOSAMENTE!');
    process.exit(0);
  } catch (e) {
    console.error('❌ Error en test-stream.mjs:', e);
    process.exit(1);
  }
}

run();
