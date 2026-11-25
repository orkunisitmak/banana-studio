import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { build } = createRequire(root + '/package.json')('esbuild');
const compiled = await build({ entryPoints: ['src/lib/references/personReferences.ts'], absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { findPersonMentions } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const ref = (id, personId, personName) => ({ id, data: 'x', mimeType: 'image/png', personId, personName });
const labels = query => findPersonMentions([ref('a', 3, 'İlker'), ref('b', 4, 'İsmail'), ref('c', 5, 'Ayşe')], query).map(group => group.label);

test('a plain lowercase prefix still finds its name', () => {
  assert.deepEqual(labels('ay'), ['Ayşe']);
});
test('typing i after @ finds names that start with a dotted İ', () => {
  assert.deepEqual(labels('ilk'), ['İlker']);
  assert.deepEqual(labels('ismail'), ['İsmail']);
});
