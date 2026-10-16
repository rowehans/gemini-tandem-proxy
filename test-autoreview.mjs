import http from 'node:http';
import assert from 'node:assert';

function sendPost(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function topLevelMemberCount(text) {
  const syntax = text.replace(/"(?:\\.|[^"\\])*"/gs, "");
  let depth = 0;
  let count = 0;
  for (const char of syntax) switch (char) {
    case "{":
    case "[":
      depth += 1;
      break;
    case "}":
    case "]":
      depth -= 1;
      break;
    case ":": if (depth === 1) count += 1;
  }
  return count;
}

function parseDecision(text) {
  const value = JSON.parse(text);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
  const keys = Object.keys(value);
  if (topLevelMemberCount(text) !== keys.length) throw new Error("member count mismatch");
  const risk = value["risk"];
  const decision = value["decision"];
  if (keys.length === 2 && decision === "allow" && (risk === "low" || risk === "medium")) return { risk, decision };
  throw new Error("policy mismatch");
}

async function run() {
  console.log('--- Test 1: Auto Review no-streaming ---');
  const res1 = await sendPost({
    model: 'gemini-4-argon',
    messages: [
      {
        role: 'system',
        content: `REVIEW_POLICY
You are the final authorization reviewer for exactly one pending tool call. Your decision replaces human approval for this call.`
      },
      {
        role: 'user',
        content: 'Review tool call: pwsh -Command "dir"'
      }
    ],
    stream: false
  });

  assert.strictEqual(res1.statusCode, 200, 'Status debe ser 200');
  const parsed1 = JSON.parse(res1.body);
  const text1 = parsed1.choices[0].message.content;
  console.log('Respuesta cruda Auto Review:', text1);
  const decision1 = parseDecision(text1);
  assert.strictEqual(decision1.risk, 'low');
  assert.strictEqual(decision1.decision, 'allow');
  console.log('✅ Test 1 pasado: Auto Review responde JSON exacto esperado por DeepSeek Harness');

  console.log('\n--- Test 2: Auto Review con streaming SSE ---');
  const res2 = await sendPost({
    model: 'gemini-4-argon',
    messages: [
      {
        role: 'system',
        content: `REVIEW_POLICY\nYou are the final authorization reviewer for exactly one pending tool call.`
      },
      {
        role: 'user',
        content: 'Review tool call: pwsh'
      }
    ],
    stream: true
  });

  assert.strictEqual(res2.statusCode, 200, 'Status SSE debe ser 200');
  const lines = res2.body.split('\n');
  let accumulated = '';
  for (const line of lines) {
    if (line.startsWith('data: ') && !line.includes('[DONE]')) {
      const chunk = JSON.parse(line.slice(6));
      if (chunk.choices && chunk.choices[0]?.delta?.content) {
        accumulated += chunk.choices[0].delta.content;
      }
    }
  }
  console.log('Contenido acumulado SSE:', accumulated);
  const decision2 = parseDecision(accumulated);
  assert.strictEqual(decision2.risk, 'low');
  assert.strictEqual(decision2.decision, 'allow');
  console.log('✅ Test 2 pasado: Stream SSE de Auto Review verificado');

  console.log('\n🎉 ¡TODOS LOS TESTS DE AUTO-REVIEW PASARON CON ÉXITO!');
}

run().catch(err => {
  console.error('❌ Error en tests:', err);
  process.exit(1);
});
