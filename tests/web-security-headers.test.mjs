import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Vercel applies every header rule whose source matches the path. The sources
// here are plain regular expressions, so this mirrors that matching.
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const headersFor = path => config.headers
  .filter(rule => new RegExp(`^${rule.source}$`).test(path))
  .flatMap(rule => rule.headers);
const policies = path => headersFor(path).filter(h => h.key.toLowerCase() === 'content-security-policy').map(h => h.value);
const directives = policy => Object.fromEntries(policy.split(';').map(d => d.trim().split(/\s+/)).filter(d => d[0]).map(([name, ...values]) => [name, values]));

test('the main app gets one enforced CSP with no unsafe script sources', () => {
  for (const path of ['/', '/index.html', '/assets/index-abc123.js', '/api/workspace-config']) {
    const found = policies(path);
    assert.equal(found.length, 1, path);
    const csp = directives(found[0]);
    assert.deepEqual(csp['script-src'], ["'self'"]);
    assert.deepEqual(csp['default-src'], ["'self'"]);
    assert.deepEqual(csp['object-src'], ["'none'"]);
    assert.deepEqual(csp['base-uri'], ["'none'"]);
    assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
    for (const values of Object.values(csp)) {
      assert.ok(!values.includes("'unsafe-eval'") && !values.includes('*'), path);
    }
    assert.ok(!headersFor(path).some(h => h.key.toLowerCase() === 'content-security-policy-report-only'));
  }
});

test('share.html keeps only its own stricter policy', () => {
  const found = policies('/share.html');
  assert.equal(found.length, 1);
  const csp = directives(found[0]);
  assert.deepEqual(csp['default-src'], ["'none'"]);
  assert.deepEqual(csp['script-src'], ["'self'"]);
  assert.deepEqual(csp['connect-src'], ["'self'"]);
});

test('every path keeps the existing hardening headers', () => {
  for (const path of ['/', '/share.html']) {
    const keys = headersFor(path).map(h => h.key);
    for (const key of ['Referrer-Policy', 'X-Content-Type-Options', 'X-Frame-Options']) assert.ok(keys.includes(key), `${path} ${key}`);
  }
});

test('the web policy allows the same sources as the desktop server policy', () => {
  const desktop = readFileSync(new URL('../desktop/server/http.mjs', import.meta.url), 'utf8')
    .match(/'Content-Security-Policy',"([^"]+)"/)[1];
  const web = directives(policies('/')[0]);
  for (const [name, values] of Object.entries(directives(desktop))) assert.deepEqual(web[name], values, name);
});
