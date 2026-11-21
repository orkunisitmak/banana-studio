import test from 'node:test';
import assert from 'node:assert/strict';
import { build, transform } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WorkspaceQuery } from '../desktop/shared/query.mjs';

const f = { user: 'user-1', rows: [], uploads: new Map(), uploadError: false, fetchHook: null, uploadCalls: 0, failUploadAt: null, signError: false, removed: [], upsertError: null, userRead: null, removeError: false, afterUpload: null, lostWriteAck: false, upsertAfterWriteError: null };
f.client = {
  from: table => new WorkspaceQuery(async plan => {
    assert.equal(table, 'templates');
    if (plan.operation === 'upsert') { if (f.upsertError) return { error: f.upsertError }; f.rows = [structuredClone(plan.value)]; if (f.upsertAfterWriteError) return { error: f.upsertAfterWriteError }; if (f.lostWriteAck) throw new Error('Write acknowledgement lost'); return { error: null }; }
    return { data: f.rows.filter(row => plan.filters.every(filter => row[filter.column] === filter.value)), error: null };
  }, table),
  storage: { from: () => ({
    upload: async (path, blob) => { f.uploadCalls++; if (f.uploadError || f.uploadCalls === f.failUploadAt) return { error: { message: 'Storage unavailable' } }; f.uploads.set(path, blob); await f.afterUpload?.(); return { error: null }; },
    remove: async paths => { f.removed.push(...paths); if (f.removeError) return { error: { message: 'Cleanup unavailable' } }; paths.forEach(path => f.uploads.delete(path)); return { error: null }; },
    createSignedUrl: async path => f.signError ? { data: null, error: { statusCode: 403, message: 'Forbidden' } } : ({ data: { signedUrl: `https://storage.invalid/storage/v1/object/sign/media/${path}?token=temporary` }, error: null }),
  }) },
};
globalThis.__templateAudio = f;
const compiled = await build({ stdin: { contents: "export { saveTemplate, getTemplates } from './src/services/storageService';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'template-audio', setup(b) {
    b.onResolve({ filter: /\/authService$|^tus-js-client$|^@supabase\/supabase-js$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'tus-js-client' ? 'export class Upload {}' : args.path === '@supabase/supabase-js' ? "export const isAuthSessionMissingError = e => e?.name === 'AuthSessionMissingError';" :
      "export const supabase=globalThis.__templateAudio.client; export const getCurrentUserId=async()=>globalThis.__templateAudio.userRead ? globalThis.__templateAudio.userRead() : globalThis.__templateAudio.user,SUPABASE_URL='https://storage.invalid';" }));
  } }] });
const { saveTemplate, getTemplates } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function setup(t) {
  Object.assign(f, { user: 'user-1', rows: [], uploads: new Map(), uploadError: false, fetchHook: null, uploadCalls: 0, failUploadAt: null, signError: false, removed: [], upsertError: null, userRead: null, removeError: false, afterUpload: null, lostWriteAck: false, upsertAfterWriteError: null });
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, ...args) => {
    if (String(url).startsWith('blob:')) { const result = await nativeFetch(url, ...args); await f.fetchHook?.(); return result; }
    const path = new URL(url).pathname.split('/media/')[1];
    const blob = f.uploads.get(path);
    return blob ? new Response(blob) : new Response('Missing', { status: 404 });
  });
  t.mock.method(console, 'warn', () => {});
}
const template = url => ({ id: 'template', name: 'Soundtrack', createdAt: 1,
  config: { prompt: 'A video with this soundtrack', mode: 'video', referenceImages: [], referenceAudios: [{ id: 'audio', url, name: 'sound.wav', mimeType: 'audio/wav', duration: 5 }] } });
const audio = new Blob(['RIFFsyntheticWAVEaudio'], { type: 'audio/wav' });

test('saved template audio survives revocation of the picker URL and retains its bytes', async t => {
  setup(t);
  const url = URL.createObjectURL(audio);
  t.after(() => URL.revokeObjectURL(url));
  const original = template(url);
  const saved = await saveTemplate(original);
  URL.revokeObjectURL(url);
  const [loaded] = await getTemplates();
  const response = await fetch(loaded.config.referenceAudios[0].url);
  assert.equal(response.ok, true);
  assert.equal(await response.text(), await audio.text());
  assert.ok(!f.rows[0].config.referenceAudios[0].url.startsWith('blob:'));
  assert.ok(!f.rows[0].config.referenceAudios[0].url.includes('token='));
  assert.deepEqual(saved.config, loaded.config);
  assert.equal(original.config.referenceAudios[0].url, url);
});

test('an unreadable local clip rejects the save without writing a broken template', async t => {
  setup(t);
  const url = URL.createObjectURL(audio); URL.revokeObjectURL(url);
  await assert.rejects(saveTemplate(template(url)));
  assert.deepEqual(f.rows, []);
});

