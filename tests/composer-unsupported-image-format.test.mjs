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
  const {config,onChange,setAttachmentError,maxReferenceImages,attachLimitsRef,readFileAsBase64,estimateBase64Size,compressImage,flushSync}=state;
  const getMimeType=${find('getMimeType')};
  return ${find('processImageFiles')};
};`, { loader: 'ts', format: 'esm' });
const create = (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))).create;

const attach = async file => {
  let draft = { mode: 'image', referenceImages: [] };
  const errors = [];
  const processImageFiles = create({
    config: draft, maxReferenceImages: 14, attachLimitsRef: { current: { images: 14 } },
    onChange: update => { draft = typeof update === 'function' ? update(draft) : update; },
    setAttachmentError: message => { if (message) errors.push(message); },
    readFileAsBase64: async f => `data:${f.type};base64,AAAA`, estimateBase64Size: () => 10, compressImage: async d => d, flushSync: fn => fn(),
  });
  await processImageFiles([file]);
  return { attached: draft.referenceImages.map(ref => ref.mimeType), errors };
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
  const result = await attach(new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' }));
  assert.deepEqual(result.attached, ['image/png']);
  assert.deepEqual(result.errors, []);
});
