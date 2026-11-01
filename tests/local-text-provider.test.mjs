import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Exercise the endpoint and shared output/deadline code without any real API,
// credentials, database, or dependency on the parent-owned provider helper.
const stubs = {
  auth: `const state=()=>globalThis.__localTextFixture;
    export const applyCors=res=>res.setHeader('Access-Control-Allow-Origin','*');
    export const requireUser=async(req,res,signal)=>{
      state().authSignals.push(signal);
      if(!state().authenticated){res.status(401).json({error:'Missing authorization token'});return null;}
      return {id:'synthetic-user'};
    };
    export const createUserScopedClient=req=>({from:table=>({insert:row=>({abortSignal:signal=>{
      state().writes.push({table,row,signal,req});return state().saveUsage(signal);
    }})})});`,
  localProvider: `export const getLocalProviderConfig=()=>{
      const s=globalThis.__localTextFixture;if(s.configError)throw s.configError;return s.config;
    };
    export const localProviderError=status=>status===401?'Local API authentication failed.':'Local API request failed.';`,
  providerConfiguration: `export const chooseProvider=(...args)=>{
    const s=globalThis.__localTextFixture;s.selections.push(args);
    if(!s.available)throw new Error('synthetic-private-routing-detail');return 'local';
  };`,
  openaiGuard: `export const startOpenAIRequest=async(req,res,user,...args)=>{
    const s=globalThis.__localTextFixture;s.guards.push({req,user,args});
    if(!s.allowed){res.status(429).json({error:'Local API request limit reached.'});return null;}
    let finished=false;
    return {id:'ledger-request',finish:async(...result)=>{
      if(!finished){finished=true;s.finishes.push(result);}
    }};
  };`,
};
const compiled = await build({
  entryPoints: ['api/local-text-generate.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'local-text-fixtures', setup(builder) {
    builder.onResolve({ filter: /_lib\/(auth|localProvider|providerConfiguration|openaiGuard)\.js$/ }, args => ({
      path: args.path.match(/([^/]+)\.js$/)[1], namespace: 'fixture',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
  } }],
});
const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

let state, upstream;
beforeEach(t => {
  state = globalThis.__localTextFixture = {
    authenticated: true, available: true, allowed: true,
    config: { baseUrl: 'http://127.0.0.1:12345/v1', textModel: 'installed/local-text-model', imageModel: '', apiKey: '' },
    authSignals: [], selections: [], guards: [], finishes: [], writes: [], saveUsage: async () => ({ error: null }),
  };
  upstream = t.mock.method(globalThis, 'fetch', async () => completion());
  t.after(() => { delete globalThis.__localTextFixture; });
});
const presets = ['anthropic/claude-opus-5.5', 'gpt-6.1-sol', 'gemini-3.8-flash'];
const requestBody = (extra = {}) => ({
  model: presets[0], contents: { parts: [{ text: 'Write a scene.' }] },
  usageContext: { action: 'enhance', prompt: 'Write a scene.' }, ...extra,
});
const completion = (extra = {}) => ({
  status: 200, ok: true, headers: new Headers({ 'x-request-id': 'header-request' }),
  json: async () => ({ id: 'upstream-request', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'A finished scene.' } }], usage: { prompt_tokens: 12, completion_tokens: 8 }, ...extra }),
});
const response = () => Object.assign(new EventEmitter(), {
  statusCode: 200, headers: {}, lines: [], writableEnded: false, destroyed: false,
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; this.writableEnded = true; return this; },
  write(line) { this.lines.push(JSON.parse(line)); return true; },
  end() { this.writableEnded = true; return this; },
});
const invoke = async (body = requestBody(), headers = {}) => {
  const res = response();
  await handler({ method: 'POST', headers, body }, res);
  return res;
};
const until = async predicate => {
  for (let i = 0; i < 50 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'endpoint reached the expected asynchronous stage');
};

