import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { devApiServer } from '../scripts/devApiServer.ts';

async function serve(t, root, scratch, env = {}) {
  const vite = await createServer({ root, envDir: scratch, configFile: false, cacheDir: path.join(scratch, 'cache'),
    logLevel: 'silent', appType: 'custom', plugins: [devApiServer(env)],
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, entries: [] } });
  const server = createHttpServer(vite.middlewares);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await vite.close(); await rm(scratch, { recursive: true, force: true }); });
  const localFetch = globalThis.fetch;
  return (route, options) => localFetch(`http://127.0.0.1:${server.address().port}/api/${route}`, options);
}
const post = (type, body) => ({ method: 'POST', headers: { 'content-type': type }, body });

test('Vite calls Vercel-style handlers with bounded lazy bodies and parsed queries', async t => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'dev-api-'));
  await mkdir(path.join(scratch, 'api'));
  await writeFile(path.join(scratch, 'api/workspace-config.ts'), `export default (req: any, res: any) => res.status(201).json({
    query: req.query, body: Buffer.isBuffer(req.body) ? req.body.length : req.body ?? null
  });`);
  const request = await serve(t, scratch, scratch);
  const query = await request('workspace-config/?id=1&id=2&mode=plain&constructor=safe');
  assert.equal(query.status, 201);
  assert.deepEqual(await query.json(), { query: { id: ['1', '2'], mode: 'plain', constructor: 'safe' }, body: null });
  for (const [type, input, expected] of [
    ['application/json; charset=utf-8', '{"value":1}', { value: 1 }], ['application/json', '', {}],
    ['application/x-www-form-urlencoded', 'a=1&a=2', { a: ['1', '2'] }], ['text/plain', 'text', 'text'], ['application/octet-stream', 'abc', 3],
  ]) assert.deepEqual((await (await request('workspace-config', post(type, input))).json()).body, expected);
  assert.equal((await request('workspace-config', post('application/json', '{'))).status, 400);
  assert.equal((await request('workspace-config', post('text/plain', 'a'.repeat(4.5 * 1024 * 1024 + 1)))).status, 413);
  for (const route of ['image-job-worker', 'image-job-sweep', '_lib/auth', 'workspace-config.ts', 'workspace-config/extra', '..%2Fworkspace-config']) {
    assert.equal((await request(route)).status, 404, route);
  }
});

test('real hosted boot exposes only public configuration and paid handlers require their usual auth', async t => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'dev-api-auth-'));
  const names = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  t.after(() => { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } });
  const request = await serve(t, fileURLToPath(new URL('..', import.meta.url)), scratch, {
    SUPABASE_URL: 'https://workspace.example.invalid', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test',
  });
  t.mock.method(globalThis, 'fetch', () => assert.fail('Unauthenticated dev routes may not call any upstream service'));
  const config = await request('workspace-config');
  assert.deepEqual(await config.json(), { mode: 'cloud', supabaseUrl: 'https://workspace.example.invalid', supabasePublishableKey: 'sb_publishable_test' });
  delete process.env.SUPABASE_URL;
  assert.equal((await request('workspace-config')).status, 503, 'unconfigured checkouts still enter setup');
  for (const [route, init] of [['gemini-status'], ['gemini-generate', post('application/json', '{')], ['openai-image-enqueue', post('application/json', '{}')], ['evolink-generate', post('application/json', '{}')]]) {
    const result = await request(route, init);
    assert.equal(result.status, 401, route);
    assert.deepEqual(await result.json(), { error: 'Missing authorization token' });
  }
});
