import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const load = async file => {
  const compiled = await build({ entryPoints: [fileURLToPath(new URL(file, import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
};
const agents = await load('../api/_lib/localAgents.ts');
const text = await load('../api/_lib/localAgentText.ts');

const withEnv = async (values, run) => {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) value == null ? delete process.env[key] : process.env[key] = value;
  try { return await run(); } finally { for (const [key, value] of Object.entries(saved)) value == null ? delete process.env[key] : process.env[key] = value; }
};
// A stand-in for `claude`: answers `--version`, `auth status` and a stream-json turn, and records what it received.
const fakeClaude = (directory, { loggedIn = true, method = 'claude.ai', fail = false } = {}) => {
  const file = path.join(directory, `claude-${loggedIn}-${method}-${fail}`);
  fs.writeFileSync(file, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2);
if(args[0]==='--version'){console.log('2.1.310 (Claude Code)');return;}
if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:${loggedIn},authMethod:${JSON.stringify(method)},apiProvider:'firstParty',email:'person@example.invalid'}));return;}
let input='';process.stdin.on('data',c=>input+=c).on('end',()=>{
  fs.writeFileSync(path.join(${JSON.stringify(directory)},'call.json'),JSON.stringify({args,input,cwd:process.cwd(),secrets:['OPENAI_API_KEY','ANTHROPIC_API_KEY','SUPABASE_SERVICE_ROLE_KEY'].filter(k=>k in process.env)}));
  console.log(JSON.stringify({type:'system',subtype:'init',session_id:'session-1'}));
  ${fail ? `console.log(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,result:'Usage limit reached.'}));process.exitCode=1;`
    : `console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'A brighter prompt.'}));`}
});`, { mode: 0o755 });
  return file;
};

test('Claude Code status reports install, version and sign-in without account details', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-claude-'));
  try {
    const binary = fakeClaude(directory);
    await withEnv({ BANANA_RUNTIME: 'local', CLAUDE_BIN: binary, CLAUDE_CODE_ENABLED: undefined }, async () => {
      const cold = agents.localAgentStatus('claude-code');
      assert.equal(cold.available, false, 'a cache miss answers at once instead of waiting for the CLI');
      const status = await agents.refreshLocalAgentStatus('claude-code');
      assert.deepEqual(agents.localAgentStatus('claude-code'), status, 'the cached result is served afterwards');
      assert.deepEqual(status, { installed: true, version: '2.1.310', auth: 'signed-in', authMethod: 'Claude subscription', available: true, disabled: false });
      assert.ok(!JSON.stringify(status).includes('example.invalid'), 'the account email never leaves the probe');
    });
    await withEnv({ BANANA_RUNTIME: 'local', CLAUDE_BIN: binary, CLAUDE_CODE_ENABLED: 'false' }, () => {
      const status = agents.localAgentStatus('claude-code');
      assert.equal(status.disabled, true); assert.equal(status.available, false);
    });
    await withEnv({ BANANA_RUNTIME: undefined, CLAUDE_BIN: binary }, async () => assert.equal((await agents.refreshLocalAgentStatus('claude-code')).available, false, 'hosted workspaces never run local agents'));
    await withEnv({ BANANA_RUNTIME: 'local', CLAUDE_BIN: fakeClaude(directory, { method: 'console' }) }, async () =>
      assert.equal((await agents.refreshLocalAgentStatus('claude-code')).auth, 'api-key', 'an API-key login is not a subscription route'));
    await withEnv({ BANANA_RUNTIME: 'local', CLAUDE_BIN: fakeClaude(directory, { loggedIn: false }) }, async () =>
      assert.equal((await agents.refreshLocalAgentStatus('claude-code')).auth, 'signed-out'));
    await withEnv({ BANANA_RUNTIME: 'local', CLAUDE_BIN: path.join(directory, 'missing') }, async () =>
      assert.equal((await agents.refreshLocalAgentStatus('claude-code')).installed, false));
  } finally { agents.resetAgentStatusCache(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Claude Code text runs with tools off, prompt over stdin and no provider keys in its environment', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-claude-'));
  try {
    const binary = fakeClaude(directory);
    await withEnv({ BANANA_RUNTIME: 'local', CLAUDE_BIN: binary, OPENAI_API_KEY: 'sk-secret', ANTHROPIC_API_KEY: 'sk-ant', SUPABASE_SERVICE_ROLE_KEY: 'service' }, async () => {
      agents.resetAgentStatusCache();
      const result = await text.runLocalAgentText({ agent: 'claude-code', instructions: 'Write prompts.', effort: 'high',
        parts: [{ text: 'A red fox; $(rm -rf ~)' }, { image: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } }] });
      assert.deepEqual(result, { text: 'A brighter prompt.', sessionId: 'session-1' });
      const call = JSON.parse(fs.readFileSync(path.join(directory, 'call.json'), 'utf8'));
      assert.deepEqual(call.secrets, []);
      assert.equal(call.args[call.args.indexOf('--tools') + 1], '');
      assert.equal(call.args[call.args.indexOf('--effort') + 1], 'high');
      assert.ok(!call.args.some(arg => arg.includes('red fox')), 'the prompt is not passed as an argument');
      const message = JSON.parse(call.input).message.content;
      assert.equal(message[0].text, 'A red fox; $(rm -rf ~)');
      assert.equal(message[1].source.media_type, 'image/png');
      assert.ok(!fs.existsSync(call.cwd), 'the private working directory is removed');
    });
    await withEnv({ BANANA_RUNTIME: 'local', CLAUDE_BIN: fakeClaude(directory, { fail: true }) }, async () => {
      agents.resetAgentStatusCache();
      await assert.rejects(text.runLocalAgentText({ agent: 'claude-code', instructions: 'x', parts: [{ text: 'y' }] }), /Usage limit reached/);
    });
    await withEnv({ BANANA_RUNTIME: 'local', CLAUDE_BIN: fakeClaude(directory, { loggedIn: false }) }, async () => {
      agents.resetAgentStatusCache();
      await assert.rejects(text.runLocalAgentText({ agent: 'claude-code', instructions: 'x', parts: [{ text: 'y' }] }), /claude auth login/);
    });
  } finally { agents.resetAgentStatusCache(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Codex text uses a read-only ephemeral run with the schema and images as files', () => {
  const args = text.codexTextArguments({ agent: 'codex', model: 'gpt-6.1-sol', instructions: 'x', parts: [], effort: 'max' }, '/tmp/work', ['/tmp/work/image-1.png'], '/tmp/work/schema.json');
  assert.deepEqual(args.slice(0, 9), ['exec', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--json', '--cd', '/tmp/work']);
  assert.ok(args.includes('model_reasoning_effort=xhigh'));
  assert.equal(args[args.indexOf('--output-schema') + 1], '/tmp/work/schema.json');
  assert.equal(args[args.indexOf('--image') + 1], '/tmp/work/image-1.png');
  assert.equal(args.at(-1), '-', 'the prompt is read from stdin');
});

test('Gemini CLI counts only a Google sign-in and runs with every tool denied', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-gemini-'));
  try {
    fs.mkdirSync(path.join(home, '.gemini'));
    const settings = type => fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), JSON.stringify({ security: { auth: { selectedType: type } } }));
    await withEnv({ GEMINI_CLI_HOME: home }, () => {
      settings('oauth-personal'); assert.equal(agents.geminiCliAuth().auth, 'signed-out', 'no stored Google credentials yet');
      fs.writeFileSync(path.join(home, '.gemini', 'oauth_creds.json'), '{}'); assert.deepEqual(agents.geminiCliAuth(), { auth: 'signed-in', authMethod: 'Google account' });
      settings('gemini-api-key'); assert.equal(agents.geminiCliAuth().auth, 'api-key');
    });
    assert.match(text.GEMINI_POLICY, /toolName = "\*"\ndecision = "deny"/);
    const args = text.geminiArguments({ agent: 'gemini-cli', model: 'gemini-3.8-flash', instructions: 'x', parts: [] }, '/tmp/policy.toml');
    assert.equal(args[args.indexOf('--admin-policy') + 1], '/tmp/policy.toml');
    assert.equal(args[args.indexOf('--extensions') + 1], 'none');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('opencode runs a private tool-less agent and counts only an OpenCode account', async () => {
  const config = JSON.parse(text.opencodeConfig('Write prompts.'));
  assert.deepEqual(config.agent['banana-studio'].permission, { '*': 'deny' });
  assert.deepEqual(config.agent['banana-studio'].tools, { '*': false });
  const args = text.opencodeArguments({ agent: 'opencode', model: 'anthropic/claude-opus-5.5', instructions: 'x', parts: [] }, ['/tmp/a.png']);
  assert.ok(args.includes('--standalone'), 'the background service and its config are not used');
  assert.equal(args[args.indexOf('--model') + 1], 'opencode/claude-opus-5-5');
  assert.equal(args[args.indexOf('--file') + 1], '/tmp/a.png');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-opencode-'));
  try {
    const fake = (name, providers) => { const file = path.join(directory, name); fs.writeFileSync(file, `#!${process.execPath}\nif(process.argv[2]==='--version')console.log('opencode v2.1.4');else console.log(${JSON.stringify(JSON.stringify(providers))});`, { mode: 0o755 }); return file; };
    await withEnv({ BANANA_RUNTIME: 'local', OPENCODE_BIN: fake('zen', [{ id: 'opencode', connections: [{ id: 'cred_secret', label: 'Personal' }] }]) }, async () => {
      const status = (await agents.refreshLocalAgentStatus('opencode'));
      assert.equal(status.available, true); assert.equal(status.version, '2.1.4');
      assert.ok(!JSON.stringify(status).includes('cred_secret'));
    });
    await withEnv({ BANANA_RUNTIME: 'local', OPENCODE_BIN: fake('go-only', [{ id: 'opencode-go', connections: [{ id: 'x' }] }]) }, async () =>
      assert.equal((await agents.refreshLocalAgentStatus('opencode')).auth, 'signed-out', 'other opencode providers do not serve these models'));
  } finally { agents.resetAgentStatusCache(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a Windows npm shim resolves to its Node script, which runs under the bundled Node without a shell', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-shim-'));
  try {
    const script = path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    fs.mkdirSync(path.dirname(script), { recursive: true }); fs.writeFileSync(script, '');
    // The shape npm writes for global installs.
    const shim = path.join(directory, 'codex.cmd');
    fs.writeFileSync(shim, '@ECHO off\r\nSETLOCAL\r\nSET dp0=%~dp0\r\nIF EXIST "%dp0%\\node.exe" (SET "_prog=%dp0%\\node.exe") ELSE (SET "_prog=node")\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
    assert.equal(agents.resolveCmdShim(shim), script);
    const short = path.join(directory, 'short.cmd');
    fs.writeFileSync(short, '@node "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*');
    assert.equal(agents.resolveCmdShim(short), script);
    const broken = path.join(directory, 'broken.cmd');
    fs.writeFileSync(broken, '@echo off');
    assert.equal(agents.resolveCmdShim(broken), null, 'a shim without a script is refused');
    fs.writeFileSync(path.join(directory, 'gone.cmd'), '"%dp0%\\missing.js" %*');
    assert.equal(agents.resolveCmdShim(path.join(directory, 'gone.cmd')), null, 'a script that does not exist is refused');
    assert.deepEqual(agents.agentCommand(script), { command: process.execPath, args: [script] });
    assert.deepEqual(agents.agentCommand('/usr/local/bin/codex'), { command: '/usr/local/bin/codex', args: [] });
    withEnv({ CODEX_BIN: shim }, () => assert.equal(agents.findAgentBinary('codex'), script));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
