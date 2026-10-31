import test from 'node:test';
import assert from 'node:assert/strict';
import { claimVideoSubmission, saveAcceptedVideoTask } from '../api/_lib/videoSubmission.ts';

const body = { generationId: 'gen1', provider: 'fal', videoModel: 'seedance-2.5', prompt: 'sample', duration: 8 };
function fixture(overrides = {}) {
  let row = { id: 'gen1', user_id: 'user1', type: 'video', image_model: 'seedance-2.5',
    status: 'pending', task_id: '', metadata: {}, ...overrides };
  const registered = new Map();
  let claims = 0, saves = 0, saveAttempts = 0;
  let metadataMutation = null, mutationsLeft = 0;
  const db = { from(table) {
    let op = 'select', patch, fields = {}, returning = false;
    const q = {
      select() { if (op === 'update') returning = true; return q; },
      update(value) { op = 'update'; patch = value; return q; },
      async insert(value) {
        if (table !== 'provider_tasks' || registered.has(value.task_id)) return { error: new Error('task conflict') };
        registered.set(value.task_id, value.user_id);
        return { error: null };
      },
      eq(key, value) { fields[key] = value; return q; },
      is(key, value) { fields[key] = value; return q; },
      async maybeSingle() {
        if (table === 'provider_tasks') {
          const owner = registered.get(fields.task_id);
          return { data: owner && fields.user_id === owner && fields.provider ? { user_id: owner } : null, error: null };
        }
        if (row && op === 'update' && 'task_id' in patch) {
          saveAttempts++;
          if (mutationsLeft > 0) {
            row = { ...row, metadata: metadataMutation(row, saveAttempts) };
            mutationsLeft--;
          }
        }
        const matches = row && Object.entries(fields).every(([key, value]) => key === 'metadata' ? JSON.stringify(row.metadata) === value : row[key] === value);
        if (!matches) return { data: null, error: null };
        if (op === 'update') {
          if ('status' in patch) claims++; else saves++;
          row = { ...row, ...patch }; return { data: { id: row.id }, error: null };
        }
        return { data: { ...row, metadata: { ...row.metadata } }, error: null };
      }
    };
    return q;
  }};
  const res = { code: 200, payload: null, status(n) { this.code = n; return this; }, json(x) { this.payload = x; return this; } };
  return { db, res, register: (taskId, owner = 'user1') => registered.set(taskId, owner),
    mutateBeforeConditionalSave: (fn, times = 1) => { metadataMutation = fn; mutationsLeft = times; },
    row: () => row, count: () => ({ claims, saves, saveAttempts }), deleteRow: () => {row = null;} };
}
const claim = f => claimVideoSubmission(f.db, f.res, 'gen1', 'user1', 'fal', 'seedance-2.5', body);

test('first submission claims the existing pending video exactly once', async () => {
  const f = fixture();
  assert.deepEqual(await claim(f), { kind: 'fresh', id: 'gen1' });
  assert.equal(f.row().status, 'processing');
  assert.equal(f.count().claims, 1);
  assert.equal((await claim(f)), null);
  assert.equal(f.res.code, 409);
  assert.equal(f.res.payload.code, 'GENERATION_SUBMITTING');
  assert.equal(f.count().claims, 1);
});

test('simultaneous calls can never both claim the same generation', async () => {
  const f = fixture();
  const results = await Promise.all([claim(f), claim(f), claim(f)]);
  assert.equal(results.filter(x => x?.kind === 'fresh').length, 1);
  assert.equal(f.count().claims, 1);
});

test('accepted task is saved server-side and securely recovered after lost browser response', async () => {
  const f = fixture();
  assert.equal((await claim(f)).kind, 'fresh');
  f.register('bs_fal_seedance-2.5_provider123');
  assert.equal(await saveAcceptedVideoTask(f.db, 'gen1', 'user1', 'bs_fal_seedance-2.5_provider123', {falEndpoint:'bytedance/seedance-2.5'}), true);
  const repeat = await claim(f);
  assert.equal(repeat?.kind, 'existing');
  assert.equal(repeat.taskId, 'bs_fal_seedance-2.5_provider123');
  assert.equal(f.count().claims, 1);
});

test('a user-edited task ID never establishes ownership', async () => {
  const f = fixture({task_id:'foreign-task'});
  f.register('foreign-task', 'another-user');
  assert.equal(await claim(f), null);
  assert.equal(f.res.code, 503);
  assert.equal(f.res.payload.code, 'VIDEO_TASK_UNREGISTERED');
  assert.equal(f.count().claims, 0);
});

