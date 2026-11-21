import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Real routes and the real admission guard over a fake ledger. Only auth, the
// task registry, usage records and the provider's HTTP endpoint are faked.
const stubs = {
  auth: `export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});export const createUserScopedClient=()=>({rpc:async name=>globalThis.__spending(name)});
export const createServiceRoleClient=()=>process.env.SUPABASE_SERVICE_ROLE_KEY?{rpc:(name,args)=>({abortSignal:async()=>globalThis.__ledger(name,args)})}:null;`,
  providerTasks: `export const prepareTaskRegistry=async()=>globalThis.__registry;export const registerProviderTask=async()=>{};export const requireProviderTask=async()=>true;export const isGenerationId=v=>typeof v==="string"&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(v);export const requireSavedVideo=async()=>true;export const saveGenerationTask=async()=>true;`,
  h3Usage: 'export const recordH3Usage=async()=>{};',
  falBillingCosts: 'export const fetchFalRequestCosts=async()=>null;',
  imageStorage: 'export const signedMediaUrl=async()=>"https://signed";',
};
const root = fileURLToPath(new URL('..', import.meta.url));
const load = async entry => {
  const out = await build({
    entryPoints: [entry], absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /(^|\/)(auth|providerTasks|h3Usage|falBillingCosts|imageStorage)\.js$/ }, a => ({ path: a.path.match(/(\w+)\.js$/)[1], namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'js' }));
      b.onResolve({ filter: /^[^./]/ }, a => (a.path.startsWith('node:') ? undefined : { path: import.meta.resolve(a.path), external: true }));
    } }],
  });
  return (await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))).default;
};

const seedance = { videoModel: 'seedance-2.0', mode: 'text_only', prompt: 'hi', duration: 5, quality: '720p', aspectRatio: '16:9' };
const ROUTES = [
  { name: 'fal image', entry: 'api/fal-image-generate.ts', kind: 'image', body: { endpoint: 'fal-ai/nano-banana-pro', input: { prompt: 'a cat' } } },
  { name: 'fal video scale', entry: 'api/fal-video-scale.ts', kind: 'image', body: { videoUrl: 'https://example.com/a.mp4', width: 640, height: 360 } },
  { name: 'MiniMax H3 video', entry: 'api/fal-h3-video.ts', kind: 'image', body: { prompt: 'a cat', mode: 'text_to_video' } },
  { name: 'EvoLink video', entry: 'api/evolink-generate.ts', kind: 'image', body: { mode: 'text_only', prompt: 'hi', duration: 5, quality: '720p', videoModel: 'seedance-2.5' } },
  { name: 'Seedance on fal', entry: 'api/seedance-video.ts', kind: 'image', body: { ...seedance, provider: 'fal' } },
  { name: 'Seedance on OpenRouter', entry: 'api/seedance-video.ts', kind: 'image', body: { ...seedance, provider: 'openrouter' } },
  { name: 'Seedance on EvoLink', entry: 'api/seedance-video.ts', kind: 'image', body: { ...seedance, provider: 'evolink' } },
  { name: 'Gemini text', entry: 'api/gemini-generate.ts', kind: 'text', body: { model: 'gemini-3.8-flash', contents: { parts: [{ text: 'hi' }] } } },
  { name: 'Gemini image', entry: 'api/gemini-generate.ts', kind: 'image', body: { model: 'gemini-3-pro-image-preview', contents: { parts: [{ text: 'hi' }] } } },
  { name: 'Gemini Nano Banana 2.1', entry: 'api/gemini-generate.ts', kind: 'image', body: { model: 'gemini-nano-banana-2.1', contents: { parts: [{ text: 'hi' }] } } },
].filter(route => existsSync(new URL(`../${route.entry}`, import.meta.url)));
const handlers = new Map();
for (const route of ROUTES) if (!handlers.has(route.entry)) handlers.set(route.entry, await load(route.entry));

