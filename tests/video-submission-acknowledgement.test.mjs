import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const output = await build({
  entryPoints: ['src/lib/video/submissionAcknowledgement.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { isUncertainVideoSubmissionFailure } = await import(
  'data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64')
);

test('explicit no-dispatch response is a normal error even if HTTP status is 503', () => {
  assert.equal(isUncertainVideoSubmissionFailure(503, { error: 'database unavailable', dispatched: false }), false);
  assert.equal(isUncertainVideoSubmissionFailure(409, { code: 'GENERATION_SUBMITTING', dispatched: false }), false);
});

test('authentication refusals with unreadable response bodies are never ambiguous paid dispatches', () => {
  assert.equal(isUncertainVideoSubmissionFailure(401, null), false);
  assert.equal(isUncertainVideoSubmissionFailure(403, null), false);
  assert.equal(isUncertainVideoSubmissionFailure(401, { error: 'session expired' }), false);
  assert.equal(isUncertainVideoSubmissionFailure(403, { error: 'forbidden' }), false);
});

test('uncertain provider acceptance stays recoverable', () => {
  assert.equal(isUncertainVideoSubmissionFailure(502, { error: 'provider timeout' }), true);
  assert.equal(isUncertainVideoSubmissionFailure(409, { code: 'GENERATION_SUBMITTING' }), true);
  assert.equal(isUncertainVideoSubmissionFailure(400, null), true);
});

test('definite validation failures do not invite provider reconciliation', () => {
  assert.equal(isUncertainVideoSubmissionFailure(404, { error: 'not found' }), false);
  assert.equal(isUncertainVideoSubmissionFailure(409, { code: 'VIDEO_SUBMISSION_MISMATCH' }), false);
});
