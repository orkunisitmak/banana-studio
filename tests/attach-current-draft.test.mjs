import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
// Runs the exact Controls attach handlers. onChange behaves like React setState:
// a functional update sees the latest draft, so file reads that await must use one.
const src = readFileSync(new URL('../src/components/Controls.tsx', import.meta.url), 'utf8');
const audio = src.slice(src.indexOf('  const processAudioFiles = async'), src.indexOf('\n  };', src.indexOf('  const handleAudioFileUpload = async')) + 5);
const pif = src.slice(src.indexOf('  const processImageFiles = async'), src.indexOf('  // --- Upload Handlers ---'));
const ds = src.indexOf('    // 1. Handle Desktop Files', src.indexOf('  const handleDrop = async'));
const drop = src.slice(ds, src.indexOf('    // 2. Handle Gallery Drops', ds));
const code = transformSync(`module.exports = env => { let { config, onChange, setAttachmentError, maxReferenceImages, maxReferenceVideos, maxReferenceAudios, isH3VideoConfig, readFileAsBase64, getMimeType, estimateBase64Size, compressImage, processVideoFiles, readAudioDuration, URL, audioInputRef, attachLimitsRef, uploadingReferenceVideos, addAttachmentError, flushSync } = env;
  ${audio}
  ${pif}
  return { processImageFiles, handleAudioFileUpload, drop: async e => { ${drop} } }; };`, { loader: 'ts', format: 'cjs' }).code;
const setup = (start, gate, max = 14, failRead, queued, audios = 3) => {
  let state = start;
  // queued: updates wait for a render, as React batches them; flushSync applies them now.
  const pending = [];
  const render = () => { while (pending.length) state = pending.shift()(state); };
  // What a re-render publishes after commit; tests change it to simulate a model switch.
  const limits = { images: max, audios };
  const errors = [], revoked = [];
  const env = { config: start, onChange: v => { const update = typeof v === 'function' ? v : () => v; if (queued) pending.push(update); else state = update(state); }, setAttachmentError: e => errors.push(e), flushSync: fn => { fn(); render(); },
    maxReferenceImages: max, maxReferenceVideos: 3, maxReferenceAudios: audios, isH3VideoConfig: false,
    readFileAsBase64: async f => { if (gate) await gate; if (failRead?.(f)) throw new Error('read failed'); return 'data:' + f.name; }, getMimeType: f => f.type, estimateBase64Size: () => 10, compressImage: async d => d,
    processVideoFiles: async files => { env.onChange(prev => ({ ...prev, referenceVideos: [...(prev.referenceVideos || []), ...files.map(f => ({ id: f.name }))], mode: 'video' })); },
    readAudioDuration: async () => { if (gate) await gate; return 3; }, audioInputRef: { current: null }, uploadingReferenceVideos: 0, addAttachmentError: e => errors.push(e), URL: { createObjectURL: f => 'blob:' + f.name, revokeObjectURL: url => revoked.push(url) },
    attachLimitsRef: { get current() { return { ...limits, config: state }; } } };
  const mod = { exports: {} }; new Function('module', code)(mod);
  return { api: mod.exports(env), env, limits, errors, revoked, render, get: () => state };
};

const base = { prompt: 'old', mode: 'image', referenceImages: [], referenceVideos: [], referenceAudios: [] };
const file = (name, type) => ({ name, type });
const gated = () => { let release; const gate = new Promise(r => { release = r; }); return { gate, release }; };

test('one drop with an image, a video and an audio file keeps all three', async () => {
  const t = setup(base);
  await t.api.drop({ dataTransfer: { files: [file('i.png', 'image/png'), file('v.mp4', 'video/mp4'), file('a.mp3', 'audio/mpeg')] } });
  assert.deepEqual([t.get().referenceImages.length, t.get().referenceVideos.length, t.get().referenceAudios.length, t.get().mode], [1, 1, 1, 'video']);
});

test('text typed while an image or audio file is read is kept', async () => {
  for (const kind of ['image', 'audio']) {
    const g = gated(); const t = setup({ ...base, mode: 'video' }, g.gate);
    const pending = kind === 'image' ? t.api.processImageFiles([file('x.png', 'image/png')]) : t.api.handleAudioFileUpload({ target: { files: [file('a.mp3', 'audio/mpeg')] } });
    t.env.onChange(prev => ({ ...prev, prompt: 'typed meanwhile' }));
    g.release(); await pending;
    assert.equal(t.get().prompt, 'typed meanwhile');
    assert.equal(kind === 'image' ? t.get().referenceImages.length : t.get().referenceAudios.length, 1);
  }
});

