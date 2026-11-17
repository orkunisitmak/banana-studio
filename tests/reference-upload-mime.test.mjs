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

const imageStart = controls.indexOf('  const processImageFiles = async');
const imageEnd = controls.indexOf('  // --- Upload Handlers ---', imageStart);
const audioStart = controls.indexOf('  const processAudioFiles = async');
const audioEnd = controls.indexOf('  const handleEnhance = async', audioStart);
assert.ok(imageStart > 0 && imageEnd > imageStart && audioStart > 0 && audioEnd > audioStart);
const pickers = await transform(`export const createPicker = (getMimeType, initial) => {
  let config = initial;
  const onChange = update => { config = typeof update === 'function' ? update(config) : update; };
  const maxReferenceImages = 14, maxReferenceAudios = 3, isH3VideoConfig = false;
  const attachLimitsRef = { current: { images: 14, audios: 3 } }, audioInputRef = { current: null };
  const setAttachmentError = error => { if (error) throw new Error(error); };
  const addAttachmentError = setAttachmentError, flushSync = callback => callback();
  const readAudioDuration = async () => 3, estimateBase64Size = data => data.length;
  const readFileAsBase64 = async file => 'data:' + file.type + ';base64,' + Buffer.from(await file.arrayBuffer()).toString('base64');
  const compressImage = () => { throw new Error('Unexpected compression'); };
  ${controls.slice(imageStart, imageEnd)}
  ${controls.slice(audioStart, audioEnd)}
  return { processImageFiles, handleAudioFileUpload, getConfig: () => config };
};`, { loader: 'ts', format: 'esm' });
const { createPicker } = await import('data:text/javascript;base64,' + Buffer.from(pickers.code).toString('base64'));
const picker = () => createPicker(getMimeType, { mode: 'image', prompt: 'Synthetic', referenceImages: [], referenceAudios: [] });

const state = { uploads: [], rows: [], allowedMimeTypes: null };
globalThis.__referenceMimeUpload = {
  storage: { from: bucket => {
    assert.equal(bucket, 'media');
    return {
      upload: async (path, blob, options) => {
        // Model the new bucket's MIME gate. This tests the client's upload
        // metadata, not the Supabase Storage HTTP implementation.
        if (!/^(image|video|audio)\//.test(options.contentType) || (state.allowedMimeTypes && !state.allowedMimeTypes.includes(options.contentType))) return { error: { message: 'MIME type is not allowed' } };
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
  state.uploads = []; state.rows = []; state.allowedMimeTypes = null;
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
  const input = picker();
  await input.processImageFiles([file]);
  const [reference] = input.getConfig().referenceImages;
  assert.equal(file.type, 'application/octet-stream');
  assert.equal(reference.mimeType, 'image/png');
  const url = await uploadBase64ToPublicUrl(reference.data, reference.mimeType);
  assert.ok(url?.startsWith('https://storage.invalid/'));
  assert.equal(state.uploads[0].contentType, 'image/png');
  assert.equal(state.uploads[0].blob.type, 'image/png');
  assert.equal(await state.uploads[0].blob.text(), 'synthetic-png');
});

test('generic MP3 picker bytes keep their inferred MIME when saving a template', async t => {
  setup(t);
  const file = new File(['synthetic-mp3'], 'clip.mp3', { type: 'application/octet-stream' });
  const input = picker();
  await input.handleAudioFileUpload({ target: { files: [file] } });
  const config = input.getConfig();
  t.after(() => config.referenceAudios.forEach(ref => URL.revokeObjectURL(ref.url)));
  assert.equal(file.type, 'application/octet-stream');
  assert.equal(config.referenceAudios[0].mimeType, 'audio/mpeg');
  const saved = await saveTemplate({ id: 'template', name: 'Soundtrack', createdAt: 1, config });
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

for (const [mime, bytes] of [
  ['image/png', Buffer.from('89504e470d0a1a0a00000000', 'hex')],
  ['image/jpeg', Buffer.from('ffd8ffe000000000', 'hex')],
  ['image/webp', Buffer.from('524946460400000057454250', 'hex')],
]) {
  test(`legacy generic references infer ${mime} from bytes without changing them`, async t => {
    setup(t);
    const data = `data:application/octet-stream;base64,${bytes.toString('base64')}`;
    assert.ok(await uploadBase64ToPublicUrl(data, 'application/octet-stream'));
    assert.equal(state.uploads[0].contentType, mime);
    assert.equal(state.uploads[0].blob.type, mime);
    assert.deepEqual(Buffer.from(await state.uploads[0].blob.arrayBuffer()), bytes);
  });
}

test('generic legacy bytes cannot use a data URL label as proof of image type', async t => {
  setup(t);
  for (const bytes of [Buffer.from('unknown'), Buffer.from('000000146674797069736f6d', 'hex'), Buffer.from('89504e47', 'hex')]) {
    assert.equal(await uploadBase64ToPublicUrl(`data:image/jpeg;base64,${bytes.toString('base64')}`, 'application/octet-stream'), null);
  }
  assert.equal(state.uploads.length, 0);
});

test('template MIME rejections retain their reason while ordinary uploads keep returning null', async t => {
  setup(t);
  const file = new File(['unknown'], 'data.bin', { type: 'application/octet-stream' });
  const input = picker();
  await input.handleAudioFileUpload({ target: { files: [file] } });
  const config = input.getConfig();
  t.after(() => config.referenceAudios.forEach(ref => URL.revokeObjectURL(ref.url)));
  await assert.rejects(saveTemplate({ id: 'template', name: 'Rejected', createdAt: 1, config }), /application\/octet-stream.*MIME type is not allowed/);
  assert.equal(state.rows.length, 0);
  assert.equal(await uploadBase64ToPublicUrl('dW5rbm93bg==', 'text/plain'), null);
});

test('legacy image inference does not bypass a narrower custom MIME allowlist', async t => {
  setup(t); state.allowedMimeTypes = ['image/jpeg'];
  const bytes = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  assert.equal(await uploadBase64ToPublicUrl(bytes.toString('base64'), 'application/octet-stream'), null);
  assert.equal(state.uploads.length, 0);
});
