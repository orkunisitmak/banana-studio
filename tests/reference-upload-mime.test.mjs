import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build, transform } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Exercise the existing picker helper without mounting the entire workspace.
const controls = fs.readFileSync(new URL('../src/components/Controls.tsx', import.meta.url), 'utf8');
const helper = await build({ entryPoints: ['src/lib/references/mediaMimeType.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node' });
const { getMediaMimeType: getMimeType } = await import('data:text/javascript;base64,' + Buffer.from(helper.outputFiles[0].text).toString('base64'));
assert.match(controls, /import \{ getMediaMimeType as getMimeType \} from '\.\.\/lib\/references\/mediaMimeType'/);

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
  let attachmentError = null;
  const setAttachmentError = error => { attachmentError = error; };
  const addAttachmentError = setAttachmentError, flushSync = callback => callback();
  const readAudioDuration = async () => 3, estimateBase64Size = data => data.length;
  const readFileAsBase64 = async file => 'data:' + file.type + ';base64,' + Buffer.from(await file.arrayBuffer()).toString('base64');
  const compressImage = () => { throw new Error('Unexpected compression'); };
  ${controls.slice(imageStart, imageEnd)}
  ${controls.slice(audioStart, audioEnd)}
  return { processImageFiles, handleAudioFileUpload, getConfig: () => config, getError: () => attachmentError };
};`, { loader: 'ts', format: 'esm' });
const { createPicker } = await import('data:text/javascript;base64,' + Buffer.from(pickers.code).toString('base64'));
const picker = () => createPicker(getMimeType, { mode: 'image', prompt: 'Synthetic', referenceImages: [], referenceAudios: [] });

const state = { uploads: [], rows: [], allowedMimeTypes: null };
globalThis.__referenceMimeUpload = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }) },
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
    assert.ok(['templates', 'generations'].includes(table));
    const query = {
      select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }),
      upsert: async row => { state.rows.push(row); return { error: null }; },
    };
    return query;
  },
};
const compiled = await build({ stdin: {
  contents: "export { uploadBase64ToPublicUrl, uploadBlobToPublicUrl, saveTemplate, saveImage, saveVideo } from './src/services/storageService'; export { createReferenceUploader } from './src/lib/references/referenceUploadCache';",
  resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
}, bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'reference-mime-upload', setup(b) {
  b.onResolve({ filter: /\/authService$|^tus-js-client$|^@supabase\/supabase-js$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'tus-js-client' ? 'export class Upload {}' : args.path === '@supabase/supabase-js' ?
    "export const isAuthSessionMissingError = () => false;" :
    "export const supabase = globalThis.__referenceMimeUpload, getCurrentUserId = async () => 'user-1', SUPABASE_URL = 'https://storage.invalid';" }));
} }] });
const { uploadBase64ToPublicUrl, uploadBlobToPublicUrl, saveTemplate, saveImage, saveVideo, createReferenceUploader } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

function setup(t) {
  state.uploads = []; state.rows = []; state.allowedMimeTypes = null;
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options) => String(url).startsWith('https://provider.invalid/')
    ? new Response('synthetic-video', { headers: { 'content-type': 'video/mp4' } }) : originalFetch(url, options));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
}

test('empty and generic picker MIME types use recognized media extensions', () => {
  const cases = { PNG: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif',
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

for (const type of ['', 'application/octet-stream', 'text/plain', 'image/png']) {
  test(`audio picker rejects non-audio MIME ${type || '(empty)'} before creating a reference`, async t => {
    const createUrl = t.mock.method(URL, 'createObjectURL', () => { throw new Error('Invalid audio must not create an object URL'); });
    const input = picker();
    await input.handleAudioFileUpload({ target: { files: [new File(['unknown'], 'data.bin', { type })] } });
    assert.deepEqual(input.getConfig().referenceAudios, []);
    assert.equal(input.getConfig().mode, 'image');
    assert.match(input.getError(), /data\.bin.*audio file/);
    assert.equal(createUrl.mock.callCount(), 0);
  });
}

test('audio picker retains valid inferred audio from a mixed selection', async t => {
  const input = picker();
  await input.handleAudioFileUpload({ target: { files: [
    new File(['unknown'], 'data.bin', { type: 'application/octet-stream' }),
    new File(['synthetic-mp3'], 'clip.mp3', { type: 'application/octet-stream' }),
  ] } });
  const refs = input.getConfig().referenceAudios;
  t.after(() => refs.forEach(ref => URL.revokeObjectURL(ref.url)));
  assert.equal(refs.length, 1);
  assert.equal(refs[0].mimeType, 'audio/mpeg');
  assert.match(input.getError(), /data\.bin.*audio file/);
});

for (const name of ['clip.oga', 'clip.ogg', 'clip.OGA']) {
  test(`application/ogg ${name} retains an audio MIME through picker and template storage`, async t => {
    setup(t);
    const input = picker();
    await input.handleAudioFileUpload({ target: { files: [new File(['synthetic-ogg'], name, { type: 'application/ogg; codecs=opus' })] } });
    const config = input.getConfig();
    t.after(() => config.referenceAudios.forEach(ref => URL.revokeObjectURL(ref.url)));
    assert.equal(input.getError(), null);
    assert.equal(config.referenceAudios[0].mimeType, 'audio/ogg');
    await saveTemplate({ id: 'template', name: 'Ogg soundtrack', createdAt: 1, config });
    assert.equal(state.uploads[0].contentType, 'audio/ogg');
    assert.equal(await state.uploads[0].blob.text(), 'synthetic-ogg');
  });
}

test('Ogg alias normalization does not relabel unknown containers or explicit video types', () => {
  assert.equal(getMimeType(new Blob([], { type: 'application/ogg' }), 'clip.ogv'), 'application/ogg');
  assert.equal(getMimeType(new Blob([], { type: 'application/ogg' })), 'application/ogg');
  assert.equal(getMimeType(new Blob([], { type: 'video/ogg' }), 'clip.ogg'), 'video/ogg');
});

for (const [mime, bytes] of [
  ['image/png', Buffer.from('89504e470d0a1a0a00000000', 'hex')],
  ['image/jpeg', Buffer.from('ffd8ffe000000000', 'hex')],
  ['image/webp', Buffer.from('524946460400000057454250', 'hex')],
  ['image/avif', Buffer.from('00000018667479706176696600000000617669666d696631', 'hex')],
  ['image/avif', Buffer.from('00000018667479706176697300000000617669736d736631', 'hex')],
  ['image/avif', Buffer.from('00000018667479706d69663100000000617669666d696631', 'hex')],
  ['image/bmp', Buffer.from('424d3a000000000000003600000028000000', 'hex')],
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
  for (const bytes of [Buffer.from('unknown'), Buffer.from('000000146674797069736f6d', 'hex'), Buffer.from('89504e47', 'hex'),
    Buffer.from('00000018667479706176696600000000', 'hex'), // truncated FileTypeBox
    Buffer.from('00000010667479706d70343261766966', 'hex'), // avif in minor_version, not a brand
    Buffer.from('424d', 'hex'), Buffer.from('424d3a0000000100000036000000', 'hex')]) {
    assert.equal(await uploadBase64ToPublicUrl(`data:image/jpeg;base64,${bytes.toString('base64')}`, 'application/octet-stream'), null);
  }
  assert.equal(state.uploads.length, 0);
});

test('template MIME rejections retain their reason while ordinary uploads keep returning null', async t => {
  setup(t);
  const file = new File(['unknown'], 'data.bin', { type: 'application/octet-stream' });
  // Existing saved drafts can predate picker validation and still need clear save errors.
  const config = { mode: 'image', prompt: 'Synthetic', referenceImages: [], referenceAudios: [
    { id: 'legacy-audio', url: URL.createObjectURL(file), mimeType: file.type, name: file.name, size: file.size, duration: 3 },
  ] };
  t.after(() => config.referenceAudios.forEach(ref => URL.revokeObjectURL(ref.url)));
  await assert.rejects(saveTemplate({ id: 'template', name: 'Rejected', createdAt: 1, config }), /Unsupported media type.*application\/octet-stream/);
  assert.equal(state.rows.length, 0);
  assert.equal(await uploadBase64ToPublicUrl('dW5rbm93bg==', 'text/plain'), null);
});

test('legacy image inference does not bypass a narrower custom MIME allowlist', async t => {
  setup(t); state.allowedMimeTypes = ['image/jpeg'];
  const bytes = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  assert.equal(await uploadBase64ToPublicUrl(bytes.toString('base64'), 'application/octet-stream'), null);
  assert.equal(state.uploads.length, 0);
});

for (const [kind, save] of [['image', saveImage], ['video', saveVideo]]) {
  const result = { id: `generated-${kind}`, url: kind === 'image' ? 'data:image/png;base64,c3ludGhldGlj' : 'https://provider.invalid/video.mp4', prompt: 'Synthetic', mediaType: kind, createdAt: 1 };
  test(`${kind} persistence retains a generic PNG picker's inferred MIME and bytes`, async t => {
    setup(t);
    const file = new File(['synthetic-png'], 'photo.png', { type: 'application/octet-stream' });
    const input = picker();
    await input.processImageFiles([file]);
    const referenceImages = input.getConfig().referenceImages;
    assert.ok(await save({ ...result, referenceImages }, 'user-1'));
    const uploaded = state.uploads.find(upload => upload.path.includes('/refs/'));
    assert.equal(uploaded.contentType, 'image/png');
    assert.equal(uploaded.blob.type, 'image/png');
    assert.equal(await uploaded.blob.text(), 'synthetic-png');
    assert.equal(state.rows[0].reference_images[0].mimeType, 'image/png');
    assert.match(state.rows[0].reference_images[0].data, /\/storage\/v1\/object\/authenticated\/media\//);
  });

  test(`${kind} persistence detects legacy generic references and records the corrected MIME`, async t => {
    setup(t);
    const bytes = Buffer.from('89504e470d0a1a0a00000000', 'hex');
    for (const mimeType of ['application/octet-stream', undefined]) {
      state.rows = []; state.uploads = [];
      const referenceImages = [{ id: 'legacy', data: `data:application/octet-stream;base64,${bytes.toString('base64')}`, mimeType }];
      assert.ok(await save({ ...result, referenceImages }, 'user-1'));
      const uploaded = state.uploads.find(upload => upload.path.includes('/refs/'));
      assert.equal(uploaded.contentType, 'image/png');
      assert.deepEqual(Buffer.from(await uploaded.blob.arrayBuffer()), bytes);
      assert.equal(state.rows[0].reference_images[0].mimeType, 'image/png');
    }
  });

  test(`${kind} persistence respects narrower custom MIME lists without relabeling PNG as JPEG`, async t => {
    setup(t); state.allowedMimeTypes = ['image/jpeg', 'video/mp4'];
    const referenceImages = [{ id: 'png', data: 'data:application/octet-stream;base64,iVBORw0KGgoAAAAA', mimeType: 'application/octet-stream' }];
    assert.equal(await save({ ...result, referenceImages }, 'user-1'), undefined);
    assert.equal(state.uploads.filter(upload => upload.path.includes('/refs/')).length, 0);
    assert.equal(state.rows.length, 0);
  });

  test(`${kind} persistence rejects unknown generic references without completing the row`, async t => {
    setup(t);
    const referenceImages = [{ id: 'unknown', data: 'data:application/octet-stream;base64,dW5rbm93bg==', mimeType: 'application/octet-stream' }];
    assert.equal(await save({ ...result, id: `invalid-${kind}`, referenceImages }, 'user-1'), undefined);
    assert.equal(state.uploads.filter(upload => upload.path.includes('/refs/')).length, 0);
    assert.equal(state.rows.length, 0);
    assert.equal(state.uploads.length, 0, 'Invalid references must fail before uploading the result video');
  });
}