test('preflight and method checks precede authentication; denied auth never reaches a provider', async () => {
  for (const [method, status] of [['OPTIONS', 200], ['GET', 405]]) {
    const res = response();
    await handler({ method, headers: {} }, res);
    assert.equal(res.statusCode, status);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal(state.authSignals.length, 0);
  state.authenticated = false;
  assert.equal((await invoke()).statusCode, 401);
  assert.equal(state.authSignals.length, 1);
  assert.equal(state.selections.length, 0);
  assert.equal(upstream.mock.callCount(), 0);
});

test('missing local config or an empty text model gives actionable setup guidance', async () => {
  for (const config of [null, { ...state.config, textModel: '' }, { ...state.config, textModel: '   ' }]) {
    state.config = config;
    const res = await invoke();
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /Configure LOCAL_TEXT_MODEL/);
  }
  assert.equal(state.guards.length, 0);
  assert.equal(upstream.mock.callCount(), 0);
});

test('configuration validation exceptions become fixed actionable 503 errors', async () => {
  for (const field of ['URL', 'key', 'model']) {
    state.configError = new Error(`synthetic-private-${field}-detail`);
    const res = await invoke();
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'Invalid Local API configuration. Check LOCAL_API_BASE_URL, LOCAL_API_KEY, LOCAL_TEXT_MODEL and LOCAL_IMAGE_MODEL in Provider keys or the server environment.');
    assert.ok(!JSON.stringify(res.body).includes('synthetic-private'));
  }
  assert.equal(state.guards.length, 0);
  assert.equal(upstream.mock.callCount(), 0);
});

test('local availability and shared request protection must both allow a request', async () => {
  state.available = false;
  let res = await invoke();
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'Local API request failed.' });
  assert.equal(state.guards.length, 0);
  state.available = true; state.allowed = false;
  res = await invoke();
  assert.equal(res.statusCode, 429);
  assert.deepEqual(state.guards[0].args, ['text', undefined, 'Local API']);
  assert.equal(upstream.mock.callCount(), 0);
});

test('all accepted presets route to the configured model using standard OpenAI chat fields', async () => {
  for (const model of presets) {
    const res = await invoke(JSON.stringify(requestBody({ model, reasoningEffort: 'high', provider: 'openrouter', baseUrl: 'https://untrusted.invalid', apiKey: 'client-value' })));
    assert.equal(res.statusCode, 200);
    const [url, init] = upstream.mock.calls.at(-1).arguments;
    assert.equal(url, 'http://127.0.0.1:12345/v1/chat/completions');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { 'Content-Type': 'application/json' });
    const sent = JSON.parse(init.body);
    assert.deepEqual(Object.keys(sent).sort(), ['messages', 'model', 'stream']);
    assert.equal(sent.model, state.config.textModel);
    assert.equal(sent.stream, false);
    assert.equal(sent.messages[0].role, 'system');
    assert.deepEqual(sent.messages[1], { role: 'user', content: [{ type: 'text', text: 'Write a scene.' }] });
    assert.deepEqual(state.selections.at(-1), [model, 'local']);
    assert.equal(res.body.provider, 'local');
    assert.equal(res.body.providerModel, state.config.textModel);
    assert.equal(res.body.text, 'A finished scene.');
    assert.equal(res.body.candidates, null);
    assert.equal(res.body.requestId, 'ledger-request');
    assert.deepEqual(res.body.usageMetadata, { provider: 'local', localUsage: { prompt_tokens: 12, completion_tokens: 8 }, usageLogged: true, usageLoggingPending: false });
    assert.equal(state.writes.at(-1).row.model, model);
  }
  assert.deepEqual(state.finishes, presets.map(() => ['completed', 'upstream-request', 200]));
});

test('optional server bearer credentials and image references use the OpenAI format', async () => {
  state.config.apiKey = 'synthetic-local-credential';
  const parts = [{ text: 'Describe this.' }, ...['image/jpeg', 'image/png', 'image/webp'].map(mimeType => ({ inlineData: { mimeType, data: 'YWJj' } }))];
  const res = await invoke(requestBody({ contents: { parts } }));
  assert.equal(res.statusCode, 200);
  const init = upstream.mock.calls[0].arguments[1];
  assert.equal(init.headers.Authorization, 'Bearer synthetic-local-credential');
  assert.deepEqual(JSON.parse(init.body).messages[1].content.slice(1), parts.slice(1).map(({ inlineData }) => ({ type: 'image_url', image_url: { url: `data:${inlineData.mimeType};base64,YWJj` } })));
  assert.ok(!JSON.stringify(res.body).includes(state.config.apiKey));
});