test('two overlapping pastes keep both images and respect the limit of the latest draft', async () => {
  let g = gated(); let t = setup(base, g.gate);
  let calls = [t.api.processImageFiles([file('a.png', 'image/png')]), t.api.processImageFiles([file('b.png', 'image/png')])];
  g.release(); await Promise.all(calls);
  assert.deepEqual(t.get().referenceImages.map(x => x.data), ['data:a.png', 'data:b.png']);
  g = gated(); t = setup({ ...base, referenceImages: Array.from({ length: 12 }, (_, i) => ({ id: 'r' + i })) }, g.gate);
  calls = [t.api.processImageFiles([file('a.png', 'image/png'), file('b.png', 'image/png')]), t.api.processImageFiles([file('c.png', 'image/png'), file('d.png', 'image/png')])];
  g.release(); await Promise.all(calls);
  assert.equal(t.get().referenceImages.length, 14);
});

test('a model change while images are read applies the new, lower limit and reports it', async () => {
  const g = gated(); const t = setup({ ...base, referenceImages: Array.from({ length: 12 }, (_, i) => ({ id: 'r' + i })) }, g.gate, 16);
  const pending = t.api.processImageFiles(['a', 'b', 'c', 'd'].map(n => file(n + '.png', 'image/png')));
  t.limits.images = 14; g.release(); await pending;
  assert.equal(t.get().referenceImages.length, 14);
  assert.ok(t.errors.includes('Limit reached: 14 images max.'));
});

test('overlapping audio uploads never exceed the audio limit', async () => {
  const g = gated(); const t = setup(base, g.gate);
  const upload = names => t.api.handleAudioFileUpload({ target: { files: names.map(n => file(n, 'audio/mpeg')) } });
  const both = [upload(['a.mp3', 'b.mp3']), upload(['c.mp3', 'd.mp3'])];
  g.release(); await Promise.all(both);
  assert.deepEqual(t.get().referenceAudios.map(a => a.name), ['a.mp3', 'b.mp3', 'c.mp3']);
});

test('a model change while audio durations are read applies the new, lower audio limit', async () => {
  const g = gated(); const t = setup(base, g.gate);
  const pending = t.api.handleAudioFileUpload({ target: { files: ['a.mp3', 'b.mp3', 'c.mp3'].map(n => file(n, 'audio/mpeg')) } });
  t.limits.audios = 1; g.release(); await pending;
  assert.deepEqual(t.get().referenceAudios.map(a => a.name), ['a.mp3']);
});
test('reads that finish before a render warn when their queued update hits the limit', async () => {
  const g = gated(); const t = setup({ ...base, referenceImages: Array.from({ length: 13 }, (_, i) => ({ id: 'r' + i })) }, g.gate, 14, undefined, true);
  const both = [t.api.processImageFiles([file('a.png', 'image/png')]), t.api.processImageFiles([file('b.png', 'image/png')])];
  g.release(); await Promise.all(both); t.render();
  assert.equal(t.get().referenceImages.length, 14);
  assert.ok(t.errors.includes('Limit reached: 14 images max.'));
});
test('overlapping audio uploads warn about the clip their queued update cut', async () => {
  const g = gated(); const t = setup({ ...base, referenceAudios: [{ id: 'x' }, { id: 'y' }] }, g.gate, 14, undefined, true);
  const upload = name => t.api.handleAudioFileUpload({ target: { files: [file(name, 'audio/mpeg')] } });
  const both = [upload('a.mp3'), upload('b.mp3')];
  g.release(); await Promise.all(both); t.render();
  assert.equal(t.get().referenceAudios.length, 3);
  assert.ok(t.errors.includes('Limit reached: 3 audio clips max.'));
});
test('audio clips cut by a lower limit release their URLs and are reported after the switch cleared the warning', async () => {
  // Three picked against a limit of two: the third is reported before reading.
  const g = gated(); const t = setup(base, g.gate, 14, undefined, true, 2);
  const pending = t.api.handleAudioFileUpload({ target: { files: ['a', 'b', 'c'].map(n => file(n + '.mp3', 'audio/mpeg')) } });
  // A switch to a one-clip limit clears that warning while the two are read.
  t.limits.audios = 1; t.errors.length = 0; g.release(); await pending; t.render();
  assert.deepEqual(t.get().referenceAudios.map(a => a.url), ['blob:a.mp3']);
  assert.deepEqual(t.revoked, ['blob:b.mp3']);
  assert.ok(t.errors.includes('Limit reached: 1 audio clips max.'));
});
test('a failed read leaves the draft unchanged and a retry adds the image exactly once', async () => {
  let fail = true; const t = setup(base, null, 14, () => fail);
  await assert.rejects(t.api.processImageFiles([file('x.png', 'image/png')]), /read failed/);
  assert.deepEqual(t.get(), base);
  fail = false; await t.api.processImageFiles([file('x.png', 'image/png')]);
  assert.deepEqual(t.get().referenceImages.map(x => x.data), ['data:x.png']);
});
