import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Runs the exact App persistCompletedVideo, resumeVideoPolling and handleDelete source.
// The provider result is gated so the delete always lands first.
import { transformSync } from 'esbuild';
const src = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const a = src.indexOf('  const persistCompletedVideo = async');
const b = src.indexOf('  const handleRecoverVideo = ', a);
const hd = src.indexOf('  const handleDelete = async');
const he = src.indexOf('  const handleDeleteMultiple', hd);
const fd = src.indexOf('  const handleDeleteFolder = async');
const fe = src.indexOf('  const handleRenameFolder', fd);
const body = src.slice(a, b) + src.slice(hd, he) + src.slice(fd, fe);
const cls = (src.match(/class DeletedVideoError[^\n]*\n/) || [''])[0];
const code = transformSync(`${cls}module.exports = (env) => { const { setGeneratedMedia, setActiveRequests, pollVideoTask, saveVideo, deleteImage, updateVideoStatus, getImageById, assertWorkspaceSession, toast, deletedMediaIdsRef, RecoverableVideoTaskError, isRecoverableVideoTaskError, DEFAULT_VIDEO_MODEL, deleteFolder, setTimeout, generatedMedia, workspaceStorage } = env; ${body}; return { resumeVideoPolling, handleDelete, handleDeleteFolder }; };`, { loader: 'ts', format: 'cjs' }).code;
class FolderDeleteError extends Error { constructor(message, keptMediaIds) { super(message); this.keptMediaIds = keptMediaIds; } }
const run = async deleteWhen => {
  const calls = { saveCalls: 0, saved: 0, deleted: [], completed: 0, toasts: [] };
  let retryWait;
  let items = [{ id: 'v1', mediaType: 'video', status: 'processing', isLoading: true, folderId: 'f1' }];
  let release, releaseSave;
  const env = {
    setGeneratedMedia: f => { items = typeof f === 'function' ? f(items) : f; }, setActiveRequests() {},
    pollVideoTask: () => new Promise(r => { release = () => r({ urls: ['https://provider/v.mp4'] }); }),
    saveVideo: async () => { calls.saveCalls++; if (deleteWhen === 'retry' && calls.saveCalls === 1) return null; if (deleteWhen === 'saving') await new Promise(r => { releaseSave = r; }); calls.saved++; return { publicUrl: 'https://store/v.mp4', storagePath: 'u/v1.mp4', thumbnailPath: 'u/v1.png' }; },
    deleteImage: async m => { calls.deleted.push(m.storagePath || 'default'); },
    updateVideoStatus: async (id, status) => { if (status === 'completed') calls.completed++; },
    getImageById: async () => null, assertWorkspaceSession: async () => {},
    toast: { success: t => calls.toasts.push(t), warning: t => calls.toasts.push(t), error: t => calls.toasts.push(t), dismissToast() {} },
    deletedMediaIdsRef: { current: new Set() },
    RecoverableVideoTaskError: class extends Error {}, isRecoverableVideoTaskError: () => false, DEFAULT_VIDEO_MODEL: 'm',
    // The ids are reported before the rows are deleted, as the real deleteFolder does.
    deleteFolder: async (_id, onMediaIds) => {
      // 'folder-new-row': the row was not visible to the delete yet; only the folder ids are reported.
      onMediaIds?.(deleteWhen === 'folder-new-row' ? [] : ['v1'], ['f1']);
      calls.markedBeforeDelete = env.deletedMediaIdsRef.current.has('v1');
      if (deleteWhen === 'folder-failed') throw new FolderDeleteError('Folder media could not be deleted: x', ['v1']);
      return { folderIds: ['f1'], mediaIds: deleteWhen === 'folder-new-row' ? [] : ['v1'] };
    },
    generatedMedia: items, workspaceStorage: { FolderDeleteError },
    // The wait between save attempts is gated so the delete lands inside it.
    setTimeout: deleteWhen === 'retry' ? fn => { retryWait = fn; } : setTimeout,
  };
  const mod = { exports: {} };
  new Function('module', 'exports', code)(mod, mod.exports);
  const { resumeVideoPolling, handleDelete, handleDeleteFolder } = mod.exports(env);
  const done = resumeVideoPolling('v1', 'task1', items[0]);
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  if (deleteWhen === 'polling') await handleDelete(items[0]);
  if (deleteWhen.startsWith('folder')) await handleDeleteFolder('f1').catch(() => {});
  release();
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  if (deleteWhen === 'saving') { await handleDelete({ id: 'v1', mediaType: 'video' }); releaseSave(); }
  if (deleteWhen === 'retry') { await handleDelete({ id: 'v1', mediaType: 'video' }); retryWait(); }
  await done;
  return { cardPresent: items.length === 1, ...calls };
};

