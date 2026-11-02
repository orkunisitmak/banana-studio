import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Run the real session wrapper and the two delete handlers from App.tsx; only the session lookup, storage calls and UI are faked.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const slice = (from, to) => { const i = app.indexOf(from); return app.slice(i, app.indexOf(to, i)); };
const code = transformSync(`module.exports = env => { const { getSession, workspaceActive, userId, workspaceStorage, generatedMedia, setGeneratedMedia, toast, deletedMediaIdsRef, describeMediaCount } = env;
${slice('/** The workspace session check failed.', 'export default function App')}
${slice('  const assertWorkspaceSession', '  const saveImage')}
const deleteImage = withWorkspaceSession(workspaceStorage.deleteImage);
const deleteImages = withWorkspaceSession(workspaceStorage.deleteImages);
${slice('  // Put items whose delete never ran', '  const handleToggleFavorite')}
return { handleDelete, handleDeleteMultiple }; };`, { loader: 'ts', format: 'cjs' }).code;

class DeleteNotQueuedError extends Error {}
const items = ['a', 'b'].map(id => ({ id, mediaType: 'image' }));
// sessionChecks: the signed-in user id for each check, in order (the wrapper checks before and after the call).
const setup = ({ sessionChecks, deleteImage = async () => {}, deleteImages = async () => ({ notQueued: [], queued: [] }) }) => {
  const mod = { exports: {} }; new Function('module', code)(mod);
  const toasts = [];
  let list = items.slice(), checks = 0, calls = 0;
  const env = {
    getSession: async () => ({ user: { id: sessionChecks[checks++] } }), workspaceActive: { current: true }, userId: 'u1',
    workspaceStorage: { DeleteNotQueuedError, deleteImage: async (...a) => { calls++; return deleteImage(...a); }, deleteImages: async (...a) => { calls++; return deleteImages(...a); } },
    generatedMedia: items, setGeneratedMedia: update => { list = update(list); },
    toast: { success: (t, m) => toasts.push(`success:${t}:${m}`), error: (t, m) => toasts.push(`error:${t}:${m}`) },
    deletedMediaIdsRef: { current: new Set() },
    describeMediaCount: (ids, media) => { const n = media.filter(m => new Set(ids).has(m.id)).length; return `${n} image${n === 1 ? '' : 's'}`; },
  };
  return { ...mod.exports(env), toasts, list: () => list.map(m => m.id), calls: () => calls };
};
const quiet = async fn => { const original = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = original; } };

test('single delete whose session check fails before the call is put back and never calls storage', async () => {
  const t = setup({ sessionChecks: ['other'] });
  await quiet(() => t.handleDelete(items[0]));
  assert.equal(t.calls(), 0);
  assert.deepEqual(t.list(), ['a', 'b']);
  assert.deepEqual(t.toasts, ['error:Delete Failed:The image could not be deleted and is back in your library. Try again.']);
});

test('single delete whose session check fails after the call stays deleted with no retry promise', async () => {
  const t = setup({ sessionChecks: ['u1', 'other'] });
  await quiet(() => t.handleDelete(items[0]));
  assert.equal(t.calls(), 1);
  assert.deepEqual(t.list(), ['b']);
  assert.deepEqual(t.toasts, []);
});

test('batch delete whose session check fails before the call restores everything', async () => {
  const t = setup({ sessionChecks: ['other'] });
  await quiet(() => t.handleDeleteMultiple(['a', 'b']));
  assert.equal(t.calls(), 0);
  assert.deepEqual(t.list(), ['a', 'b']);
  assert.deepEqual(t.toasts, ['error:Delete Failed:2 images could not be deleted and are back in your library. Try again.']);
});

test('batch delete whose session check fails after the call keeps the finished deletes gone', async () => {
  const t = setup({ sessionChecks: ['u1', 'other'] });
  await quiet(() => t.handleDeleteMultiple(['a', 'b']));
  assert.equal(t.calls(), 1);
  assert.deepEqual(t.list(), []);
  assert.deepEqual(t.toasts, ['success:Deleted:2 images removed.']);
});

test('batch delete whose session check fails after a partial result restores only the not-queued item', async () => {
  const t = setup({ sessionChecks: ['u1', 'other'], deleteImages: async medias => ({ notQueued: [medias[0]], queued: [] }) });
  await quiet(() => t.handleDeleteMultiple(['a', 'b']));
  assert.deepEqual(t.list(), ['a']);
  assert.deepEqual(t.toasts, ['error:Delete Failed:1 image could not be deleted and is back in your library. Try again.']);
});
