import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const start = app.indexOf('  const handleSelectTemplate =');
const compiled = await build({ stdin: { contents: `
  import { getActiveImageModel } from './src/types';
  import { mergePersonReferenceInputs } from './src/lib/references/personReferences';
  import { SUNBURST_MODEL } from './src/lib/images/openaiImage';
  import { getReferenceImageLimit } from './src/lib/images/imageReferences';
  export const apply = (config, template) => {
    let applied, changes = 0; const errors = [];
    const resolveImageModel = getActiveImageModel;
    const recreateLoadIdRef = { current: 0 }, recreateLoadingRef = { current: null };
    const setIsRecreateLoading = () => {}, setPromptLoadVersion = () => {};
    const setConfig = next => { applied = next; changes++; };
    const toast = { info() {}, error: (title, message) => errors.push(message) };
    ${app.slice(start, app.indexOf('  const displayedMedia', start))}
    handleSelectTemplate(template);
    return { applied, changes, errors };
  };
`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic' });
const { apply } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const refs = count => Array.from({ length: count }, (_, i) => ({ id: `template-${i}`, data: `data:image/png;base64,photo${i}`, mimeType: 'image/png' }));
const draft = { mode: 'image', imageModel: 'gpt-image-2.5-sunburst', prompt: 'Current scene', referenceImages: [], count: 3 };
const template = (count, patch = {}) => ({ id: 'saved', name: 'Video cast', config: {
  ...draft, mode: 'video', videoModel: 'seedance-2.5', videoOperation: 'generate', prompt: 'Saved scene', referenceImages: refs(count), ...patch,
} });
const accepted = (value, current = draft) => {
  const result = apply(current, value);
  assert.deepEqual(result.errors, []);
  assert.equal(result.changes, 1);
  assert.equal(result.applied.referenceImages.length, value.config.referenceImages.length + current.referenceImages.length);
  assert.equal(result.applied.mode, value.config.mode);
  assert.equal(result.applied.prompt, 'Saved scene Current scene');
  assert.equal(result.applied.count, current.count);
  return result.applied;
};
const rejected = (value, limit, current = draft) => {
  const result = apply(current, value);
  assert.equal(result.changes, 0, 'an invalid template must not replace the current draft');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], new RegExp(`referans sayısını ${limit} `));
};

test('Seedance 2.5 templates can restore all thirty supported reference images', () => {
  const value = template(30); const before = structuredClone(value);
  accepted(value);
  assert.deepEqual(value, before, 'applying a template does not mutate its saved configuration');
});
test('template capacity is checked after merging the existing draft references', () => {
  const current = { ...draft, referenceImages: [{ id: 'current', data: 'data:image/png;base64,current', mimeType: 'image/png' }] };
  accepted(template(29), current);
  rejected(template(30), 30, current);
});
test('Seedance first/last-frame templates retain the two-image boundary', () => {
  accepted(template(2, { referenceImages: refs(2).map((ref, i) => ({ ...ref, isFirstFrame: i === 0, isLastFrame: i === 1 })) }));
  rejected(template(3, { referenceImages: refs(3).map((ref, i) => ({ ...ref, isFirstFrame: i === 0 })) }), 2);
  accepted(template(30, { referenceImages: refs(30).map((ref, i) => ({ ...ref, isFirstFrame: i === 0 })), referenceAudios: [{ id: 'sound', url: 'https://example.invalid/sound.wav' }] }));
});
test('Seedance 2.0 templates use their nine-image limit', () => {
  accepted(template(9, { videoModel: 'seedance-2.0' }));
  rejected(template(10, { videoModel: 'seedance-2.0' }), 9);
});
test('H3 templates use the selected action rather than the inactive image model', () => {
  accepted(template(2, { videoModel: 'minimax-h3', h3MaxMode: 'image_to_video' }));
  rejected(template(3, { videoModel: 'minimax-h3', h3MaxMode: 'image_to_video' }), 2);
  rejected(template(5, { videoModel: 'minimax-h3', h3MaxMode: 'recast' }), 4);
});
test('H3 reference templates count attached keyframes separately without counting missing or repeated IDs', () => {
  accepted(template(12, { videoModel: 'minimax-h3', h3MaxMode: 'reference_to_video', h3MaxOptions: { startImageId: 'template-0', middleImageId: 'template-1', endImageId: 'template-2' } }));
  rejected(template(11, { videoModel: 'minimax-h3', h3MaxMode: 'reference_to_video', h3MaxOptions: { startImageId: 'template-0', middleImageId: 'template-0', endImageId: 'missing' } }), 10);
});
test('image template limits remain unchanged', () => {
  accepted(template(16, { mode: 'image', imageModel: 'gpt-image-2.5-sunburst' }));
  rejected(template(17, { mode: 'image', imageModel: 'gpt-image-2.5-sunburst' }), 16);
  accepted(template(14, { mode: 'image', imageModel: 'gemini-nano-banana-2.1' }));
  rejected(template(15, { mode: 'image', imageModel: 'gemini-nano-banana-2.1' }), 14);
});
