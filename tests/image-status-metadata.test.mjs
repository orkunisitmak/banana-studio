import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Finishing or failing an image row calls updateImageStatus. When the read of the saved metadata
// fails, updateVideoStatus still saves the status and URL (and leaves the metadata alone);
// updateImageStatus throws before writing anything, so the row keeps its old status.
const root = fileURLToPath(new URL('..', import.meta.url));
const { build } = createRequire(root + '/package.json')('esbuild');
const stubs = {
  authService: `export const SUPABASE_URL='https://x.supabase.co';export const getCurrentUserId=async()=>'u1';
    const from=()=>{const op={op:'select'};const q={select(){return q},update(v){op.op='update';op.value=v;return q},eq(){return q},single(){return q},
      then(ok,fail){globalThis.__writes.push(op);return Promise.resolve(globalThis.__respond(op)).then(ok,fail)}};return q;};
    export const supabase={from,storage:{from:()=>({})}};`,
  runtimeConfig: 'export const isLocalWorkspace=()=>false;',
  'tus-js-client': 'export class Upload{}',
};
const compiled = await build({ entryPoints: ['src/services/storageService.ts'], absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /^(\.[\\/]authService|.*[\\/]runtimeConfig|tus-js-client)$/ }, args => ({ path: args.path.split(/[\\/]/).pop().replace(/^\./, ''), namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    b.onResolve({ filter: /^[^./]/ }, args => ({ path: pathToFileURL(createRequire(root + '/package.json').resolve(args.path)).href, external: true }));
  } }] });
const { updateImageStatus } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const WANT_URL = 'https://x.supabase.co/storage/v1/object/authenticated/media/u1/a.png';
const warnings = [];
const update = async (status, read, updates, writeResult = { data: null, error: null }) => {
  const warn = console.warn; console.warn = (...args) => { warnings.push(args.join(' ')); };
  warnings.length = 0;
  globalThis.__writes = [];
  globalThis.__respond = op => op.op === 'select' ? read : writeResult;
  try { await updateImageStatus('i1', status, updates); } finally { console.warn = warn; }
  return globalThis.__writes.find(op => op.op === 'update')?.value;
};

test('control: a successful read merges new metadata into the saved image details', async () => {
  const written = await update('failed', { data: { metadata: { falRequestId: 'r1' } }, error: null }, { metadata: { error: 'boom' } });
  assert.deepEqual(written.metadata, { falRequestId: 'r1', error: 'boom' });
});
test('a failed metadata read still saves a failed status and leaves the saved details alone', async () => {
  const written = await update('failed', { data: null, error: { message: 'timeout' } }, { metadata: { error: 'boom' } });
  assert.ok(written, 'the status update is written');
  assert.equal(written.status, 'failed');
  assert.equal('metadata' in written, false);
});
test('a failed metadata read still saves the completed status and the stored URL', async () => {
  const written = await update('completed', { data: null, error: { message: 'timeout' } }, { url: 'https://x.supabase.co/storage/v1/object/sign/media/u1/a.png?token=t', metadata: { imagePromptCategory: 'x' } });
  assert.ok(written, 'the status update is written');
  assert.equal(written.status, 'completed');
  assert.equal(written.url, WANT_URL);
  assert.equal(written.storage_path, 'u1/a.png');
});
test('a write that returns an error is warned about and the call still resolves', async () => {
  const written = await update('failed', { data: { metadata: {} }, error: null }, { metadata: { error: 'boom' } }, { data: null, error: { message: 'row locked' } });
  assert.equal(written.status, 'failed');
  assert.ok(warnings.some(w => w.includes('status could not be saved') && w.includes('row locked')), warnings.join('|'));
});
test('control: a write without an error does not warn', async () => {
  await update('failed', { data: { metadata: {} }, error: null }, { metadata: { error: 'boom' } });
  assert.deepEqual(warnings, []);
});
