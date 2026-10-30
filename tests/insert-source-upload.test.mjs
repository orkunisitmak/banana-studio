import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Execute the real file-selection handlers with independently gated upload outcomes.
const source = readFileSync(new URL('../src/components/Controls.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const processVideoFiles = async');
const handlers = source.slice(start, source.indexOf('  const processAudioFiles = async', start));
const counterStart = source.indexOf('  const [uploadingReferenceVideos, setUploadingReferenceVideos]');
const initStart = counterStart >= 0 ? counterStart : source.indexOf('  const insertSourceUploadRef');
const initialize = source.slice(initStart, source.indexOf('\n  useLayoutEffect(', initStart));
const clearStart = source.indexOf('  const handleClearAll =');
const clearHandler = source.slice(clearStart, source.indexOf('  const handleRemoveImage', clearStart));
const code = transformSync(`module.exports = env => { const { config, onChange, setAttachmentError, isH3VideoConfig, h3State, currentReferenceVideos, maxReferenceVideos, useRef, useState, promptLoadVersion, uploadReferenceVideo, videoInputRef, attachLimitsRef, flushSync, setUndoStack, getPersonDefinitions, refInputRef, setEnhanceError } = env; ${initialize} ${handlers} ${clearHandler}; return { handleVideoFileUpload, handleClearAll, uploadingReferenceVideos }; };`, { loader: 'ts', format: 'cjs' }).code;
const mod = { exports: {} }; new Function('module', code)(mod);
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const templateStart = appSource.indexOf('  const handleSelectTemplate =');
const templateCode = transformSync(`module.exports = env => {
  const { config, resolveImageModel, mergePersonReferenceInputs, SUNBURST_MODEL, recreateLoadIdRef, recreateLoadingRef, setIsRecreateLoading, setConfig, setPromptLoadVersion, toast } = env;
  ${appSource.slice(templateStart, appSource.indexOf('  const displayedMedia', templateStart))}
  return handleSelectTemplate;
};`, { loader: 'ts', format: 'cjs' }).code;
const templateMod = { exports: {} }; new Function('module', templateCode)(templateMod);

function scenario(videos = [], mode = 'insert_video', deferred = false) {
  let state = { mode: 'video', videoModel: 'minimax-h3', h3MaxMode: mode, prompt: 'Keep my source scene', referenceImages: [], referenceAudios: [], referenceVideos: videos.map(id => ({ id })) }, uploadState = null;
  const errors = [], requests = [], gates = new Map(), slots = [], updates = []; let cursor = 0, version = 0;
  const api = () => { cursor = 0; return mod.exports({ config: state, onChange: update => { if (deferred) updates.push(update); else state = typeof update === 'function' ? update(state) : update; }, setAttachmentError: value => errors.push(typeof value === 'function' ? value(errors.at(-1)) : value),
    isH3VideoConfig: true, h3State: { mode }, currentReferenceVideos: state.referenceVideos, maxReferenceVideos: 4,
    useRef: value => { const index = cursor++; return slots[index] ||= { current: value }; }, useState: initial => [uploadState ?? initial, update => { uploadState = update(uploadState ?? initial); }], promptLoadVersion: version,
    setUndoStack() {}, getPersonDefinitions: () => [], refInputRef: { current: null }, setEnhanceError() {},
    uploadReferenceVideo: file => {
      requests.push(file.name); return new Promise((resolve, reject) => gates.set(file.name, { resolve: () => resolve({ id: file.name }), reject: () => reject(new Error(file.name + ' upload failed')) }));
    }, videoInputRef: { current: null }, attachLimitsRef: { get current() { return { videos: 4, config: state }; } }, flushSync: run => { run(); while (updates.length) { const update = updates.shift(); state = typeof update === 'function' ? update(state) : update; } },
  }); };
  return { pick: names => api().handleVideoFileUpload({ target: { files: names.map(name => ({ name, size: 1 })) } }),
    clear: () => api().handleClearAll(), replaceDraft: () => { state = { ...state, prompt: 'New draft', referenceVideos: [] }; version++; api(); },
    loadTemplate: () => { templateMod.exports({ config: state, resolveImageModel: value => value, SUNBURST_MODEL: 'test-image',
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
