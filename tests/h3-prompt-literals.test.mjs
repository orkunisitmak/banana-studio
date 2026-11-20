import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/video/h3MaxPromptGuide.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { normalizeH3MaxPromptLanguage } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const empty = { images: [], videos: [], audios: [] };

test('H3 text-to-video preserves exact dialogue and visible copy containing reference words', () => {
  const prompt = 'Say "Image 1, video 2, audio 3". Print “@PERSON_9” and \'don\'t change @FIRST_FRAME\'.';
  assert.equal(normalizeH3MaxPromptLanguage(prompt, { mode: 'text_to_video' }, empty), prompt);
});

test('H3 reference normalization changes instructions outside quotes only', () => {
  const references = {
    images: [{ id: 'opening', data: 'opening', mimeType: 'image/png' }, { id: 'person', data: 'person', mimeType: 'image/png', personId: 3 }],
    videos: [{ id: 'motion', url: 'motion' }], audios: [{ id: 'sound', url: 'sound' }],
  };
  const context = { mode: 'reference_to_video', options: { startImageId: 'opening' } };
  const prompt = 'Use @REF_IMAGE_2 with @VIDEO_1 and @AUDIO_1 from @FIRST_FRAME. Say "@REF_IMAGE_2 and Image 9".';
  assert.equal(normalizeH3MaxPromptLanguage(prompt, context, references),
    'Use Image 1 with Video 1 and Audio 1 from the start image. Say "@REF_IMAGE_2 and Image 9".');
  assert.equal(normalizeH3MaxPromptLanguage('Follow @PERSON_3; label "@PERSON_3".', context, references),
    'Follow the person shown in Image 1; label "@PERSON_3".');
});

test('H3 frame prompts keep quoted aliases and escaped underscores verbatim', () => {
  const references = { ...empty, images: [{ id: 'start', isFirstFrame: true }, { id: 'end', isLastFrame: true }] };
  const prompt = 'Move from @REF_IMAGE_1 to @LAST_FRAME. Print "@FIRST\\_FRAME" and \'@IMAGE_2\'.';
  assert.equal(normalizeH3MaxPromptLanguage(prompt, { mode: 'image_to_video' }, references),
    'Move from the start image to the end image. Print "@FIRST\\_FRAME" and \'@IMAGE_2\'.');
});

test('unquoted H3 references still resolve beside possessives and unmatched quotes', () => {
  assert.equal(normalizeH3MaxPromptLanguage('John\'s @FIRST_FRAME; "@AUDIO_1', { mode: 'text_to_video' }, empty),
    'John\'s the opening scene; "the requested sound');
  assert.equal(normalizeH3MaxPromptLanguage('', { mode: 'text_to_video' }, empty), '');
});
