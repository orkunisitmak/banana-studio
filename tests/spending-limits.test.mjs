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
});

test('typed limits accept dollar amounts and reject ambiguous input', async () => {
  const bundle = await build({ entryPoints: [path.join(root, 'src/services/spendingService.ts')], bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'stub', setup(b) {
      b.onResolve({ filter: /\/authService$/ }, () => ({ path: 'authService', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const supabase={};', loader: 'js' }));
    } }] });
  const { parseLimitInput, normalizeSpendingStatus, spendingShare } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  assert.deepEqual(['', ' $25 ', '1,250.50', '0', '12.345', '-5', 'abc', '1000001'].map(parseLimitInput), [null, 25, 1250.5, 0, undefined, undefined, undefined, undefined]);
  const status = normalizeSpendingStatus({ limitUsd: '10', spentUsd: '12.5', source: 'bogus', blocked: false });
  assert.deepEqual([status.limitUsd, status.spentUsd, status.source, status.blocked], [10, 12.5, 'none', true]);
  assert.equal(spendingShare(status), 1);
  assert.equal(spendingShare({ limitUsd: null, spentUsd: 3 }), null);
  assert.equal(spendingShare({ limitUsd: 0, spentUsd: 0 }), 1);
});
