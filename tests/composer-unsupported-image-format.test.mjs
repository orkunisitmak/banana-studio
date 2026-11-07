import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The composer's file picker (accept="image/*"), paste and drop all go through
// processImageFiles, which attaches any image/* file as-is in image mode. The image
// providers only take PNG, JPEG or WebP (Gemini: providerImageData throws
// "Unsupported image format."), so a GIF/HEIC/AVIF reference is accepted silently and
// the generation fails later. The image editor's reference reader already refuses
// these formats up front with "Choose a PNG, JPG or WebP reference image."
const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const ts = req('typescript');
const { transform, build } = req('esbuild');
const source = fs.readFileSync(root + '/src/components/Controls.tsx', 'utf8');
const ast = ts.createSourceFile('Controls.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const find = name => { let found; const visit = node => { if (!found && ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer.getText(ast); ts.forEachChild(node, visit); }; visit(ast); assert.ok(found, name); return found; };

const { code } = await transform(`export const create=(state)=>{
  const {config,onChange,setAttachmentError,addAttachmentError,maxReferenceImages,attachLimitsRef,readFileAsBase64,estimateBase64Size,compressImage,flushSync}=state;
  const getMimeType=${find('getMimeType')};
  return ${find('processImageFiles')};
};`, { loader: 'ts', format: 'esm' });
const create = (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))).create;

const SIGNATURE = { 'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/jpeg': [0xff, 0xd8, 0xff, 0xe0, 0, 0x10], 'image/webp': [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50] };
const image = (name, type, signature = type) => new File([new Uint8Array(SIGNATURE[signature] || [1, 2, 3])], name, { type });

const attach = async file => {
  let draft = { mode: 'image', referenceImages: [] };
  const errors = [];
  const processImageFiles = create({
    config: draft, maxReferenceImages: 14, attachLimitsRef: { current: { images: 14 } },
    onChange: update => { draft = typeof update === 'function' ? update(draft) : update; },
    setAttachmentError: message => { if (message) errors.push(message); }, addAttachmentError: message => errors.push(message),
    readFileAsBase64: async (f, type) => `data:${type || f.type};base64,AAAA`, estimateBase64Size: () => 10, compressImage: async d => d, flushSync: fn => fn(),
  });
  await processImageFiles([file]);
  return { attached: draft.referenceImages.map(ref => ref.mimeType), datas: draft.referenceImages.map(ref => ref.data), errors };
};

// The sibling reader in the image editor, run for real.
const bundled = await build({ entryPoints: ['src/components/galleryImageEdit.ts'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent' });
const mod = { exports: {} };
new Function('module', 'exports', 'require', bundled.outputFiles[0].text)(mod, mod.exports, p => req(p));
const { readGalleryEditReference } = mod.exports;

test('control: the image editor refuses a GIF reference before generation', async () => {
  await assert.rejects(readGalleryEditReference(new File([new Uint8Array([71, 73, 70])], 'loop.gif', { type: 'image/gif' })), /PNG, JPG or WebP/);
});

for (const [name, type] of [['loop.gif', 'image/gif'], ['photo.heic', 'image/heic'], ['still.avif', 'image/avif']]) {
  test(`the composer refuses a ${type} reference instead of attaching it for a provider that cannot read it`, async () => {
    const result = await attach(new File([new Uint8Array([1, 2, 3])], name, { type }));
    assert.deepEqual(result.attached, [], `${type} was attached`);
    assert.ok(result.errors.some(message => /PNG|JPE?G|WebP/i.test(message)), 'no format message was shown');
  });
}

test('control: the composer attaches a PNG reference', async () => {
  const result = await attach(image('photo.png', 'image/png'));
  assert.deepEqual(result.attached, ['image/png']);
  assert.deepEqual(result.errors, []);
});

test('control: a JPEG and a WebP reference are attached', async () => {
  for (const [name, type] of [['photo.jpg', 'image/jpeg'], ['photo.webp', 'image/webp']]) {
    const result = await attach(image(name, type));
    assert.deepEqual(result.attached, [type]);
    assert.deepEqual(result.errors, []);
  }
});

test('an unsupported file does not use up the last free slot of a supported one', async () => {
  let draft = { mode: 'image', referenceImages: Array.from({ length: 13 }, (_, i) => ({ id: String(i), data: 'x', mimeType: 'image/png' })) };
  const processImageFiles = create({
    config: draft, maxReferenceImages: 14, attachLimitsRef: { current: { images: 14 } },
    onChange: update => { draft = typeof update === 'function' ? update(draft) : update; },
    setAttachmentError() {}, addAttachmentError() {},
    readFileAsBase64: async (f, type) => `data:${type || f.type};base64,AAAA`, estimateBase64Size: () => 10, compressImage: async d => d, flushSync: fn => fn(),
  });
  await processImageFiles([new File([new Uint8Array([1])], 'photo.heic', { type: 'image/heic' }), image('photo.jpg', 'image/jpeg')]);
  assert.equal(draft.referenceImages.length, 14);
  assert.equal(draft.referenceImages[13].mimeType, 'image/jpeg');
});

test('a gallery download with no content type is recognised from its bytes', async () => {
  const png = await attach(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])]));
  assert.equal(png.attached.length, 1);
  assert.equal(png.attached[0], 'image/png');
  const gif = await attach(new Blob([new Uint8Array([71, 73, 70, 56, 57, 97])]));
  assert.deepEqual(gif.attached, []);
});