test('malformed input and unsupported formats are rejected before a provider request', async () => {
  const invalid = ['{', null, requestBody({ model: 'installed/local-text-model' }), requestBody({ usageContext: { action: 'unknown', prompt: '' } }),
    requestBody({ contents: { parts: [] } }), requestBody({ contents: { parts: Array(257).fill({ text: 'a' }) } }),
    requestBody({ contents: { parts: [{ text: '   ' }] } }), requestBody({ brainstormFormat: 'wardrobe' }),
    requestBody({ brainstormCount: 2 }), requestBody({ outputFormat: 'other' }),
    requestBody({ outputFormat: 'youtube_analysis', usageContext: { action: 'variation', prompt: '' } }),
    ...[0, 21, 1.5, '2'].map(brainstormCount => requestBody({ brainstormCount, usageContext: { action: 'brainstorm', prompt: '' } })),
    ...[null, { inlineData: { mimeType: 'image/gif', data: 'YWJj' } }, { inlineData: { mimeType: 'image/png', data: 'invalid!' } }].map(part => requestBody({ contents: { parts: [{ text: 'a' }, part] } })),
  ];
  for (const body of invalid) assert.equal((await invoke(body)).statusCode, 400);
  assert.equal((await invoke(requestBody({ contents: { parts: [{ text: 'a'.repeat(4_100_001) }] } }))).statusCode, 413);
  assert.equal(state.guards.length, 0);
  assert.equal(upstream.mock.callCount(), 0);
});

test('YouTube and other fileData references are explicitly rejected for every preset', async () => {
  for (const model of presets) for (const fileData of [{ fileUri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, { fileUri: 'https://untrusted.invalid/video' }, {}]) {
    const res = await invoke(requestBody({ model, contents: { parts: [{ text: 'Analyze.' }, { fileData }] } }));
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Local API does not support YouTube or file references/);
  }
  assert.equal(state.guards.length, 0);
  assert.equal(upstream.mock.callCount(), 0);
});

test('brainstorm schema enforces the full requested count and preserves the idea-array contract', async () => {
  for (const count of [1, 3, 20]) {
    const ideas = Object.fromEntries(Array.from({ length: count }, (_, i) => [`idea_${count - i}`, ` Scene ${count - i} `]));
    upstream.mock.mockImplementation(async () => completion({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ ideas }) } }] }));
    const res = await invoke(requestBody({ brainstormCount: count, usageContext: { action: 'brainstorm', prompt: 'Ideas' } }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body.text), Array.from({ length: count }, (_, i) => `Scene ${i + 1}`));
    const sent = JSON.parse(upstream.mock.calls.at(-1).arguments[1].body);
    assert.equal(sent.response_format.type, 'json_schema');
    assert.equal(sent.response_format.json_schema.strict, true);
    assert.equal(sent.response_format.json_schema.schema.properties.ideas.required.length, count);
    assert.match(sent.messages[0].content, new RegExp(`Return exactly ${count} distinct`));
  }
});

test('legacy brainstorm and wardrobe output share the existing normalization behavior', async () => {
  for (const wardrobe of [false, true]) {
    const idea = wardrobe ? { prompt: ' Scene ', wardrobe: [{ personId: 1, garments: ['coat'], outfit: 'blue' }] } : ' Scene ';
    upstream.mock.mockImplementation(async () => completion({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ ideas: [idea] }) } }] }));
    const res = await invoke(requestBody({ ...(wardrobe ? { brainstormFormat: 'wardrobe' } : {}), usageContext: { action: 'brainstorm', prompt: 'Ideas' } }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body.text), [wardrobe ? { ...idea, prompt: 'Scene' } : 'Scene']);
  }
});