test('an upload failure rejects without changing the draft and allows retry', async t => {
  setup(t); f.uploadError = true;
  const url = URL.createObjectURL(audio); t.after(() => URL.revokeObjectURL(url));
  const draft = template(url);
  await assert.rejects(saveTemplate(draft), /audio|upload/i);
  assert.deepEqual(f.rows, []);
  f.uploadError = false;
  const saved = await saveTemplate(draft);
  assert.ok(saved.config.referenceAudios[0].url.startsWith('https://'));
  assert.equal(draft.config.referenceAudios[0].url, url);
  assert.equal(f.rows.length, 1);
});

test('existing durable clips are not downloaded or uploaded again', async t => {
  setup(t);
  const value = template('https://cdn.invalid/audio.mp3');
  await saveTemplate(value);
  assert.equal(f.uploads.size, 0);
  assert.deepEqual(f.rows[0].config, value.config);
});

test('an account change during local audio preparation cannot save the template', async t => {
  setup(t); f.fetchHook = async () => { f.user = 'user-2'; };
  const url = URL.createObjectURL(audio); t.after(() => URL.revokeObjectURL(url));
  await assert.rejects(saveTemplate(template(url)), /session|account/i);
  assert.deepEqual(f.rows, []);
});

// Exercise the real create/update handlers: the visible list must use the
// durable snapshot returned by storage, not the original picker URLs.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const start = app.indexOf('  const handleSaveTemplate = async');
const end = app.indexOf('  const handleDeleteTemplate = async', start);
assert.ok(start > 0 && end > start);
const handlers = await transform(`export const create = (config, saveTemplate, setTemplates, toast) => {
  ${app.slice(start, end)}
  return { save: handleSaveTemplate, update: handleUpdateTemplate };
};`, { loader: 'ts', format: 'esm' });
const { create } = await import('data:text/javascript;base64,' + Buffer.from(handlers.code).toString('base64'));
for (const operation of ['save', 'update']) {
  test(`template ${operation} keeps the durable snapshot in the visible list`, async () => {
    const original = template('blob:picker');
    const durable = template('https://storage.invalid/stored-audio.wav');
    let rows = operation === 'update' ? [original] : [];
    const handler = create(original.config, async value => ({ ...value, config: durable.config }),
      update => { rows = update(rows); }, { success() {}, error() { assert.fail('Save should succeed'); } });
    await handler[operation](operation === 'update' ? original : original.name);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].config, durable.config);
    assert.equal(original.config.referenceAudios[0].url, 'blob:picker');
  });
}

test('image-only templates retain their existing shape without uploading media', async t => {
  setup(t);
  const value = template('unused');
  delete value.config.referenceAudios;
  const saved = await saveTemplate(value);
  assert.deepEqual(saved.config, value.config);
  assert.equal(f.uploads.size, 0);
});

test('an empty picker-backed clip cannot become a saved reference', async t => {
  setup(t);
  const url = URL.createObjectURL(new Blob([], { type: 'audio/wav' }));
  t.after(() => URL.revokeObjectURL(url));
  await assert.rejects(saveTemplate(template(url)), /empty/i);
  assert.deepEqual(f.rows, []);
});

function twoClips(t) {
  const urls = [URL.createObjectURL(audio), URL.createObjectURL(audio)];
  t.after(() => urls.forEach(url => URL.revokeObjectURL(url)));
  const value = template(urls[0]);
  value.config.referenceAudios.push({ ...value.config.referenceAudios[0], id: 'second', url: urls[1] });
  return value;
}

test('a second upload failure rolls back new objects and retry retains only the saved clips', async t => {
  setup(t);
  const value = twoClips(t);
  f.failUploadAt = 2;
  await assert.rejects(saveTemplate(value), /upload/i);
  assert.deepEqual(f.rows, []);
  assert.equal(f.uploads.size, 0);
  assert.ok(f.removed.some(path => path.startsWith('user-1/template_audio_')));
  f.failUploadAt = null;
  const saved = await saveTemplate(value);
  assert.equal(saved.config.referenceAudios.length, 2);
  assert.equal(f.uploads.size, 2);
  assert.equal(f.rows.length, 1);
});

test('failed URL signing after upload still removes the newly uploaded bytes', async t => {
  setup(t); f.signError = true;
  const url = URL.createObjectURL(audio); t.after(() => URL.revokeObjectURL(url));
  await assert.rejects(saveTemplate(template(url)), /upload/i);
  assert.equal(f.uploads.size, 0);
  assert.deepEqual(f.rows, []);
});

test('a later account lookup cannot retarget a template upload to another owner', async t => {
  setup(t);
  let reads = 0;
  f.userRead = () => ++reads < 3 ? 'user-1' : 'user-2';
  const url = URL.createObjectURL(audio); t.after(() => URL.revokeObjectURL(url));
  await assert.rejects(saveTemplate(template(url)), /account|upload/i);
  assert.equal(f.uploadCalls, 0);
  assert.equal(f.uploads.size, 0);
  assert.deepEqual(f.rows, []);
});

