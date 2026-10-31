import { execFile } from 'node:child_process';
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

/** npm on Windows installs `name.cmd` shims that start `node <script>`. The script
 * is read out of the shim and later run with the app's own Node, so a prompt never
 * passes through cmd.exe. Returns null when the shim does not point at a script. */
export const resolveCmdShim = (shim: string): string | null => {
  let text: string;
  try { text = fs.readFileSync(shim, 'utf8'); } catch { return null; }
  const match = text.match(/"%~?dp0%?\\?([^"%]+?\.[cm]?js)"/i);
  if (!match) return null;
  const script = path.resolve(path.dirname(shim), match[1].replace(/\\/g, path.sep));
  try { return fs.statSync(script).isFile() ? script : null; } catch { return null; }
};
const usable = (file: string): string | null => {
  if (/\.(cmd|bat)$/i.test(file)) return resolveCmdShim(file);
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
};

/** The executable, or on Windows the Node script behind an npm shim. */
export const findAgentBinary = (agent: LocalAgent): string | null => {
  const { exe, binEnv } = SPEC[agent];
  const configured = process.env[binEnv]?.trim();
  if (configured) return path.isAbsolute(configured) ? usable(configured) : null;
  const files = process.platform === 'win32' ? [`${exe}.exe`, `${exe}.cmd`] : [exe];
  for (const directory of candidateDirectories(agent)) {
    for (const file of files) { const found = usable(path.join(directory, file)); if (found) return found; }
  }
  return null;
};
/** How to start a binary without a shell: scripts run under the app's own Node. */
export const agentCommand = (binary: string): { command: string; args: string[] } =>
  /\.[cm]?js$/i.test(binary) ? { command: process.execPath, args: [binary] } : { command: binary, args: [] };

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

const probe = (binary: string, agent: LocalAgent, args: string[]): Promise<string | null> => new Promise(resolve => {
  const { command, args: prefix } = agentCommand(binary);
  const child = execFile(command, [...prefix, ...args], { encoding: 'utf8', timeout: 5_000, windowsHide: true, env: agentEnvironment(binary, agent), cwd: os.tmpdir(), maxBuffer: 256 * 1024 },
    (error, stdout) => resolve(error ? null : stdout));
  // No input: a CLI that reads stdin must see it closed instead of waiting for the timeout.
  child.stdin?.end();
});

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
export const claudeAuth = async (binary: string): Promise<{ auth: LocalAgentAuth; authMethod: string | null }> => {
  const output = await probe(binary, 'claude-code', ['auth', 'status']);
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
export const opencodeAuth = async (binary: string): Promise<{ auth: LocalAgentAuth; authMethod: string | null }> => {
  const output = await probe(binary, 'opencode', ['auth', 'list', '--format', 'json']);
  if (output == null) return { auth: 'signed-out', authMethod: null };
  try {
    const providers = JSON.parse(output);
    const zen = Array.isArray(providers) ? providers.find((provider: any) => provider?.id === 'opencode') : null;
    return Array.isArray(zen?.connections) && zen.connections.length ? { auth: 'signed-in', authMethod: 'OpenCode account' } : { auth: 'signed-out', authMethod: null };
  } catch { return { auth: 'unknown', authMethod: null }; }
};

const AUTH: Record<LocalAgent, (binary: string) => Promise<{ auth: LocalAgentAuth; authMethod: string | null }>> = {
  codex: async () => codexAuth(), 'claude-code': claudeAuth, 'gemini-cli': async () => geminiCliAuth(), opencode: opencodeAuth,
};

const cache = new Map<string, { at: number; value: LocalAgentStatus }>();
const pending = new Map<string, Promise<LocalAgentStatus>>();
export const resetAgentStatusCache = () => { cache.clear(); pending.clear(); };
const STALE_MS = 15_000;
const unavailable = (disabled: boolean, installed = false): LocalAgentStatus => ({ installed, version: null, auth: 'unknown', authMethod: null, available: false, disabled });
const withDisabled = (value: LocalAgentStatus, disabled: boolean): LocalAgentStatus => ({ ...value, disabled, available: value.available && !disabled });
const locate = (agent: LocalAgent) => {
  const disabled = process.env[SPEC[agent].enabledEnv] === 'false';
  if (process.env.BANANA_RUNTIME !== 'local') return { disabled };
  const binary = findAgentBinary(agent);
  // Keyed by binary so a changed install or CLAUDE_BIN/CODEX_BIN is seen at once.
  return { disabled, binary, key: binary ? `${agent}\0${binary}` : undefined };
};

/** Probes the CLI without blocking the server: the version and sign-in checks run
 * as child processes. Concurrent callers share one probe per binary. */
export const refreshLocalAgentStatus = (agent: LocalAgent): Promise<LocalAgentStatus> => {
  const { disabled, binary, key } = locate(agent);
  if (!binary || !key) return Promise.resolve(unavailable(disabled));
  let run = pending.get(key);
  if (!run) {
    run = (async () => {
      const [versionOutput, { auth, authMethod }] = await Promise.all([probe(binary, agent, ['--version']), AUTH[agent](binary)]);
      const value: LocalAgentStatus = { installed: true, version: versionOutput?.match(/\d+\.\d+\.\d+[\w.-]*/)?.[0] || null, auth, authMethod, available: auth === 'signed-in', disabled: false };
      cache.set(key, { at: Date.now(), value });
      return value;
    })().finally(() => pending.delete(key));
    pending.set(key, run);
  }
  return run.then(value => withDisabled(value, process.env[SPEC[agent].enabledEnv] === 'false'));
};

/** Cached status only; never starts a process on the caller's path. A stale or
 * missing entry is refreshed in the background, and a never-probed CLI reports
 * itself unavailable until that first probe finishes. */
export const localAgentStatus = (agent: LocalAgent): LocalAgentStatus => {
  const { disabled, binary, key } = locate(agent);
  if (!binary || !key) return unavailable(disabled);
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at >= STALE_MS) void refreshLocalAgentStatus(agent).catch(() => { /* Reported by the next status read. */ });
  return hit ? withDisabled(hit.value, disabled) : unavailable(disabled, true);
};
export const localAgentAvailable = (agent: LocalAgent): boolean => localAgentStatus(agent).available;
/** Cached status, waiting for the first probe only when nothing is cached yet. */
export const localAgentStatusWarm = async (agent: LocalAgent, { fresh = false } = {}): Promise<LocalAgentStatus> => {
  const { key } = locate(agent);
  return fresh || (key && !cache.has(key)) ? refreshLocalAgentStatus(agent) : localAgentStatus(agent);
};
