import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { agentEnvironment, findAgentBinary, localAgentAvailable, type LocalAgent } from './localAgents.js';

/** Prompt-writing text tasks (Enhance, Brainstorm, Variation) through the
 * desktop user's own Codex or Claude Code sign-in. Tools are disabled and the
 * prompt and references travel over stdin, never through a shell or argv. */
const TIMEOUT_MS = 240_000;
const MAX_OUTPUT = 4 * 1024 * 1024;

export interface LocalTextPart { text?: string; image?: { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string } }
export interface LocalTextRequest { agent: LocalAgent; model: string; instructions: string; parts: LocalTextPart[]; effort?: string; schema?: Record<string, unknown> }
export interface LocalTextResult { text: string; sessionId: string | null }

const CLAUDE_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const CODEX_EFFORTS: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' };

export const claudeArguments = (request: LocalTextRequest): string[] => [
  '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--model', 'opus', '--tools', '', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands',
  '--system-prompt', request.instructions,
  ...(request.effort && CLAUDE_EFFORTS.has(request.effort) ? ['--effort', request.effort] : []),
  ...(request.schema ? ['--json-schema', JSON.stringify(request.schema)] : []),
];
export const claudeInput = (parts: LocalTextPart[]): string => `${JSON.stringify({ type: 'user', message: { role: 'user', content: parts.map(part => part.image
  ? { type: 'image', source: { type: 'base64', media_type: part.image.mimeType, data: part.image.data } }
  : { type: 'text', text: part.text || '' }) } })}\n`;

export const codexTextArguments = (request: LocalTextRequest, workingDirectory: string, imagePaths: string[], schemaPath?: string): string[] => [
  'exec', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--json', '--cd', workingDirectory,
  '-m', request.model, ...(request.effort && CODEX_EFFORTS[request.effort] ? ['-c', `model_reasoning_effort=${CODEX_EFFORTS[request.effort]}`] : []),
  ...(schemaPath ? ['--output-schema', schemaPath] : []),
  ...imagePaths.flatMap(file => ['--image', file]), '-',
];
// Every tool denied: the studio only needs text back.
export const GEMINI_POLICY = '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n';
export const geminiArguments = (request: LocalTextRequest, policyPath: string): string[] => [
  '--output-format', 'json', '--model', request.model, '--admin-policy', policyPath, '--extensions', 'none', '--prompt', '',
];
export const OPENCODE_MODELS: Record<string, string> = {
  'anthropic/claude-opus-5.5': 'opencode/claude-opus-5-5', 'gpt-6.1-sol': 'opencode/gpt-6.1-sol', 'gemini-3.8-flash': 'opencode/gemini-3.8-flash',
};
/** A private agent with every tool off, loaded only for this run. `--standalone`
 * keeps the user's background opencode service and its config out of it. */
export const opencodeConfig = (instructions: string): string => JSON.stringify({ share: 'disabled', autoupdate: false, agent: { 'banana-studio': {
  mode: 'primary', prompt: instructions, tools: { '*': false }, permission: { '*': 'deny' } } } });
export const opencodeArguments = (request: LocalTextRequest, imagePaths: string[]): string[] => [
  'run', '--standalone', '--format', 'json', '--agent', 'banana-studio', '--model', OPENCODE_MODELS[request.model],
  ...imagePaths.flatMap(file => ['--file', file]),
];
export const textOnlyPrompt = (request: LocalTextRequest, withInstructions: boolean): string => [
  ...(withInstructions ? [request.instructions, 'Do not run commands, read or edit files, or call tools. Reply with the finished deliverable only.', ''] : []),
  ...(request.schema ? [`Reply with only a JSON object matching this JSON Schema, with no code fence: ${JSON.stringify(request.schema)}`, ''] : []),
  ...request.parts.map((part, index) => part.image ? `[Image ${request.parts.slice(0, index + 1).filter(item => item.image).length} attached]` : part.text || ''),
].join('\n');

export const codexTextPrompt = (request: LocalTextRequest): string => [
  request.instructions,
  'Do not run commands, edit files or call tools. Reply with the finished deliverable only.',
  '', ...request.parts.map((part, index) => part.image ? `[Image ${request.parts.slice(0, index + 1).filter(item => item.image).length} attached]` : part.text || ''),
].join('\n');

