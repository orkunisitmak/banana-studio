import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Local agent CLIs that run on the desktop user's own subscription sign-in.
 * The app never reads or forwards their credentials: it starts the user's own
 * binary, which uses its own login. Hosted workspaces never offer them. */
export type LocalAgent = 'codex' | 'claude-code' | 'gemini-cli' | 'opencode';
export type LocalAgentAuth = 'signed-in' | 'signed-out' | 'api-key' | 'unknown';
export interface LocalAgentStatus {
  installed: boolean;
  version: string | null;
  auth: LocalAgentAuth;
  /** Human-readable sign-in method, never an account identifier. */
  authMethod: string | null;
  available: boolean;
  disabled: boolean;
}

const SPEC: Record<LocalAgent, { exe: string; binEnv: string; enabledEnv: string; extraDirectories: () => string[] }> = {
  codex: { exe: 'codex', binEnv: 'CODEX_BIN', enabledEnv: 'CODEX_ENABLED',
    extraDirectories: () => process.platform === 'win32' ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'codex')] : [] },
  'claude-code': { exe: 'claude', binEnv: 'CLAUDE_BIN', enabledEnv: 'CLAUDE_CODE_ENABLED',
    extraDirectories: () => [path.join(os.homedir(), '.claude', 'local'), ...(process.platform === 'win32' ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude')] : [])] },
  'gemini-cli': { exe: 'gemini', binEnv: 'GEMINI_CLI_BIN', enabledEnv: 'GEMINI_CLI_ENABLED', extraDirectories: () => [] },
  opencode: { exe: 'opencode', binEnv: 'OPENCODE_BIN', enabledEnv: 'OPENCODE_ENABLED', extraDirectories: () => [path.join(os.homedir(), '.opencode', 'bin')] },
};

// Node version managers keep global CLIs outside the default PATH of a Finder-launched app.
const nvmDirectories = (): string[] => {
  const root = path.join(process.env.NVM_DIR || path.join(os.homedir(), '.nvm'), 'versions', 'node');
  try { return fs.readdirSync(root).sort().reverse().map(version => path.join(root, version, 'bin')); } catch { return []; }
};

// A Finder- or Explorer-launched app has a minimal PATH; check the usual install locations too.
export const candidateDirectories = (agent?: LocalAgent): string[] => {
  const home = os.homedir();
  return [...(process.env.PATH || '').split(path.delimiter),
    ...(agent ? SPEC[agent].extraDirectories() : []),
    ...(process.platform === 'win32'
      ? [path.join(process.env.APPDATA || '', 'npm')]
      : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local/bin'), path.join(home, '.npm-global/bin'), path.join(home, '.bun/bin'), path.join(home, '.volta/bin'), ...nvmDirectories()]),
  ].filter(Boolean);
};

export const findAgentBinary = (agent: LocalAgent): string | null => {
  const { exe, binEnv } = SPEC[agent];
  const configured = process.env[binEnv]?.trim();
  // Windows .cmd/.bat shims cannot be started without a shell, and prompts must never pass through one.
  if (configured) return path.isAbsolute(configured) && !/\.(cmd|bat)$/i.test(configured) && fs.existsSync(configured) ? configured : null;
  const file = process.platform === 'win32' ? `${exe}.exe` : exe;
  for (const directory of candidateDirectories(agent)) {
    const candidate = path.join(directory, file);
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* Not installed here. */ }
  }
  return null;
};

// Only what an agent CLI needs to run and reach the network. Provider keys and
// server secrets in this process's environment never reach the child, so an
// agent cannot silently switch to an API key such as OPENAI_API_KEY.
const ENV_ALLOWLIST = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TEMP', 'TMP', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'GEMINI_CLI_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'SystemRoot', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'COMSPEC', 'PATHEXT'];
export const agentEnvironment = (binary: string, agent?: LocalAgent): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = Object.fromEntries(ENV_ALLOWLIST.filter(name => process.env[name]).map(name => [name, process.env[name]]));
  // npm installs agent CLIs as Node scripts; the app's bundled Node satisfies their shebang.
  env.PATH = [...new Set([path.dirname(binary), path.dirname(process.execPath), ...candidateDirectories(agent)])].join(path.delimiter);
  return env;
};

const probe = (binary: string, agent: LocalAgent, args: string[]): string | null => {
  const result = spawnSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000, windowsHide: true, env: agentEnvironment(binary, agent), cwd: os.tmpdir(), maxBuffer: 256 * 1024 });
  return result.status === 0 && typeof result.stdout === 'string' ? result.stdout : null;
};

