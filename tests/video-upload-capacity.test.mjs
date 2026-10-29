import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Runs the exact handleVideoFileUpload + processVideoFiles. Each selection uses the
// closures of a fresh render; uploads are gated so selections overlap.
const src = readFileSync(new URL('../src/components/Controls.tsx', import.meta.url), 'utf8');
const piece = (from, to) => { const a = src.indexOf(from); return src.slice(a, src.indexOf(to, a)); };
const pvf = piece('  const processVideoFiles = async', '  const handleVideoFileUpload = async');
const hv = piece('  const handleVideoFileUpload = async', '  const handleAudioFileUpload = async');
const code = transformSync(`module.exports = env => { const { config, onChange, setAttachmentError, isH3VideoConfig, h3State, currentReferenceVideos, maxReferenceVideos, uploadingReferenceVideos, setUploadingReferenceVideos, uploadReferenceVideo, videoInputRef, attachLimitsRef, flushSync } = env;
  ${pvf}\n${hv}\n return { handleVideoFileUpload }; };`, { loader: 'ts', format: 'cjs' }).code;
const mod = { exports: {} }; new Function('module', code)(mod);

// queued: updates wait for a render, as React batches them; flushSync applies them now.
const scenario = async (start, steps, limits = { videos: 3 }, queued = false) => {
  let config = { mode: 'video', referenceVideos: start.map(id => ({ id })) }, uploading = 0; const errors = []; const gates = new Map(); const queue = [];
  const flush = () => { while (queue.length) config = queue.shift()(config); };
  const render = () => mod.exports({ config, onChange: f => { if (queued) queue.push(f); else config = f(config); }, flushSync: fn => { fn(); flush(); }, setAttachmentError: e => { errors.push(typeof e === 'function' ? e(errors.at(-1) ?? null) : e); },
    isH3VideoConfig: false, h3State: {}, currentReferenceVideos: config.referenceVideos, maxReferenceVideos: limits.videos, uploadingReferenceVideos: uploading,
    setUploadingReferenceVideos: f => { uploading = f(uploading); }, videoInputRef: { current: null },
    uploadReferenceVideo: file => new Promise((ok, fail) => gates.set(file.name, { ok: () => ok({ id: file.name }), fail: () => fail(new Error(file.name + ' failed')) })),
    // What the latest committed render publishes; a step can lower it (an operation switch).
    attachLimitsRef: { get current() { return { ...limits, config }; } } });
  const pending = []; let shared;
  for (const step of steps) {
    if (step.pick) { const h = step.sameRender ? (shared ??= render()) : render(); pending.push(h.handleVideoFileUpload({ target: { files: step.pick.map(name => ({ name, size: 1 })) } })); }
    if (step.limit) limits.videos = step.limit;
    if (step.ok) gates.get(step.ok).ok(); if (step.fail) gates.get(step.fail).fail();
    if (step.settle) await Promise.all(pending.splice(0));
    await new Promise(r => setTimeout(r, 0));
  }
  gates.forEach(g => g.ok()); await Promise.all(pending); flush();
  return { videos: config.referenceVideos.map(v => v.id).join(','), limit: errors.some(e => /Limit reached: \d+ videos/.test(e || '')), uploading };
};

test('a second video picked while the last free slot uploads is not added', async () => {
  assert.deepEqual(await scenario(['v1', 'v2'], [{ pick: ['a'] }, { pick: ['b'] }]), { videos: 'v1,v2,a', limit: true, uploading: 0 });
});

test('selections from one render are capped and reported when the uploads finish', async () => {
  assert.deepEqual(await scenario(['v1', 'v2'], [{ pick: ['a'], sameRender: true }, { pick: ['b'], sameRender: true }]), { videos: 'v1,v2,a', limit: true, uploading: 0 });
});

test('free slots and a failed upload still allow every video that fits', async () => {
  assert.deepEqual(await scenario(['v1'], [{ pick: ['a'] }, { pick: ['b'] }]), { videos: 'v1,a,b', limit: false, uploading: 0 });
  assert.deepEqual(await scenario(['v1', 'v2'], [{ pick: ['a'] }, { fail: 'a', settle: true }, { pick: ['b'] }]), { videos: 'v1,v2,b', limit: false, uploading: 0 });
});

test('a lower limit chosen while a video uploads applies when the upload finishes', async () => {
  // Seedance 2.5 Generate (10) -> Edit (1) with one source attached.
  assert.deepEqual(await scenario(['src'], [{ pick: ['b'] }, { limit: 1 }], { videos: 10 }), { videos: 'src', limit: true, uploading: 0 });
  assert.deepEqual(await scenario(['src'], [{ pick: ['b'] }], { videos: 10 }), { videos: 'src,b', limit: false, uploading: 0 });
});

test('uploads that finish before a render warn when the lowered limit cuts one', async () => {
  assert.deepEqual(await scenario(['v1'], [{ pick: ['a'] }, { pick: ['b'] }, { limit: 2 }, { ok: 'a' }, { ok: 'b' }, { settle: true }], { videos: 3 }, true), { videos: 'v1,a', limit: true, uploading: 0 });
});
