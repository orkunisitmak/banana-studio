import { buildBrainstormOutputFormat, brainstormOutputInstruction, isBrainstormCount } from './textOutputFormats.js';

export const ANTHROPIC_MODEL = 'claude-opus-5-5';
const ACTIONS = ['enhance', 'video_enhance', 'brainstorm', 'variation'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export function buildAnthropicMessage(body: any) {
  if (body?.model !== 'anthropic/claude-opus-5.5') throw new Error('Unsupported text model.');
  const context = body.usageContext;
  if (!ACTIONS.includes(context?.action) || typeof context.prompt !== 'string') throw new Error('Invalid text feature.');
  const effort = body.reasoningEffort ?? 'medium';
  if (!EFFORTS.includes(effort as typeof EFFORTS[number])) throw new Error('Unsupported Anthropic thinking effort. Select Low, Medium, High, Extra high or Max.');
  if (body.brainstormFormat != null && (body.brainstormFormat !== 'wardrobe' || context.action !== 'brainstorm')) throw new Error('Invalid Brainstorm output format.');
  if (body.brainstormCount != null && (context.action !== 'brainstorm' || !isBrainstormCount(body.brainstormCount))) throw new Error('Invalid Brainstorm idea count.');
  if (body.outputFormat != null) throw new Error('YouTube footage analysis requires Gemini.');
  const parts = body.contents?.parts;
  if (!Array.isArray(parts) || !parts.length || parts.length > 256 || !parts.some((p: any) => typeof p?.text === 'string' && p.text.trim())) throw new Error('Provide text and optional image references.');
  if (Buffer.byteLength(JSON.stringify(parts), 'utf8') > 4_100_000) throw new Error('Reference images are too large. Use fewer or smaller images.');
  const content = parts.map((part: any) => {
    if (typeof part?.text === 'string' && !part.inlineData && !part.fileData) return { type: 'text', text: part.text };
    if (part?.text == null && !part.fileData && ['image/jpeg', 'image/png', 'image/webp'].includes(part?.inlineData?.mimeType)
      && typeof part.inlineData.data === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(part.inlineData.data)
      && part.inlineData.data.length > 0)
      return { type: 'image', source: { type: 'base64', media_type: part.inlineData.mimeType, data: part.inlineData.data } };
    throw new Error('This model accepts text and image references. YouTube footage requires Gemini.');
  });
  const wardrobe = body.brainstormFormat === 'wardrobe';
  const format = context.action === 'brainstorm' ? buildBrainstormOutputFormat(wardrobe, body.brainstormCount) : undefined;
  return { model: ANTHROPIC_MODEL, max_tokens: 32768,
    system: 'Complete the requested prompt-writing task using the supplied brief and references. Make reasonable creative decisions without follow-up questions. Return only the finished deliverable.' + (format ? brainstormOutputInstruction(wardrobe, body.brainstormCount) : ''),
    messages: [{ role: 'user', content }],
    output_config: { effort, ...(format ? { format: { type: 'json_schema', schema: format.schema } } : {}) },
  };
}

export function readAnthropicMessage(data: any): string {
  if (data?.stop_reason !== 'end_turn') throw new Error('Model response did not finish.');
  const text = data.content?.filter((block: any) => block.type === 'text' && typeof block.text === 'string').map((block: any) => block.text).join('') || '';
  if (!text.trim()) throw new Error('Model returned no text.');
  return text;
}

// Opus 5.5 base rates: $4 input / $20 output per MTok; cached reads 0.05x,
// 5-minute writes 1.25x and 1-hour writes 2x. No estimate for malformed usage.
export function calculateAnthropicCost(usage: any): number | null {
  const values = [usage?.input_tokens, usage?.output_tokens, usage?.cache_read_input_tokens ?? 0, usage?.cache_creation_input_tokens ?? 0];
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) return null;
  const [input, output, read, write] = values;
  const oneHour = usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  if (typeof oneHour !== 'number' || !Number.isFinite(oneHour) || oneHour < 0 || oneHour > write) return null;
  return (input * 4 + read * 0.2 + (write - oneHour) * 5 + oneHour * 8 + output * 20) / 1_000_000;
}
