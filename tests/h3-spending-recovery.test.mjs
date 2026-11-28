import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Real api/fal-h3-video.ts and real shared admission (openaiGuard.ts) with a
// spending limit that is always reached. Only auth, the task registry and the
// limit lookup are faked; the ledger is never reached.
const stubs = {
  auth: `export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});
    export const createServiceRoleClient=()=>({rpc(){globalThis.__admitted++;throw new Error('ledger must not be reached');}});
    export const createUserScopedClient=()=>{throw new Error('unused');};`,
  spending: `export const requireSpendingAllowance=async(req,res)=>{globalThis.__checked=(globalThis.__checked||0)+1;
    res.status(402).json({code:'SPENDING_LIMIT',error:'Monthly spending limit reached ($12.00 of $10.00).'});return false;};`,
  providerTasks: `
    const saved = () => globalThis.__saved;
    export const prepareTaskRegistry=async()=>({ from:()=>({ select(){return this;}, eq(){return this;}, update(){globalThis.__claimed=true;return this;},
      maybeSingle:async()=>({ data: saved(), error: null }) }) });
    export const registerProviderTask=async()=>{};
    export const requireProviderTask=async()=>true;
  `,
  h3Usage: 'export const recordH3Usage=async()=>{};',
  falBilling: 'export const fetchFalRequestCosts=async()=>null;',
};

const compiled = await build({
  entryPoints: ['api/fal-h3-video.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /(?:^|\/)(auth|providerTasks|h3Usage|falBillingCosts|spendingLimit)\.js$/ }, args => ({
      path: ['providerTasks', 'h3Usage', 'spendingLimit'].find(name => args.path.includes(name))?.replace('spendingLimit', 'spending')
        || (args.path.includes('falBillingCosts') ? 'falBilling' : 'auth'),
      namespace: 'stub',
    }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    b.onResolve({ filter: /^[^./]/ }, args => (
      args.path.startsWith('node:') ? undefined : { path: import.meta.resolve(args.path), external: true }
    ));
  } }],
});
const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const post = async (body, saved) => {
  const previous = { fetch: globalThis.fetch, key: process.env.FAL_KEY };
  Object.assign(globalThis, { __saved: saved, __checked: 0, __admitted: 0, __claimed: false, __fetched: 0 });
  process.env.FAL_KEY = 'test-key';
  globalThis.fetch = async () => { globalThis.__fetched++; throw new Error('no provider request expected'); };
  const res = { statusCode: 0, body: undefined, status(code) { res.statusCode = code; return res; }, json(value) { res.body = value; return res; }, end() { return res; }, setHeader() {} };
  // A signed-in request with a session, so admission reaches the limit check.
  const token = `x.${Buffer.from(JSON.stringify({ session_id: '00000000-0000-4000-8000-000000000001' })).toString('base64url')}.y`;
  try { await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res); return res; }
  finally { globalThis.fetch = previous.fetch; process.env.FAL_KEY = previous.key; }
};

test('a reached limit still returns the task of an already accepted H3 video', async () => {
  const res = await post({ prompt: 'a cat', mode: 'text_to_video', generationId: 'gen-1' },
    { id: 'gen-1', user_id: 'u1', type: 'video', status: 'processing', task_id: 'h3-task', metadata: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.taskId, 'h3-task');
  assert.deepEqual([globalThis.__checked, globalThis.__admitted, globalThis.__fetched], [0, 0, 0]);
});

test('a reached limit stops a new H3 video before it is claimed, admitted or sent', async () => {
  const saved = await post({ prompt: 'a cat', mode: 'text_to_video', generationId: 'gen-2' },
    { id: 'gen-2', user_id: 'u1', type: 'video', status: 'pending', task_id: null, metadata: {} });
  assert.equal(saved.statusCode, 402);
  assert.deepEqual([globalThis.__checked, globalThis.__admitted, globalThis.__claimed, globalThis.__fetched], [1, 0, false, 0]);
  const unsaved = await post({ prompt: 'a cat', mode: 'text_to_video' });
  assert.equal(unsaved.statusCode, 402);
  assert.deepEqual([globalThis.__checked, globalThis.__admitted, globalThis.__fetched], [1, 0, 0]);
});
