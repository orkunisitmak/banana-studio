import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Execute the real file-selection handlers with independently gated upload outcomes.
const source = readFileSync(new URL('../src/components/Controls.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const processVideoFiles = async');
const handlers = source.slice(start, source.indexOf('  const processAudioFiles = async', start));
const code = transformSync(`module.exports = env => { const { config, onChange, setAttachmentError, isH3VideoConfig, h3State, currentReferenceVideos, maxReferenceVideos, uploadingReferenceVideos, insertSourceUploadRef, setUploadingReferenceVideos, uploadReferenceVideo, videoInputRef, attachLimitsRef, flushSync } = env; ${handlers}; return { handleVideoFileUpload }; };`, { loader: 'ts', format: 'cjs' }).code;
const mod = { exports: {} }; new Function('module', code)(mod);
function scenario(videos = [], mode = 'insert_video') {
  let state = { mode: 'video', videoModel: 'minimax-h3', h3MaxMode: mode, prompt: 'Keep my source scene', referenceVideos: videos.map(id => ({ id })) }, uploading = 0;
  const errors = [], requests = [], gates = new Map(), insertSourceUploadRef = { current: false };
  const api = () => mod.exports({ config: state, onChange: update => { state = update(state); }, setAttachmentError: value => errors.push(typeof value === 'function' ? value(errors.at(-1)) : value),
    isH3VideoConfig: true, h3State: { mode }, currentReferenceVideos: state.referenceVideos, maxReferenceVideos: 4, uploadingReferenceVideos: uploading,
    insertSourceUploadRef, setUploadingReferenceVideos: update => { uploading = update(uploading); }, uploadReferenceVideo: file => {
      requests.push(file.name); return new Promise((resolve, reject) => gates.set(file.name, { resolve: () => resolve({ id: file.name }), reject: () => reject(new Error(file.name + ' upload failed')) }));
    }, videoInputRef: { current: null }, attachLimitsRef: { get current() { return { videos: 4, config: state }; } }, flushSync: run => run(),
  });
  return { pick: names => api().handleVideoFileUpload({ target: { files: names.map(name => ({ name, size: 1 })) } }),
    change: update => { state = update(state); }, gates, requests, errors, state: () => state, uploading: () => uploading };
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
  const f = scenario(['source.mp4']); const pending = f.pick(['guide.mp4']);
  await tick(); f.change(state => ({ ...state, referenceVideos: [] }));
  f.gates.get('guide.mp4').resolve(); await pending;
  assert.deepEqual(f.state().referenceVideos, []);
  assert.ok(f.errors.some(error => /source.*changed/i.test(error || '')));
});
