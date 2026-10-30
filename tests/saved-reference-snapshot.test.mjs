import test from 'node:test';
import assert from 'node:assert/strict';
import { build, transformSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WorkspaceQuery } from '../desktop/shared/query.mjs';

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
const f = { user: 'owner', references: [], files: new Map(), writes: 0, reads: 0, readFailure: false, afterFetch: null, lookupError: null, afterLookup: null };
const origin = 'https://storage.invalid';
const sourcePath = 'owner/source.png';
const sourceUrl = `${origin}/storage/v1/object/authenticated/media/${sourcePath}`;
f.client = {
  from(table) { return new WorkspaceQuery(async plan => {
    if (plan.operation === 'upsert') { f.writes++; f.references = [structuredClone(plan.value), ...f.references.filter(row => row.id !== plan.value.id)]; return { error: null }; }
    if (plan.operation === 'delete') return { error: null };
    assert.equal(table, 'reference_images');
    assert.ok(++f.reads < 20, 'library reads must reach an empty page');
    const rows = f.references.filter(row => plan.filters.every(filter => filter.operator !== 'eq' || row[filter.column] === filter.value));
    const [from, to] = plan.range || [0, undefined];
    if (plan.single) {
      f.afterLookup?.();
      return { data: f.lookupError ? null : structuredClone(rows[0] || null), error: f.lookupError };
    }
    return { data: structuredClone(rows.slice(from, to === undefined ? undefined : to + 1)), error: null };
  }, table); },
  storage: { from: () => ({
    remove: async paths => { paths.forEach(path => f.files.delete(path)); return { error: null }; },
    createSignedUrl: async path => ({ data: { signedUrl: `${origin}/storage/v1/object/sign/media/${path}?token=synthetic` }, error: null }),
    createSignedUrls: async paths => ({ data: paths.map(path => ({ path, signedUrl: f.files.has(path) ? `${origin}/storage/v1/object/sign/media/${path}?token=synthetic` : '', error: f.files.has(path) ? null : 'Not found' })), error: null }),
  }) },
};
globalThis.__referenceSnapshot = f;
const bundle = await build({ stdin: { contents: "export { saveReferenceImage, getReferenceGallery, deleteImage } from './src/services/storageService';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(process.cwd() + '/package.json');" }, plugins: [{ name: 'snapshot-fixture', setup(b) {
  b.onResolve({ filter: /\/authService$|^tus-js-client$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'tus-js-client' ? 'export class Upload {}' : "export const supabase=globalThis.__referenceSnapshot.client; export const getCurrentUserId=async()=>globalThis.__referenceSnapshot.user,SUPABASE_URL='https://storage.invalid';" }));
} }] });
const service = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const image = () => ({ id: 'saved', data: sourceUrl, mimeType: 'image/png', createdAt: 1 });
function setup(t) {
  f.references = []; f.files = new Map([[sourcePath, bytes]]); f.user = 'owner'; f.writes = 0; f.reads = 0; f.readFailure = false; f.afterFetch = null; f.lookupError = null; f.afterLookup = null;
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.startsWith('data:')) return nativeFetch(url);
    if (f.readFailure) return new Response('Unavailable', { status: 503 });
    const path = new URL(url).pathname.split('/media/')[1];
    f.afterFetch?.();
    return f.files.has(path) ? new Response(f.files.get(path), { headers: { 'content-type': 'image/png' } }) : new Response('Missing', { status: 404 });
  });
  t.mock.method(console, 'error', () => {});
  const oldReader = globalThis.FileReader;
  globalThis.FileReader = class { readAsDataURL(blob) { blob.arrayBuffer().then(data => { this.result = `data:${blob.type};base64,${Buffer.from(data).toString('base64')}`; this.onload(); }); } };
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  t.after(() => {
    if (oldReader === undefined) delete globalThis.FileReader; else globalThis.FileReader = oldReader;
    if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage;
  });
}
test('a private saved reference remains usable after deleting its source gallery image', async t => {
  setup(t); await service.saveReferenceImage(image());
  await service.deleteImage({ id: 'source', mediaType: 'image', storagePath: sourcePath });
  assert.equal(f.files.has(sourcePath), false, 'the original really was deleted');
  const [saved] = await service.getReferenceGallery();
  assert.ok(saved.data.startsWith('data:image/png;base64,'));
  assert.deepEqual(Buffer.from(await (await fetch(saved.data)).arrayBuffer()), bytes);
});
test('saving returns an independent snapshot without changing the draft input', async t => {
  setup(t); const input = image(); const saved = await service.saveReferenceImage(input);
  assert.equal(input.data, sourceUrl);
  assert.ok(saved?.data.startsWith('data:image/png;base64,'));
  assert.equal(saved.data, f.references[0].data);
});
test('a failed source read leaves the old saved row unchanged and supports retry', async t => {
  setup(t); f.references = [{ id: 'saved', data: 'old snapshot' }]; f.readFailure = true;
  await assert.rejects(service.saveReferenceImage(image()), /could not be saved/i);
  assert.equal(f.writes, 0); assert.equal(f.references[0].data, 'old snapshot');
  f.readFailure = false; const saved = await service.saveReferenceImage(image());
  assert.ok(saved.data.startsWith('data:image/png;base64,')); assert.equal(f.writes, 1);
});
test('already embedded photos retain their exact bytes without another source fetch', async t => {
  setup(t); const input = { ...image(), data: `data:image/png;base64,${bytes.toString('base64')}` };
  f.readFailure = true; await service.saveReferenceImage(input);
  assert.equal(f.references[0].data, input.data);
});

