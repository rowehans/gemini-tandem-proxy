import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('--- Test de Cookie Auto-Sync y Parser de Cabeceras ---');

// Función idéntica a la lógica integrada en server.mjs
function parseCookies(cookieHeaders) {
  const cookieList = Array.isArray(cookieHeaders) ? cookieHeaders : [cookieHeaders];
  let updatedPsid = null;
  let updatedPsidts = null;
  let updatedPsidcc = null;

  for (const c of cookieList) {
    const firstPart = c.split(';')[0];
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx === -1) continue;
    const name = firstPart.slice(0, eqIdx).trim();
    const val = firstPart.slice(eqIdx + 1).trim();

    if (name === '__Secure-1PSIDTS' || name === '__Secure-3PSIDTS') {
      updatedPsidts = val;
    } else if (name === '__Secure-1PSID' || name === '__Secure-3PSID') {
      updatedPsid = val;
    } else if (name === '__Secure-1PSIDCC' || name === '__Secure-3PSIDCC') {
      updatedPsidcc = val;
    }
  }

  return { updatedPsid, updatedPsidts, updatedPsidcc };
}

const mockSetCookie = [
  '__Secure-1PSIDTS=sidts-NEW-TOKEN-12345; Path=/; Domain=.google.com; Secure; HttpOnly; Priority=HIGH',
  '__Secure-1PSIDCC=AKEyXz-NEW-CC-999; Path=/; Domain=.google.com; Secure; HttpOnly',
  'NID=511=XYZ; expires=Sat, 17-Apr-2027 23:45:00 GMT'
];

const result = parseCookies(mockSetCookie);
assert.strictEqual(result.updatedPsidts, 'sidts-NEW-TOKEN-12345', 'PSIDTS rotado debe ser extraído');
assert.strictEqual(result.updatedPsidcc, 'AKEyXz-NEW-CC-999', 'PSIDCC debe ser extraído');
assert.strictEqual(result.updatedPsid, null, 'PSID no vino en el set-cookie, debe ser null');

console.log('✅ Test 1 pasado: Parser extrae correctamente cookies rotadas');

// Test 2: Simulación de persistencia en archivo .env temporal
const testEnvPath = path.join(__dirname, '.test-env');
fs.writeFileSync(testEnvPath, 'GEMINI_PSID="original_psid"\nGEMINI_PSIDTS="original_psidts"\nGEMINI_API_KEY="test_key"\n', 'utf8');

function updateEnv(filePath, newPsid, newPsidts) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (newPsid) {
    content = content.replace(/GEMINI_PSID=.*/, `GEMINI_PSID="${newPsid}"`);
  }
  if (newPsidts) {
    content = content.replace(/GEMINI_PSIDTS=.*/, `GEMINI_PSIDTS="${newPsidts}"`);
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

updateEnv(testEnvPath, null, 'sidts-NEW-TOKEN-12345');
const updatedContent = fs.readFileSync(testEnvPath, 'utf8');
assert.ok(updatedContent.includes('GEMINI_PSIDTS="sidts-NEW-TOKEN-12345"'), 'El nuevo token debe quedar guardado en el archivo .env');
assert.ok(updatedContent.includes('GEMINI_PSID="original_psid"'), 'El PSID original debe mantenerse intacto');

fs.unlinkSync(testEnvPath);
console.log('✅ Test 2 pasado: Persistencia en .env funciona limpiamente y preserva otras variables');

console.log('🎉 ¡TESTS DE COOKIE AUTO-SYNC COMPLETADOS CON ÉXITO!\n');