test('a video cancelled while polling is never saved again', async () => {
  const result = await run('polling');
  assert.equal(result.saved, 0);
  assert.equal(result.completed, 0);
  assert.deepEqual(result.toasts, []);
});

test('a video deleted while it is being saved has that copy removed', async () => {
  const result = await run('saving');
  assert.ok(result.deleted.includes('u/v1.mp4'));
  assert.equal(result.completed, 0);
  assert.deepEqual(result.toasts, []);
});

test('a video deleted between save attempts is not saved on the retry', async () => {
  const result = await run('retry');
  assert.equal(result.saveCalls, 1);
  assert.equal(result.saved, 0);
  assert.equal(result.completed, 0);
  assert.deepEqual(result.toasts, []);
});

test('a running video in a deleted folder is never saved again', async () => {
  const result = await run('folder');
  assert.equal(result.markedBeforeDelete, true);
  assert.equal(result.saved, 0);
  assert.equal(result.completed, 0);
  assert.ok(!result.toasts.includes('Video Ready'));
});

test('a video whose folder delete failed is saved and completed as usual', async () => {
  const result = await run('folder-failed');
  assert.equal(result.markedBeforeDelete, true);
  assert.equal(result.saved, 1);
  assert.equal(result.completed, 1);
});

test('a video whose row was not visible to the folder delete is still marked and its row removed', async () => {
  const result = await run('folder-new-row');
  assert.equal(result.markedBeforeDelete, true);
  assert.deepEqual(result.deleted, ['default']);
  assert.equal(result.saved, 0);
  assert.equal(result.cardPresent, false);
});

test('a video that is not deleted is still saved and completed', async () => {
  const result = await run('never');
  assert.equal(result.saved, 1);
  assert.equal(result.completed, 1);
  assert.ok(result.cardPresent);
});

// The exact handleGenerate lines from the first row save up to the provider submission.
const ps = src.indexOf('      const pendingSaved=await createPendingVideo(videoId,'), pe = src.indexOf('      const progressToastId = toast.loading(', ps);
const submit = transformSync(`async () => {\n${src.slice(ps, pe)}\nreturn 'submitted'; }`, { loader: 'ts' }).code.trim().replace(/;$/, '');
const createRow = async deleteDuringCreate => {
  const deleted = new Set(), removed = []; let active = 1, heartbeats = 0;
  const env = {
    videoId: 'vid1', config: { prompt: 'p' }, DEFAULT_VIDEO_MODEL: 'm', requestedVideoAspectRatio: '16:9', requestedVideoDuration: 5, effectiveVideoPromptExpansionMode: 'off',
    h3MaxMode: undefined, currentFolderId: null, genStart: 0, placeholder: { id: 'vid1' },
    // handleDelete runs while the row is still being created.
    createPendingVideo: async () => { if (deleteDuringCreate) deleted.add('vid1'); return true; },
    deletedMediaIdsRef: { current: deleted }, deleteImage: async media => { removed.push(media.id); },
    setGeneratedMedia() {}, setActiveRequests: f => { active = f(active); }, toast: { error() {}, loading: () => 't' },
    // The submission heartbeat must not start for a video that is not submitted.
    setInterval: () => { heartbeats++; return 0; }, refreshVideoSubmission: async () => true, VIDEO_SUBMISSION_HEARTBEAT_INTERVAL_MS: 15_000,
  };
  const outcome = await new Function(...Object.keys(env), `return (${submit})();`)(...Object.values(env));
  return { outcome: outcome ?? 'stopped', removed, active, heartbeats };
};

test('a video deleted while its first row is created removes that row and is never submitted', async () => {
  assert.deepEqual(await createRow(true), { outcome: 'stopped', removed: ['vid1'], active: 0, heartbeats: 0 });
  assert.deepEqual(await createRow(false), { outcome: 'submitted', removed: [], active: 1, heartbeats: 1 });
});
