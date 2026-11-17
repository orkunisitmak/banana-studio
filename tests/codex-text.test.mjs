import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { LocalWorkspace } from '../desktop/server/store.mjs';
import { resolveProvider } from '../src/lib/providers.ts';

const compiled = await build({ stdin: { contents: `export * from './api/_lib/codexText.ts'; export { default as handler } from './api/codex-text-generate.ts';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external', plugins: [{ name: 'auth-boundary', setup(b) {
  b.onResolve({ filter: /\/auth\.js$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const requireUser = async () => { throw new Error('Hosted route must reject before authentication'); };` }));
} }] });
const { requestCodexText, validateCodexTextRequest, CodexTextInputError, handler } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const request = (extra = {}) => ({ model: 'codex-text', contents: { parts: [{ text: 'Two thumbnail concepts about Turkish dotted and dotless I. Keep the text "TEK NOKTA".' }] }, usageContext: { action: 'brainstorm', prompt: 'Turkish I' }, brainstormCount: 2, reasoningEffort: 'medium', ...extra });

function fixture(t, output, { failure, hang } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-text-test-'));
  fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt' }));
  const binary = path.join(home, 'codex');
  fs.writeFileSync(binary, `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'); let prompt = '';
process.stdin.on('data', chunk => prompt += chunk).on('end', () => {
 const args = process.argv.slice(2), home = process.env.CODEX_HOME;
 fs.appendFileSync(path.join(home, 'calls.jsonl'), JSON.stringify({args, prompt, schema: JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1])), images: args.flatMap((arg,i)=>arg==='--image'?[fs.readFileSync(args[i+1]).toString('base64')]:[]), secrets: ['OPENAI_API_KEY','OPENROUTER_API_KEY','FAL_KEY'].filter(k=>k in process.env)})+'\\n');
 console.log(JSON.stringify({type:'thread.started',thread_id:'test-thread'}));
 ${hang ? `setInterval(()=>{},1000);return;` : ''}
 ${failure ? `console.log(JSON.stringify({type:'turn.failed',error:{message:'ChatGPT usage limit reached'}})); process.exitCode=1;` : `console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(JSON.stringify(output))}}}));`}
});`, { mode: 0o755 });
  const env = { BANANA_RUNTIME: 'local', CODEX_HOME: home, CODEX_BIN: binary, CODEX_ENABLED: 'true', OPENAI_API_KEY: 'test-not-real', OPENROUTER_API_KEY: 'test-not-real', FAL_KEY: 'test-not-real' };
  const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [k, v] of Object.entries(previous)) v == null ? delete process.env[k] : process.env[k] = v; fs.rmSync(home, { recursive: true, force: true }); });
  return { home, calls: () => fs.existsSync(path.join(home, 'calls.jsonl')) ? fs.readFileSync(path.join(home, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [] };
}

test('malformed references, video URLs and invalid idea counts are rejected before dispatch', () => {
  for (const body of [null, {}, request({ brainstormCount: 0 }), request({ brainstormCount: 21 }), request({ reasoningEffort: 'max' }), request({ contents: { parts: [null] } }), request({ contents: { parts: [{ text: 'Brief' }, { fileData: { fileUri: 'https://example.invalid/video' } }] } }), request({ contents: { parts: [{ text: 'Brief', inlineData: { mimeType: 'image/png', data: 'YWJj' } }] } })]) assert.throws(() => validateCodexTextRequest(body), CodexTextInputError);
});

test('ChatGPT-only text routing never selects configured paid APIs', () => {
  assert.equal(resolveProvider('codex-text', 'auto', { codex: true, openai: true, openrouter: true }), 'codex');
  assert.throws(() => resolveProvider('codex-text', 'auto', { openai: true, openrouter: true }), /codex login/);
  assert.throws(() => resolveProvider('codex-text', 'openai', { codex: true, openai: true }), /does not serve/);
});

test('hosted requests cannot start the desktop Codex endpoint', async t => {
  const old = process.env.BANANA_RUNTIME; delete process.env.BANANA_RUNTIME;
  t.after(() => old == null ? delete process.env.BANANA_RUNTIME : process.env.BANANA_RUNTIME = old);
  const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'POST', body: request(), headers: {} }, res);
  assert.equal(res.code, 404); assert.match(res.body.error, /desktop-only/);
});

