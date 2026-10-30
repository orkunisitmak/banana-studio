import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const start = source.indexOf('        syncLocalImages().then(');
const end = source.indexOf('\n      } catch', start);
assert.ok(start > 0 && end > start);
const compiled = transformSync(`module.exports = (syncLocalImages, console) => ${source.slice(start, end).trim()}`, { loader: 'ts', format: 'cjs' }).code;
const mod = { exports: {} };
new Function('module', 'exports', compiled)(mod, mod.exports);

test('a background gallery sync failure is handled after a session change', async () => {
  const notices = [];
  await assert.doesNotReject(mod.exports(async () => { throw new Error('Synthetic session transition'); }, { warn: (...args) => notices.push(args) }));
  assert.equal(notices.length, 1);
});
