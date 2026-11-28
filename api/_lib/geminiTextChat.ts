import { buildBrainstormOutputFormat, brainstormOutputInstruction, normalizeBrainstormOutput } from './textOutputFormats.js';
import { chatContent, HYDROGEN, postTextChat, routedChatError, vendorCost, type ChatMessage, type ChatProvider, type TextChatInput } from './textRouting.js';
import { openRouterErrorMessage } from '../../src/lib/prompts/openrouterText.js';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const chatConfigKeys = ['thinkingConfig', 'responseModalities', 'systemInstruction', 'responseMimeType', 'responseSchema', 'responseJsonSchema', 'maxOutputTokens', 'seed', 'stopSequences'];

function jsonSchema(schema: unknown): unknown {
  if (!record(schema)) return schema;
  const { propertyOrdering: _order, type, properties, items, ...rest } = schema;
  return { ...rest, ...(typeof type === 'string' && { type: type.toLowerCase() }),
    ...(record(properties) && { properties: Object.fromEntries(Object.entries(properties).map(([name, child]) => [name, jsonSchema(child)])) }),
    ...(items != null && { items: jsonSchema(items) }) };
}

export function buildGeminiChat(contents: unknown, config: Record<string, unknown>, brainstorm: boolean, wardrobe: boolean, count?: number): TextChatInput {
  if (Object.keys(config).some(key => !chatConfigKeys.includes(key))) throw new Error('This configuration requires native Gemini.');
  const messages: ChatMessage[] = [];
  const instruction = config.systemInstruction;
  if (typeof instruction === 'string') messages.push({ role: 'system', content: instruction });
  else if (instruction !== undefined) {
    if (!record(instruction) || !Array.isArray(instruction.parts) || !instruction.parts.every(part => typeof part?.text === 'string')) throw new Error('Invalid system instruction.');
    messages.push({ role: 'system', content: instruction.parts.map(part => part.text).join('\n') });
  }
  if (brainstorm) messages.push({ role: 'system', content: brainstormOutputInstruction(wardrobe, count) });
  for (const item of Array.isArray(contents) ? contents : [contents]) {
    if (typeof item === 'string' && item.trim()) { messages.push({ role: 'user', content: item }); continue; }
    if (!record(item) || (item.role != null && item.role !== 'user' && item.role !== 'model')) throw new Error('Invalid Gemini message.');
    const content = chatContent(item.parts);
    if (!content) throw new Error('This text route accepts text and JPEG, PNG or WebP image references.');
    messages.push({ role: item.role === 'model' ? 'assistant' : 'user', content });
  }
  if (!messages.some(message => message.role === 'user')) throw new Error('A user message is required.');
  if (config.responseMimeType != null && !['application/json', 'text/plain'].includes(String(config.responseMimeType))) throw new Error('Unsupported response MIME type.');
  const schema = config.responseJsonSchema ?? jsonSchema(config.responseSchema);
  const format = brainstorm ? buildBrainstormOutputFormat(wardrobe, count) : undefined;
  return { messages, effort: record(config.thinkingConfig) && typeof config.thinkingConfig.thinkingLevel === 'string' ? config.thinkingConfig.thinkingLevel.toLowerCase() : undefined,
    maxTokens: typeof config.maxOutputTokens === 'number' ? config.maxOutputTokens : undefined, seed: config.seed, stop: config.stopSequences,
    responseFormat: format ? { type: 'json_schema', json_schema: { name: format.name, strict: true, schema: format.schema } }
      : schema ? { type: 'json_schema', json_schema: { name: 'gemini_result', schema } } : config.responseMimeType === 'application/json' ? { type: 'json_object' } : undefined };
}

export async function generateGeminiChat(provider: ChatProvider, key: string, input: TextChatInput, signal: AbortSignal, brainstorm: boolean, wardrobe: boolean, count?: number) {
  const response = await postTextChat(provider, key, HYDROGEN, input, signal);
  if (!response.ok) throw Object.assign(new Error(provider === 'openrouter' ? openRouterErrorMessage(response.status) : routedChatError(provider, response.status)), { status: response.status });
  const data = await response.json();
  const choice = data?.choices?.[0];
  if (choice?.finish_reason !== 'stop' || choice.message?.refusal || choice.message?.role !== 'assistant' || typeof choice.message.content !== 'string' || !choice.message.content.trim()) {
    throw Object.assign(new Error('The selected text model did not return a completed answer.'), { status: 502 });
  }
  const text = brainstorm ? normalizeBrainstormOutput(choice.message.content, wardrobe, count) : choice.message.content;
  if (!text) throw Object.assign(new Error('The selected text model returned an invalid brainstorm result.'), { status: 502 });
  return { text, candidates: null, usageMetadata: { textProvider: provider, providerCost: vendorCost(data.usage), openrouterUsage: provider === 'openrouter' ? data.usage : undefined,
    promptTokenCount: data.usage?.prompt_tokens, candidatesTokenCount: data.usage?.completion_tokens, totalTokenCount: data.usage?.total_tokens, thoughtsTokenCount: undefined } };
}