test('numbered ideas preserve image order, quoted text and wardrobe, without passing API keys', { skip: process.platform === 'win32' }, async t => {
  const ideas = { idea_1: { prompt: 'Portrait with "TEK NOKTA"', wardrobe: [{ personId: 1, garments: ['jacket'], outfit: 'blue jacket' }] }, idea_2: { prompt: 'Compare dotted and dotless I', wardrobe: [{ personId: 1, garments: ['shirt'], outfit: 'white shirt' }] } };
  const f = fixture(t, { ideas });
  const body = request({ brainstormFormat: 'wardrobe', contents: { parts: [{ text: 'Person one' }, { inlineData: { mimeType: 'image/png', data: 'YWJj' } }, { text: 'Style reference' }, { inlineData: { mimeType: 'image/jpeg', data: 'ZGVm' } }, ...request().contents.parts] } });
  const result = await requestCodexText(body);
  assert.deepEqual(JSON.parse(result.text), Object.values(ideas));
  assert.equal(result.usageMetadata.billingSource, 'chatgpt-plan');
  const [call] = f.calls();
  assert.deepEqual(call.images, ['YWJj', 'ZGVm']); assert.deepEqual(call.secrets, []);
  assert.ok(call.prompt.indexOf('Person one') < call.prompt.indexOf('[Attached Image 1'));
  assert.ok(call.prompt.indexOf('[Attached Image 1') < call.prompt.indexOf('Style reference'));
  assert.match(call.prompt, /TEK NOKTA/);
  assert.deepEqual(call.schema.properties.ideas.required, ['idea_1', 'idea_2']);
  assert.equal(fs.existsSync(call.args[call.args.indexOf('--cd') + 1]), false);
});

test('incomplete brainstorm output is rejected rather than used as a partial batch', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t, { ideas: { idea_1: 'Only one' } });
  await assert.rejects(requestCodexText(request()), /incomplete/); assert.equal(f.calls().length, 1);
});

test('subscription quota failures surface without a fallback or second submission', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t, null, { failure: true });
  await assert.rejects(requestCodexText(request()), /usage limit/); assert.equal(f.calls().length, 1);
});

test('API-key login and pre-cancelled requests do not start Codex', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t, { text: 'unused' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestCodexText(request(), controller.signal), { name: 'AbortError' });
  fs.writeFileSync(path.join(f.home, 'auth.json'), JSON.stringify({ auth_mode: 'apikey' }));
  await assert.rejects(requestCodexText(request()), /codex login/); assert.deepEqual(f.calls(), []);
});

test('cancelling a running text request terminates its process and removes reference files', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t, null, { hang: true });
  const controller = new AbortController();
  const result = requestCodexText(request(), controller.signal);
  const outcome = result.then(() => null, error => error);
  const { setTimeout: delay } = await import('node:timers/promises');
  const until = Date.now() + 5000;
  while (!f.calls().length && Date.now() < until) await delay(10);
  controller.abort(); assert.equal((await outcome)?.name, 'AbortError');
  const [call] = f.calls(); assert.ok(call); assert.equal(fs.existsSync(call.args[call.args.indexOf('--cd') + 1]), false);
});

test('Enhance returns the finished text, not the JSON transport wrapper', { skip: process.platform === 'win32' }, async t => {
  fixture(t, { text: 'A crisp portrait with readable Turkish text.' });
  const result = await requestCodexText(request({ usageContext: { action: 'enhance', prompt: 'portrait' }, brainstormCount: undefined }));
  assert.equal(result.text, 'A crisp portrait with readable Turkish text.');
});

test('the selected subscription text model survives a local workspace restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-text-prefs-')); let store = new LocalWorkspace(directory);
  try {
    store.rpc('save_text_model_preferences', { p_model: 'codex-text', p_gemini_thinking: 'MEDIUM', p_openai_reasoning: 'medium' }, false);
    store.close(); store = new LocalWorkspace(directory);
    const settings = store.rpc('get_text_model_preferences', {}, false);
    assert.equal(settings.model, 'codex-text'); assert.equal(settings.reasoningEffort, 'medium');
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