// The real composer save path must install the returned snapshot, not its source URL.
const controls = readFileSync(new URL('../src/components/Controls.tsx', import.meta.url), 'utf8');
const from = controls.indexOf('  const handleGalleryDrop = async');
const handler = controls.slice(from, controls.indexOf('  const handleAddFromGallery', from));
const compiled = transformSync(`module.exports = env => { const { config, refGallery, saveReferenceImage, setRefGallery, setGenerationError, setIsDraggingToGallery } = env; ${handler}; return handleGalleryDrop; };`, { loader: 'ts', format: 'cjs' }).code;
test('the composer saves a URL-backed draft reference using the returned durable snapshot', async () => {
  const mod = { exports: {} }; new Function('module', compiled)(mod);
  const snapshot = { ...image(), data: 'data:image/png;base64,c25hcHNob3Q=' }; let gallery = [];
  const handler = mod.exports({ config: { referenceImages: [{ id: 'ref', data: sourceUrl, mimeType: 'image/png' }] }, refGallery: gallery,
    saveReferenceImage: async input => ({ ...input, data: snapshot.data }), setRefGallery: update => { gallery = update(gallery); }, setGenerationError: error => assert.fail(error), setIsDraggingToGallery() {} });
  await handler({ preventDefault() {}, dataTransfer: { getData: type => type === 'application/nanogen-ref-id' ? 'ref' : '' } });
  assert.equal(gallery.length, 1);
  assert.equal(gallery[0].data, snapshot.data);
});