test('a previously claimed generation cannot be repurposed to another provider or prompt', async () => {
  const f = fixture();
  assert.ok(await claim(f));
  assert.equal(await claimVideoSubmission(f.db, f.res, 'gen1', 'user1', 'evolink', 'seedance-2.5', body), null);
  assert.equal(f.res.code, 409);
  assert.equal(await claimVideoSubmission(f.db, f.res, 'gen1', 'user1', 'fal', 'seedance-2.5', {...body,prompt:'changed'}), null);
  assert.equal(f.res.payload.code, 'VIDEO_SUBMISSION_MISMATCH');
});

test('missing, foreign, deleted and invalid video IDs fail without claiming a paid request', async () => {
  const f = fixture();
  assert.equal(await claimVideoSubmission(f.db, f.res, undefined, 'user1', 'fal', 'seedance-2.5', body), null);
  assert.equal(f.res.code, 400);
  assert.equal(await claimVideoSubmission(f.db, f.res, 'gen1', 'other-user', 'fal', 'seedance-2.5', body), null);
  assert.equal(f.res.code, 404);
  f.deleteRow();
  assert.equal(await claim(f), null);
  assert.equal(f.res.code, 404);
  assert.equal(f.count().claims, 0);
});

test('server-signed proof repairs private registration after a lost DB acknowledgement', async () => {
  const oldSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-secret-not-a-real-credential';
  try {
    const f = fixture();
    assert.equal((await claim(f)).kind, 'fresh');
    assert.equal(await saveAcceptedVideoTask(f.db, 'gen1', 'user1', 'task-accepted'), true);
    assert.equal(typeof f.row().metadata.videoSubmissionTaskProof, 'string');
    const restored = await claim(f);
    assert.equal(restored?.kind, 'existing');
    assert.equal(restored.taskId, 'task-accepted');
    assert.equal(f.count().claims, 1);
  } finally {
    if (oldSecret === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldSecret;
  }
});

test('tampered or copied proof cannot register an unrelated paid task', async () => {
  const oldSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-secret-not-a-real-credential';
  try {
    const f = fixture();
    assert.ok(await claim(f));
    assert.equal(await saveAcceptedVideoTask(f.db, 'gen1', 'user1', 'real-task'), true);
    f.row().task_id = 'forged-task';
    assert.equal(await claim(f), null);
    assert.equal(f.res.payload.code, 'VIDEO_TASK_UNREGISTERED');
    f.row().task_id = 'real-task';
    f.row().metadata.videoSubmissionTaskProof = 'a'.repeat(64);
    assert.equal(await claim(f), null);
    assert.equal(f.res.payload.code, 'VIDEO_TASK_UNREGISTERED');
  } finally {
    if (oldSecret === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldSecret;
  }
});

test('terminal/deleted rows cannot be resurrected when task registration finishes late', async () => {
  const f = fixture();
  assert.ok(await claim(f));
  f.row().status = 'failed';
  assert.equal(await saveAcceptedVideoTask(f.db, 'gen1', 'user1', 'paid-task'), false);
  assert.equal(f.row().status, 'failed');
  assert.equal(f.row().task_id, '');
});

test('a tracking failure explicitly reports that no provider request was dispatched', async () => {
  const res = { code: 200, payload: null,
    status(n) { this.code = n; return this; },
    json(value) { this.payload = value; return this; } };
  const db = { from() { throw new Error('database offline'); } };
  const result = await claimVideoSubmission(db, res, 'gen1', 'user1', 'fal', 'seedance-2.5', body);
  assert.equal(result, null);
  assert.equal(res.code, 503);
  assert.equal(res.payload.dispatched, false);
});

test('accepted task save retries with fresh metadata after a concurrent gallery edit', async () => {
  const f = fixture({ status: 'processing', metadata: { album: 'before' } });
  f.mutateBeforeConditionalSave((row) => ({ ...row.metadata, album: 'after', note: 'keep me' }), 1);
  assert.equal(await saveAcceptedVideoTask(f.db, 'gen1', 'user1', 'accepted-id', { providerUsage: { credits: 2 } }), true);
  assert.equal(f.count().saves, 1);
  assert.equal(f.count().saveAttempts, 2);
  assert.equal(f.row().task_id, 'accepted-id');
  assert.deepEqual(f.row().metadata, { album: 'after', note: 'keep me', providerUsage: { credits: 2 } });
});

test('accepted task save gives up without overwriting repeatedly changing metadata', async () => {
  const f = fixture({ status: 'processing', metadata: { album: 'before' } });
  f.mutateBeforeConditionalSave((row, attempt) => ({ ...row.metadata, revision: attempt }), 3);
  assert.equal(await saveAcceptedVideoTask(f.db, 'gen1', 'user1', 'accepted-id'), false);
  assert.equal(f.count().saveAttempts, 3);
  assert.equal(f.count().saves, 0);
  assert.equal(f.row().task_id, '');
  assert.equal(f.row().metadata.revision, 3);
});