for (const [name, mime] of [['photo.png', 'image/png'], ['clip.mp3', 'audio/mpeg']]) {
  test(`shared blob uploads infer ${name} from a missing or generic File MIME`, async t => {
    setup(t);
    for (const type of ['', 'application/octet-stream']) {
      state.uploads = [];
      const file = new File(['synthetic'], name, { type });
      assert.ok(await uploadBlobToPublicUrl(file));
      assert.equal(state.uploads[0].contentType, mime);
      assert.equal(await state.uploads[0].blob.text(), 'synthetic');
    }
  });
}

test('shared blob uploads reject unknown types clearly without trusting the fallback extension', async t => {
  setup(t);
  const unknown = new File(['unknown'], 'data.bin', { type: 'application/octet-stream' });
  assert.equal(await uploadBlobToPublicUrl(unknown, undefined, 'ref', 'jpg'), null);
  await assert.rejects(uploadBlobToPublicUrl(unknown, undefined, 'ref', 'jpg', { throwOnError: true }), /Unsupported media type.*application\/octet-stream/);
  assert.equal(state.uploads.length, 0);
});

test('shared blob uploads preserve explicit non-media types rather than trusting a misleading filename', async t => {
  setup(t);
  const file = new File(['text'], 'photo.png', { type: 'text/plain' });
  await assert.rejects(uploadBlobToPublicUrl(file, undefined, 'ref', 'jpg', { throwOnError: true }), /Unsupported media type.*text\/plain/);
  assert.equal(state.uploads.length, 0);
});

