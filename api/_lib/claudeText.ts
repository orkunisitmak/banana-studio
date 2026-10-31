import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/** Claude Opus 5.5 through the official Claude Agent SDK, billed to the desktop
 * user's own Claude plan with the OAuth token from `claude setup-token`.
 * Desktop only: a hosted workspace must never share one person's plan. */
export const CLAUDE_TEXT_MODEL = 'claude-opus-5-5';
const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';

export const claudeToken = (): string | undefined => {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  return token && /^sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,}$/.test(token) ? token : undefined;
};

// A Finder- or Explorer-launched app has a minimal PATH; check the usual install locations too.
const candidateDirectories = () => {
  const home = os.homedir();
  return [...(process.env.PATH || '').split(path.delimiter), path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'),
    ...(process.platform === 'win32' ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude'),
      // Default `npm install -g` prefix on Windows.
      ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin')] : [])]
      : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.npm-global/bin'), path.join(home, '.bun/bin'), path.join(home, '.volta/bin')]),
  ].filter(Boolean);
};

/** The user's installed Claude Code, else the SDK's own native build when it ships beside the app. */
export const findClaudeBinary = (): string | null => {
  const configured = process.env.CLAUDE_BIN?.trim();
  // Windows .cmd/.bat shims cannot be started without a shell, and the prompt must never pass through one.
  if (configured) return path.isAbsolute(configured) && !/\.(cmd|bat)$/i.test(configured) && fs.existsSync(configured) ? configured : null;
  for (const directory of candidateDirectories()) {
    const file = path.join(directory, exe);
    try { if (fs.statSync(file).isFile()) return file; } catch { /* Not installed here. */ }
  }
  try {
    const file = createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${exe}`);
    if (fs.statSync(file).isFile()) return file;
  } catch { /* The platform build is optional. */ }
  return null;
};

let cached: { at: number; value: boolean } | undefined;
export const claudeAvailable = (): boolean => {
  if (process.env.BANANA_RUNTIME !== 'local' || process.env.CLAUDE_ENABLED === 'false' || !claudeToken()) return false;
  if (cached && Date.now() - cached.at < 15_000) return cached.value;
  const value = !!findClaudeBinary();
  cached = { at: Date.now(), value };
  return value;
};

// Only what Claude Code needs to run and reach the network, plus the plan token.
// Provider keys such as ANTHROPIC_API_KEY never reach the child, so a request
// cannot silently bill an API account instead of the plan.
const ENV_ALLOWLIST = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TEMP', 'TMP',
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'SystemRoot', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'COMSPEC', 'PATHEXT'];
export const claudeEnvironment = (binary: string, token: string, configDirectory: string): Record<string, string> => {
  const env: Record<string, string> = Object.fromEntries(ENV_ALLOWLIST.filter(name => process.env[name]).map(name => [name, process.env[name]!]));
  env.PATH = [...new Set([path.dirname(binary), path.dirname(process.execPath), ...candidateDirectories()])].join(path.delimiter);
  env.CLAUDE_CODE_OAUTH_TOKEN = token;
  // A private config directory keeps the user's own Claude Code settings, hooks, plugins and history out of the request.
  env.CLAUDE_CONFIG_DIR = configDirectory;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'banana-studio';
  env.DISABLE_AUTOUPDATER = '1';
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  return env;
};

export class ClaudeTextError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export const claudeErrorMessage = (status?: number): string => {
  if (status === 401 || status === 403) return 'Claude plan token geçersiz veya süresi dolmuş. `claude setup-token` ile yeni token alıp Provider keys bölümüne ekle.';
  if (status === 429) return 'Claude plan kullanım limiti doldu. Limit yenilenince yeniden dene veya AI ayarlarında OpenRouter seç.';
  if (status === 529 || status === 503) return 'Opus 5.5 şu anda yoğun. Biraz sonra yeniden dene.';
  if (status === 400 || status === 413) return 'Claude bu isteği kabul edemedi. Prompt ve referansları kontrol et.';
  return 'Claude plan isteği tamamlanamadı. Yeniden dene.';
};

export type ClaudeContent = ({ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string } })[];
export type ClaudeTextRequest = { system: string; content: ClaudeContent; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; schema?: Record<string, unknown> };

/** One tool-free turn. Returns the text, or the structured output as JSON text when a schema is given. */
export async function requestClaudeText(input: ClaudeTextRequest, signal?: AbortSignal): Promise<{ text: string; sessionId: string | null; usage: unknown }> {
  const token = claudeToken();
  const binary = findClaudeBinary();
  if (!token) throw new ClaudeTextError('Run `claude setup-token` and paste the token as Claude plan in Provider keys.', 401);
  if (!binary) throw new ClaudeTextError('Install Claude Code (claude.com/claude-code) so the Agent SDK can run your Claude plan.', 503);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-claude-'));
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  // The prompt travels as one SDK message over stdin, never through a shell or the argument list.
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    yield { type: 'user', message: { role: 'user', content: input.content }, parent_tool_use_id: null };
  }
  let stderr = '';
  try {
    // Loaded on first use so hosted routes that only check availability never pull in the SDK.
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    for await (const message of query({ prompt: prompt(), options: {
      model: CLAUDE_TEXT_MODEL, effort: input.effort, systemPrompt: input.system,
      tools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [], persistSession: false,
      // Structured output is delivered through one internal tool call, so allow its follow-up turn.
      maxTurns: input.schema ? 3 : 1,
      ...(input.schema ? { outputFormat: { type: 'json_schema' as const, schema: input.schema } } : {}),
      cwd: directory, pathToClaudeCodeExecutable: binary, env: claudeEnvironment(binary, token, directory),
      abortController: controller, stderr: data => { stderr = (stderr + data).slice(-2000); },
    } })) {
      if (message.type !== 'result') continue;
      if (message.subtype !== 'success' || message.is_error) {
        const status = message.subtype === 'success' ? message.api_error_status ?? undefined : undefined;
        const detail = message.subtype === 'success' ? message.result : message.errors.join(' ');
        if (/rate.?limit|usage limit|limit reached/i.test(detail)) throw new ClaudeTextError(claudeErrorMessage(429), 429);
        if (/oauth|authenticat|invalid.*token|token.*(expired|revoked)/i.test(detail)) throw new ClaudeTextError(claudeErrorMessage(401), 401);
        throw new ClaudeTextError(claudeErrorMessage(status), status ?? 502);
      }
      const text = input.schema ? (message.structured_output == null ? '' : JSON.stringify(message.structured_output)) : message.result;
      return { text, sessionId: message.session_id ?? null, usage: message.usage ?? null };
    }
    throw new ClaudeTextError(stderr.trim().split('\n').at(-1) || claudeErrorMessage(), 502);
  } catch (error) {
    if (signal?.aborted) throw Object.assign(new Error('The text request was cancelled.'), { name: 'AbortError' });
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    controller.abort();
    // A locked temp folder must not turn a finished plan call into an error.
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch { console.warn('[claude-text] temporary directory could not be removed'); }
  }
}
