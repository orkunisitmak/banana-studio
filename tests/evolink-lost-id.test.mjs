import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('evolink generate catch includes an accepted task id', () => {
  const api = readFileSync(new URL('../api/evolink-generate.ts', import.meta.url), 'utf8');
  assert.match(api, /acceptedTaskId = data\.id/);
  assert.match(api, /await registerProviderTask\(registry, 'evolink', data\.id, user\.id\)/);
  assert.match(
    api,
    /return res\.status\(500\)\.json\(\{ error: error\.message \|\| 'Video generation failed', \.\.\.\(acceptedTaskId \? \{ taskId: acceptedTaskId \} : \{\}\) \}\)/,
  );
});
