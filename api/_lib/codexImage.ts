import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { agentCommand, agentEnvironment, codexAuth, findAgentBinary, localAgentAvailable } from './localAgents.js';

/** GPT Image through the official Codex CLI signed in with a ChatGPT plan.
 * Desktop only: the app never reads or forwards Codex credentials; it runs
 * the user's own `codex` binary, which uses its own login. */
const TIMEOUT_MS = 240_000;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

const codexHome = () => process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
export const findCodexBinary = (): string | null => findAgentBinary('codex');
/** True when Codex stores a ChatGPT sign-in. Only the auth mode is inspected. */
export const hasChatGPTLogin = (): boolean => codexAuth().auth === 'signed-in';
export const codexAvailable = (): boolean => localAgentAvailable('codex');
export const codexEnvironment = (binary: string): NodeJS.ProcessEnv => agentEnvironment(binary, 'codex');

export const codexImagePrompt = (input: Record<string, any>, imageCount: number): string => {
  const canvas = typeof input.size === 'string' && /^\d+x\d+$/.test(input.size)
    ? `Canvas: ${input.size.replace('x', ' × ')} pixels, or the closest supported size with exactly the same aspect ratio.`
    : input.aspect_ratio ? `Canvas: ${input.aspect_ratio} aspect ratio.` : '';
  return [
    imageCount
      ? `Use your built-in image generation tool to create exactly one image. ${imageCount} image${imageCount === 1 ? ' is' : 's are'} attached in order as Image 1${imageCount > 1 ? `–Image ${imageCount}` : ''}; use them as the request describes.`
      : 'Use your built-in image generation tool to create exactly one image.',
    'Do not write code, run commands, edit files or call any API. Generate the image with the tool, then reply with one short sentence.',
    canvas,
    input.background === 'transparent' ? 'Background: transparent.' : '',
    '', 'Image request:', input.prompt,
  ].filter(line => line !== '').join('\n');
};

export const codexArguments = (imagePaths: string[], workingDirectory: string): string[] => [
  'exec', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '--cd', workingDirectory,
  ...imagePaths.flatMap(file => ['--image', file]), '-',
];

const runCodex = (binary: string, args: string[], prompt: string, signal?: AbortSignal) => new Promise<{ threadId: string; message: string }>((resolve, reject) => {
  // The prompt goes through stdin, never through a shell or the argument list.
  const { command, args: prefix } = agentCommand(binary);
  const child = spawn(command, [...prefix, ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: codexEnvironment(binary) });
  let threadId = '', message = '', failure = '', lastError = '', buffer = '', stderr = '';
  const stop = (error: Error) => { child.kill('SIGTERM'); reject(error); };
  const timer = setTimeout(() => stop(Object.assign(new Error('Codex did not finish the image in time.'), { name: 'TimeoutError' })), TIMEOUT_MS);
  const abort = () => stop(Object.assign(new Error('The image request was cancelled.'), { name: 'AbortError' }));
  signal?.addEventListener('abort', abort, { once: true });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try {
        const event = JSON.parse(line);
        if (event.type === 'thread.started' && typeof event.thread_id === 'string') threadId = event.thread_id;
        if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) message = String(event.item.text);
        if (event.type === 'turn.failed') failure = String(event.error?.message || 'Codex reported an error.');
        // Codex also reports stream errors it retries ("Reconnecting... 1/5") as `error`; only a failed turn or exit ends the run.
        if (event.type === 'error') lastError = String(event.message || 'Codex reported an error.');
      } catch { /* Ignore non-JSON progress lines. */ }
    }
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
  child.on('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
  child.on('close', code => {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (failure) return reject(new Error(failure));
    if (code !== 0) return reject(new Error(lastError || `Codex exited with code ${code}. ${stderr.trim().split('\n').at(-1) || ''}`.trim()));
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(threadId)) return reject(new Error('Codex did not report a session.'));
    resolve({ threadId, message });
  });
  child.stdin.on('error', () => { /* An early exit is reported by 'close'. */ });
  child.stdin.end(prompt);
});

const writeReference = (directory: string, value: string, index: number): string => {
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) throw new Error('This reference could not be prepared for Codex.');
  const file = path.join(directory, `image-${index + 1}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`);
  fs.writeFileSync(file, Buffer.from(match[2], 'base64'), { mode: 0o600 });
  return file;
};

/** Returns the same response shape as the API routes: `{ data: [{ b64_json }] }`. */
export async function requestCodexImage(input: Record<string, any>, imageData: (url: string) => Promise<string>, signal?: AbortSignal): Promise<Response> {
  const binary = findCodexBinary();
  if (!binary || !hasChatGPTLogin()) return Response.json({ error: { message: 'Install the Codex CLI and run `codex login` with your ChatGPT account.' } }, { status: 401 });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `banana-codex-${randomUUID().slice(0, 8)}-`));
  try {
    const images: string[] = [];
    for (const [index, image] of (input.images || []).entries()) images.push(writeReference(directory, await imageData(image.image_url), index));
    const { threadId, message } = await runCodex(binary, codexArguments(images, directory), codexImagePrompt(input, images.length), signal);
    const outputDirectory = path.join(codexHome(), 'generated_images', threadId);
    const names = fs.existsSync(outputDirectory) ? fs.readdirSync(outputDirectory) : [];
    const files = names.filter(name => /\.(png|jpe?g|webp)$/i.test(name))
      .map(name => path.join(outputDirectory, name)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (!files.length) return Response.json({ error: { message: `Codex finished without an image. ${message}`.trim() } }, { status: 502 });
    const bytes = fs.readFileSync(files[0]);
    if (bytes.length > MAX_OUTPUT_BYTES) throw new Error('Generated image exceeds the output limit.');
    const extension = path.extname(files[0]).slice(1).toLowerCase();
    return Response.json({ data: [{ b64_json: bytes.toString('base64'), media_type: `image/${extension === 'jpg' ? 'jpeg' : extension}` }] },
      { headers: { 'x-request-id': threadId } });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
