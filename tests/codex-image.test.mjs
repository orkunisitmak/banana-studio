import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codexArguments, codexAvailable, codexImagePrompt, findCodexBinary, hasChatGPTLogin, requestCodexImage } from '../api/_lib/codexImage.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const withEnv = async (values, run) => {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) value == null ? delete process.env[key] : process.env[key] = value;
  try { return await run(); } finally { for (const [key, value] of Object.entries(saved)) value == null ? delete process.env[key] : process.env[key] = value; }
};
// A stand-in for the Codex CLI: records its arguments and stdin, then saves one image like `codex exec --json`.
const fakeCodex = (directory, { fail, retry, fatal } = {}) => {
  const file = path.join(directory, 'codex');
  fs.writeFileSync(file, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');let input='';
process.stdin.on('data',c=>input+=c).on('end',()=>{
  const thread='thread-1',home=process.env.CODEX_HOME,images=[];
  for(let i=0;i<process.argv.length;i++)if(process.argv[i]==='--image')images.push(fs.readFileSync(process.argv[i+1]).toString('base64'));
  fs.writeFileSync(path.join(home,'call.json'),JSON.stringify({args:process.argv.slice(2),input,images,secrets:['OPENAI_API_KEY','FAL_KEY','SUPABASE_SERVICE_ROLE_KEY'].filter(k=>k in process.env)}));
  console.log(JSON.stringify({type:'thread.started',thread_id:thread}));
  // exitCode instead of exit(): exiting at once can drop stdout that has not reached the pipe.
  ${retry ? `console.log(JSON.stringify({type:'error',message:'Reconnecting... 1/5 (stream disconnected before completion)'}));` : ''}
  ${fatal ? `console.log(JSON.stringify({type:'error',message:'Not signed in'}));process.exitCode=1;return;` : ''}
  ${fail ? `console.log(JSON.stringify({type:'turn.failed',error:{message:'You have hit your usage limit.'}}));process.exitCode=1;return;` : `
  fs.mkdirSync(path.join(home,'generated_images',thread),{recursive:true});
  fs.writeFileSync(path.join(home,'generated_images',thread,'out.png'),Buffer.from('${PNG.toString('base64')}','base64'));
  console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Done.'}}));`}
});`, { mode: 0o755 });
  return file;
};
const workspace = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-codex-test-'));
  fs.writeFileSync(path.join(directory, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt' }));
  return directory;
};

test('Codex is offered only in the desktop runtime with a ChatGPT sign-in', { skip: process.platform === 'win32' }, async () => {
  const home = workspace();
  try {
    const binary = fakeCodex(home);
    await withEnv({ BANANA_RUNTIME: undefined, CODEX_HOME: home, CODEX_BIN: binary }, () => assert.equal(codexAvailable(), false));
    await withEnv({ BANANA_RUNTIME: 'local', CODEX_HOME: home, CODEX_BIN: binary, CODEX_ENABLED: 'false' }, () => assert.equal(codexAvailable(), false));
    // Positive control. codexAvailable() caches this result, so the conditions below check its two inputs directly.
    await withEnv({ BANANA_RUNTIME: 'local', CODEX_HOME: home, CODEX_BIN: binary, CODEX_ENABLED: undefined }, () => assert.equal(codexAvailable(), true));
    await withEnv({ CODEX_HOME: home, CODEX_BIN: binary }, () => {
      assert.equal(findCodexBinary(), binary);
      assert.equal(hasChatGPTLogin(), true);
    });
    // A valid binary with an API-key Codex login is not a ChatGPT plan.
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ auth_mode: 'apikey' }));
    await withEnv({ CODEX_HOME: home, CODEX_BIN: binary }, () => { assert.equal(findCodexBinary(), binary); assert.equal(hasChatGPTLogin(), false); });
    // A ChatGPT login without a usable binary.
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt' }));
    await withEnv({ CODEX_HOME: home, CODEX_BIN: path.join(home, 'missing') }, () => { assert.equal(hasChatGPTLogin(), true); assert.equal(findCodexBinary(), null); });
    // A shell shim is refused even when it exists: it would need a shell to start.
    const shim = path.join(home, 'codex.cmd');
    fs.writeFileSync(shim, '@echo off');
    await withEnv({ CODEX_BIN: shim }, () => assert.equal(findCodexBinary(), null));
    await withEnv({ CODEX_BIN: 'codex' }, () => assert.equal(findCodexBinary(), null));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Codex runs read-only without user config and receives the prompt on stdin', () => {
  const args = codexArguments(['/tmp/a.png', '/tmp/b.png'], '/tmp/work');
  assert.deepEqual(args.slice(0, 2), ['exec', '--ignore-user-config']);
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.deepEqual(args.filter((_, index) => args[index - 1] === '--image'), ['/tmp/a.png', '/tmp/b.png']);
  assert.equal(args.at(-1), '-');
  const prompt = codexImagePrompt({ prompt: 'A banana; $(rm -rf ~)', size: '1536x1024', background: 'transparent' }, 2);
  assert.match(prompt, /exactly one image/);
  assert.match(prompt, /Image 1–Image 2/);
  assert.match(prompt, /1536 × 1024/);
  assert.match(prompt, /transparent/);
  assert.ok(prompt.endsWith('A banana; $(rm -rf ~)'));
});

test('a Codex image returns the API response shape and passes references as files', { skip: process.platform === 'win32' }, async () => {
  const home = workspace();
  try {
    const binary = fakeCodex(home);
    const reference = `data:image/png;base64,${PNG.toString('base64')}`;
    const response = await withEnv({ CODEX_HOME: home, CODEX_BIN: binary, OPENAI_API_KEY: 'sk-test-only', FAL_KEY: 'fal-test-only', SUPABASE_SERVICE_ROLE_KEY: 'test-only' }, () =>
      requestCodexImage({ prompt: 'Edit Image 1', size: '1024x1024', images: [{ image_url: 'local-ref' }] }, async url => { assert.equal(url, 'local-ref'); return reference; }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'thread-1');
    const body = await response.json();
    assert.deepEqual(Buffer.from(body.data[0].b64_json, 'base64'), PNG);
    assert.equal(body.data[0].media_type, 'image/png');
    const call = JSON.parse(fs.readFileSync(path.join(home, 'call.json'), 'utf8'));
    assert.match(call.input, /Edit Image 1$/);
    assert.deepEqual(call.images, [PNG.toString('base64')]);
    // Provider keys and server secrets never reach Codex, so it cannot bill an API key instead of the plan.
    assert.deepEqual(call.secrets, []);
    // Temporary reference files are removed after the run.
    const work = call.args[call.args.indexOf('--cd') + 1];
    assert.equal(fs.existsSync(work), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Codex failures surface the CLI message instead of a generic error', { skip: process.platform === 'win32' }, async () => {
  const home = workspace();
  try {
    const binary = fakeCodex(home, { fail: true });
    await withEnv({ CODEX_HOME: home, CODEX_BIN: binary }, () =>
      assert.rejects(requestCodexImage({ prompt: 'x' }, async value => value), /usage limit/));
    fs.writeFileSync(path.join(home, 'auth.json'), '{}');
    const response = await withEnv({ CODEX_HOME: home, CODEX_BIN: binary }, () => requestCodexImage({ prompt: 'x' }, async value => value));
    assert.equal(response.status, 401);
    assert.match((await response.json()).error.message, /codex login/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('a stream error that Codex retries does not fail an image it then completes', { skip: process.platform === 'win32' }, async () => {
  const home = workspace();
  try {
    const binary = fakeCodex(home, { retry: true });
    const response = await withEnv({ CODEX_HOME: home, CODEX_BIN: binary }, () => requestCodexImage({ prompt: 'x' }, async value => value));
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from((await response.json()).data[0].b64_json, 'base64'), PNG);
    // A retry that ends in a failed turn still reports that turn's error.
    const failing = fakeCodex(home, { retry: true, fail: true });
    await withEnv({ CODEX_HOME: home, CODEX_BIN: failing }, () =>
      assert.rejects(requestCodexImage({ prompt: 'x' }, async value => value), /usage limit/));
    // An error followed by a non-zero exit, without a failed turn, reports that error.
    const fatal = fakeCodex(home, { fatal: true });
    await withEnv({ CODEX_HOME: home, CODEX_BIN: fatal }, () =>
      assert.rejects(requestCodexImage({ prompt: 'x' }, async value => value), /^Error: Not signed in$/));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