test('invalid, truncated and refused output still records usage before failing', async () => {
  for (const [choice, extra, status] of [
    [{ finish_reason: 'length', message: { role: 'assistant', content: 'partial' } }, {}, 502],
    [{ finish_reason: 'stop', message: { role: 'assistant', content: '', refusal: 'synthetic-private-detail' } }, {}, 422],
    [{ finish_reason: 'stop', message: { role: 'assistant', content: ' ' } }, {}, 502],
    [{ finish_reason: 'stop', message: { role: 'user', content: 'invalid role' } }, {}, 502],
    [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"ideas":{"idea_1":"Only one"}}' } }, { brainstormCount: 2, usageContext: { action: 'brainstorm', prompt: 'Ideas' } }, 502],
    [{ finish_reason: 'stop', message: { role: 'assistant', content: 'not-json' } }, { outputFormat: 'youtube_analysis' }, 502],
  ]) {
    const previousWrites = state.writes.length;
    upstream.mock.mockImplementation(async () => completion({ choices: [choice], usage: { cost: 0.125 } }));
    const res = await invoke(requestBody(extra));
    assert.equal(res.statusCode, status);
    assert.equal(state.writes.length, previousWrites + 1);
    assert.equal(state.writes.at(-1).row.estimated_cost, 0.125);
    assert.equal(state.finishes.at(-1)[0], 'failed');
    assert.ok(!JSON.stringify(res.body).includes('synthetic-private-detail'));
  }
});

test('only finite nonnegative numeric upstream cost is persisted; no token-based price is invented', async () => {
  for (const cost of [0, 0.125, -1, Infinity, NaN, '0.125', null, undefined]) {
    upstream.mock.mockImplementation(async () => completion({ usage: { prompt_tokens: 100, cost } }));
    const prompt = 'p'.repeat(600);
    const res = await invoke(requestBody({ usageContext: { action: 'variation', prompt } }));
    assert.equal(res.statusCode, 200);
    const write = state.writes.at(-1);
    assert.equal(write.table, 'usage_logs');
    assert.deepEqual(write.row, { user_id: 'synthetic-user', action: 'variation', model: presets[0], prompt: prompt.slice(0, 500), image_count: 0, estimated_cost: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null });
    assert.deepEqual(res.body.usageMetadata.localUsage, { prompt_tokens: 100, cost });
  }
  upstream.mock.mockImplementation(async () => completion({ usage: undefined }));
  assert.equal((await invoke()).body.usageMetadata.localUsage, null);
  assert.equal(state.writes.at(-1).row.estimated_cost, null);
});

test('usage persistence distinguishes a rejected write from an uncertain write', async () => {
  state.saveUsage = async () => ({ error: { message: 'synthetic-private-detail' } });
  let res = await invoke();
  assert.equal(res.body.usageMetadata.usageLogged, false);
  assert.equal(res.body.usageMetadata.usageLoggingPending, false);
  state.saveUsage = async () => { throw new Error('synthetic-private-detail'); };
  res = await invoke();
  assert.equal(res.body.usageMetadata.usageLogged, false);
  assert.equal(res.body.usageMetadata.usageLoggingPending, true);
  assert.ok(!JSON.stringify(res.body).includes('synthetic-private-detail'));
});

test('a stalled usage write is bounded and tells the client to avoid a duplicate record', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  state.saveUsage = () => new Promise(() => {});
  const pending = invoke();
  await until(() => state.writes.length === 1);
  t.mock.timers.tick(5_000);
  const res = await pending;
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.usageMetadata.usageLogged, false);
  assert.equal(res.body.usageMetadata.usageLoggingPending, true);
  assert.equal(state.writes[0].signal.aborted, true);
});

