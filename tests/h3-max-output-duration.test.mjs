import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/services/runwayService.ts', import.meta.url), 'utf8');

test('an H3 Max result without a provider duration is measured from the output video', () => {
  assert.match(src, /duration: providerDuration \?\? \(isH3Max \? await getMediaDuration\(output\[0\], 'video'\) \?\? undefined : undefined\)/);
});

test('a provider duration is kept ahead of the measured one', () => {
  assert.match(src, /const providerDuration = typeof data\.duration === 'number'[^\r\n]*data\.duration : undefined;\r?\n/);
});
