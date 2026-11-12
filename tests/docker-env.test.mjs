import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const run = file => execFileSync(process.execPath, ['scripts/docker-env.mjs', file], { encoding: 'utf8' });
const read = file => Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

test('docker-env fills only empty secrets, signs API keys with JWT_SECRET and keeps the private key out of JWT_JWKS', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-docker-env-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, '.env');
  fs.writeFileSync(file, 'BANANA_PUBLIC_URL=https://studio.example.test\nPOSTGRES_PASSWORD=kept-by-operator\nJWT_SECRET=\nANON_KEY=\nSERVICE_ROLE_KEY=\nJWT_KEYS=\nJWT_JWKS=\n');
  run(file);
  const first = read(file);
  assert.equal(first.POSTGRES_PASSWORD, 'kept-by-operator');
  assert.equal(first.BANANA_PUBLIC_URL, 'https://studio.example.test');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  for (const [name, role] of [['ANON_KEY', 'anon'], ['SERVICE_ROLE_KEY', 'service_role']]) {
    const [header, payload, signature] = first[name].split('.');
    assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).role, role);
    assert.equal(signature, createHmac('sha256', first.JWT_SECRET).update(`${header}.${payload}`).digest('base64url'));
  }
  const signing = JSON.parse(first.JWT_KEYS), verifying = JSON.parse(first.JWT_JWKS).keys;
  assert.ok(signing.find(key => key.kty === 'EC').d, 'Auth needs the EC private key to sign tokens.');
  assert.ok(verifying.every(key => key.d === undefined), 'The verification set must not contain private key material.');
  assert.equal(Buffer.from(verifying.find(key => key.kty === 'oct').k, 'base64url').toString(), first.JWT_SECRET);
  run(file);
  assert.deepEqual(read(file), first, 'A second run must not rotate any secret.');
});
