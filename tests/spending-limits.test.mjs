import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LocalWorkspace } from '../desktop/server/store.mjs';
import { setWorkspace, LOCAL_AUTH } from '../desktop/server/context.mjs';
import { parseErrorMessage } from '../src/services/generationErrors.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const contextUrl = pathToFileURL(path.join(root, 'desktop/server/context.mjs')).href;

// Bundle a route the way build-desktop.mjs does, sharing this test's workspace context.
async function loadRoute(entry) {
  const replacements = { auth: 'auth.mjs', openaiGuard: 'guard.mjs', imageJobQueue: 'queue.mjs', providerMedia: 'providerMedia.mjs', rasterCodec: 'rasterCodec.mjs' };
  const result = await build({ entryPoints: [path.join(root, entry)], bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external',
    plugins: [{ name: 'local-workspace', setup(b) {
      b.onResolve({ filter: /context\.mjs$/ }, () => ({ path: contextUrl, external: true }));
      b.onResolve({ filter: /(auth|openaiGuard|imageJobQueue|providerMedia|rasterCodec)\.(js|ts)$/ }, args => {
        if (args.importer.includes(`${path.sep}desktop${path.sep}server${path.sep}`)) return undefined;
        const name = path.basename(args.path).replace(/\.(js|ts)$/, '');
        return { path: path.join(root, 'desktop/server', replacements[name]) };
      });
    } }] });
  return (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)).default;
}

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-spending-'));
  const store = new LocalWorkspace(directory);
  setWorkspace(store);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return store;
}

const response = () => {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.body = body; return res; };
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.end = () => res;
  return res;
};