const token = `h.${Buffer.from(JSON.stringify({ session_id: '00000000-0000-4000-8000-000000000001' })).toString('base64url')}.s`;
const accepted = () => new Response(JSON.stringify({ request_id: 'r1', id: 't1', candidates: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
const refused = () => new Response(JSON.stringify({ error: { message: 'no' } }), { status: 400, headers: { 'content-type': 'application/json' } });

// Sends one POST and reports the response, the provider calls and the ledger calls.
const post = async (route, { allowed = true, reason = 'daily', provider = accepted, headers = { authorization: `Bearer ${token}` }, env = {}, registry = {}, spending = { blocked: false, spentUsd: 0, limitUsd: null } } = {}) => {
  const ledger = [];
  globalThis.__spending = name => { ledger.push({ name }); return { data: spending, error: null }; };
  globalThis.__registry = registry;
  globalThis.__ledger = (name, args) => {
    ledger.push({ name, ...args });
    return { data: name === 'start_openai_request' ? { allowed, reason, retry_after: 3600 } : null, error: null };
  };
  const names = { FAL_KEY: 'k', EVOLINK_API_KEY: 'k', OPENROUTER_API_KEY: 'k', GEMINI_API_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'k', ...env };
  const saved = Object.fromEntries(Object.keys(names).map(name => [name, process.env[name]]));
  const savedFetch = globalThis.fetch;
  const calls = [];
  Object.assign(process.env, names);
  globalThis.fetch = async (url, init) => { calls.push(url); return provider(url, init); };
  const res = { statusCode: 200, headers: {}, status(code) { res.statusCode = code; return res; }, json(body) { res.body = body; return res; }, end() { return res; }, write() {}, on() {}, off() {}, setHeader(name, value) { res.headers[name] = value; } };
  try {
    await handlers.get(route.entry)({ method: 'POST', headers, query: {}, body: route.body }, res);
  } finally {
    globalThis.fetch = savedFetch;
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
  return { res, calls, started: ledger.filter(row => row.name === 'start_openai_request'), finished: ledger.filter(row => row.name === 'finish_openai_request') };
};

for (const route of ROUTES) {
  test(`${route.name}: an exhausted limit stops the request before the provider`, async () => {
    for (const reason of ['daily', 'rate']) {
      const { res, calls, started, finished } = await post(route, { allowed: false, reason });
      assert.equal(res.statusCode, 429);
      assert.equal(res.headers['Retry-After'], '3600');
      assert.equal(calls.length, 0);
      assert.equal(started.length, 1);
      assert.equal(finished.length, 0);
    }
  });

  test(`${route.name}: a reached monthly spending limit stops the request before the ledger and the provider`, async () => {
    const { res, calls, started } = await post(route, { spending: { blocked: true, spentUsd: 12, limitUsd: 10, unknownCostRequests: 0 } });
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.code, 'SPENDING_LIMIT');
    assert.equal(calls.length, 0);
    assert.equal(started.length, 0);
  });

  test(`${route.name}: a request under the limit is admitted once, sent once and settled`, async () => {
    const { res, calls, started, finished } = await post(route);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(calls.length, 1);
    assert.equal(started.length, 1);
    assert.equal(started[0].p_kind, route.kind);
    assert.equal(started[0].p_user_id, 'u1');
    assert.deepEqual(finished.map(row => row.p_outcome), ['completed']);
  });

  test(`${route.name}: a provider refusal settles the ledger as failed`, async () => {
    const { res, calls, finished } = await post(route, { provider: refused });
    assert.equal(res.statusCode, 400);
    assert.equal(calls.length, 1);
    assert.deepEqual(finished.map(row => [row.p_outcome, row.p_provider_status]), [['failed', 400]]);
  });

  test(`${route.name}: a lost connection settles the ledger as failed`, async () => {
    const { calls, finished } = await post(route, { provider: () => { throw new Error('socket hang up'); } });
    assert.ok(calls.length >= 1);
    assert.deepEqual(finished.map(row => row.p_outcome), ['failed']);
  });

  test(`${route.name}: no provider request without a session or a working ledger`, async () => {
    const anonymous = await post(route, { headers: {} });
    assert.equal(anonymous.res.statusCode, 401);
    assert.equal(anonymous.calls.length, 0);
    const unprotected = await post(route, { env: { SUPABASE_SERVICE_ROLE_KEY: '' } });
    assert.equal(unprotected.res.statusCode, 503);
    assert.equal(unprotected.calls.length, 0);
  });

  test(`${route.name}: the OpenAI and OpenRouter switches do not close this route`, async () => {
    if (route.name.includes('OpenRouter')) return;
    const { res, calls } = await post(route, { env: { OPENAI_ENABLED: 'false', OPENROUTER_ENABLED: 'false', VERCEL_ENV: 'preview' } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(calls.length, 1);
  });
}

const savedVideo = (updates, row = { id: 'g1', user_id: 'u1', type: 'video', status: 'pending', task_id: null, metadata: {} }) => ({ from: () => ({
  select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
  update: values => { updates.push(values); const chain = { eq: () => chain, select: () => chain, maybeSingle: async () => ({ data: { id: row.id }, error: null }), then: done => done({ data: [{ id: row.id }], error: null }) }; return chain; },
}) });
const h3 = { name: 'saved H3', entry: 'api/fal-h3-video.ts', body: { prompt: 'a cat', mode: 'text_to_video', generationId: 'g1' } };

test('saved H3 video: the limit leaves it unclaimed, so it can be submitted later', async () => {
  const updates = [];
  const { res, calls } = await post(h3, { allowed: false, registry: savedVideo(updates) });
  assert.equal(res.statusCode, 429);
  assert.equal(calls.length, 0);
  assert.deepEqual(updates, []);
});

test('saved H3 video: an already submitted one takes no limit slot', async () => {
  const updates = [];
  const { res, calls, started } = await post(h3, { registry: savedVideo(updates, { id: 'g1', user_id: 'u1', type: 'video', status: 'processing', task_id: 'r0', metadata: {} }) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.taskId, 'r0');
  assert.equal(calls.length, 0);
  assert.equal(started.length, 0);
});

test('saved H3 video: admitted, claimed and sent once', async () => {
  const updates = [];
  const { res, calls, started, finished } = await post(h3, { registry: savedVideo(updates) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(calls.length, 1);
  assert.equal(started.length, 1);
  assert.deepEqual(finished.map(row => row.p_outcome), ['completed']);
  assert.equal(updates[0].status, 'processing');
});
