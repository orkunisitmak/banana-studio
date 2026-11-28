import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const state = {};
globalThis.__providerUsageTest = state;
const bundle = await build({
  entryPoints: ['api/provider-usage.ts'], absWorkingDir: root, bundle: true, write: false,
  format: 'esm', platform: 'node', plugins: [{ name: 'admin-fixture', setup(builder) {
    builder.onResolve({ filter: /\/_lib\/auth\.js$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export const applyCors=()=>{};
      export const createServiceRoleClient=()=>null;
      export const requireAdmin=async(req,res)=>{
        if(!globalThis.__providerUsageTest.admin){res.status(403).json({error:'Forbidden'});return null;}
        return {id:'admin-1'};
      };
    ` }));
  } }],
});
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const response = () => ({ code: 0, body: null, headers: {}, setHeader(key, value) { this.headers[key] = value; },
  end() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const page = (summary, next_cursor = null) => ({ summary, next_cursor, has_more: next_cursor !== null });
const costPage = (results, next_page = null) => ({ object: 'page', has_more: next_page !== null, next_page,
  data: [{ object: 'bucket', start_time: 1767225600, end_time: 1767312000, results }] });
const cost = (line_item, value, currency = 'usd') => ({ object: 'organization.costs.result', amount: { value, currency }, line_item, project_id: null });
const row = (extra = {}) => ({ endpoint_id: 'fal-ai/nano-banana-pro', cost: 1, currency: 'USD', quantity: 5, unit: 'image', ...extra });
const reset = () => {
  Object.assign(state, { admin: true, calls: [], falPages: [page([])], falStatus: 200, openaiPages: [costPage([])], openaiStatus: 200,
    evolinkStatus: 200, evolink: { success: true, data: { user: { used_credits: 68, remaining_credits: 136 }, token: { used_credits: 34 } } } });
  delete state.networkFailure;
  delete process.env.FAL_ADMIN_KEY;
  delete process.env.FAL_KEY;
  delete process.env.PROVIDER_USAGE_START_DATE;
  delete process.env.OPENAI_ADMIN_KEY;
  delete process.env.OPENAI_PROJECT_ID;
  process.env.EVOLINK_API_KEY = 'evolink-test-secret';
  globalThis.fetch = async (url, options) => {
    state.calls.push({ url: new URL(url), options });
    if (state.networkFailure) throw new Error('Network failure echoing test-secret-do-not-expose');
    if (url.startsWith('https://api.evolink.ai/')) return { ok: state.evolinkStatus === 200, status: state.evolinkStatus, json: async () => state.evolink };
    if (url.startsWith('https://api.openai.com/')) {
      const next = state.openaiPages.shift();
      const status = next?.status || state.openaiStatus;
      return { ok: status === 200, status, json: async () => next?.payload ?? next };
    }
    assert.equal(new URL(url).origin, 'https://api.fal.ai');
    const next = state.falPages.shift();
    const status = next?.status || state.falStatus;
    return { ok: status === 200, status, json: async () => next?.payload ?? next };
  };
};
const run = async (method = 'GET') => { const res = response(); await handler({ method }, res); return res; };
const falCalls = () => state.calls.filter(call => call.url.origin === 'https://api.fal.ai');
const openaiCalls = () => state.calls.filter(call => call.url.origin === 'https://api.openai.com');

test('provider usage remains admin-only, is not cached, and missing billing keys produce unknown totals', async () => {
  reset(); state.admin = false;
  assert.equal((await run()).code, 403); assert.equal(state.calls.length, 0);
  state.admin = true; assert.equal((await run('POST')).code, 405); assert.equal(state.calls.length, 0);
  const result = await run();
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.body.fal, null); assert.equal(result.body.falStatus, 'needs_admin_key');
  assert.match(result.body.warnings.join(' '), /BILLING preset.*FAL_ADMIN_KEY/);
  assert.equal(falCalls().length, 0); assert.equal(result.body.evolink.usedUsdApprox, 1);
});

test('fal inference-key 403 explains billing permissions, while an explicit billing-key failure stays distinct', async () => {
  for (const explicit of [false, true]) {
    reset(); process.env.FAL_KEY = 'inference-test-secret';
    if (explicit) process.env.FAL_ADMIN_KEY = ' Key admin-test-secret ';
    state.falStatus = 403; state.falPages = [{ error: { message: 'do not echo secret payload' } }];
    const result = await run();
    assert.equal(result.body.fal, null);
    assert.equal(result.body.falStatus, explicit ? 'forbidden' : 'needs_admin_key');
    assert.match(result.body.warnings.join(' '), /403/);
    assert.match(result.body.warnings.join(' '), explicit ? /billing:usage:read.*auth:keys:read.*account:users:read/ : /BILLING preset/);
    assert.equal(falCalls()[0].options.headers.Authorization, explicit ? 'Key admin-test-secret' : 'Key inference-test-secret');
    assert.doesNotMatch(JSON.stringify(result.body), /test-secret|secret payload/);
    assert.equal(falCalls().length, 1, 'Never switch keys silently after a rejected Admin key');
  }
});

test('fal accepts a legacy key with billing access, follows every page, and sums final discounted costs', async () => {
  reset(); process.env.FAL_KEY = ' Key legacy-admin-test-secret '; process.env.PROVIDER_USAGE_START_DATE = '2026-01-01';
  state.falPages = [page([row({ cost_total: '0.8', cost: 99, cost_subtotal: 1, quantity: '4' })], 'page-two'),
    page([row({ cost: 0.2, quantity: 1 }), row({ endpoint_id: 'fal-ai/nano-banana-pro/edit', cost: 0.5, quantity: 2 }),
      row({ endpoint_id: 'outside/app/filter', cost: 999, currency: 'EUR' })])];
  const { body } = await run();
  assert.equal(body.falStatus, 'ok'); assert.equal(body.fal.actualCostUsd, 1.5);
  assert.equal(body.fal.imageActualCostUsd, 1.5); assert.equal(body.fal.videoActualCostUsd, 0);
  assert.equal(body.fal.quantity, 7); assert.equal(body.fal.quantityUnit, 'image');
  assert.equal(body.fal.scope, 'workspace_endpoints'); assert.equal(body.fal.start, '2026-01-01');
  assert.deepEqual(body.fal.byEndpoint[0], { endpoint: 'fal-ai/nano-banana-pro', costUsd: 1, quantity: 5, unit: 'image' });
  const calls = falCalls(); assert.equal(calls.length, 2);
  assert.equal(calls[1].url.searchParams.get('cursor'), 'page-two');
  assert.equal(calls[0].url.searchParams.get('end'), calls[1].url.searchParams.get('end'));
  assert.equal(calls[0].url.searchParams.get('end'), body.fal.end);
  assert.equal(calls[0].url.searchParams.get('expand'), 'summary');
  assert.equal(calls[0].url.searchParams.get('bound_to_timeframe'), 'false');
  assert.ok(calls[0].url.searchParams.get('endpoint_id').includes('minimax/h3-max/image-to-video'));
});

test('fal video billing includes standard Seedance 2.0, US Seedance 2.5 and compatibility preprocessing', async () => {
  reset(); process.env.FAL_ADMIN_KEY = 'billing-test-only';
  const endpoints = [
    'bytedance/seedance-2.0/text-to-video',
    'bytedance/seedance-2.0/image-to-video',
    'bytedance/seedance-2.0/reference-to-video',
    'bytedance/seedance-2.5/us/text-to-video',
    'bytedance/seedance-2.5/us/image-to-video',
    'bytedance/seedance-2.5/us/reference-to-video',
    'fal-ai/workflow-utilities/scale-video',
  ];
  state.falPages = [page(endpoints.map(endpoint_id => row({ endpoint_id, cost: 0.25, unit: 'second' })))];
  const { body } = await run();
  const filter = falCalls()[0].url.searchParams.get('endpoint_id').split(',');
  for (const id of endpoints) assert.ok(filter.includes(id));
  assert.ok(filter.length <= 50, 'fal usage accepts at most 50 endpoint IDs');
  assert.equal(body.fal.videoActualCostUsd, 1.75);
  assert.equal(body.fal.imageActualCostUsd, 0);
});

test('billing quantities retain their units, including multiple units for one endpoint', async () => {
  reset(); process.env.FAL_ADMIN_KEY = 'admin-test-secret';
  state.falPages = [page([row(), row({ cost: 2, quantity: 12.5, unit: 'megapixel' }),
    row({ endpoint_id: 'minimax/h3-max/text-to-video', cost: 3, quantity: 30, unit: 'second' })])];
  const { body } = await run();
  assert.equal(body.fal.actualCostUsd, 6); assert.equal(body.fal.imageActualCostUsd, 3); assert.equal(body.fal.videoActualCostUsd, 3);
  assert.equal(body.fal.quantity, null); assert.equal(body.fal.quantityUnit, null);
  assert.equal(body.fal.byEndpoint.length, 3);
  assert.deepEqual(body.fal.byEndpoint.map(item => item.unit), ['image', 'megapixel', 'second']);
});

test('incomplete, repeated, or failed pagination never presents a partial total', async () => {
  const cases = [
    [page([row()], 'two'), { status: 500 }],
    [page([row()], 'two'), page([row()], 'two')],
    [{ summary: [row()], has_more: true, next_cursor: null }],
    [{ summary: [row()] }],
    [{ arbitrary: 'schema drift' }],
  ];
  for (const pages of cases) {
    reset(); process.env.FAL_ADMIN_KEY = 'admin-test-secret'; state.falPages = pages;
    const { body } = await run();
    assert.equal(body.fal, null); assert.equal(body.falStatus, 'unavailable');
    assert.match(body.warnings.join(' '), /unavailable/); assert.equal(body.evolink.usedUsdApprox, 1);
  }
});

test('missing or malformed costs are not zero; only explicit empty completed usage has zero spend', async () => {
  for (const cost of [null, '', ' ', false, undefined, 'not-a-number', -1]) {
    reset(); process.env.FAL_ADMIN_KEY = 'admin-test-secret'; state.falPages = [page([row({ cost })])];
    assert.equal((await run()).body.fal, null);
  }
  for (const invalid of [row({ cost_total: null, cost: 100 }), row({ currency: 'EUR' }), row({ currency: undefined })]) {
    reset(); process.env.FAL_ADMIN_KEY = 'admin-test-secret'; state.falPages = [page([invalid])];
    assert.equal((await run()).body.fal, null);
  }
  reset(); process.env.FAL_ADMIN_KEY = 'admin-test-secret';
  assert.equal((await run()).body.fal.actualCostUsd, 0);
  state.falPages = [page([row({ quantity: null })])];
  const { body } = await run(); assert.equal(body.fal.actualCostUsd, 1); assert.equal(body.fal.quantity, null);
  assert.equal(body.fal.byEndpoint[0].quantity, null);
});

test('unauthorized and network failures expose safe diagnostics, not keys or upstream payloads', async () => {
  reset(); process.env.FAL_ADMIN_KEY = 'admin-test-secret'; state.falStatus = 401;
  assert.equal((await run()).body.falStatus, 'invalid_key');
  reset(); process.env.FAL_ADMIN_KEY = 'admin-test-secret'; state.networkFailure = true;
  const { body } = await run(); assert.equal(body.fal, null); assert.equal(body.evolink, null);
  assert.equal(body.falStatus, 'unavailable'); assert.doesNotMatch(JSON.stringify(body), /test-secret/);
});

test('EvoLink null credits remain unknown and invalid reporting dates fail before fal access', async () => {
  reset(); state.evolink = { success: true, data: { user: { used_credits: null, remaining_credits: '' }, token: {} } };
  const { body } = await run();
  assert.equal(body.evolink.usedCredits, null); assert.equal(body.evolink.remainingCredits, null);
  assert.equal(body.evolink.tokenUsedCredits, null); assert.equal(body.evolink.usedUsdApprox, null);
  process.env.FAL_ADMIN_KEY = 'admin-test-secret'; process.env.PROVIDER_USAGE_START_DATE = 'not-a-date';
  assert.equal((await run()).body.falStatus, 'unavailable'); assert.equal(falCalls().length, 0);
});

test('OpenAI costs need a separate Admin key and never fall back to the inference key', async () => {
  reset(); process.env.OPENAI_API_KEY = 'inference-test-secret';
  const { body } = await run();
  assert.equal(body.openai, null); assert.equal(body.openaiStatus, 'needs_admin_key');
  assert.match(body.warnings.join(' '), /OPENAI_ADMIN_KEY/); assert.equal(openaiCalls().length, 0);
  assert.equal(body.evolink.usedUsdApprox, 1);
  delete process.env.OPENAI_API_KEY;
});

test('OpenAI costs follow every page with a fixed window and sum USD amounts per line item', async () => {
  reset(); process.env.OPENAI_ADMIN_KEY = ' admin-test-secret '; process.env.PROVIDER_USAGE_START_DATE = '2026-01-01T00:00:00Z';
  state.openaiPages = [
    costPage([cost('gpt-image-2.5-sunburst, output', 1.25), cost('gpt-6.1-sol, input', '0.5')], 'page-two'),
    costPage([cost('gpt-image-2.5-sunburst, output', 2), cost(null, 0.25), cost('gpt-6.1-sol, input', 0)]),
  ];
  const { body } = await run();
  assert.equal(body.openaiStatus, 'ok'); assert.equal(body.openai.actualCostUsd, 4);
  assert.equal(body.openai.scope, 'organization'); assert.equal(body.openai.start, '2026-01-01T00:00:00Z');
  assert.deepEqual(body.openai.byLineItem, [
    { lineItem: 'gpt-image-2.5-sunburst, output', costUsd: 3.25 },
    { lineItem: 'gpt-6.1-sol, input', costUsd: 0.5 },
    { lineItem: 'Unspecified', costUsd: 0.25 },
  ]);
  const calls = openaiCalls(); assert.equal(calls.length, 2);
  assert.equal(calls[0].url.pathname, '/v1/organization/costs');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer admin-test-secret');
  assert.equal(calls[0].url.searchParams.get('start_time'), String(Date.parse('2026-01-01T00:00:00Z') / 1000));
  assert.equal(calls[0].url.searchParams.get('end_time'), calls[1].url.searchParams.get('end_time'));
  assert.equal(Number(calls[0].url.searchParams.get('end_time')), Math.floor(Date.parse(body.openai.end) / 1000));
  assert.equal(calls[0].url.searchParams.get('group_by'), 'line_item');
  assert.equal(calls[0].url.searchParams.get('bucket_width'), '1d');
  assert.equal(calls[0].url.searchParams.get('project_ids'), null);
  assert.equal(calls[0].url.searchParams.get('page'), null); assert.equal(calls[1].url.searchParams.get('page'), 'page-two');

  reset(); process.env.OPENAI_ADMIN_KEY = 'admin-test-secret'; process.env.OPENAI_PROJECT_ID = 'proj_banana';
  const scoped = await run();
  assert.equal(scoped.body.openai.scope, 'project'); assert.equal(scoped.body.openai.actualCostUsd, 0);
  assert.deepEqual(openaiCalls()[0].url.searchParams.getAll('project_ids'), ['proj_banana']);
});

test('incomplete or malformed OpenAI cost data never presents a partial or zero total', async () => {
  const cases = [
    [costPage([cost('a', 1)], 'two'), { status: 500 }],
    [costPage([cost('a', 1)], 'two'), costPage([cost('a', 1)], 'two')],
    [{ data: [], has_more: true, next_page: null }],
    [{ data: [] }],
    [{ arbitrary: 'schema drift' }],
    [{ data: [{ object: 'bucket' }], has_more: false, next_page: null }],
    [costPage([cost('a', null)])],
    [costPage([cost('a', 'not-a-number')])],
    [costPage([cost('a', 1, 'eur')])],
    [costPage([{ line_item: 'a' }])],
  ];
  for (const pages of cases) {
    reset(); process.env.OPENAI_ADMIN_KEY = 'admin-test-secret'; state.openaiPages = pages;
    const { body } = await run();
    assert.equal(body.openai, null); assert.equal(body.openaiStatus, 'unavailable');
    assert.match(body.warnings.join(' '), /unavailable/); assert.equal(body.evolink.usedUsdApprox, 1);
  }
});

test('OpenAI auth failures are distinct and never expose keys or upstream payloads', async () => {
  for (const [status, code] of [[401, 'invalid_key'], [403, 'forbidden']]) {
    reset(); process.env.OPENAI_ADMIN_KEY = 'admin-test-secret';
    state.openaiPages = [{ status, payload: { error: { message: 'do not echo secret payload' } } }];
    const { body } = await run();
    assert.equal(body.openai, null); assert.equal(body.openaiStatus, code);
    assert.match(body.warnings.join(' '), new RegExp(String(status)));
    assert.doesNotMatch(JSON.stringify(body), /test-secret|secret payload/);
    assert.equal(openaiCalls().length, 1);
  }
  reset(); process.env.OPENAI_ADMIN_KEY = 'admin-test-secret'; process.env.PROVIDER_USAGE_START_DATE = 'not-a-date';
  assert.equal((await run()).body.openaiStatus, 'unavailable'); assert.equal(openaiCalls().length, 0);
});


test('all eight H3 Max routes are included in admin billing filters and video totals', async () => {
  reset(); process.env.FAL_ADMIN_KEY = 'admin-test-secret';
  const endpoints = ['text-to-video', 'image-to-video', 'reference-to-video', 'extend-video', 'insert-video', 'lip-sync/image-to-video', 'recast', 'relight'].map(path => `minimax/h3-max/${path}`);
  state.falPages = [page(endpoints.map(endpoint_id => row({ endpoint_id, cost_total: 0.5, quantity: 5, unit: 'second' })))];
  const { body } = await run();
  assert.equal(body.falStatus, 'ok'); assert.equal(body.fal.actualCostUsd, 4); assert.equal(body.fal.videoActualCostUsd, 4); assert.equal(body.fal.imageActualCostUsd, 0);
  assert.deepEqual(body.fal.byEndpoint.map(item => item.endpoint).sort(), [...endpoints].sort());
  const filter = falCalls()[0].url.searchParams.get('endpoint_id').split(',');
  for (const endpoint of endpoints) assert.ok(filter.includes(endpoint), endpoint);
  for (const excluded of ['camera-controls', '3d-to-video', 'director']) assert.ok(!filter.includes(`minimax/h3-max/${excluded}`));
});

test('provider billing includes Nano Banana 2.1 alongside historical Nano Banana 2', async () => {
  reset();process.env.FAL_KEY='legacy-admin-test-secret';
  const endpoints=['google/nano-banana-2.1','google/nano-banana-2.1/edit','fal-ai/nano-banana-2','fal-ai/nano-banana-2/edit'];
  state.falPages=[page(endpoints.map(endpoint_id=>row({endpoint_id,cost_total:.1,quantity:1000,unit:'tokens'})))];
  const {body}=await run();
  assert.equal(body.falStatus,'ok');assert.ok(Math.abs(body.fal.actualCostUsd-.4)<1e-9);
  assert.deepEqual(body.fal.byEndpoint.map(item=>item.endpoint).sort(),[...endpoints].sort());
  const filter=falCalls()[0].url.searchParams.get('endpoint_id').split(',');
  for(const endpoint of endpoints)assert.ok(filter.includes(endpoint));
});

test('public historical and current image, video and shared text endpoints each contribute once', async () => {
  reset();
  process.env.FAL_ADMIN_KEY = 'billing-test-only';
  process.env.OPENAI_ADMIN_KEY = 'organization-test-only';
  const images = [
    ...['text-to-image', 'edit', 'layerize'].map(mode => `bytedance/seedream/v5.5/${mode}`),
    ...['2.5/sunburst', '2.6/flare', '2.6/sunburst'].flatMap(version =>
      ['text-to-image', 'edit'].map(mode => `openai/gpt-image-${version}/${mode}`)),
  ];
  const videos = [
    ...['text-to-video', 'image-to-video', 'reference-to-video', 'edit', 'extend', 'upscale'].map(mode => `google/gemini-omni-flash/v1.2/${mode}`),
    ...['text-to-video', 'image-to-video', 'reference-to-video'].map(mode => `bytedance/seedance-2.5/${mode}`),
  ];
  const text = 'openrouter/router/openai/v1/chat/completions';
  state.falPages = [page([
    ...images.map(endpoint_id => row({ endpoint_id, cost_total: 0.5 })),
    ...videos.map(endpoint_id => row({ endpoint_id, cost_total: 0.25, unit: 'second' })),
    row({ endpoint_id: text, cost_total: 1.5, unit: 'token' }),
    row({ endpoint_id: 'not/an/app-endpoint', cost_total: 1000 }),
  ])];
  state.openaiPages = [costPage([cost('gpt-image-2.6-sunburst, output', 7)])];
  const { body } = await run();
  const filter = falCalls()[0].url.searchParams.get('endpoint_id').split(',');
  assert.equal(new Set(filter).size, filter.length, 'mode aliases must not duplicate endpoint IDs');
  assert.ok(filter.length <= 50);
  for (const endpoint of [...images, ...videos, text]) assert.ok(filter.includes(endpoint), endpoint);
  assert.equal(body.fal.imageActualCostUsd, 0.5 * images.length);
  assert.equal(body.fal.videoActualCostUsd, 0.25 * videos.length);
  assert.equal(body.fal.textActualCostUsd, 1.5);
  assert.equal(body.fal.actualCostUsd, 0.5 * images.length + 0.25 * videos.length + 1.5);
  assert.equal(body.fal.quantity, null, 'tokens, seconds and images cannot be summed');
  assert.equal(body.openai.actualCostUsd, 7, 'native OpenAI charges remain a separate report');
  assert.equal(body.evolink.usedUsdApprox, 1, 'account credits are not added to model charges');
});

test('app logs use only a routed media cost and skip requests logged by the provider boundary', async () => {
  const logs = [];
  globalThis.__providerUsageTest.client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'test-user' } } } }),
      getUser: async () => ({ data: { user: { id: 'test-user' } } }),
    },
    from: table => { assert.equal(table, 'usage_logs'); return { insert: async row => { logs.push(row); } }; },
  };
  const fixtures = {
    '@supabase/supabase-js': 'export const createClient = () => globalThis.__providerUsageTest.client;',
    '../lib/config/runtimeConfig': `export const getWorkspaceConfig = () => ({mode:'cloud'});
      export const getCloudPublicConfig = () => ({supabaseUrl:'https://example.invalid',supabasePublishableKey:'test'});`,
    '../../desktop/shared/browserClient': `export const createLocalWorkspaceClient = () => { throw Error('unexpected local database'); };`,
  };
  const app = await build({ entryPoints: ['src/services/authService.ts'], absWorkingDir: root,
    bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'usage-client', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(fixtures, args.path) ? { path: args.path, namespace: 'usage-client' } : null);
      builder.onLoad({ filter: /.*/, namespace: 'usage-client' }, args => ({ contents: fixtures[args.path] }));
    } }],
  });
  const { logUsage } = await import(`data:text/javascript;base64,${Buffer.from(app.outputFiles[0].text).toString('base64')}`);
  for (const [model, cost] of [['gemini-3-pro-image-preview', null], ['seedance-2.5-image-to-video', 0],
    ['minimax-h3-text-only', null], ['magi-2-text-to-video', 0.47], ['gemini-omni-1.2-flash-edit', undefined]]) {
    const action = model === 'gemini-3-pro-image-preview' ? 'generate' : 'video_generate';
    await logUsage(action, model, 'example', 1, { estimatedCost: cost });
    assert.equal(logs.at(-1)?.model, model);
    assert.equal(logs.at(-1).estimated_cost, cost ?? null);
  }
  for (const usageMetadata of [{usageLogged: true}, {usageLoggingPending: true}]) {
    await logUsage('video_generate', 'minimax-h3-text-only', 'example', 1, { usageMetadata, estimatedCost: 5 });
  }
  assert.equal(logs.length, 5);
});