test('NDJSON emits generating, heartbeats, finishing and a single terminal result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let resolveProvider;
  upstream.mock.mockImplementation(() => new Promise(resolve => { resolveProvider = resolve; }));
  const res = response();
  const pending = handler({ method: 'POST', headers: { Accept: 'application/x-ndjson' }, body: requestBody() }, res);
  await until(() => !!resolveProvider);
  assert.equal(res.headers['content-type'], 'application/x-ndjson; charset=utf-8');
  assert.equal(res.headers['x-accel-buffering'], 'no');
  t.mock.timers.tick(10_000);
  assert.deepEqual(res.lines, [{ type: 'status', stage: 'generating' }, { type: 'heartbeat' }]);
  resolveProvider(completion());
  await pending;
  assert.deepEqual(res.lines.map(event => event.type), ['status', 'heartbeat', 'status', 'result']);
  assert.equal(res.lines[2].stage, 'finishing');
  assert.equal(res.lines[3].result.requestId, 'ledger-request');
  assert.equal(res.writableEnded, true);
  assert.equal(res.listenerCount('close'), 0);
  t.mock.timers.tick(30_000);
  assert.equal(res.lines.length, 4);
});

test('disconnect stops heartbeats and writes while completing usage and the request ledger', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let resolveProvider;
  upstream.mock.mockImplementation(() => new Promise(resolve => { resolveProvider = resolve; }));
  const res = response();
  const pending = handler({ method: 'POST', headers: { accept: 'application/x-ndjson' }, body: requestBody() }, res);
  await until(() => !!resolveProvider);
  res.emit('close');
  t.mock.timers.tick(10_000);
  resolveProvider(completion());
  await pending;
  assert.deepEqual(res.lines, [{ type: 'status', stage: 'generating' }]);
  assert.equal(state.writes.length, 1);
  assert.deepEqual(state.finishes, [['completed', 'upstream-request', 200]]);
  assert.equal(res.listenerCount('close'), 0);
});

test('provider and body deadlines bound dependencies that ignore AbortSignal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const stallBody of [false, true]) {
    let signal;
    upstream.mock.mockImplementation(async (_url, init) => {
      signal = init.signal;
      return stallBody ? { ...completion(), json: () => new Promise(() => {}) } : new Promise(() => {});
    });
    const pending = invoke();
    await until(() => !!signal);
    t.mock.timers.tick(250_000);
    const res = await pending;
    assert.equal(res.statusCode, 504);
    assert.equal(signal.aborted, true);
    assert.equal(state.finishes.at(-1)[0], 'failed');
  }
  assert.equal(state.writes.length, 0);
});

test('HTTP, transport and malformed-JSON failures expose fixed errors without upstream details', async t => {
  const logs = ['error', 'warn', 'info'].map(method => t.mock.method(console, method, () => {}));
  for (const status of [400, 401, 429, 500]) {
    let canceled = false, parsed = false;
    upstream.mock.mockImplementation(async () => ({ ...completion(), ok: false, status,
      body: new ReadableStream({ cancel() { canceled = true; } }),
      json: async () => { parsed = true; throw new Error('synthetic-private-detail'); },
    }));
    const res = await invoke();
    assert.equal(res.statusCode, status);
    assert.equal(res.body.error, status === 401 ? 'Local API authentication failed.' : 'Local API request failed.');
    assert.equal(canceled, true);
    assert.equal(parsed, false);
  }
  for (const fetchImpl of [async () => { throw new Error('synthetic-private-detail'); }, async () => ({ ...completion(), json: async () => { throw new SyntaxError('synthetic-private-detail'); } })]) {
    upstream.mock.mockImplementation(fetchImpl);
    assert.deepEqual((await invoke()).body, { error: 'Local API request failed.' });
  }
  const res = await invoke(requestBody(), { accept: 'application/x-ndjson' });
  assert.deepEqual(res.lines, [{ type: 'status', stage: 'generating' }, { type: 'error', error: 'Local API request failed.' }]);
  assert.equal(res.listenerCount('close'), 0);
  assert.equal(state.writes.length, 0);
  for (const log of logs) assert.equal(log.mock.callCount(), 0);
});

test('response body cancellation failures preserve the sanitized upstream HTTP error', async () => {
  upstream.mock.mockImplementation(async () => ({ ...completion(), ok: false, status: 401,
    body: new ReadableStream({ cancel() { throw new Error('synthetic-private-detail'); } }),
  }));
  const res = await invoke();
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Local API authentication failed.' });
  assert.deepEqual(state.finishes, [['failed', 'header-request', 401]]);
});
