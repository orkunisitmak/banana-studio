import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const load = async file => {
  const out = await build({ entryPoints: [fileURLToPath(new URL(file, import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const { prepareEditableImagePrompt } = await load('../src/lib/references/dynamicReferences.ts');
const { resolveStableImageReferences } = await load('../src/lib/references/referenceTokens.ts');
const refs = ['a', 'b', 'c', 'd'].map(id => ({ id, data: '', mimeType: 'image/png' }));
const T = id => `@REFERENCE[${id}]`;

test('every image number in a list is bound, including Oxford commas, "or" and "through"', () => {
  assert.equal(prepareEditableImagePrompt('images 1, 2, and 3', refs), `${T('a')} and ${T('b')} and ${T('c')}`);
  assert.equal(prepareEditableImagePrompt('images 1, 2, or 3', refs), `${T('a')} or ${T('b')} or ${T('c')}`);
  assert.equal(prepareEditableImagePrompt('images 1 through 3', refs), `${T('a')} and ${T('b')} and ${T('c')}`);
  assert.equal(prepareEditableImagePrompt('make images 1 and 2 16:9', refs), `make ${T('a')} and ${T('b')} 16:9`);
});

test('ranges expand inside longer lists and mixed conjunctions keep their meaning', () => {
  assert.equal(prepareEditableImagePrompt('images 1 through 3 and 4', refs), `${T('a')} and ${T('b')} and ${T('c')} and ${T('d')}`);
  assert.equal(prepareEditableImagePrompt('images 1 or 2 and 3', refs), `${T('a')} or ${T('b')} and ${T('c')}`);
  assert.equal(prepareEditableImagePrompt('from images 1 to 3 to image 4', refs), `from ${T('a')} and ${T('b')} and ${T('c')} to ${T('d')}`);
  assert.equal(prepareEditableImagePrompt('images 1, 2, or 3 and 4', refs), `${T('a')} or ${T('b')} or ${T('c')} and ${T('d')}`);
  assert.equal(prepareEditableImagePrompt('images 1 and 2 or 2 and 3', refs), `${T('a')} and ${T('b')} or ${T('b')} and ${T('c')}`);
  assert.equal(prepareEditableImagePrompt('images 1 or 2, 3', refs), `${T('a')} or ${T('b')} or ${T('c')}`);
});

test('a donor list before "to image N" binds every donor and keeps the destination', () => {
  assert.equal(prepareEditableImagePrompt('from images 2 and 3 to image 1', refs), `from ${T('b')} and ${T('c')} to ${T('a')}`);
  assert.equal(prepareEditableImagePrompt('from images 2-3 to image 1', refs), `from ${T('b')} and ${T('c')} to ${T('a')}`);
  assert.equal(prepareEditableImagePrompt('from image 2 to image 1', refs), `from ${T('b')} to ${T('a')}`);
});

test('bound lists follow their images after a reference is inserted', () => {
  const stored = prepareEditableImagePrompt('Combine images 1, 2, and 3', refs);
  assert.equal(resolveStableImageReferences(stored, [{ id: 'z' }, ...refs]), 'Combine image 2 and image 3 and image 4');
});