test('generation uploads can opt into actionable errors without changing ordinary callers', async t => {
  setup(t);
  await assert.rejects(uploadBase64ToPublicUrl('dW5rbm93bg==', 'application/octet-stream', 'ref', { throwOnError: true }), /Reference image type could not be recognized/);
  assert.equal(await uploadBase64ToPublicUrl('dW5rbm93bg==', 'application/octet-stream'), null);
  state.allowedMimeTypes = ['image/jpeg'];
  await assert.rejects(uploadBase64ToPublicUrl('iVBORw0KGgoAAAAA', 'image/png', 'ref', { throwOnError: true }), /image\/png.*MIME type is not allowed/);
  assert.equal(await uploadBase64ToPublicUrl('iVBORw0KGgoAAAAA', 'image/png'), null);
});

for (const provider of ['falImageService', 'runwayService', 'openaiImageService']) {
  const source = fs.readFileSync(new URL(`../src/services/${provider}.ts`, import.meta.url), 'utf8');
  const openai = provider === 'openaiImageService';
  const start = source.indexOf(openai ? 'const uploadReference =' : 'const resolveImageUrl =');
  const end = openai ? source.indexOf('const activeImageJobs', start) : source.indexOf('\n};', start) + 3;
  assert.ok(start >= 0 && end > start);
  const transformed = await transform(`export const createResolver = (uploadBase64ToPublicUrl, createReferenceUploader) => {
    const refreshMediaAccessUrl = async url => url;
    ${source.slice(start, end)}
    return ${openai ? "ref => uploadReference(ref.data, ref.mimeType, 'openai_ref', 'user-1')" : 'resolveImageUrl'};
  };`, { loader: 'ts', format: 'esm' });
  const { createResolver } = await import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64'));
  test(`${provider} reference preparation preserves actionable upload errors`, async t => {
    setup(t);
    const resolve = createResolver(uploadBase64ToPublicUrl, createReferenceUploader);
    await assert.rejects(resolve({ data: 'dW5rbm93bg==', mimeType: 'application/octet-stream' }), /Reference image type could not be recognized/);
    state.allowedMimeTypes = ['image/jpeg'];
    await assert.rejects(resolve({ data: 'iVBORw0KGgoAAAAA', mimeType: 'image/png' }), /image\/png.*MIME type is not allowed/);
    state.allowedMimeTypes = null;
    // Missing legacy MIME must reach signature inference, not a JPEG default.
    assert.ok(await resolve({ data: 'iVBORw0KGgoAAAAA', mimeType: '' }));
    assert.equal(state.uploads.at(-1).contentType, 'image/png');
  });
}