const LABELS: Record<LocalAgent, string> = { codex: 'Codex', 'claude-code': 'Claude Code', 'gemini-cli': 'Gemini CLI', opencode: 'opencode' };
const run = (agent: LocalAgent, binary: string, args: string[], input: string, cwd: string, signal?: AbortSignal, extraEnv: NodeJS.ProcessEnv = {}) => new Promise<LocalTextResult>((resolve, reject) => {
  const child = spawn(binary, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...agentEnvironment(binary, agent), ...extraEnv } });
  let whole = '';
  let buffer = '', size = 0, stderr = '', text = '', sessionId: string | null = null, failure = '', lastError = '';
  const stop = (error: Error) => { child.kill('SIGTERM'); reject(error); };
  const timer = setTimeout(() => stop(Object.assign(new Error('The local agent did not finish in time.'), { name: 'TimeoutError' })), TIMEOUT_MS);
  const abort = () => stop(Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' }));
  signal?.addEventListener('abort', abort, { once: true });
  const handle = (event: any) => {
    if (agent === 'claude-code') {
      if (event.type === 'system' && typeof event.session_id === 'string') sessionId = event.session_id;
      if (event.type === 'result') {
        if (event.is_error || event.subtype !== 'success') failure = String(event.result || 'Claude Code reported an error.');
        else text = event.structured_output != null ? JSON.stringify(event.structured_output) : String(event.result || '');
      }
    } else if (agent === 'opencode') {
      if (typeof event.sessionID === 'string') sessionId = event.sessionID;
      if (event.type === 'text' && typeof event.part?.text === 'string') text += event.part.text;
      if (event.type === 'error') failure = String(event.error?.message || 'opencode reported an error.');
    } else {
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') sessionId = event.thread_id;
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') text = event.item.text;
      if (event.type === 'turn.failed') failure = String(event.error?.message || 'Codex reported an error.');
      // Codex reports stream errors it retries as `error`; only a failed turn or exit ends the run.
      if (event.type === 'error') lastError = String(event.message || 'Codex reported an error.');
    }
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_OUTPUT) return stop(new Error('The local agent returned too much output.'));
    buffer += chunk; if (agent === 'gemini-cli') whole += chunk;
    for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try { handle(JSON.parse(line)); } catch { /* Ignore non-JSON progress lines. */ }
    }
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
  child.on('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
  child.on('close', code => {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (agent === 'gemini-cli') {
      // Gemini CLI prints one pretty-printed JSON document: { response, error }.
      try { const value = JSON.parse(whole); if (value?.error) failure = String(value.error.message || 'Gemini CLI reported an error.'); else text = String(value?.response || ''); sessionId = value?.session_id || null; }
      catch { if (!failure && code === 0) failure = 'Gemini CLI returned an unreadable reply.'; }
    } else if (buffer.trim()) { try { handle(JSON.parse(buffer)); } catch { /* Partial line. */ } }
    if (failure) return reject(new Error(failure));
    if (code !== 0) return reject(new Error(lastError || `${LABELS[agent]} exited with code ${code}. ${stderr.trim().split('\n').at(-1) || ''}`.trim()));
    resolve({ text, sessionId });
  });
  child.stdin.on('error', () => { /* An early exit is reported by 'close'. */ });
  child.stdin.end(input);
});

const SIGN_IN: Record<LocalAgent, string> = {
  codex: 'Install the Codex CLI and run `codex login` with your ChatGPT account.',
  'claude-code': 'Install Claude Code and run `claude auth login` with your Claude account.',
  'gemini-cli': 'Install Gemini CLI and run `gemini` once to sign in with Google.',
  opencode: 'Install opencode and run `opencode auth login` with your OpenCode account.',
};
const writeImages = (directory: string, parts: LocalTextPart[]) => parts.filter(part => part.image).map((part, index) => {
  const file = path.join(directory, `image-${index + 1}.${part.image!.mimeType === 'image/jpeg' ? 'jpg' : part.image!.mimeType.slice(6)}`);
  fs.writeFileSync(file, Buffer.from(part.image!.data, 'base64'), { mode: 0o600 });
  return file;
});

export async function runLocalAgentText(request: LocalTextRequest, signal?: AbortSignal): Promise<LocalTextResult> {
  const binary = findAgentBinary(request.agent);
  if (!binary || !localAgentAvailable(request.agent)) throw Object.assign(new Error(SIGN_IN[request.agent]), { status: 401 });
  // An empty private directory: the agent has nothing to read even with a read-only sandbox.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `banana-${request.agent}-${randomUUID().slice(0, 8)}-`));
  try {
    if (request.agent === 'claude-code') return await run('claude-code', binary, claudeArguments(request), claudeInput(request.parts), directory, signal);
    if (request.agent === 'gemini-cli') {
      if (request.parts.some(part => part.image)) throw Object.assign(new Error('Gemini CLI accepts text only here. Remove the references or choose another provider.'), { status: 400 });
      const policy = path.join(directory, 'policy.toml'); fs.writeFileSync(policy, GEMINI_POLICY, { mode: 0o600 });
      return await run('gemini-cli', binary, geminiArguments(request, policy), textOnlyPrompt(request, true), directory, signal);
    }
    if (request.agent === 'opencode') {
      const images = writeImages(directory, request.parts);
      return await run('opencode', binary, opencodeArguments(request, images), textOnlyPrompt(request, false), directory, signal, { OPENCODE_CONFIG_CONTENT: opencodeConfig(request.instructions) });
    }
    const images = writeImages(directory, request.parts);
    let schemaPath: string | undefined;
    if (request.schema) { schemaPath = path.join(directory, 'schema.json'); fs.writeFileSync(schemaPath, JSON.stringify(request.schema), { mode: 0o600 }); }
    return await run('codex', binary, codexTextArguments(request, directory, images, schemaPath), codexTextPrompt(request), directory, signal);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
