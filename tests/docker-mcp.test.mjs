import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';

const tempFile = fileURLToPath(new URL('./.temp-docker-mcp.mjs', import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL('../docker/server/mcp.mjs', import.meta.url))], outfile: tempFile,
  bundle: true, format: 'esm', platform: 'node', packages: 'external' });
const { createMcpServer } = await import(pathToFileURL(tempFile).href);
fs.rmSync(tempFile, { force: true });

const origin = 'https://studio.example.test';
const start = async t => {
  const handle = createMcpServer({ publicOrigin: origin, handlers: {}, invoke: async () => {}, sql: null, anonKey: 'unused' });
  const readBody = async req => { const parts = []; for await (const part of req) parts.push(part); return Buffer.concat(parts); };
  const server = http.createServer(async (req, res) => { if (!await handle(req, res, new URL(req.url, origin), readBody)) { res.statusCode = 404; res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
};

test('MCP discovery points clients at the workspace Auth server and challenges unauthenticated calls', async t => {
  const base = await start(t);
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const metadata = await (await fetch(base + path)).json();
    assert.equal(metadata.resource, `${origin}/mcp`);
    assert.deepEqual(metadata.authorization_servers, [`${origin}/auth/v1`]);
  }
  const anonymous = await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get('www-authenticate'), `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`);
  assert.equal((await fetch(base + '/mcp')).status, 405, 'No server-to-client stream is offered.');
  assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer x' }, body: '{' })).status, 400);
  assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer x' }, body: '{"id":1}' })).status, 400, 'Messages must be JSON-RPC 2.0.');
  assert.equal((await fetch(base + '/other')).status, 404, 'Other paths fall through to the app.');
});