test('spending denial blocks only a reached limit and tolerates a missing migration', async () => {
  const bundle = await build({ entryPoints: [path.join(root, 'api/_lib/spendingLimit.ts')], bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'stub', setup(b) {
      b.onResolve({ filter: /\/auth\.js$/ }, () => ({ path: 'auth', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const createUserScopedClient=()=>{throw new Error("unused");};', loader: 'js' }));
    } }] });
  const { spendingDenial } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  assert.equal(spendingDenial({ data: { blocked: false, spentUsd: 9, limitUsd: 10 }, error: null }), null);
  assert.equal(spendingDenial({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.get_spending_status' } }), null);
  const denied = spendingDenial({ data: { blocked: true, spentUsd: '10.5', limitUsd: '10' }, error: null });
  assert.equal(denied.status, 402);
  assert.equal(denied.body.code, 'SPENDING_LIMIT');
  assert.match(denied.body.error, /\$10\.50 of \$10\.00/);
  assert.equal(spendingDenial({ data: null, error: { code: '42501', message: 'Application access required' } }).status, 503);
  // Below the limit, generations without a recorded cost still block, and the
  // message does not tell the member to raise a limit that is not the cause.
  const unknown = spendingDenial({ data: { blocked: true, spentUsd: 2, limitUsd: 10, unknownCostRequests: 1 }, error: null });
  assert.equal(unknown.status, 402);
  assert.equal(unknown.body.code, 'SPENDING_LIMIT');
  assert.equal(unknown.body.reason, 'unknown_cost');
  assert.equal(unknown.body.unknownCostRequests, 1);
  assert.match(unknown.body.error, /^Monthly spending limit paused: 1 generation this month has no recorded cost/);
  assert.equal(parseErrorMessage({ status: 402, code: 'SPENDING_LIMIT', error: unknown.body.error }).title, 'Spending Limit Reached');
  // Over the limit and with an unknown cost: raising the limit alone would not help.
  const both = spendingDenial({ data: { blocked: true, spentUsd: 12, limitUsd: 10, unknownCostRequests: 1 }, error: null });
  assert.equal(both.body.reason, 'unknown_cost');
  assert.match(both.body.error, /^Monthly spending limit reached \(\$12\.00 of \$10\.00\), and 1 generation this month has no recorded cost\. Raising the limit does not resume/);
  assert.doesNotMatch(both.body.error, /after the limit is raised/);
  assert.equal(parseErrorMessage({ status: 402, code: 'SPENDING_LIMIT', error: both.body.error }).title, 'Spending Limit Reached');
  const reached = spendingDenial({ data: { blocked: true, spentUsd: 12, limitUsd: 10, unknownCostRequests: 0 }, error: null });
  assert.equal(reached.body.reason, 'limit');
  assert.match(reached.body.error, /after the limit is raised/);
});

test('local budget counts this UTC month, ignores negative estimates and validates changes', async t => {
  const store = workspace(t);
  const client = store.client(false);
  const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
  await client.from('usage_logs').insert([
    { action: 'generate', model: 'synthetic', estimated_cost: 3 },
    { action: 'generate', model: 'synthetic', estimated_cost: -50 },
    { action: 'generate', model: 'synthetic', estimated_cost: 40, created_at: monthStart - 1 },
    { action: 'generate', model: 'synthetic', estimated_cost: 2, created_at: new Date(monthStart).toISOString() },
  ]);
  let status = (await client.rpc('get_spending_status')).data;
  assert.deepEqual([status.spentUsd, status.limitUsd, status.blocked], [5, null, false]);
  status = (await client.rpc('set_spending_limit', { p_scope: 'workspace', p_mode: 'limit', p_limit_usd: 5 })).data;
  assert.deepEqual([status.limitUsd, status.blocked], [5, true]);
  for (const args of [{ p_scope: 'workspace', p_mode: 'limit', p_limit_usd: -1 }, { p_scope: 'workspace', p_mode: 'limit', p_limit_usd: null }, { p_scope: 'account', p_mode: 'exempt' }]) {
    assert.ok((await client.rpc('set_spending_limit', args)).error, JSON.stringify(args));
  }
  status = (await client.rpc('set_spending_limit', { p_scope: 'workspace', p_mode: 'none', p_limit_usd: null })).data;
  assert.equal(status.blocked, false);
});

test('a local generation without a usable cost is unknown, never free, under a budget', async t => {
  const store = workspace(t);
  const client = store.client(false);
  const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
  await client.from('usage_logs').insert([
    { action: 'generate', model: 'synthetic', estimated_cost: 1 },
    { action: 'generate', model: 'synthetic', estimated_cost: null, created_at: monthStart - 1 },
  ]);
  let status = (await client.rpc('set_spending_limit', { p_scope: 'workspace', p_mode: 'limit', p_limit_usd: 10 })).data;
  assert.deepEqual([status.spentUsd, status.unknownCostRequests, status.blocked], [1, 0, false], 'last month does not count');
  await client.from('usage_logs').insert([
    { action: 'generate', model: 'gemini-nano-banana-2.1', estimated_cost: null },
    { action: 'generate', model: 'synthetic', estimated_cost: 'Infinity' },
  ]);
  status = (await client.rpc('get_spending_status')).data;
  assert.deepEqual([status.spentUsd, status.unknownCostRequests, status.blocked], [1, 2, true]);
  status = (await client.rpc('set_spending_limit', { p_scope: 'workspace', p_mode: 'none', p_limit_usd: null })).data;
  assert.deepEqual([status.unknownCostRequests, status.blocked], [2, false], 'without a budget nothing is blocked');
});

test('a reached local budget stops a paid route before it reaches the provider', async t => {
  const store = workspace(t);
  const route = await loadRoute('api/fal-image-generate.ts');
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => { calls.push(args); return new Response(JSON.stringify({ request_id: 'req_1' }), { status: 200 }); };
  t.after(() => { globalThis.fetch = originalFetch; delete process.env.FAL_KEY; });
  process.env.FAL_KEY = 'synthetic-key';
  store.put('usage_logs', 'spent', { id: 'spent', user_id: store.user.id, action: 'generate', model: 'synthetic', estimated_cost: 12, created_at: Date.now() });
  store.setting('spendingLimit', { monthlyLimitUsd: 10 });
  const request = () => ({ method: 'POST', headers: {}, query: {}, body: { endpoint: 'google/nano-banana-2.1', prompt: 'Synthetic', generationId: 'gen-1' }, [LOCAL_AUTH]: true });
  const blocked = response();
  await route(request(), blocked);
  assert.equal(blocked.statusCode, 402);
  assert.equal(blocked.body.code, 'SPENDING_LIMIT');
  assert.equal(calls.length, 0);
  store.setting('spendingLimit', { monthlyLimitUsd: 20 });
  await route(request(), response());
  assert.ok(calls.length > 0, 'an allowed request reaches the provider');
});

test('a spending limit error is not reported as a provider rate limit', () => {
  const parsed = parseErrorMessage({ status: 402, code: 'SPENDING_LIMIT', error: 'Monthly spending limit reached ($12.00 of $10.00). New generations resume next month or after the limit is raised.' });
  assert.equal(parsed.title, 'Spending Limit Reached');
  assert.match(parsed.message, /\$12\.00 of \$10\.00/);
  // Provider text that merely mentions a monthly spending limit is the
  // provider's own billing problem, not this workspace's limit.
  for (const error of [
    { status: 400, error: 'Your organization has exceeded its monthly spending limit. Visit billing to raise it.' },
    { status: 429, message: 'Rate limit: monthly spending limit for this key' },
  ]) assert.notEqual(parseErrorMessage(error).title, 'Spending Limit Reached', JSON.stringify(error));
  // A client that prefixes the server's message still recognizes it.
  assert.equal(parseErrorMessage(new Error('Image request failed: Monthly spending limit reached ($12.00 of $10.00).')).title, 'Spending Limit Reached');
});

test('typed limits accept dollar amounts and reject ambiguous input', async () => {
  const bundle = await build({ entryPoints: [path.join(root, 'src/services/spendingService.ts')], bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'stub', setup(b) {
      b.onResolve({ filter: /\/authService$/ }, () => ({ path: 'authService', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const supabase={};', loader: 'js' }));
    } }] });
  const { parseLimitInput, normalizeSpendingStatus, spendingShare } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  assert.deepEqual(['', ' $25 ', '1,250.50', '1,000,000', '0', '12.345', '-5', 'abc', '1000001'].map(parseLimitInput), [null, 25, 1250.5, 1_000_000, 0, undefined, undefined, undefined, undefined]);
  // A decimal comma is rejected instead of becoming a 100× larger limit.
  assert.deepEqual(['12,50', '1,25', '1,2345', ',100', '1,,000', '1,000,00'].map(parseLimitInput), Array(6).fill(undefined));
  const status = normalizeSpendingStatus({ limitUsd: '10', spentUsd: '12.5', source: 'bogus', blocked: false });
  assert.deepEqual([status.limitUsd, status.spentUsd, status.source, status.blocked], [10, 12.5, 'none', true]);
  const unknown = normalizeSpendingStatus({ limitUsd: 10, spentUsd: 1, unknownCostRequests: 2, source: 'workspace', blocked: false });
  assert.deepEqual([unknown.unknownCostRequests, unknown.blocked], [2, true]);
  assert.equal(normalizeSpendingStatus({ limitUsd: null, spentUsd: 1, unknownCostRequests: 2 }).blocked, false);
  assert.equal(spendingShare(status), 1);
  assert.equal(spendingShare({ limitUsd: null, spentUsd: 3 }), null);
  assert.equal(spendingShare({ limitUsd: 0, spentUsd: 0 }), 1);
});

// The limit lives in the shared admission that every paid route already
// passes, hosted and desktop. A paid route that skips admission, or a guard
// that admits before checking the limit, fails here.
test('every paid route reaches the spending check through the shared admission', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const paid = ['anthropic-text-generate', 'evolink-generate', 'fal-h3-video', 'fal-image-generate', 'fal-video-scale', 'gemini-generate',
    'openai-image-generate', 'openai-text-generate', 'openrouter-text-generate', 'seedance-video'];
  const admitting = fs.readdirSync(path.join(root, 'api')).filter(name => name.endsWith('.ts'))
    .filter(name => /\bstart(?:Paid|OpenAI)Request\(req/.test(read(`api/${name}`))).map(name => name.replace(/\.ts$/, ''));
  assert.deepEqual(admitting.sort(), [...paid].sort(), 'paid routes and admitting routes differ');
  const hosted = read('api/_lib/openaiGuard.ts');
  const admit = hosted.slice(hosted.indexOf('async function admitRequest'));
  assert.ok(admit.indexOf('requireSpendingAllowance(req, res)') > 0
    && admit.indexOf('requireSpendingAllowance(req, res)') < admit.indexOf("rpc('start_openai_request'"), 'hosted admission checks the limit first');
  const desktop = read('desktop/server/guard.mjs');
  assert.ok(desktop.indexOf('requireSpendingAllowance(req,res)') > 0
    && desktop.indexOf('requireSpendingAllowance(req,res)') < desktop.indexOf("'start_openai_request'"), 'desktop admission checks the limit first');
  // Queued images are admitted later by the worker, so enqueueing checks directly.
  const enqueue = read('api/openai-image-enqueue.ts');
  assert.ok(enqueue.indexOf('requireSpendingAllowance(req, res)') > enqueue.indexOf('requireUser(req'), 'enqueue checks the limit after sign-in');
  assert.ok(enqueue.indexOf('requireSpendingAllowance(req, res)') < enqueue.indexOf('publishImageJob('), 'enqueue checks the limit before queueing');
});
