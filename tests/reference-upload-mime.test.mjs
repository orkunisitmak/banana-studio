import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build, transform } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Exercise the existing picker helper without mounting the entire workspace.
const controls = fs.readFileSync(new URL('../src/components/Controls.tsx', import.meta.url), 'utf8');
const start = controls.indexOf('const getMimeType =');
const end = controls.indexOf('const readFileAsBase64 =', start);
assert.ok(start >= 0 && end > start);
const helper = await transform(`${controls.slice(start, end)}\nexport { getMimeType };`, { loader: 'ts', format: 'esm' });
const { getMimeType } = await import('data:text/javascript;base64,' + Buffer.from(helper.code).toString('base64'));

const state = { uploads: [], rows: [] };
globalThis.__referenceMimeUpload = {
  storage: { from: bucket => {
    assert.equal(bucket, 'media');
    return {
      upload: async (path, blob, options) => {
        // Model the new bucket's MIME gate. This tests the client's upload
        // metadata, not the Supabase Storage HTTP implementation.
        if (!/^(image|video|audio)\//.test(options.contentType)) return { error: { message: 'MIME type is not allowed' } };
        state.uploads.push({ path, blob, contentType: options.contentType });
        return { error: null };
      },
      createSignedUrl: async path => ({ data: { signedUrl: `https://storage.invalid/storage/v1/object/sign/media/${path}?token=synthetic` }, error: null }),
      remove: async () => ({ error: null }),
    };
  } },
  from: table => {
    assert.equal(table, 'templates');
    return { upsert: async row => { state.rows.push(row); return { error: null }; } };
  },
};
const compiled = await build({ stdin: {
  contents: "export { uploadBase64ToPublicUrl, saveTemplate } from './src/services/storageService';",
  resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
}, bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'reference-mime-upload', setup(b) {
  b.onResolve({ filter: /\/authService$|^tus-js-client$|^@supabase\/supabase-js$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'tus-js-client' ? 'export class Upload {}' : args.path === '@supabase/supabase-js' ?
    "export const isAuthSessionMissingError = () => false;" :
    "export const supabase = globalThis.__referenceMimeUpload, getCurrentUserId = async () => 'user-1', SUPABASE_URL = 'https://storage.invalid';" }));
} }] });
const { uploadBase64ToPublicUrl, saveTemplate } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

function setup(t) {
  state.uploads = []; state.rows = [];
  t.mock.method(console, 'warn', () => {});
}

test('empty and generic picker MIME types use recognized media extensions', () => {
  const cases = { PNG: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogg: 'audio/ogg', oga: 'audio/ogg', aac: 'audio/aac',
    m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aif: 'audio/aiff', aiff: 'audio/aiff' };
  for (const type of ['', 'application/octet-stream']) {
    for (const [ext, expected] of Object.entries(cases)) {
      const file = new File(['synthetic-media'], `reference.${ext}`, { type });
      assert.equal(getMimeType(file, file.name), expected, `${type || '(empty)'}: ${file.name}`);
      assert.equal(file.type, type, 'MIME inference must not mutate the picker file');
    }
  }
});

test('specific MIME types and unrecognized filenames are not relabeled as media', () => {
  assert.equal(getMimeType(new Blob([], { type: 'image/jpeg' }), 'photo.png'), 'image/jpeg');
  assert.equal(getMimeType(new Blob([], { type: 'text/plain' }), 'photo.png'), 'text/plain');
  for (const name of [undefined, 'unknown', 'document.bin', 'document.pdf']) {
    assert.equal(getMimeType(new Blob([], { type: 'application/octet-stream' }), name), 'application/octet-stream');
  }
});

test('generic PNG picker bytes retain the inferred MIME through reference storage upload', async t => {
  setup(t);
  const file = new File(['synthetic-png'], 'photo.png', { type: 'application/octet-stream' });
  const data = `data:application/octet-stream;base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;
  const url = await uploadBase64ToPublicUrl(data, getMimeType(file, file.name));
  assert.ok(url?.startsWith('https://storage.invalid/'));
  assert.equal(state.uploads[0].contentType, 'image/png');
  assert.equal(state.uploads[0].blob.type, 'image/png');
  assert.equal(await state.uploads[0].blob.text(), 'synthetic-png');
});

test('generic MP3 picker bytes keep their inferred MIME when saving a template', async t => {
  setup(t);
  const file = new File(['synthetic-mp3'], 'clip.mp3', { type: 'application/octet-stream' });
  const url = URL.createObjectURL(file);
  t.after(() => URL.revokeObjectURL(url));
  const saved = await saveTemplate({ id: 'template', name: 'Soundtrack', createdAt: 1,
    config: { prompt: 'Synthetic', referenceImages: [], referenceAudios: [{ id: 'clip', url, name: file.name, mimeType: getMimeType(file, file.name) }] } });
  assert.equal(state.uploads[0].contentType, 'audio/mpeg');
  assert.equal(await state.uploads[0].blob.text(), 'synthetic-mp3');
  assert.equal(saved.config.referenceAudios[0].mimeType, 'audio/mpeg');
  assert.ok(!saved.config.referenceAudios[0].url.startsWith('blob:'));
  assert.equal(state.rows.length, 1);
});

test('unrecognized binary uploads still fail the media MIME gate', async t => {
  setup(t);
  const file = new File(['unknown'], 'data.bin', { type: 'application/octet-stream' });
  const url = await uploadBase64ToPublicUrl('data:application/octet-stream;base64,dW5rbm93bg==', getMimeType(file, file.name));
  assert.equal(url, null);
  assert.equal(state.uploads.length, 0);
});
