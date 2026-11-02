import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('fal image generate catch includes an accepted task id', () => {
  const api = readFileSync(new URL('../api/fal-image-generate.ts', import.meta.url), 'utf8');
  assert.match(api, /acceptedTaskId = data\.request_id/);
  assert.match(api, /await registerProviderTask\(registry, 'fal', data\.request_id, user\.id\)/);
  assert.match(
    api,
    /return res\.status\(500\)\.json\(\{ error: error\.message \|\| 'Image generation failed', \.\.\.\(acceptedTaskId \? \{ taskId: acceptedTaskId \} : \{\}\) \}\)/,
  );
});
