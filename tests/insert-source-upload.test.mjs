import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, transformSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Execute the real file-selection handlers with independently gated upload outcomes.
const source = readFileSync(new URL('../src/components/Controls.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('  const processVideoFiles = async');
const handlers = source.slice(start, source.indexOf('  const processAudioFiles = async', start));
const counterStart = source.indexOf('  const [uploadingReferenceVideos, setUploadingReferenceVideos]');
const initStart = counterStart >= 0 ? counterStart : source.indexOf('  const insertSourceUploadRef');
const initialize = source.slice(initStart, source.indexOf('\n  useLayoutEffect(() => {\n    const element = generationBarRef.current;', initStart));
const clearStart = source.indexOf('  const handleClearAll =');
const clearHandler = source.slice(clearStart, source.indexOf('  const handleRemoveImage', clearStart));
const dropStart = source.indexOf('  const handleDrop = async');
const dropHandler = source.slice(dropStart, source.indexOf('  // --- Prompt Resize Handlers ---', dropStart));
const code = transformSync(`module.exports = env => { const { config, onChange, setAttachmentError, isH3VideoConfig, h3State, currentReferenceVideos, maxReferenceVideos, useRef, useState, useLayoutEffect, promptLoadVersion, uploadReferenceVideo, videoInputRef, attachLimitsRef, flushSync, setUndoStack, getPersonDefinitions, refInputRef, setEnhanceError, draggedRefId, draggedGalleryItem, setIsDragging, setIsDraggingSavedRef, setDraggedGalleryItem, handleAddFromGallery, processImageFiles, processAudioFiles, maxReferenceAudios } = env; ${initialize} ${handlers} ${clearHandler} ${dropHandler}; return { handleVideoFileUpload, handleClearAll, handleDrop, uploadingReferenceVideos }; };`, { loader: 'ts', format: 'cjs' }).code;
const mod = { exports: {} }; new Function('module', code)(mod);
const h3 = await build({ entryPoints: [fileURLToPath(new URL('../src/components/H3MaxSettings.tsx', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic' });
const { getH3MaxUIState } = await import('data:text/javascript;base64,' + Buffer.from(h3.outputFiles[0].text).toString('base64'));
const referenceModule = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/images/imageReferences.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { getReferenceImageLimit } = await import('data:text/javascript;base64,' + Buffer.from(referenceModule.outputFiles[0].text).toString('base64'));
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const templateStart = appSource.indexOf('  const handleSelectTemplate =');
const templateCode = transformSync(`module.exports = env => {
  const { config, resolveImageModel, mergePersonReferenceInputs, SUNBURST_MODEL, recreateLoadIdRef, recreateLoadingRef, setIsRecreateLoading, setConfig, setPromptLoadVersion, getH3MaxUIState, getReferenceImageLimit, toast } = env;
  ${appSource.slice(templateStart, appSource.indexOf('  const displayedMedia', templateStart))}
  return handleSelectTemplate;
};`, { loader: 'ts', format: 'cjs' }).code;
const templateMod = { exports: {} }; new Function('module', templateCode)(templateMod);

function scenario(videos = [], mode = 'insert_video', deferred = false, h3 = true) {
  let state = { mode: 'video', videoModel: h3 ? 'minimax-h3' : 'seedance-2.5', h3MaxMode: mode, prompt: 'Keep my source scene', referenceImages: [], referenceAudios: [], referenceVideos: videos.map(id => ({ id })) }, uploadState = null;
  const errors = [], requests = [], gates = new Map(), slots = [], updates = []; let cursor = 0, version = 0, effects = [];
  const api = (commit = true) => { cursor = 0; effects = []; const handlers = mod.exports({ config: state, onChange: update => { if (deferred) updates.push(update); else state = typeof update === 'function' ? update(state) : update; }, setAttachmentError: value => errors.push(typeof value === 'function' ? value(errors.at(-1)) : value),
    isH3VideoConfig: h3, h3State: { mode: state.h3MaxMode }, currentReferenceVideos: state.referenceVideos, maxReferenceVideos: state.h3MaxMode === 'image_to_video' ? 0 : 4,
    useLayoutEffect: effect => effects.push(effect), useRef: value => { const index = cursor++; return slots[index] ||= { current: value }; }, useState: initial => [uploadState ?? initial, update => { uploadState = update(uploadState ?? initial); }], promptLoadVersion: version,
    draggedRefId: null, draggedGalleryItem: null, setIsDragging() {}, setIsDraggingSavedRef() {}, setDraggedGalleryItem() {}, handleAddFromGallery() {}, processImageFiles: files => new Promise(resolve => gates.set(files[0].name, { resolve })), processAudioFiles() { throw new Error('Unexpected audio read'); }, maxReferenceAudios: 3,
    setUndoStack() {}, getPersonDefinitions: () => [], refInputRef: { current: null }, setEnhanceError() {},
    uploadReferenceVideo: file => {
      requests.push(file.name); return new Promise((resolve, reject) => gates.set(file.name, { resolve: () => resolve({ id: file.name }), reject: () => reject(new Error(file.name + ' upload failed')) }));
    }, videoInputRef: { current: null }, attachLimitsRef: { get current() { return { videos: 4, config: state }; } }, flushSync: run => { run(); while (updates.length) { const update = updates.shift(); state = typeof update === 'function' ? update(state) : update; } },
  }); if (commit) effects.forEach(effect => effect()); return handlers; };
  return { pick: names => api().handleVideoFileUpload({ target: { files: names.map(name => ({ name, size: 1 })) } }),
    drop: names => api().handleDrop({ preventDefault() {}, dataTransfer: { getData: () => '', files: names.map(name => ({ name, size: 1, type: name.endsWith('.png') ? 'image/png' : 'video/mp4' })) } }),
    discardRender: () => { const previous = state; state = { ...state, videoModel: 'uncommitted-model' }; api(false); state = previous; },
    clear: () => api().handleClearAll(), replaceDraft: () => { state = { ...state, prompt: 'New draft', referenceVideos: [] }; version++; api(); },
    loadTemplate: () => { templateMod.exports({ getH3MaxUIState, getReferenceImageLimit, config: state, resolveImageModel: value => value, SUNBURST_MODEL: 'test-image',
      mergePersonReferenceInputs: (references, current, prompt) => ({ references, prompt, personGroups: [] }),
      recreateLoadIdRef: { current: 0 }, recreateLoadingRef: { current: null }, setIsRecreateLoading() {},
      setConfig: value => { state = value; }, setPromptLoadVersion: update => { version = update(version); },
      toast: { info() {}, error: (...args) => assert.fail(args.join(' ')) },
    })({ name: 'Another scene', config: { ...state, prompt: 'Template scene', referenceVideos: [] } }); api(); },
    change: update => { state = update(state); api(); }, gates, requests, errors, state: () => state, uploading: () => api().uploadingReferenceVideos };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('a failed Insert source never promotes a supplemental clip into its role', async () => {
  const f = scenario();
  const pending = f.pick(['source.mp4', 'guide.mp4']);
  await tick(); f.gates.get('source.mp4').reject(); f.gates.get('guide.mp4')?.resolve();
  await pending;
  assert.deepEqual(f.state().referenceVideos, []);
  assert.equal(f.uploading(), 0);
  assert.ok(f.errors.some(error => /source.mp4 upload failed/.test(error || '')));
  assert.deepEqual(f.requests, ['source.mp4'], 'do not upload references when their source could not be prepared');
});
test('a valid Insert source stays first if a supplemental upload fails', async () => {
  const f = scenario(); const pending = f.pick(['source.mp4', 'bad-guide.mp4', 'guide.mp4']);
  await tick(); f.gates.get('source.mp4').resolve(); await tick();
  f.gates.get('bad-guide.mp4').reject(); f.gates.get('guide.mp4').resolve(); await pending;
  assert.deepEqual(f.state().referenceVideos.map(video => video.id), ['source.mp4', 'guide.mp4']);
  assert.equal(f.uploading(), 0);
});
test('a failed first attempt can be retried with the intended source', async () => {
  const f = scenario(); let pending = f.pick(['source.mp4']);
  await tick(); f.gates.get('source.mp4').reject(); await pending;
  pending = f.pick(['source.mp4', 'guide.mp4']); await tick(); f.gates.get('source.mp4').resolve(); await tick();
  f.gates.get('guide.mp4').resolve(); await pending;
  assert.deepEqual(f.state().referenceVideos.map(video => video.id), ['source.mp4', 'guide.mp4']);
  assert.equal(f.uploading(), 0);
});
test('supplemental failures do not block additions when an Insert source already exists', async () => {
  const f = scenario(['existing-source']); const pending = f.pick(['bad-guide.mp4', 'guide.mp4']);
  await tick(); f.gates.get('bad-guide.mp4').reject(); f.gates.get('guide.mp4').resolve(); await pending;
  assert.deepEqual(f.state().referenceVideos.map(video => video.id), ['existing-source', 'guide.mp4']);
});
test('ordinary reference mode retains successful clips when another upload fails', async () => {
  const f = scenario([], 'reference_to_video'); const pending = f.pick(['bad.mp4', 'guide.mp4']);
  await tick(); f.gates.get('bad.mp4').reject(); f.gates.get('guide.mp4').resolve(); await pending;
  assert.deepEqual(f.state().referenceVideos.map(video => video.id), ['guide.mp4']);
});

test('an overlapping selection cannot replace the pending Insert source', async () => {
  const f = scenario(); const first = f.pick(['source.mp4', 'guide.mp4']);
  await tick(); const second = f.pick(['other-source.mp4']); await tick();
  f.gates.get('source.mp4').resolve(); await tick(); f.gates.get('guide.mp4').resolve();
  // Existing implementation starts this upload and may commit it first.
  f.gates.get('other-source.mp4')?.resolve(); await Promise.all([first, second]);
  assert.deepEqual(f.requests, ['source.mp4', 'guide.mp4']);
  assert.deepEqual(f.state().referenceVideos.map(video => video.id), ['source.mp4', 'guide.mp4']);
});
test('removing the source during a supplemental upload cannot promote the guide', async () => {
  const f = scenario(['source.mp4'], 'insert_video', true); const pending = f.pick(['guide.mp4']);
  await tick(); f.change(state => ({ ...state, referenceVideos: [] }));
  f.gates.get('guide.mp4').resolve(); await pending;
  assert.deepEqual(f.state().referenceVideos, []);
  assert.ok(f.errors.some(error => /source.*changed/i.test(error || '')));
});

for (const action of ['clear', 'replaceDraft']) {
  test(`${action} invalidates an old Insert upload and permits a new source immediately`, async () => {
    const f = scenario(); const old = f.pick(['old.mp4']); await tick();
    f[action](); const current = f.pick(['new.mp4']); await tick();
    f.gates.get('new.mp4')?.resolve(); await tick();
    f.gates.get('old.mp4').resolve(); await Promise.all([old,current]);
    assert.deepEqual(f.requests, ['old.mp4','new.mp4']);
    assert.deepEqual(f.state().referenceVideos.map(video => video.id), ['new.mp4']);
    assert.equal(f.uploading(), 0);
  });
}
test('an invalidated upload finishing cannot release a newer source lock', async () => {
  const f = scenario(); const old = f.pick(['old.mp4']); await tick(); f.clear();
  const current = f.pick(['new.mp4']); await tick(); f.gates.get('old.mp4').resolve(); await old;
  const third = f.pick(['third.mp4']); await tick(); f.gates.get('third.mp4')?.resolve();
  f.gates.get('new.mp4')?.resolve(); await Promise.all([current,third]);
  assert.deepEqual(f.requests, ['old.mp4','new.mp4']);
  assert.deepEqual(f.state().referenceVideos.map(video => video.id), ['new.mp4']);
  assert.equal(f.uploading(), 0);
});

for (const action of ['clear', 'replaceDraft']) {
  test(`${action} releases all slots reserved by the previous Insert draft`, async () => {
    const f = scenario();
    const old = f.pick(['old.mp4', 'guide1.mp4', 'guide2.mp4', 'guide3.mp4']);
    await tick(); f[action]();
    const current = f.pick(['new.mp4']); await tick();
    f.gates.get('new.mp4')?.resolve(); await tick();
    f.gates.get('old.mp4').resolve(); await tick();
    for (const name of ['guide1.mp4', 'guide2.mp4', 'guide3.mp4']) f.gates.get(name)?.resolve();
    await Promise.all([old, current]);
    assert.deepEqual(f.requests, ['old.mp4', 'new.mp4']);
    assert.deepEqual(f.state().referenceVideos.map(video => video.id), ['new.mp4']);
    assert.equal(f.uploading(), 0);
  });
}

test('an abandoned source failure cannot replace the new draft warning or start its guides', async () => {
  const f = scenario(); const old = f.pick(['old.mp4', 'unused-guide.mp4']); await tick();
  f.clear(); const current = f.pick(['new.mp4']); await tick();
  f.gates.get('old.mp4').reject(); await old;
  assert.equal(f.errors.at(-1), null);
  assert.equal(f.uploading(), 1, 'old completion must not decrement the new reservation');
  f.gates.get('new.mp4')?.resolve(); await current;
  assert.deepEqual(f.requests, ['old.mp4', 'new.mp4']);
  assert.deepEqual(f.state().referenceVideos.map(video => video.id), ['new.mp4']);
});
test('clearing while supplemental clips load discards their source and guides', async () => {
  const f = scenario(); const pending = f.pick(['source.mp4', 'guide.mp4']); await tick();
  f.gates.get('source.mp4').resolve(); await tick(); f.clear();
  f.gates.get('guide.mp4').resolve(); await pending;
  assert.deepEqual(f.state().referenceVideos, []);
  assert.equal(f.uploading(), 0);
});
test('typing in the same draft keeps its pending Insert source', async () => {
  const f = scenario(); const pending = f.pick(['source.mp4']); await tick();
  f.change(state => ({ ...state, prompt: 'Keep this newly typed direction' }));
  f.gates.get('source.mp4').resolve(); await pending;
  assert.equal(f.state().prompt, 'Keep this newly typed direction');
  assert.deepEqual(f.state().referenceVideos.map(video => video.id), ['source.mp4']);
});

test('applying a template invalidates the pending source through the real App handler', async () => {
  const f = scenario(); const old = f.pick(['old.mp4']); await tick();
  f.loadTemplate(); const current = f.pick(['new.mp4']); await tick();
  f.gates.get('new.mp4')?.resolve(); await tick(); f.gates.get('old.mp4').resolve();
  await Promise.all([old, current]);
  assert.deepEqual(f.requests, ['old.mp4', 'new.mp4']);
  assert.equal(f.state().prompt, 'Template scene');
  assert.deepEqual(f.state().referenceVideos.map(video => video.id), ['new.mp4']);
});

test('a discarded render cannot invalidate the committed draft upload', async () => {
  const f = scenario(); const pending = f.pick(['source.mp4']); await tick();
  f.discardRender(); f.gates.get('source.mp4').resolve(); await pending;
  assert.deepEqual(f.state().referenceVideos.map(video => video.id), ['source.mp4']);
  assert.equal(f.uploading(), 0);
});
for (const outcome of ['resolve', 'reject']) {
  test(`clearing a Seedance draft discards its obsolete upload ${outcome}`, async () => {
    const f = scenario([], 'reference_to_video', false, false);
    const old = f.pick(['old.mp4']); await tick(); f.clear();
    const current = f.pick(['new.mp4']); await tick();
    f.gates.get('old.mp4')[outcome](); await old;
    assert.equal(f.uploading(), 1);
    assert.equal(f.errors.at(-1), null);
    f.gates.get('new.mp4').resolve(); await current;
    assert.deepEqual(f.state().referenceVideos.map(video => video.id), ['new.mp4']);
    assert.equal(f.uploading(), 0);
  });
}

for (const action of ['pick', 'drop']) {
  test(`obsolete ${action} cannot append its capacity warning to the new draft error`, async () => {
    const f = scenario(['source.mp4']);
    const old = f[action](['g1.mp4', 'g2.mp4', 'g3.mp4', 'extra.mp4']); await tick();
    f.clear(); const current = f.pick(['new.mp4']); await tick();
    f.gates.get('new.mp4').reject(); await current;
    for (const name of ['g1.mp4', 'g2.mp4', 'g3.mp4']) f.gates.get(name).resolve();
    await old;
    assert.deepEqual(f.state().referenceVideos, []);
    assert.equal(f.errors.at(-1), 'new.mp4 upload failed');
    assert.equal(f.uploading(), 0);
  });
}
test('a current over-capacity selection still reports its limit', async () => {
  const f = scenario(['source.mp4']); const pending = f.pick(['g1.mp4', 'g2.mp4', 'g3.mp4', 'extra.mp4']); await tick();
  for (const name of ['g1.mp4', 'g2.mp4', 'g3.mp4']) f.gates.get(name).resolve(); await pending;
  assert.match(f.errors.at(-1), /Limit reached: 4 videos max/);
  assert.equal(f.state().referenceVideos.length, 4);
});

test('an obsolete mixed drop cannot start its video phase or clear the new draft error', async () => {
  const f = scenario(['source.mp4']); const old = f.drop(['image.png', 'late.mp4']); await tick();
  f.clear(); const current = f.pick(['new.mp4']); await tick(); f.gates.get('new.mp4').reject(); await current;
  f.gates.get('image.png').resolve(); await tick(); f.gates.get('late.mp4')?.resolve(); await old;
  assert.deepEqual(f.requests, ['new.mp4']);
  assert.equal(f.errors.at(-1), 'new.mp4 upload failed');
  assert.deepEqual(f.state().referenceVideos, []);
});

test('an obsolete mixed drop cannot report a disallowed-video error from its old action', async () => {
  const f = scenario([], 'image_to_video'); const old = f.drop(['image.png', 'late.mp4']); await tick();
  f.clear(); f.change(state => ({ ...state, h3MaxMode: 'insert_video' }));
  const current = f.pick(['new.mp4']); await tick(); f.gates.get('new.mp4').reject(); await current;
  f.gates.get('image.png').resolve(); await old;
  assert.equal(f.errors.at(-1), 'new.mp4 upload failed');
  assert.deepEqual(f.requests, ['new.mp4']);
});
