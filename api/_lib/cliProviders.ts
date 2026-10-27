import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CliProvider } from '../../src/lib/providers.js';

/** Runs the user's own signed-in `claude` / `codex` command for text features.
 * Desktop (local runtime) only: a hosted server must never run a visitor's
 * prompt through the host's personal subscription. Prompts travel over stdin,
 * so the shell never sees user text. */
const BINARY: Record<CliProvider, string> = { 'claude-cli': 'claude', 'codex-cli': 'codex' };
const isWindows = process.platform === 'win32';

const onPath = (name: string): boolean => {
  const extensions = isWindows ? (process.env.PATHEXT || '.EXE;.CMD').split(';').map(ext => ext.toLowerCase()) : [''];
  return (process.env.PATH || '').split(path.delimiter).filter(Boolean)
    .some(dir => extensions.some(ext => existsSync(path.join(dir, name + ext))));
};

let cache: { at: number; value: Record<CliProvider, boolean> } | undefined;
export const cliAvailability = (): Record<CliProvider, boolean> => {
  if (process.env.BANANA_RUNTIME !== 'local') return { 'claude-cli': false, 'codex-cli': false };
  if (!cache || Date.now() - cache.at > 30_000) {
    cache = { at: Date.now(), value: {
      'claude-cli': process.env.CLAUDE_CLI_ENABLED !== 'false' && onPath('claude'),
      'codex-cli': process.env.CODEX_CLI_ENABLED !== 'false' && onPath('codex'),
    } };
  }
  return cache.value;
};

export interface CliImage { mimeType: string; data: string }
export interface CliRequest {
  prompt: string; system: string; effort: string; images: CliImage[]; jsonSchema?: object; signal: AbortSignal;
}
export class CliError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const CLAUDE_EFFORT = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const CODEX_EFFORT: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };

const run = (command: string, args: string[], stdin: string, cwd: string, signal: AbortSignal): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    // `.cmd` shims on Windows need a shell; every argument below is a fixed token.
    const child = spawn(command, args, { cwd, shell: isWindows, windowsHide: true, signal, env: { ...process.env, NO_COLOR: '1' } });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', error => reject(error));
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => { /* process ended early */ });
    child.stdin.end(stdin);
  });

export async function runCliText(provider: CliProvider, request: CliRequest): Promise<string> {
  if (!cliAvailability()[provider]) throw new CliError(`${BINARY[provider]} komutu bulunamadı ya da bu çalışma alanında kapalı.`, 503);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'banana-cli-'));
  try {
    const files: string[] = [];
    for (const [index, image] of request.images.entries()) {
      const file = path.join(dir, `reference-${index + 1}.${EXTENSIONS[image.mimeType]}`);
      await writeFile(file, Buffer.from(image.data, 'base64'));
      files.push(file);
    }
    if (provider === 'claude-cli') {
      // Empty settings and a short system prompt keep each call small; an
      // unconfigured session otherwise loads the user's whole Claude Code context.
      const args = ['-p', '--model', 'opus', '--output-format', 'json', '--no-session-persistence', '--setting-sources', '""',
        '--disable-slash-commands', '--strict-mcp-config', '--system-prompt', '"You write prompts for image and video generators."'];
      if (CLAUDE_EFFORT.has(request.effort)) args.push('--effort', request.effort);
      if (request.jsonSchema) args.push('--json-schema', isWindows ? `"${JSON.stringify(request.jsonSchema).replace(/"/g, '\\"')}"` : JSON.stringify(request.jsonSchema));
      if (files.length) args.push('--tools', 'Read', '--allowedTools', 'Read', '--add-dir', `"${dir}"`);
      else args.push('--tools', '""');
      const references = files.length ? `\n\nReference images are saved as files; open each with the Read tool before answering:\n${files.map(file => `- ${file}`).join('\n')}` : '';
      const { code, stdout, stderr } = await run(BINARY[provider], args, `${request.system}\n\n${request.prompt}${references}`, dir, request.signal);
      let data: any;
      try { data = JSON.parse(stdout); } catch { /* handled below */ }
      if (code !== 0 || !data || data.is_error) throw new CliError(cliMessage(provider, stderr || data?.result));
      const structured = data.structured_output;
      const text = structured != null ? JSON.stringify(structured) : data.result;
      if (typeof text !== 'string' || !text.trim()) throw new CliError('Claude boş yanıt döndürdü. Yeniden dene.');
      return text;
    }
    const out = path.join(dir, 'answer.txt');
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-rules', '--ignore-user-config', '--sandbox', 'read-only', '-o', `"${out}"`,
      '-c', `model_reasoning_effort="${CODEX_EFFORT[request.effort] || 'medium'}"`.replace(/"/g, isWindows ? '\\"' : '"')];
    for (const file of files) args.push('-i', `"${file}"`);
    if (request.jsonSchema) {
      const schema = path.join(dir, 'schema.json');
      await writeFile(schema, JSON.stringify(request.jsonSchema));
      args.push('--output-schema', `"${schema}"`);
    }
    const { code, stderr } = await run(BINARY[provider], args, `${request.system}\n\n${request.prompt}`, dir, request.signal);
    const text = await readFile(out, 'utf8').catch(() => '');
    if (code !== 0 || !text.trim()) throw new CliError(cliMessage(provider, stderr));
    return text;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const cliMessage = (provider: CliProvider, detail?: string): string => {
  const name = provider === 'claude-cli' ? 'Claude' : 'Codex';
  if (/log ?in|auth|credential|sign/i.test(detail || '')) return `${name} oturumu açık değil. Terminalde \`${BINARY[provider]}\` ile giriş yap, sonra yeniden dene.`;
  if (/limit|quota|rate/i.test(detail || '')) return `${name} abonelik limiti doldu. Biraz sonra yeniden dene.`;
  return `${name} isteği tamamlanamadı. Komut satırında oturumun açık olduğunu kontrol et.`;
};