test('shared URL-backed references retain their independent snapshot behavior', async t => {
  setup(t); const saved = await service.saveReferenceImage({ ...image(), isShared: true });
  assert.ok(saved.data.startsWith('data:image/png;base64,'));
  assert.equal(f.references[0].is_shared, true);
});
test('an account change during the source read prevents the write', async t => {
  setup(t); f.afterFetch = () => { f.user = 'other'; };
  await assert.rejects(service.saveReferenceImage(image()), /could not be saved/i);
  assert.equal(f.writes, 0);
});
test('another owner’s saved reference cannot be changed', async t => {
  setup(t);
  await assert.rejects(service.saveReferenceImage({ ...image(), canEdit: false }), /Only the owner/);
  assert.equal(f.writes, 0);
});
const editorSource = readFileSync(new URL('../src/components/SavedReferenceImages.tsx', import.meta.url), 'utf8');
const saveStart = editorSource.indexOf('  const save = async');
const editorSave = editorSource.slice(saveStart, editorSource.indexOf('  const remove = async', saveStart));
const editorCompiled = transformSync(`module.exports = env => { const { editing, busy, mounted, saveReferenceImage, onSaved, setEditing, setBusy, setError } = env; ${editorSave}; return save; };`, { loader: 'ts', format: 'cjs' }).code;
test('the saved-reference editor publishes the returned snapshot to its parent', async () => {
  const mod = { exports: {} }; new Function('module', editorCompiled)(mod);
  const snapshot = { ...image(), data: 'data:image/png;base64,c25hcHNob3Q=' }; let published, editor = image(), busy;
  const save = mod.exports({ editing: editor, busy: false, mounted: { current: true }, saveReferenceImage: async () => snapshot,
    onSaved: value => { published = value; }, setEditing: value => { editor = value; }, setBusy: value => { busy = value; }, setError: error => { if (error) assert.fail(error); } });
  await save(); assert.deepEqual(published, snapshot); assert.equal(editor, null); assert.equal(busy, false);
});
test('saving the same URL-backed composer reference twice does not duplicate its saved row', async t => {
  setup(t); const mod = { exports: {} }; new Function('module', compiled)(mod);
  let gallery = [];
  const render = () => mod.exports({ config: { referenceImages: [{ id: 'ref', data: sourceUrl, mimeType: 'image/png' }] }, refGallery: gallery,
    saveReferenceImage: service.saveReferenceImage, setRefGallery: update => { gallery = update(gallery); }, setGenerationError: error => assert.fail(error), setIsDraggingToGallery() {} });
  const event = { preventDefault() {}, dataTransfer: { getData: type => type === 'application/nanogen-ref-id' ? 'ref' : '' } };
  await render()(event); await render()(event);
  assert.equal(f.writes, 1);
  assert.equal(gallery.length, 1);
});
test('a matching shared reference from another owner does not replace a private save', async t => {
  setup(t); const data = `data:image/png;base64,${bytes.toString('base64')}`;
  const shared = { ...image(), id: 'shared', data, isShared: true, canEdit: false };
  f.references = [{ id: shared.id, user_id: 'teammate', data, is_shared: true }];
  const saved = await service.saveReferenceImage(image(), [shared]);
  assert.equal(f.writes, 1);
  assert.equal(saved.id, 'saved');
  assert.equal(f.references[0].user_id, 'owner');
  assert.equal(f.references[0].is_shared, false);
});
test('a cached duplicate deleted during snapshotting is saved as a new private entry', async t => {
  setup(t); const data = `data:image/png;base64,${bytes.toString('base64')}`;
  const stale = { ...image(), id: 'old', data, canEdit: true };
  f.references = [{ id: stale.id, user_id: 'owner', data, is_shared: false }];
  f.afterFetch = () => { f.references = []; };
  const saved = await service.saveReferenceImage(image(), [stale]);
  assert.equal(f.writes, 1);
  assert.equal(saved.id, 'saved');
  assert.equal(f.references[0].id, 'saved');
});

test('a duplicate whose stored bytes changed is not reused for a different snapshot', async t => {
  setup(t); const data = `data:image/png;base64,${bytes.toString('base64')}`;
  const stale = { ...image(), id: 'old', data, canEdit: true };
  f.references = [{ id: 'old', user_id: 'owner', data: 'updated photo' }];
  const saved = await service.saveReferenceImage(image(), [stale]);
  assert.equal(saved.id, 'saved'); assert.equal(f.writes, 1);
  assert.equal(f.references.find(row => row.id === 'old').data, 'updated photo');
});
test('a failed duplicate lookup rejects without another write and can be retried', async t => {
  setup(t); const data = `data:image/png;base64,${bytes.toString('base64')}`;
  const existing = { ...image(), data, canEdit: true };
  f.references = [{ id: existing.id, user_id: 'owner', data }];
  f.lookupError = { message: 'Unavailable' };
  await assert.rejects(service.saveReferenceImage(image(), [existing]), /could not be saved/);
  assert.equal(f.writes, 0);
  f.lookupError = null;
  assert.deepEqual(await service.saveReferenceImage(image(), [existing]), existing);
  assert.equal(f.writes, 0);
});
test('changing accounts during duplicate confirmation cannot return an old account entry', async t => {
  setup(t); const data = `data:image/png;base64,${bytes.toString('base64')}`;
  const existing = { ...image(), data, canEdit: true };
  f.references = [{ id: existing.id, user_id: 'owner', data }];
  f.afterLookup = () => { f.user = 'other'; };
  await assert.rejects(service.saveReferenceImage(image(), [existing]), /could not be saved/);
  assert.equal(f.writes, 0);
});
