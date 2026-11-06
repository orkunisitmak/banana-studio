// Create or complete .env for compose.yaml: copies .env.example when .env is
// missing, then fills only EMPTY internal secrets. Existing values are never
// changed, so rerunning it is safe. Prints no secret values.
//   node scripts/docker-env.mjs [path/to/.env]
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const file = path.resolve(process.argv[2] || path.join(root, '.env'));
if (!fs.existsSync(file)) fs.copyFileSync(path.join(root, '.env.example'), file);
let text = fs.readFileSync(file, 'utf8');
const value = name => text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1].trim() || '';
const set = (name, next) => {
  const line = `${name}=${next}`;
  text = new RegExp(`^${name}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${name}=.*$`, 'm'), line) : text.replace(/\n?$/, '\n') + line + '\n';
};
const b64 = input => Buffer.from(typeof input === 'string' ? input : JSON.stringify(input)).toString('base64url');
// Supabase API keys are HS256 JWTs signed with the shared JWT secret.
const apiKey = (role, secret) => {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase', iat: now, exp: now + 10 * 365 * 24 * 3600 })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
};

const filled = [];
if (!value('POSTGRES_PASSWORD')) { set('POSTGRES_PASSWORD', randomBytes(24).toString('hex')); filled.push('POSTGRES_PASSWORD'); }
let regenerateKeys = false;
if (!value('JWT_SECRET')) { set('JWT_SECRET', randomBytes(32).toString('hex')); filled.push('JWT_SECRET'); regenerateKeys = true; }
for (const [name, role] of [['ANON_KEY', 'anon'], ['SERVICE_ROLE_KEY', 'service_role']]) {
  if (regenerateKeys || !value(name)) { set(name, apiKey(role, value('JWT_SECRET'))); filled.push(name); }
}
// Auth signs user tokens with an ES256 key; the OAuth 2.1 server (MCP sign-in)
// needs asymmetric keys. The HS256 secret stays in both sets so the API keys
// above remain valid. JWT_JWKS is the public half the other services verify with.
if (regenerateKeys || !value('JWT_KEYS') || !value('JWT_JWKS')) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const { crv, x, y, d } = privateKey.export({ format: 'jwk' });
  const kid = randomUUID(), oct = { kty: 'oct', k: Buffer.from(value('JWT_SECRET')).toString('base64url'), alg: 'HS256' };
  const ec = { kty: 'EC', kid, use: 'sig', alg: 'ES256', ext: true, crv, x, y };
  set('JWT_KEYS', JSON.stringify([{ ...ec, key_ops: ['sign', 'verify'], d }, oct]));
  set('JWT_JWKS', JSON.stringify({ keys: [{ ...ec, key_ops: ['verify'] }, oct] }));
  filled.push('JWT_KEYS', 'JWT_JWKS');
}
fs.writeFileSync(file, text, { mode: 0o600 });
fs.chmodSync(file, 0o600);
console.log(filled.length ? `Generated ${filled.join(', ')} in ${path.relative(process.cwd(), file) || file}.` : 'All internal secrets are already set.');
const missing = ['BANANA_PUBLIC_URL', 'BANANA_OWNER_EMAIL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter(name => !value(name));
if (missing.length) console.log(`Still to fill in: ${missing.join(', ')}.`);