test('a definite database rejection rolls back only newly staged audio', async t => {
  setup(t);
  const value = twoClips(t);
  f.uploads.set('user-1/existing.wav', audio);
  value.config.referenceAudios.unshift({ id: 'existing', url: 'https://storage.invalid/storage/v1/object/authenticated/media/user-1/existing.wav', mimeType: 'audio/wav' });
  f.upsertError = { code: '23514', message: 'Template rejected' };
  await assert.rejects(saveTemplate(value), /Template rejected/);
  assert.deepEqual([...f.uploads.keys()], ['user-1/existing.wav']);
  assert.ok(!f.removed.includes('user-1/existing.wav'));
  assert.deepEqual(f.rows, []);
});

for (const failure of ['unreadable', 'empty']) {
  test(`a later ${failure} clip rolls back earlier uploads before any template write`, async t => {
    setup(t);
    const value = twoClips(t);
    if (failure === 'unreadable') URL.revokeObjectURL(value.config.referenceAudios[1].url);
    else {
      const empty = URL.createObjectURL(new Blob([], { type: 'audio/wav' }));
      t.after(() => URL.revokeObjectURL(empty));
      value.config.referenceAudios[1].url = empty;
    }
    await assert.rejects(saveTemplate(value));
    assert.equal(f.uploads.size, 0);
    assert.deepEqual(f.rows, []);
    assert.ok(f.removed.length > 0);
  });
}

test('an account change skips cleanup with new credentials and reports retained files', async t => {
  setup(t);
  f.afterUpload = async () => { f.user = 'user-2'; };
  const from = f.client.storage.from;
  t.mock.method(f.client.storage, 'from', bucket => ({ ...from(bucket), remove: async paths => {
    // Model owner-scoped deletion: account 2 cannot remove account 1's audio.
    f.removed.push(...paths);
    return { error: { message: 'Permission denied' } };
  } }));
  const warn = t.mock.method(console, 'warn', () => {});
  await assert.rejects(saveTemplate(twoClips(t)), /account/i);
  assert.equal(f.uploads.size, 1);
  assert.ok([...f.uploads.keys()].every(path => path.startsWith('user-1/')));
  assert.deepEqual(f.rows, []);
  assert.deepEqual(f.removed, []);
  assert.ok(warn.mock.calls.some(call => /retained.*account changed/i.test(call.arguments[0])));
});

test('cleanup failure preserves the preparation error and reports the unsuccessful cleanup', async t => {
  setup(t); f.failUploadAt = 2; f.removeError = true;
  const warn = t.mock.method(console, 'warn', () => {});
  await assert.rejects(saveTemplate(twoClips(t)), /Upload rejected for audio\/wav: Storage unavailable/);
  assert.deepEqual(f.rows, []);
  assert.ok(f.removed.length > 0);
  assert.ok(warn.mock.calls.some(call => /Uncommitted template audio/.test(call.arguments[0])));
});

test('a lost database acknowledgement never deletes audio a committed template may reference', async t => {
  setup(t); f.lostWriteAck = true;
  await assert.rejects(saveTemplate(twoClips(t)), /Write acknowledgement lost/);
  assert.equal(f.rows.length, 1);
  assert.equal(f.uploads.size, 2);
  assert.deepEqual(f.removed, []);
});

for (const code of ['08006', 'EPIPE']) {
  test(`an ambiguous write error (${code}) retains possibly committed audio`, async t => {
    setup(t); f.upsertAfterWriteError = { code, message: 'Connection lost after write' };
    await assert.rejects(saveTemplate(twoClips(t)), /Connection lost after write/);
    assert.equal(f.rows.length, 1);
    assert.equal(f.uploads.size, 2);
    assert.deepEqual(f.removed, []);
  });
}

for (const operation of ['save', 'update']) {
  test(`template ${operation} displays an upload error without changing the visible list`, async t => {
    setup(t); t.mock.method(console, 'error', () => {});
    for (const error of [new Error('Upload rejected for audio/mpeg: MIME type is not allowed'), 'unexpected']) {
      const original = template('blob:picker');
      let rows = [original];
      const notifications = [];
      const handler = create(original.config, async () => { throw error; }, update => { rows = update(rows); },
        { success() { assert.fail('Rejected template cannot succeed'); }, error: (...args) => notifications.push(args) });
      await handler[operation](operation === 'update' ? original : original.name);
      assert.deepEqual(rows, [original]);
      assert.deepEqual(notifications, [[operation === 'save' ? 'Save Failed' : 'Update Failed',
        error instanceof Error ? error.message : operation === 'save' ? 'Could not save template.' : 'Could not update template.']]);
    }
  });
}
