import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, transformSync } from 'esbuild';

// Run the actual Clear, Undo and Revert handlers with the real reference helpers.
const source = readFileSync(new URL('../src/components/Controls.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const handleRevertEnhancedPrompt =');
const end = source.indexOf('  // --- Template Handlers ---', start);
assert.ok(start > 0 && end > start);
const compiled = await build({ stdin: { contents: `
  export { getPersonDefinitions, getPersonId } from './src/lib/references/personReferences';
  export { removeH3MaxReferenceImages } from './src/lib/video/h3MaxConfig';
  export { getPromptEnhancementTarget, isEnhancedPromptStale } from './src/types';
  export { getH3MaxUIState } from './src/components/H3MaxSettings';
  export { getReferenceImageLimit } from './src/lib/images/imageReferences';
`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const helpers = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const code = transformSync(`module.exports = env => {
  const { config, onChange, undoStack, setUndoStack, setEnhanceError, refInputRef,
    getPersonDefinitions, getPersonId, removeH3MaxReferenceImages, isH3VideoConfig,
    h3PromptSupported, preEnhancePrompt, maxReferenceVideos, maxReferenceAudios, setAttachmentError, getH3MaxUIState,
    insertUploadDraftRef, insertSourceUploadRef, getReferenceImageLimit } = env;
  ${source.slice(start, end)}
  return { clear: handleClearAll, undo: handleUndo, remove: handleRemoveImage, revert: handleRevertEnhancedPrompt };
};`, { loader: 'ts', format: 'cjs' }).code;
const mod = { exports: {} };
new Function('module', code)(mod);

function scenario(initial) {
  let config = structuredClone(initial), undoStack = [];
  let shown = null;
  const errors = [], limits = { videos: 4, audios: 3 };
  // Also allow the pending upload-invalidation change (#168) to clear its refs.
  const insertUploadDraftRef = { current: { token: {} } }, insertSourceUploadRef = { current: null };
  const api = () => mod.exports({ ...helpers, config, undoStack,
    onChange: update => { config = typeof update === 'function' ? update(config) : update; },
    setUndoStack: update => { undoStack = update(undoStack); },
    setEnhanceError() {}, refInputRef: { current: null },
    insertUploadDraftRef, insertSourceUploadRef,
    maxReferenceVideos: limits.videos, maxReferenceAudios: limits.audios, setAttachmentError: update => { shown = typeof update === 'function' ? update(shown) : update; errors.push(shown); },
    isH3VideoConfig: config.mode === 'video' && config.videoModel === 'minimax-h3',
    h3PromptSupported: true, preEnhancePrompt: config.originalPrompt ?? null,
  });
  return { clear: () => api().clear(), undo: () => api().undo(), remove: id => api().remove(id),
    revert: () => api().revert(), shown: () => shown, setShown: value => { shown = value; }, state: () => config, entries: () => undoStack,
    change: update => { config = update(config); }, limits, errors };
}

const image = id => ({ id, data: `data:image/png;base64,${id}`, mimeType: 'image/png' });
const base = { mode: 'video', videoModel: 'minimax-h3', h3MaxMode: 'reference_to_video',
  prompt: 'Keep this scene and soundtrack', referenceImages: [image('scene')],
  referenceVideos: [{ id: 'source', url: 'https://media.invalid/source.mp4', name: 'source.mp4', duration: 5, isContinuation: true, previousPrompt: 'The previous shot' }],
  referenceAudios: [{ id: 'sound', url: 'blob:soundtrack', name: 'soundtrack.wav', duration: 5, mimeType: 'audio/wav' }],
  aspectRatio: '16:9', resolution: '1K', imageModel: 'gpt-image-2.5-sunburst', count: 1 };

test('Clear followed by Undo restores video and audio inputs with their source metadata', () => {
  const f = scenario(base);
  f.clear();
  assert.deepEqual(f.state().referenceVideos, []);
  assert.deepEqual(f.state().referenceAudios, []);
  assert.equal(f.state().prompt, '');
  f.undo();
  assert.deepEqual(f.state().referenceVideos, base.referenceVideos);
  assert.deepEqual(f.state().referenceAudios, base.referenceAudios);
  assert.deepEqual(f.state().referenceImages, base.referenceImages);
  assert.equal(f.state().prompt, base.prompt);
  assert.equal(f.entries().length, 0);
});

test('a media-only draft can be cleared, restored, and cleared again without losing clips', () => {
  const initial = { ...base, prompt: '', referenceImages: [] };
  const f = scenario(initial);
  for (let i = 0; i < 2; i++) {
    f.clear(); f.undo();
    assert.deepEqual(f.state().referenceVideos, initial.referenceVideos);
    assert.deepEqual(f.state().referenceAudios, initial.referenceAudios);
  }
});

for (const mode of ['image', 'video']) test(`Undo restores an enhanced ${mode} prompt together with the original brief and its bindings`, () => {
  const initial = { ...base, mode, ...(mode === 'image' ? { referenceVideos: [], referenceAudios: [] } : {}), prompt: 'Enhanced cinematic shot', originalPrompt: 'My original brief',
    promptPreparation: { action: 'enhance', model: 'gpt-5.5' } };
  Object.assign(initial, helpers.getPromptEnhancementTarget(initial));
  const f = scenario(initial);
  f.clear(); f.undo();
  assert.equal(f.state().originalPrompt, initial.originalPrompt);
  for (const [key, value] of Object.entries(helpers.getPromptEnhancementTarget(initial))) {
    assert.equal(f.state()[key], value, key);
  }
  assert.equal(helpers.isEnhancedPromptStale(f.state()), false);
  f.revert();
  assert.equal(f.state().prompt, 'My original brief');
  assert.equal(f.state().originalPrompt, undefined);
});

test('ordinary image removal Undo still preserves reference order and the current prompt', () => {
  const initial = { ...base, mode: 'image', referenceImages: [image('first'), image('second'), image('third')] };
  const f = scenario(initial);
  f.remove('second');
  assert.deepEqual(f.state().referenceImages.map(ref => ref.id), ['first', 'third']);
  f.undo();
  assert.deepEqual(f.state().referenceImages, initial.referenceImages);
  assert.equal(f.state().prompt, initial.prompt);
  assert.deepEqual(f.state().referenceVideos, initial.referenceVideos);
  assert.deepEqual(f.state().referenceAudios, initial.referenceAudios);
});

test('Undo keeps later attachments, avoids duplicates, and leaves unrelated settings intact', () => {
  const f = scenario(base);
  f.clear();
  const laterVideo = { id: 'later-video', url: 'https://media.invalid/later.mp4' };
  const laterAudio = { id: 'later-audio', url: 'blob:later' };
  f.change(config => ({ ...config, referenceVideos: [laterVideo, base.referenceVideos[0]],
    referenceAudios: [laterAudio], videoDuration: 8, count: 3 }));
  f.undo();
  assert.equal(f.state().referenceVideos.length, 2);
  assert.deepEqual(f.state().referenceVideos.find(video => video.id === 'later-video'), laterVideo);
  assert.deepEqual(f.state().referenceAudios, [base.referenceAudios[0], laterAudio]);
  assert.equal(f.state().videoDuration, 8);
  assert.equal(f.state().count, 3);
});

test('insufficient media capacity preserves the current draft and Undo can be retried', () => {
  for (const kind of ['videos', 'audios']) {
    const f = scenario(base);
    f.clear();
    f.change(config => ({ ...config, h3MaxMode: kind === 'videos' ? 'text_to_video' : 'recast' }));
    const before = structuredClone(f.state());
    f.undo();
    assert.deepEqual(f.state(), before);
    assert.equal(f.entries().length, 1);
    assert.match(f.errors.at(-1), /could not undo clear/i);
    f.change(config => ({ ...config, h3MaxMode: 'reference_to_video' }));
    f.undo();
    assert.deepEqual(f.state().referenceVideos, base.referenceVideos);
    assert.deepEqual(f.state().referenceAudios, base.referenceAudios);
    assert.equal(f.entries().length, 0);
    assert.equal(f.errors.at(-1), null);
  }
});

test('an automatic H3 action resolves against the restored references when Undo checks capacity', () => {
  const f = scenario({ ...base, h3MaxMode: 'auto' });
  f.clear();
  assert.equal(helpers.getH3MaxUIState(f.state()).mode, 'text_to_video');
  f.undo();
  assert.deepEqual(f.state().referenceVideos, base.referenceVideos);
  assert.deepEqual(f.state().referenceAudios, base.referenceAudios);
  assert.equal(helpers.getH3MaxUIState(f.state()).mode, 'reference_to_video');
});

test('later attachments cannot make Undo exceed the current media limit or consume the entry', () => {
  const f = scenario(base);
  f.clear();
  const later = [1, 2, 3].map(id => ({ id: `later-${id}`, url: `blob:later-${id}` }));
  f.change(config => ({ ...config, referenceVideos: later }));
  f.undo();
  assert.deepEqual(f.state().referenceVideos, later);
  assert.equal(f.entries().length, 1);
  f.change(config => ({ ...config, referenceVideos: later.slice(0, 2) }));
  f.undo();
  assert.deepEqual(f.state().referenceVideos, [base.referenceVideos[0], ...later.slice(0, 2)]);
  assert.equal(f.entries().length, 0);
});

const images = count => Array.from({ length: count }, (_, index) => image(`image-${index}`));

test('H3 action changes reject excess restored images without consuming Undo, then allow retry', () => {
  for (const [action, count] of [['text_to_video', 1], ['image_to_video', 3], ['lip_sync', 2], ['recast', 5]]) {
    const initial = { ...base, referenceImages: images(count), referenceVideos: [], referenceAudios: [] };
    const f = scenario(initial);
    f.clear();
    f.change(config => ({ ...config, h3MaxMode: action, prompt: 'Typed after Clear', videoDuration: 8 }));
    const before = structuredClone(f.state());
    f.undo();
    assert.deepEqual(f.state(), before, action);
    assert.equal(f.entries().length, 1, action);
    assert.match(f.errors.at(-1), /previous media references/i);
    f.change(config => ({ ...config, h3MaxMode: 'reference_to_video' }));
    f.undo();
    assert.deepEqual(f.state().referenceImages, initial.referenceImages);
    assert.equal(f.state().videoDuration, 8);
    assert.equal(f.entries().length, 0);
    assert.equal(f.errors.at(-1), null);
  }
});

test('Clear Undo honors lower image-model and Seedance capacities after switching models', () => {
  for (const [initial, change] of [
    [{ ...base, mode: 'image', referenceImages: images(16), referenceVideos: [], referenceAudios: [] }, { imageModel: 'gemini-nano-banana-2.1' }],
    [{ ...base, videoModel: 'seedance-2.5', referenceImages: images(10), referenceVideos: [], referenceAudios: [] }, { videoModel: 'seedance-2.0' }],
  ]) {
    const f = scenario(initial);
    f.clear();
    f.change(config => ({ ...config, ...change }));
    const before = structuredClone(f.state());
    f.undo();
    assert.deepEqual(f.state(), before);
    assert.equal(f.entries().length, 1);
    f.change(config => ({ ...config, imageModel: initial.imageModel, videoModel: initial.videoModel }));
    f.undo();
    assert.deepEqual(f.state().referenceImages, initial.referenceImages);
    assert.equal(f.entries().length, 0);
  }
});

test('image overflow keeps later media, prompt edits and settings intact until a successful retry', () => {
  const initial = { ...base, mode: 'image', referenceImages: images(16), originalPrompt: 'Original image brief' };
  Object.assign(initial, helpers.getPromptEnhancementTarget(initial));
  const f = scenario(initial);
  const laterVideo = { id: 'later-video', url: 'blob:later-video' };
  const laterAudio = { id: 'later-audio', url: 'blob:later-audio' };
  f.clear();
  f.change(config => ({ ...config, imageModel: 'gemini-nano-banana-2.1', prompt: 'New draft text',
    referenceVideos: [laterVideo], referenceAudios: [laterAudio], count: 3, resolution: '2K' }));
  const before = structuredClone(f.state());
  f.undo();
  assert.deepEqual(f.state(), before);
  assert.equal(f.entries().length, 1);
  f.change(config => ({ ...config, imageModel: initial.imageModel }));
  f.undo();
  assert.deepEqual(f.state().referenceImages, initial.referenceImages);
  assert.deepEqual(f.state().referenceVideos, [...initial.referenceVideos, laterVideo]);
  assert.deepEqual(f.state().referenceAudios, [...initial.referenceAudios, laterAudio]);
  assert.equal(f.state().originalPrompt, initial.originalPrompt);
  assert.equal(f.state().count, 3);
  assert.equal(f.state().resolution, '2K');
  assert.equal(f.entries().length, 0);
});

test('later image attachments cannot overflow Undo and can be removed before retrying', () => {
  const initial = { ...base, mode: 'image', referenceImages: images(16), referenceVideos: [], referenceAudios: [] };
  const f = scenario(initial);
  const later = image('later');
  f.clear();
  f.change(config => ({ ...config, referenceImages: [later] }));
  f.undo();
  assert.deepEqual(f.state().referenceImages, [later]);
  assert.equal(f.entries().length, 1);
  f.change(config => ({ ...config, referenceImages: [] }));
  f.undo();
  assert.deepEqual(f.state().referenceImages, initial.referenceImages);
  assert.equal(f.entries().length, 0);
});

test('Seedance frame limits use the restored operation and audio, including Edit', () => {
  const references = images(3).map((reference, index) => ({ ...reference, isFirstFrame: index === 0 }));
  const initial = { ...base, videoModel: 'seedance-2.5', videoOperation: 'generate',
    referenceImages: references.slice(0, 2), referenceVideos: [], referenceAudios: [] };
  const f = scenario(initial);
  f.clear();
  f.change(config => ({ ...config, referenceImages: [references[2]] }));
  const before = structuredClone(f.state());
  f.undo();
  assert.deepEqual(f.state(), before);
  assert.equal(f.entries().length, 1);
  f.change(config => ({ ...config, videoOperation: 'edit', referenceVideos: base.referenceVideos }));
  f.undo();
  assert.deepEqual(f.state().referenceImages, [references[2], ...references.slice(0, 2)]);
  assert.deepEqual(f.state().referenceVideos, base.referenceVideos);

  // A target soundtrack makes this a reference request, rather than two frames.
  const withAudio = scenario({ ...initial, referenceImages: references, referenceAudios: base.referenceAudios });
  withAudio.clear();
  withAudio.change(config => ({ ...config, referenceImages: [references[0]] }));
  assert.equal(helpers.getReferenceImageLimit(withAudio.state()), 2);
  withAudio.undo();
  assert.deepEqual(withAudio.state().referenceAudios, base.referenceAudios);
  assert.equal(withAudio.state().referenceImages.length, 3);
  assert.equal(withAudio.entries().length, 0);
});

test('valid H3 Auto and selected keyframes retain their restored image capacity', () => {
  for (const initial of [
    { ...base, h3MaxMode: 'auto', referenceImages: images(9), referenceVideos: [], referenceAudios: [] },
    { ...base, referenceImages: images(11), referenceVideos: [], referenceAudios: [],
      h3MaxOptions: { startImageId: 'image-0', endImageId: 'image-1' } },
  ]) {
    const f = scenario(initial);
    f.clear(); f.undo();
    assert.deepEqual(f.state().referenceImages, initial.referenceImages);
    assert.deepEqual(f.state().h3MaxOptions, initial.h3MaxOptions);
    assert.equal(f.entries().length, 0);
  }
});

test('Undo of a removed image refuses when a later attachment filled the image limit, then works after room is made', () => {
  const initial = { ...base, mode: 'image', imageModel: 'gemini-nano-banana-2.1', referenceImages: images(14), referenceVideos: [], referenceAudios: [] };
  const f = scenario(initial);
  const limit = helpers.getReferenceImageLimit(initial);
  f.remove('image-0');
  f.change(config => ({ ...config, referenceImages: [...config.referenceImages, image('later')] }));
  assert.equal(f.state().referenceImages.length, limit);
  f.undo();
  assert.equal(f.state().referenceImages.length, limit);
  assert.equal(f.entries().length, 1);
  assert.equal(f.errors.length, 1);
  f.change(config => ({ ...config, referenceImages: config.referenceImages.slice(1) }));
  f.undo();
  assert.equal(f.state().referenceImages.length, limit);
  assert.equal(f.entries().length, 0);
});

test('a refused Undo leaves the older entry under a new removal, and the next Undo restores the newer one and clears the warning', () => {
  const initial = { ...base, mode: 'image', imageModel: 'gemini-nano-banana-2.1', referenceImages: images(14), referenceVideos: [], referenceAudios: [] };
  const f = scenario(initial);
  f.remove('image-0');
  f.change(config => ({ ...config, referenceImages: [...config.referenceImages, image('later')] }));
  f.undo();
  assert.match(f.errors.at(-1), /restores that image first/);
  f.remove('image-1');
  assert.equal(f.entries().length, 2);
  f.undo();
  assert.ok(f.state().referenceImages.some(ref => ref.id === 'image-1'));
  assert.ok(!f.state().referenceImages.some(ref => ref.id === 'image-0'));
  assert.equal(f.entries().length, 1);
  assert.equal(f.errors.at(-1), null);
});

test('a successful Undo clears its own warning but leaves an unrelated upload error', () => {
  const initial = { ...base, mode: 'image', imageModel: 'gemini-nano-banana-2.1', referenceImages: images(14), referenceVideos: [], referenceAudios: [] };
  const f = scenario(initial);
  f.remove('image-0');
  f.remove('image-1');
  f.setShown('Source video upload failed.');
  f.undo();
  assert.equal(f.shown(), 'Source video upload failed.');
});

test('the full-composer warning names image references, since removing a video adds no Undo entry', () => {
  const initial = { ...base, mode: 'image', imageModel: 'gemini-nano-banana-2.1', referenceImages: images(14), referenceVideos: [], referenceAudios: [] };
  const f = scenario(initial);
  f.remove('image-0');
  f.change(config => ({ ...config, referenceImages: [...config.referenceImages, image('later')] }));
  f.undo();
  assert.match(f.shown(), /removing another image reference/);
});

test('a refused Undo keeps an unrelated upload error and shows its own warning under it, which a later Undo removes', () => {
  const initial = { ...base, mode: 'image', imageModel: 'gemini-nano-banana-2.1', referenceImages: images(14), referenceVideos: [], referenceAudios: [] };
  const f = scenario(initial);
  f.remove('image-0');
  f.change(config => ({ ...config, referenceImages: [...config.referenceImages, image('later')] }));
  f.setShown('Source video upload failed.');
  f.undo();
  assert.match(f.shown(), /^Source video upload failed\.\nCould not undo/);
  f.undo();
  assert.equal(f.shown().split('\n').length, 2);
  f.change(config => ({ ...config, referenceImages: config.referenceImages.slice(1) }));
  f.undo();
  assert.equal(f.shown(), 'Source video upload failed.');
});

test('a file name with a line break cannot split an attachment error into fake lines', () => {
  // Run the real addAttachmentError from Controls with a state setter, as an upload failure for a named file does.
  const from = source.indexOf('  const addAttachmentError =');
  const addSource = source.slice(from, source.indexOf('
', from));
  const factory = new Function('setAttachmentError', transformSync(addSource.replace('const addAttachmentError', 'var addAttachmentError') + '\nreturn addAttachmentError;', { loader: 'ts', format: 'cjs' }).code.replace(/^"use strict";/, ''));
  let shown = null;
  const add = factory(update => { shown = update(shown); });
  add('Could not read clip.\r\nLimit reached: 3 videos max.');
  assert.equal(shown, 'Could not read clip. Limit reached: 3 videos max.');
  assert.equal(shown.includes('\n'), false);
  add('Limit reached: 3 videos max.');
  assert.equal(shown, 'Could not read clip. Limit reached: 3 videos max.\nLimit reached: 3 videos max.');
  add('Limit reached: 3 videos max.');
  assert.equal(shown.split('\n').length, 2);
  shown = null;
  add('Normal-name.mp4 is too large.');
  assert.equal(shown, 'Normal-name.mp4 is too large.');
});
