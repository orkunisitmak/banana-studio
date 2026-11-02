import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Real api/evolink-generate.ts and api/evolink-status.ts and real providerTasks.ts over an in-memory provider_tasks table; only auth and the database client are faked.
const stubs = {
  auth: `export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});
export const createServiceRoleClient=()=>({from:()=>({
  select:()=>({limit:async()=>({error:null}),eq:(_,provider)=>({eq:(__,id)=>({maybeSingle:async()=>({data:globalThis.__table.rows.find(r=>r.provider===provider&&r.task_id===id)||null,error:null})})})}),
  insert:async row=>{const t=globalThis.__table;t.attempts++;if(t.rows.some(r=>r.task_id===row.task_id))return{error:{code:"23505"}};if(t.ghost&&t.attempts===1){t.rows.push(row);throw new Error("timeout")}if(t.failures>0){t.failures--;if(t.throws)throw new Error("db down");return{error:{code:"500"}}}t.rows.push(row);return{error:null}},
})});
export const createUserScopedClient=()=>({from:()=>({select:()=>({eq:(_,provider)=>({eq:(__,id)=>({maybeSingle:async()=>({data:globalThis.__table.rows.find(r=>r.provider===provider&&r.task_id===id&&r.user_id==="u1")||null,error:null})})})})})});`,
};
const load = async entry => {
  const out = await build({
    entryPoints: [entry], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /(^|\/)auth\.js$/ }, () => ({ path: 'auth', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'js' }));
      b.onResolve({ filter: /^[^./]/ }, a => (a.path.startsWith('node:') ? undefined : { path: import.meta.resolve(a.path), external: true }));
    } }],
  });
  return (await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))).default;
};
const post = await load('api/evolink-generate.ts');
const poll = await load('api/evolink-status.ts');

const response = () => { const res = { statusCode: 0, status(c) { res.statusCode = c; return res; }, json(b) { res.body = b; return res; }, end() { return res; }, setHeader() {} }; return res; };
const reply = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
// ghost: the first insert saves the row and then throws (a timeout), so the retry meets a duplicate.
// failures: how many registry inserts fail before one works; throws: fail by throwing instead of returning an error.
const run = async ({ failures, throws = false, ghost = false, rows = [] }) => {
  globalThis.__table = { rows: [...rows], attempts: 0, failures, throws, ghost };
  const saved = { fetch: globalThis.fetch, key: process.env.EVOLINK_API_KEY };
  process.env.EVOLINK_API_KEY = 'k';
  globalThis.fetch = async (url, init) => reply(init?.method === 'POST' ? { id: 'evo-r1' } : { status: 'processing', progress: 10 });
  try {
    const submit = response();
    await post({ method: 'POST', headers: {}, body: { mode: 'text_only', prompt: 'hi', duration: 5, quality: '720p', videoModel: 'seedance-2.5' } }, submit);
    const id = submit.body?.taskId;
    const status = response();
    if (id) await poll({ method: 'GET', headers: {}, query: { taskId: id } }, status);
    return { submit, status, attempts: globalThis.__table.attempts };
  } finally { globalThis.fetch = saved.fetch; if (saved.key === undefined) delete process.env.EVOLINK_API_KEY; else process.env.EVOLINK_API_KEY = saved.key; }
};

test('a registry insert that fails once is retried, the submit succeeds and the id polls', async () => {
  const { submit, status, attempts } = await run({ failures: 1 });
  assert.equal(submit.statusCode, 200);
  assert.equal(attempts, 2);
  assert.notEqual(status.statusCode, 404);
  assert.equal(status.statusCode, 200);
});

test('a registry insert that throws is retried the same way', async () => {
  const { submit, status } = await run({ failures: 2, throws: true });
  assert.equal(submit.statusCode, 200);
  assert.equal(status.statusCode, 200);
});

test('a registry that never recovers still answers with the error after three tries', async () => {
  const { submit, attempts } = await run({ failures: 99 });
  assert.equal(submit.statusCode, 500);
  assert.match(submit.body.error, /could not be recorded/);
  assert.equal(submit.body.taskId, 'evo-r1');
  assert.equal(attempts, 3);
});

test('an insert that saved the row before timing out counts as registered when the retry meets a duplicate', async () => {
  const { submit, status, attempts } = await run({ failures: 0, ghost: true });
  assert.equal(submit.statusCode, 200);
  assert.equal(attempts, 2);
  assert.equal(status.statusCode, 200);
});

test('a duplicate that belongs to another user is not counted as registered', async () => {
  const taken = { provider: 'evolink', task_id: 'evo-r1', user_id: 'someone-else' };
  const { submit, status, attempts } = await run({ failures: 0, rows: [taken] });
  assert.notEqual(submit.statusCode, 200);
  assert.match(submit.body.error, /could not be recorded/);
  assert.equal(attempts, 3);
  assert.equal(status.statusCode, 404, 'the other user\'s task cannot be polled');
});

test('a row this user already had before the submit counts as registered and polls', async () => {
  const mine = { provider: 'evolink', task_id: 'evo-r1', user_id: 'u1' };
  const { submit, status, attempts } = await run({ failures: 0, rows: [mine] });
  assert.equal(submit.statusCode, 200);
  assert.equal(attempts, 2);
  assert.equal(status.statusCode, 200);
});