test('video reference preflight rejects explicit non-image MIME before any uploads', async t => {
  setup(t);
  const referenceImages = [{ id: 'text', data: 'data:text/plain;base64,dW5rbm93bg==', mimeType: 'text/plain' }];
  assert.equal(await saveVideo({ id: 'preflight-text', url: 'https://provider.invalid/video.mp4', referenceImages }, 'user-1'), undefined);
  assert.equal(state.uploads.length, 0);
  assert.equal(state.rows.length, 0);
});

test('video reference preflight reuses local blobs and does not download stored HTTP references', async t => {
  setup(t);
  const local = 'data:application/octet-stream;base64,iVBORw0KGgoAAAAA';
  const stored = 'https://storage.invalid/storage/v1/object/authenticated/media/user-1/refs/stored.png';
  const originalFetch = globalThis.fetch, fetched = [];
  t.mock.method(globalThis, 'fetch', async url => { fetched.push(url); assert.notEqual(url, stored); return originalFetch(url); });
  const referenceImages = [{ id: 'local', data: local, mimeType: 'application/octet-stream' }, { id: 'stored', data: stored, mimeType: 'image/png' }];
  assert.ok(await saveVideo({ id: 'preflight-valid', url: 'https://provider.invalid/video.mp4', referenceImages }, 'user-1'));
  assert.equal(fetched.filter(url => url === local).length, 1);
  assert.equal(state.uploads.filter(upload => upload.path.includes('/refs/')).length, 1);
  assert.equal(state.rows[0].reference_images[1].data, stored);
});
