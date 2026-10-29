import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSeedanceFrameTags, prepareSeedanceFramePrompt } from '../src/lib/video/seedanceFrames.ts';

const frames = [
  { id: 'start', isFirstFrame: true, isLastFrame: false },
  { id: 'end', isFirstFrame: false, isLastFrame: true },
];

test('quoted visible copy remains literal while unquoted frame mentions resolve', () => {
  const prompt = 'Print "@FIRST_FRAME", “#LAST_FRAME”, and \'@IMAGE_7\' on a poster; animate @FIRST_FRAME to @IMAGE_2.';
  const expected = 'Print "@FIRST_FRAME", “#LAST_FRAME”, and \'@IMAGE_7\' on a poster; animate the provided first frame to the provided last frame.';
  assert.equal(normalizeSeedanceFrameTags(prompt, frames), expected);
  assert.ok(prepareSeedanceFramePrompt(prompt, frames).endsWith(expected));
});

test('quoted last-frame and image tokens do not require a nonexistent attachment', () => {
  const onlyFirst = [frames[0]];
  const prompt = 'Show the exact label "@LAST_FRAME" and \'@IMAGE_9\' while animating @FIRST_FRAME.';
  assert.equal(
    normalizeSeedanceFrameTags(prompt, onlyFirst),
    'Show the exact label "@LAST_FRAME" and \'@IMAGE_9\' while animating the provided first frame.',
  );
  assert.throws(() => normalizeSeedanceFrameTags('Animate @LAST_FRAME.', onlyFirst), /Last Frame/);
  assert.throws(() => normalizeSeedanceFrameTags('Animate @IMAGE_9.', onlyFirst), /not an attached/);
});

test('unquoted escaped frame tags still resolve and quoted backslashes remain untouched', () => {
  const prompt = 'Render "@FIRST\\_FRAME" literally, then animate @FIRST\\_FRAME to #REF_IMAGE_2.';
  assert.equal(
    normalizeSeedanceFrameTags(prompt, frames),
    'Render "@FIRST\\_FRAME" literally, then animate the provided first frame to the provided last frame.',
  );
});