const codexHome = () => process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
/** Only the auth mode is inspected; tokens are never read into the app. */
export const codexAuth = (): { auth: LocalAgentAuth; authMethod: string | null } => {
  try {
    const mode = JSON.parse(fs.readFileSync(path.join(codexHome(), 'auth.json'), 'utf8'))?.auth_mode;
    if (mode === 'chatgpt') return { auth: 'signed-in', authMethod: 'ChatGPT plan' };
    if (mode === 'apikey' || mode === 'api_key') return { auth: 'api-key', authMethod: 'OpenAI API key' };
    return { auth: 'signed-out', authMethod: null };
  } catch { return { auth: 'signed-out', authMethod: null }; }
};

/** `claude auth status` prints JSON; only the sign-in flag and method are kept. */
export const claudeAuth = (binary: string): { auth: LocalAgentAuth; authMethod: string | null } => {
  const output = probe(binary, 'claude-code', ['auth', 'status']);
  if (output == null) return { auth: 'signed-out', authMethod: null };
  try {
    const value = JSON.parse(output);
    if (value?.loggedIn !== true) return { auth: 'signed-out', authMethod: null };
    const method = String(value.authMethod || '');
    // Subscription sign-ins only: an API key route is already covered by Provider keys.
    if (/api.?key|console/i.test(method) || (value.apiProvider && value.apiProvider !== 'firstParty')) return { auth: 'api-key', authMethod: 'Anthropic API key' };
    return { auth: 'signed-in', authMethod: method === 'claude.ai' ? 'Claude subscription' : 'Claude account' };
  } catch { return { auth: 'unknown', authMethod: null }; }
};

/** Login with Google only: an API-key or Vertex setup is already covered by Provider keys. */
export const geminiCliAuth = (): { auth: LocalAgentAuth; authMethod: string | null } => {
  const home = path.join(process.env.GEMINI_CLI_HOME?.trim() || os.homedir(), '.gemini');
  let type = '';
  try { const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8')); type = String(settings?.security?.auth?.selectedType || settings?.selectedAuthType || ''); } catch { /* No settings yet. */ }
  if (type === 'gemini-api-key' || type === 'vertex-ai') return { auth: 'api-key', authMethod: 'Gemini API key' };
  if (type === 'oauth-personal' && fs.existsSync(path.join(home, 'oauth_creds.json'))) return { auth: 'signed-in', authMethod: 'Google account' };
  return { auth: 'signed-out', authMethod: null };
};

/** `opencode auth list --format json` lists connections by provider; only the
 * OpenCode provider (which serves the studio's models) counts. Ids and labels are dropped. */
export const opencodeAuth = (binary: string): { auth: LocalAgentAuth; authMethod: string | null } => {
  const output = probe(binary, 'opencode', ['auth', 'list', '--format', 'json']);
  if (output == null) return { auth: 'signed-out', authMethod: null };
  try {
    const providers = JSON.parse(output);
    const zen = Array.isArray(providers) ? providers.find((provider: any) => provider?.id === 'opencode') : null;
    return Array.isArray(zen?.connections) && zen.connections.length ? { auth: 'signed-in', authMethod: 'OpenCode account' } : { auth: 'signed-out', authMethod: null };
  } catch { return { auth: 'unknown', authMethod: null }; }
};

const AUTH: Record<LocalAgent, (binary: string) => { auth: LocalAgentAuth; authMethod: string | null }> = {
  codex: () => codexAuth(), 'claude-code': claudeAuth, 'gemini-cli': () => geminiCliAuth(), opencode: opencodeAuth,
};

const cache = new Map<string, { at: number; value: LocalAgentStatus }>();
export const resetAgentStatusCache = () => cache.clear();
export const localAgentStatus = (agent: LocalAgent, { fresh = false } = {}): LocalAgentStatus => {
  const disabled = process.env[SPEC[agent].enabledEnv] === 'false';
  if (process.env.BANANA_RUNTIME !== 'local') return { installed: false, version: null, auth: 'unknown', authMethod: null, available: false, disabled };
  const binary = findAgentBinary(agent);
  if (!binary) return { installed: false, version: null, auth: 'unknown', authMethod: null, available: false, disabled };
  // Keyed by binary so a changed install or CLAUDE_BIN/CODEX_BIN is seen at once.
  const key = `${agent}\0${binary}`, hit = cache.get(key);
  let value = !fresh && hit && Date.now() - hit.at < 15_000 ? hit.value : undefined;
  if (!value) {
    const version = probe(binary, agent, ['--version'])?.match(/\d+\.\d+\.\d+[\w.-]*/)?.[0] || null;
    const { auth, authMethod } = AUTH[agent](binary);
    value = { installed: true, version, auth, authMethod, available: auth === 'signed-in', disabled: false };
    cache.set(key, { at: Date.now(), value });
  }
  return { ...value, disabled, available: value.available && !disabled };
};
export const localAgentAvailable = (agent: LocalAgent): boolean => localAgentStatus(agent).available;
