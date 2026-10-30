import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const load = async file => {
  const out = await build({ entryPoints: [fileURLToPath(new URL(file, import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const { bindImageReferences, resolveStableImageReferences } = await load('../src/lib/references/referenceTokens.ts');
const { normalizeReferencePrompt, mergePersonReferenceInputs } = await load('../src/lib/references/personReferences.ts');
const { prepareEditableImagePrompt, displayReferencePrompt, storeReferencePrompt } = await load('../src/lib/references/dynamicReferences.ts');
const { normalizeSeedanceFrameTags } = await load('../src/lib/video/seedanceFrames.ts');
const { isYouTubeThumbnailPrompt } = await load('../src/lib/images/imagePrompting.ts');
const refs = ['a', 'b'].map(id => ({ id, data: '', mimeType: 'image/png' }));
const possessive = "Barış'ın";
const prompt = `${possessive} @REF_IMAGE_1 fotoğrafını ${possessive} @REF_IMAGE_2 fotoğrafıyla birleştir.`;
const bound = `${possessive} @REFERENCE[a] fotoğrafını ${possessive} @REFERENCE[b] fotoğrafıyla birleştir.`;

test('Turkish possessives do not hide positional or stable image references', () => {
  assert.equal(bindImageReferences(prompt, refs), bound);
  assert.equal(resolveStableImageReferences(bound, refs), `${possessive} image 1 fotoğrafını ${possessive} image 2 fotoğrafıyla birleştir.`);
  assert.throws(() => resolveStableImageReferences(bound, [refs[1]]), /referansı/);
});

test('apostrophes within English and Unicode words are not quote delimiters', () => {
  for (const word of ["John's", "don't", "Barış'ın", "李'的", "Ж'я", "e\u0301's", "𐐀'ı", "١'ı"]) {
    const text = `${word} @REF_IMAGE_1; ${word} @REF_IMAGE_2.`;
    assert.equal(bindImageReferences(text, refs), `${word} @REFERENCE[a]; ${word} @REFERENCE[b].`, word);
  }
});

test('real quoted references stay literal next to punctuation and Unicode prose', () => {
  const text = `('@REF_IMAGE_9'), "@REF_IMAGE_8"; “@REF_IMAGE_7”. ${possessive} @REF_IMAGE_1, ${possessive} @REF_IMAGE_2!`;
  assert.equal(bindImageReferences(text, refs), `('@REF_IMAGE_9'), "@REF_IMAGE_8"; “@REF_IMAGE_7”. ${possessive} @REFERENCE[a], ${possessive} @REFERENCE[b]!`);
  assert.equal(resolveStableImageReferences("('@REFERENCE[missing]'), \"@MISSING_IMAGE_9\"; @REFERENCE[a]", refs), "('@REFERENCE[missing]'), \"@MISSING_IMAGE_9\"; image 1");
});

test('person normalization uses the same quote boundaries', () => {
  const people = [{ ...refs[0], personId: 1 }];
  const text = `${possessive} @MAIN_PERSON; ${possessive} @REF_IMAGE_1. '@PERSON_9'`;
  assert.equal(normalizeReferencePrompt(text, people), `${possessive} the main person shown in image 1 (all these photos show the SAME single person); ${possessive} image 1. '@PERSON_9'`);
});

test('template validation cannot hide a missing reference between possessives', () => {
  const text = `${possessive} @REF_IMAGE_2; ${possessive} @REF_IMAGE_1.`;
  assert.throws(() => mergePersonReferenceInputs([], [refs[1]], '', text), /referans bulunamadı/);
  assert.doesNotThrow(() => mergePersonReferenceInputs([], [], '', "'@PERSON_9' and \"@REF_IMAGE_9\""));
});

test('template merging remaps every unquoted person mention after a collision', () => {
  const primary = [{ ...refs[0], personId: 3 }], secondary = [{ ...refs[1], personId: 3 }];
  const text = `${possessive} @PERSON_3; ${possessive} @REF_IMAGE_1. '@PERSON_3'`;
  const merged = mergePersonReferenceInputs(primary, secondary, '', text);
  assert.equal(merged.prompt, `${possessive} @PERSON_4; ${possessive} @REF_IMAGE_2. '@PERSON_3'`);
});

test('editable image numbers and display aliases preserve quoted copy', () => {
  assert.equal(prepareEditableImagePrompt(`${possessive} image 1; ${possessive} image 2. 'image 9'`, refs), `${possessive} @REFERENCE[a]; ${possessive} @REFERENCE[b]. 'image 9'`);
  const displayed = displayReferencePrompt(bound, refs);
  assert.equal(displayed, `${possessive} @[Reference 1] fotoğrafını ${possessive} @[Reference 2] fotoğrafıyla birleştir.`);
  assert.equal(storeReferencePrompt(displayed, refs), bound);
});

test('expanded identity metadata is collapsed outside genuine quotations', () => {
  const people = [{ ...refs[0], personId: 1 }];
  const expanded = 'the main person shown in image 1 (all these photos show the SAME single person)';
  assert.equal(prepareEditableImagePrompt(`${possessive} ${expanded}; ${possessive} portresi. "${expanded}"`, people), `${possessive} @MAIN_PERSON; ${possessive} portresi. "${expanded}"`);
});

test('frame resolution preserves literals and resolves mentions between possessives', () => {
  const frames = [{ ...refs[0], isFirstFrame: true }, { ...refs[1], isLastFrame: true }];
  assert.equal(normalizeSeedanceFrameTags(`${possessive} @FIRST_FRAME; ${possessive} @LAST_FRAME. '@IMAGE_9'`, frames), `${possessive} the provided first frame; ${possessive} the provided last frame. '@IMAGE_9'`);
});

test('image intent analysis does not discard instructions between possessives', () => {
  assert.equal(isYouTubeThumbnailPrompt(`${possessive} YouTube thumbnail; ${possessive} portresi.`, []), true);
  assert.equal(isYouTubeThumbnailPrompt("Print 'YouTube thumbnail' on a plain poster.", []), false);
});

test('word-internal apostrophes stay literal inside genuine single quotes', () => {
  for (const word of ["don't", "John's", possessive, "李'的", "e\u0301's", "𐐀'ı", "١'ı"]) {
    const literal = `'${word} @REF_IMAGE_1'`;
    assert.equal(bindImageReferences(`${literal}; @REF_IMAGE_2`, refs), `${literal}; @REFERENCE[b]`, word);
    const missing = `'${word} @PERSON_9 @REF_IMAGE_9 @REFERENCE[missing]'`;
    assert.equal(normalizeReferencePrompt(missing, []), missing, word);
    assert.equal(resolveStableImageReferences(missing, []), missing, word);
    assert.equal(mergePersonReferenceInputs([], [], '', missing).prompt, missing, word);
  }
});

test('editable prompts and display aliases preserve quoted apostrophes', () => {
  const people = [{ ...refs[0], personId: 1 }];
  const expanded = 'the main person shown in image 1 (all these photos show the SAME single person)';
  const text = `'don't change ${expanded}; image 2; @REF_IMAGE_1'`;
  assert.equal(prepareEditableImagePrompt(text, people), text);
  const stable = "'don't change @REFERENCE[a]'";
  assert.equal(displayReferencePrompt(stable, refs), stable);
  assert.equal(storeReferencePrompt("'don't change @[Reference 1]'", refs), "'don't change @[Reference 1]'");
});

test('frame tags and image intent remain literal inside quotes containing apostrophes', () => {
  const frames = [{ ...refs[0], isFirstFrame: true }];
  for (const [open, close] of [["'", "'"], ['"', '"'], ['“', '”']]) {
    const text = `${open}don't change @FIRST_FRAME @PERSON_9 @REF_IMAGE_9${close}`;
    assert.equal(normalizeSeedanceFrameTags(text, frames), text);
    assert.equal(normalizeReferencePrompt(text, []), text);
    assert.equal(isYouTubeThumbnailPrompt(`Print ${open}don't show a YouTube thumbnail${close} on a plain poster.`, []), false);
  }
});

test('single-quote endings beside Unicode words keep the existing boundary rule', () => {
  // A suffixed single-quoted token is ambiguous. Keep the PR's lexical rule;
  // double or curly-double quotes provide unambiguous literal copy instead.
  for (const suffix of ['ın', 'я', '\u0301', '١', '_x']) {
    assert.equal(bindImageReferences(`'@REF_IMAGE_1'${suffix} aynen yaz`, refs), `'@REFERENCE[a]'${suffix} aynen yaz`);
    assert.equal(bindImageReferences(`"@REF_IMAGE_1"${suffix} aynen yaz`, refs), `"@REF_IMAGE_1"${suffix} aynen yaz`);
    assert.equal(bindImageReferences(`“@REF_IMAGE_1”${suffix} aynen yaz`, refs), `“@REF_IMAGE_1”${suffix} aynen yaz`);
  }
  // Relaxing the closing boundary would mistake the possessive for a closer.
  assert.equal(bindImageReferences("'hi, Barış'ın @REF_IMAGE_1", refs), "'hi, Barış'ın @REFERENCE[a]");
});

test('unmatched and multiline quotes do not hide reference validation', () => {
  for (const text of ["'don't show @PERSON_9", "'don't\nshow @PERSON_9'", '"show @PERSON_9', '“show @PERSON_9']) {
    assert.throws(() => normalizeReferencePrompt(text, []), /kişi referansı yok/, text);
  }
  assert.equal(bindImageReferences("'don't\nshow @REF_IMAGE_1'", refs), "'don't\nshow @REFERENCE[a]'");
});

test('long quoted and unmatched text with many apostrophes keeps references consistent', () => {
  const words = `${possessive} `.repeat(10_000);
  assert.ok(bindImageReferences(`'${words}@REF_IMAGE_1' @REF_IMAGE_2`, refs) === `'${words}@REF_IMAGE_1' @REFERENCE[b]`, 'closed quote stays literal');
  assert.ok(bindImageReferences(`'${words}@REF_IMAGE_1`, refs) === `'${words}@REFERENCE[a]`, 'unmatched quote does not hide a reference');
});
