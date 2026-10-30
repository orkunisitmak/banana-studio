import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const start = source.indexOf('        const { taskId, endpoint, queueEndpoint, cost, mode, referenceImages, referenceVideos, referenceAudios } = await createVideoTask');
const end = source.indexOf('        const videoResult = await pollVideoTask', start);
assert.ok(start > 0 && end > start);
const compiled = transformSync(`module.exports = env => { const { createVideoTask, config, videoId, updateVideoStatus, supabase, userId, setGeneratedMedia, clearInterval, submissionHeartbeat, assertWorkspaceSession, logVideoUsage, effectiveVideoPromptExpansionMode, h3MaxMode, toast, console } = env; return (async () => { ${source.slice(start, end)} return 'poll'; })(); };`, { loader: 'ts', format: 'cjs' }).code;
const mod = { exports: {} };
new Function('module', 'exports', compiled)(mod, mod.exports);

for (const mode of ['metadata error', 'task write error', 'task write rejection']) test(`accepted video keeps its task before ${mode} and continues polling with a warning`, async () => {
  let rows = [{ id: 'v1', status: 'pending' }];
  const warnings = [], order = [];
  const query = { eq: (_key, _value) => query, then: (resolve, reject) => {
    order.push('task-write');
    return mode === 'task write rejection' ? Promise.reject(new Error('Synthetic transport failure')).then(resolve, reject)
      : Promise.resolve({ error: mode === 'task write error' ? new Error('Synthetic row error') : null }).then(resolve, reject);
  } };
  const outcome = await mod.exports({
    createVideoTask: async () => ({ taskId: 'accepted-task', endpoint: 'provider', referenceVideos: [], referenceAudios: [] }),
    config: { videoModel: 'minimax-h3' }, videoId: 'v1', userId: 'owner',
    setGeneratedMedia: update => { rows = update(rows); order.push('card'); },
    updateVideoStatus: async () => { order.push('metadata'); if (mode === 'metadata error') throw new Error('Synthetic metadata error'); },
    supabase: { from: () => ({ update: () => query }) }, clearInterval() {}, submissionHeartbeat: 1,
    assertWorkspaceSession: async () => {}, logVideoUsage() {}, effectiveVideoPromptExpansionMode: 'off',
    h3MaxMode: undefined, toast: { warning: (...args) => warnings.push(args) }, console: { warn() {} },
  });
  assert.equal(outcome, 'poll');
  assert.equal(rows[0].taskId, 'accepted-task');
  assert.ok(order.indexOf('card') < order.indexOf('metadata'), 'task handle is retained before any optional write');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].join(' '), /keep this tab open/i);
});
