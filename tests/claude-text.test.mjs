import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeAvailable, claudeEnvironment, claudeToken, findClaudeBinary, requestClaudeText } from '../api/_lib/claudeText.ts';
import { MODEL_ROUTES } from '../src/lib/providers.ts';

const TOKEN = 'sk-ant-oat01-' + 'a'.repeat(40);
const withEnv = async (values, run) => {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) value == null ? delete process.env[key] : process.env[key] = value;
  try { return await run(); } finally { for (const [key, value] of Object.entries(saved)) value == null ? delete process.env[key] : process.env[key] = value; }
};

test('the Claude plan is offered only in the desktop runtime with a plan token and Claude Code', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-claude-test-'));
  try {
    const binary = path.join(directory, process.platform === 'win32' ? 'claude.exe' : 'claude');
    fs.writeFileSync(binary, '');
    await withEnv({ BANANA_RUNTIME: undefined, CLAUDE_CODE_OAUTH_TOKEN: TOKEN, CLAUDE_BIN: binary }, () => assert.equal(claudeAvailable(), false));
    await withEnv({ BANANA_RUNTIME: 'local', CLAUDE_CODE_OAUTH_TOKEN: TOKEN, CLAUDE_BIN: binary, CLAUDE_ENABLED: 'false' }, () => assert.equal(claudeAvailable(), false));
    await withEnv({ BANANA_RUNTIME: 'local', CLAUDE_CODE_OAUTH_TOKEN: undefined, CLAUDE_BIN: binary }, () => assert.equal(claudeAvailable(), false));
    await withEnv({ BANANA_RUNTIME: 'local', CLAUDE_CODE_OAUTH_TOKEN: TOKEN, CLAUDE_BIN: binary, CLAUDE_ENABLED: undefined }, () => assert.equal(claudeAvailable(), true));
    // An API key pasted in the plan field is not a plan token and would bill the API account.
    for (const value of ['sk-ant-api03-' + 'a'.repeat(40), 'sk-ant-oat01-short', TOKEN + '\nx'])
      await withEnv({ CLAUDE_CODE_OAUTH_TOKEN: value }, () => assert.equal(claudeToken(), undefined));
    await withEnv({ CLAUDE_BIN: binary }, () => assert.equal(findClaudeBinary(), binary));
    await withEnv({ CLAUDE_BIN: path.join(directory, 'claude.cmd') }, () => assert.equal(findClaudeBinary(), null));
    await withEnv({ CLAUDE_BIN: 'claude' }, () => assert.equal(findClaudeBinary(), null));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Claude Code receives the plan token and a private config, never provider keys', async () => {
  await withEnv({ HTTPS_PROXY: 'http://proxy.test:8080', ANTHROPIC_API_KEY: 'sk-ant-api03-test-only', OPENROUTER_API_KEY: 'test-only', SUPABASE_SERVICE_ROLE_KEY: 'test-only', CLAUDE_CONFIG_DIR: '/user/config' }, () => {
    const env = claudeEnvironment('/opt/claude/claude', TOKEN, '/tmp/private');
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, TOKEN);
    assert.equal(env.CLAUDE_CONFIG_DIR, '/tmp/private');
    assert.equal(env.HTTPS_PROXY, 'http://proxy.test:8080');
    for (const name of ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_AUTH_TOKEN']) assert.equal(env[name], undefined, name);
  });
});

test('a missing token fails before Claude Code starts', async () => {
  await withEnv({ CLAUDE_CODE_OAUTH_TOKEN: undefined }, () =>
    assert.rejects(requestClaudeText({ system: 'x', content: [{ type: 'text', text: 'x' }], effort: 'low' }), error => error.status === 401 && /setup-token/.test(error.message)));
});

test('Auto keeps OpenRouter ahead of the Claude plan for existing setups', () => {
  for (const routes of Object.values(MODEL_ROUTES)) if (routes.includes('claude')) assert.equal(routes.at(-1), 'claude');
});
