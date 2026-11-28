import { OPENROUTER_MODELS } from '../../src/lib/providers.js';
import { OPENROUTER_TEXT_MODEL } from '../../src/lib/prompts/openrouterText.js';
import { ANTHROPIC_MODELS } from '../../src/lib/prompts/anthropicText.js';

export const HYDROGEN = 'gemini-4-hydrogen';
export type ChatProvider = 'fal' | 'evolink' | 'openrouter';
export type ChatPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface ChatMessage { role: 'user' | 'assistant' | 'system'; content: string | ChatPart[] }
export interface TextChatInput { messages: ChatMessage[]; effort?: string; maxTokens?: number; responseFormat?: unknown; seed?: unknown; stop?: unknown }

export function chatContent(parts: unknown): ChatPart[] | null {
  if (!Array.isArray(parts) || !parts.length || parts.length > 256 || !parts.some(part => typeof part?.text === 'string' && part.text.trim())) return null;
  const content: ChatPart[] = [];
  for (const part of parts) {
    if (typeof part?.text === 'string' && !part.inlineData && !part.fileData) content.push({ type: 'text', text: part.text });
    else if (part?.text == null && !part?.fileData && ['image/jpeg', 'image/png', 'image/webp'].includes(part?.inlineData?.mimeType)
      && typeof part.inlineData.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(part.inlineData.data)) {
      content.push({ type: 'image_url', image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } });
    } else return null;
  }
  return content;
}

// EvoLink Responses and Gemini chat require downloadable reference URLs. Upload
// only to the selected vendor and never retry the subsequent paid model call.
export async function evoReferenceUrl(key: string, data: string, signal: AbortSignal): Promise<string> {
  const response = await fetch('https://files-api.evolink.ai/api/v1/files/upload/base64', {
    method: 'POST', redirect: 'error', signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64_data: data }),
  });
  const result = response.ok && await response.json();
  if (result?.success !== true || typeof result.data?.file_url !== 'string' || !result.data.file_url.startsWith('https://')) {
    throw new Error('EvoLink did not accept a reference image. No model request was submitted.');
  }
  return result.data.file_url;
}

export async function postTextChat(provider: ChatProvider, key: string, model: string, input: TextChatInput, signal: AbortSignal) {
  const evo = provider === 'evolink';
  const url = provider === 'fal' ? 'https://fal.run/openrouter/router/openai/v1/chat/completions'
    : evo ? 'https://direct.evolink.ai/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
  let messages = input.messages;
  if (evo) {
    if (model !== HYDROGEN) throw new Error('Only Hydrogen uses EvoLink chat completions.');
    messages = [];
    for (const message of input.messages) {
      if (typeof message.content === 'string') { messages.push(message); continue; }
      const content: ChatPart[] = [];
      for (const part of message.content) content.push(part.type === 'text' ? part : {
        type: 'image_url', image_url: { url: await evoReferenceUrl(key, part.image_url.url, signal) },
      });
      messages.push({ ...message, content });
    }
  }
  return fetch(url, { method: 'POST', redirect: 'error', signal,
    headers: { Authorization: `${provider === 'fal' ? 'Key' : 'Bearer'} ${key}`, 'Content-Type': 'application/json', ...(provider === 'openrouter' && { 'X-OpenRouter-Title': 'Banana Studio' }) },
    body: JSON.stringify({ model: evo ? model : OPENROUTER_MODELS[model], messages,
      ...(evo ? { reasoning_effort: input.effort } : { reasoning: { effort: input.effort, exclude: true }, provider: { require_parameters: true, allow_fallbacks: false } }),
      max_tokens: input.maxTokens, response_format: input.responseFormat, stop: input.stop, seed: input.seed }),
  });
}

export function postEvoOpus(key: string, system: string, content: ChatPart[], effort: string, schema: unknown, signal: AbortSignal) {
  return fetch('https://direct.evolink.ai/v1/messages', { method: 'POST', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: ANTHROPIC_MODELS[OPENROUTER_TEXT_MODEL], system, max_tokens: 32768, thinking: { type: 'adaptive' },
      output_config: { effort, ...(schema != null && { format: { type: 'json_schema', schema } }) },
      messages: [{ role: 'user', content: content.map(part => {
        if (part.type === 'text') return part;
        const [header, data] = part.image_url.url.split(',', 2);
        return { type: 'image', source: { type: 'base64', media_type: header.slice(5, -7), data } };
      }) }],
    }),
  });
}

export function vendorCost(usage: unknown): number | null {
  const cost = usage && typeof usage === 'object' && 'cost' in usage ? usage.cost : undefined;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
}

export function routedChatError(provider: string, status?: number) {
  if (status === 401 || status === 403) return `${provider}: check the provider credentials and model permissions.`;
  if (status === 402) return `${provider}: insufficient provider credit.`;
  if (status === 429 || status === 503) return `${provider}: the model is busy or rate-limited. No automatic retry was sent.`;
  return `${provider}: the model request did not complete. No automatic retry was sent.`;
}
