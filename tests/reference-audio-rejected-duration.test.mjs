import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// #238 made Video Edit print a rejected length that never rounds into the accepted range.
// The reference-audio sibling (prepareReferenceAudio, used for M4A/AAC on Seedance and H3 Max)
// still uses toFixed(1): a 15.04 s clip is refused with "must be 2-15 seconds. Current duration is 15.0s."
const root = fileURLToPath(new URL('..', import.meta.url));
const { build } = createRequire(root + 'package.json')('esbuild');
const out = await build({ entryPoints: ['./src/lib/video/referenceAudio.ts'], absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { prepareReferenceAudio } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

let duration = 0;
globalThis.OfflineAudioContext = class { decodeAudioData() { return Promise.resolve({ duration, numberOfChannels: 1, sampleRate: 48000, length: Math.round(duration * 48000), getChannelData: () => new Float32Array(Math.round(duration * 48000)) }); } };
// M4A container header: not WAV/MP3, so the real decode + duration check runs.
const m4a = new Blob([new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 1, 2, 3, 4])], { type: 'audio/mp4' });
const message = async seconds => { duration = seconds; try { await prepareReferenceAudio(m4a, 'H3 Max reference audio 1', 2, 15); } catch (e) { return e.message; } return ''; };
const shown = text => Number(text.match(/Current duration is ([\d.]+)s/)?.[1]);

test('control: a clearly too long M4A reports its length', async () => {
  assert.equal(shown(await message(20)), 20);
});
test('a 15.04 s M4A is not reported as 15.0 s in a 2-15 s rule', async () => {
  const text = await message(15.04);
  assert.ok(shown(text) > 15, `refused with: ${text}`);
});
test('a 1.96 s M4A is not reported as 2.0 s in a 2-15 s rule', async () => {
  const text = await message(1.96);
  assert.ok(shown(text) < 2, `refused with: ${text}`);
});
