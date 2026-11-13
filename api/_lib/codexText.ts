import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findCodexBinary, hasChatGPTLogin, runCodex, writeReference } from './codexImage.js';
import { CODEX_TEXT_MODEL, CODEX_REASONING_EFFORTS } from '../../src/lib/prompts/codexText.js';
import { buildBrainstormOutputFormat, brainstormOutputInstruction, isBrainstormCount, normalizeBrainstormOutput, YOUTUBE_ANALYSIS_FORMAT } from './textOutputFormats.js';

export class CodexTextInputError extends Error {}
export interface CodexTextRequest {
  model: typeof CODEX_TEXT_MODEL;
  contents: { parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] };
  usageContext: { action: 'enhance' | 'video_enhance' | 'brainstorm' | 'variation'; prompt: string };
  reasoningEffort?: typeof CODEX_REASONING_EFFORTS[number];
  brainstormFormat?: 'wardrobe';
  brainstormCount?: number;
  outputFormat?: 'youtube_analysis';
}

export function validateCodexTextRequest(body: unknown): asserts body is CodexTextRequest {
  const value = body as CodexTextRequest | undefined;
  const parts = value?.contents?.parts;
  const action = value?.usageContext?.action;
  if (value?.model !== CODEX_TEXT_MODEL || !['enhance', 'video_enhance', 'brainstorm', 'variation'].includes(action || '')
    || typeof value?.usageContext?.prompt !== 'string') throw new CodexTextInputError('Invalid Codex text task.');
  if (value.reasoningEffort != null && !CODEX_REASONING_EFFORTS.includes(value.reasoningEffort)) throw new CodexTextInputError('Unsupported Codex reasoning effort.');
  if (value.brainstormFormat != null && (value.brainstormFormat !== 'wardrobe' || action !== 'brainstorm')) throw new CodexTextInputError('Invalid Brainstorm format.');
  if (value.brainstormCount != null && (action !== 'brainstorm' || !isBrainstormCount(value.brainstormCount))) throw new CodexTextInputError('Invalid Brainstorm idea count.');
  if (value.outputFormat != null && (value.outputFormat !== 'youtube_analysis' || action !== 'enhance' || value.brainstormFormat != null)) throw new CodexTextInputError('Invalid analysis format.');
  if (!Array.isArray(parts) || !parts.length || parts.length > 256 || !parts.some(part => part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' && part.text.trim())) throw new CodexTextInputError('Provide text and optional image references.');
  if (Buffer.byteLength(JSON.stringify(parts)) > 4_100_000) throw new CodexTextInputError('Reference images are too large. Use fewer or smaller images.');
  for (const part of parts) {
    if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' && Object.keys(part).length === 1) continue;
    if (part && typeof part === 'object' && 'inlineData' in part && Object.keys(part).length === 1
      && ['image/png', 'image/jpeg', 'image/webp'].includes(part.inlineData?.mimeType)
      && typeof part.inlineData?.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(part.inlineData.data)) continue;
    throw new CodexTextInputError('Use text or JPEG, PNG, WebP references. Codex does not read video URLs.');
  }
}

export async function requestCodexText(body: unknown, signal?: AbortSignal) {
  validateCodexTextRequest(body);
  signal?.throwIfAborted();
  if (process.env.BANANA_RUNTIME !== 'local' || process.env.CODEX_ENABLED === 'false') throw new Error('ChatGPT plan text generation is available only in the desktop app.');
  const binary = findCodexBinary();
  if (!binary || !hasChatGPTLogin()) throw new Error('Install the Codex CLI and run `codex login` with your ChatGPT account. No API request was sent.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-codex-text-'));
  try {
    const images: string[] = [];
    const prompt: string[] = [
      'Complete the requested creative text task using only the supplied brief and attached references. Do not ask follow-up questions.',
      'Return the finished text in the required JSON schema. Do not generate images, browse, run commands, read other files, or use tools.',
    ];
    for (const part of body.contents.parts) {
      if ('text' in part) prompt.push(part.text);
      else {
        images.push(writeReference(directory, `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`, images.length));
        prompt.push(`[Attached Image ${images.length} at this position in the brief]`);
      }
    }
    const brainstorm = body.usageContext.action === 'brainstorm';
    const wardrobe = body.brainstormFormat === 'wardrobe';
    const schema = brainstorm ? buildBrainstormOutputFormat(wardrobe, body.brainstormCount).schema
      : body.outputFormat === 'youtube_analysis' ? YOUTUBE_ANALYSIS_FORMAT.schema
      : { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } };
    if (brainstorm) prompt.push(brainstormOutputInstruction(wardrobe, body.brainstormCount));
    if (body.outputFormat === 'youtube_analysis') prompt.push('Use only the supplied verified footage observations. Do not claim to have watched the video or invent events, identities, prices, outcomes, or timestamps.');
    const schemaFile = path.join(directory, 'output-schema.json');
    fs.writeFileSync(schemaFile, JSON.stringify(schema), { mode: 0o600 });
    const args = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '--cd', directory,
      '--output-schema', schemaFile, '-c', `model_reasoning_effort="${body.reasoningEffort || 'medium'}"`, '-c', 'web_search="disabled"',
      ...['shell_tool', 'apps', 'plugins', 'hooks', 'multi_agent', 'browser_use', 'computer_use', 'image_generation'].flatMap(feature => ['--disable', feature]),
      ...images.flatMap(file => ['--image', file]), '-'];
    const result = await runCodex(binary, args, prompt.join('\n\n'), signal);
    let text: string | null;
    if (brainstorm) text = normalizeBrainstormOutput(result.message, wardrobe, body.brainstormCount);
    else {
      let output: unknown;
      try { output = JSON.parse(result.message); } catch { throw new Error('Codex did not return the requested JSON output. No API fallback was attempted.'); }
      text = body.outputFormat === 'youtube_analysis' ? JSON.stringify(output)
        : output && typeof output === 'object' && 'text' in output && typeof output.text === 'string' ? output.text : null;
    }
    if (typeof text !== 'string' || !text.trim()) throw new Error('Codex returned an empty or incomplete result. No API fallback was attempted.');
    return { text, candidates: null, requestId: result.threadId,
      usageMetadata: { provider: 'codex', billingSource: 'chatgpt-plan', usageLogged: false } };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