test('the format message and the slot limit message are both kept', async () => {
  let draft = { mode: 'image', referenceImages: [{ id: 'a', data: 'x', mimeType: 'image/png' }] };
  const errors = [];
  const processImageFiles = create({
    config: draft, maxReferenceImages: 2, attachLimitsRef: { current: { images: 2 } },
    onChange: update => { draft = typeof update === 'function' ? update(draft) : update; },
    setAttachmentError() {}, addAttachmentError: message => errors.push(message),
    readFileAsBase64: async (f, type) => `data:${type || f.type};base64,AAAA`, estimateBase64Size: () => 10, compressImage: async d => d, flushSync: fn => fn(),
  });
  const jpg = n => image(n, 'image/jpeg');
  await processImageFiles([jpg('a.jpg'), jpg('b.jpg'), new File([new Uint8Array([1])], 'c.gif', { type: 'image/gif' })]);
  assert.equal(errors.length, 2);
  assert.ok(errors.some(m => /Limit reached/.test(m)) && errors.some(m => /PNG|WebP/.test(m)));
});

// The production reader, with the browser's FileReader reduced to what it does here: a data URL typed with the Blob's type.
const { code: readerCode } = await transform(`export const read=${find('readFileAsBase64')};`, { loader: 'ts', format: 'esm' });
const { read } = await import('data:text/javascript;base64,' + Buffer.from(readerCode).toString('base64'));
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(buffer => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`; this.onload(); }, error => this.onerror(error));
  }
};

test('a gallery download with no content type is stored as the type found in its bytes', async () => {
  const png = await attach(new Blob([new Uint8Array(SIGNATURE['image/png'])]));
  assert.ok(png.datas[0].startsWith('data:image/png;base64,'), png.datas[0]);
});

test('the production reader puts the detected type on the data URL when the Blob has none or another one', async () => {
  const bytes = new Uint8Array(SIGNATURE['image/png']);
  const base64 = Buffer.from(bytes).toString('base64');
  assert.equal(await read(new Blob([bytes]), 'image/png'), `data:image/png;base64,${base64}`);
  assert.equal(await read(new Blob([bytes], { type: 'application/octet-stream' }), 'image/png'), `data:image/png;base64,${base64}`);
  assert.equal(await read(new Blob([bytes], { type: 'image/png' }), 'image/png'), `data:image/png;base64,${base64}`);
  assert.equal(await read(new Blob([bytes], { type: 'video/mp4' })), `data:video/mp4;base64,${base64}`);
});

test('a GIF named photo.jpg is refused even though its name and type say JPEG', async () => {
  const gif = new File([new Uint8Array([71, 73, 70, 56, 57, 97])], 'photo.jpg', { type: 'image/jpeg' });
  const result = await attach(gif);
  assert.deepEqual(result.attached, []);
  assert.ok(result.errors.some(message => /PNG|JPE?G|WebP/i.test(message)), 'no format message was shown');
});

test('a PNG labelled image/jpeg is attached as the PNG it is', async () => {
  const result = await attach(image('photo.jpg', 'image/jpeg', 'image/png'));
  assert.deepEqual(result.attached, ['image/png']);
  assert.ok(result.datas[0].startsWith('data:image/png;base64,'), result.datas[0]);
});

test('an image/jpg file is attached as image/jpeg', async () => {
  const result = await attach(image('photo.jpg', 'image/jpg', 'image/jpeg'));
  assert.deepEqual(result.attached, ['image/jpeg']);
  assert.deepEqual(result.errors, []);
});

test('a file whose bytes cannot be read does not stop the valid file next to it', async () => {
  let draft = { mode: 'image', referenceImages: [] };
  const errors = [];
  const processImageFiles = create({
    config: draft, maxReferenceImages: 14, attachLimitsRef: { current: { images: 14 } },
    onChange: update => { draft = typeof update === 'function' ? update(draft) : update; },
    setAttachmentError() {}, addAttachmentError: message => errors.push(message),
    readFileAsBase64: async (f, type) => `data:${type || f.type};base64,AAAA`, estimateBase64Size: () => 10, compressImage: async d => d, flushSync: fn => fn(),
  });
  const unreadable = new Blob([new Uint8Array([1])]);
  unreadable.slice = () => ({ arrayBuffer: () => Promise.reject(new Error('NotReadableError')) });
  await processImageFiles([image('photo.jpg', 'image/jpeg'), unreadable]);
  assert.deepEqual(draft.referenceImages.map(ref => ref.mimeType), ['image/jpeg']);
  assert.ok(errors.some(message => /PNG|JPE?G|WebP/i.test(message)));
});
