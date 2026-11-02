import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Runs the real handleVideoFileUpload + processVideoFiles from Controls.tsx
// (the same extraction tests/video-upload-capacity.test.mjs uses), with a
// one-video limit as Seedance 2.5 Edit / Extend and H3 Extend Video have.
const src = readFileSync(new URL('../src/components/Controls.tsx', import.meta.url), 'utf8');
const piece = (from, to) => { const a = src.indexOf(from); return src.slice(a, src.indexOf(to, a)); };
const pvf = piece('  const processVideoFiles = async', '  const handleVideoFileUpload = async');
const hv = piece('  const handleVideoFileUpload = async', '  const handleAudioFileUpload = async');
const code = transformSync(`module.exports = env => { const { config, onChange, setAttachmentError, isH3VideoConfig, h3State, currentReferenceVideos, maxReferenceVideos, uploadingReferenceVideos, setUploadingReferenceVideos, uploadReferenceVideo, videoInputRef, attachLimitsRef, flushSync } = env;
  ${pvf}\n${hv}\n return { handleVideoFileUpload }; };`, { loader: 'ts', format: 'cjs' }).code;
const mod = { exports: {} }; new Function('module', code)(mod);

const errorFor = async (max) => {
  let config = { mode: 'video', videoModel: 'seedance-2.5', videoOperation: 'edit', referenceVideos: Array.from({ length: max }, (_, i) => ({ id: 'v' + i })) };
  const errors = [];
  const h = mod.exports({ config, onChange: f => { config = f(config); }, flushSync: fn => fn(), setAttachmentError: e => { errors.push(typeof e === 'function' ? e(errors.at(-1) ?? null) : e); },
    isH3VideoConfig: false, h3State: {}, currentReferenceVideos: config.referenceVideos, maxReferenceVideos: max, uploadingReferenceVideos: 0,
    setUploadingReferenceVideos() {}, videoInputRef: { current: null }, uploadReferenceVideo: async f => ({ id: f.name }),
    attachLimitsRef: { current: { videos: max, config } } });
  await h.handleVideoFileUpload({ target: { files: [{ name: 'extra.mp4', size: 1 }] } });
  return errors.filter(Boolean).join(' | ');
};

test('control: a three-video limit says "3 videos max"', async () => assert.match(await errorFor(3), /Limit reached: 3 videos max\./));
test('a one-video limit says "1 video max", not "1 videos max"', async () => {
  const e = await errorFor(1);
  assert.match(e, /Limit reached: 1 video max\./);
});
