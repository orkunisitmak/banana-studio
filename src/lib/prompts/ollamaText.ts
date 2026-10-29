// Server-safe definitions for local text models served by Ollama.
// https://docs.ollama.com/api/chat
import { LOCAL_SERVERS, localServerUrl } from '../localModels.js';

export const OLLAMA_TEXT_MODEL = 'ollama/local' as const;
export const OLLAMA_DEFAULT_URL = LOCAL_SERVERS.ollama.defaultUrl;
export const OLLAMA_DEFAULT_CONTEXT = 16384;
/** The installed model is a device choice: Ollama runs next to the workspace, not in the account. */
export const OLLAMA_MODEL_STORAGE_KEY = 'banana-ollama-model';

export const isOllamaModelName = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value);

/** Desktop defaults to the local daemon; hosted installs opt in with OLLAMA_BASE_URL. */
export const ollamaBaseUrl = (env: Record<string, string | undefined>): string | null => localServerUrl('ollama', env);

export const ollamaContextSize = (value: unknown): number => {
  const size = Number(value);
  return Number.isSafeInteger(size) && size >= 2048 && size <= 262144 ? size : OLLAMA_DEFAULT_CONTEXT;
};

/** Inline local `#/$defs/x` references; small local grammars handle a flat schema more reliably. */
export const inlineSchemaRefs = (schema: any): any => {
  const defs = schema?.$defs || {};
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const ref = typeof node.$ref === 'string' && node.$ref.match(/^#\/\$defs\/([\w-]+)$/);
    if (ref && defs[ref[1]]) return walk(defs[ref[1]]);
    return Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$defs').map(([key, value]) => [key, walk(value)]));
  };
  return walk(schema);
};

type ChatPart = { text?: string; inlineData?: { data: string } };
/** Ollama's native chat takes one text body plus base64 images per message. */
export const buildOllamaChat = (input: { model: string; system: string; parts: ChatPart[]; schema?: unknown; numCtx: number }) => {
  const text = input.parts.flatMap(part => typeof part.text === 'string' ? [part.text] : []).join('\n\n');
  const images = input.parts.flatMap(part => typeof part.inlineData?.data === 'string' ? [part.inlineData.data] : []);
  return {
    model: input.model, stream: false,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: text, ...(images.length ? { images } : {}) }],
    ...(input.schema ? { format: inlineSchemaRefs(input.schema) } : {}),
    options: { num_ctx: input.numCtx },
  };
};

/** OpenAI-compatible servers (LM Studio, llama.cpp, vLLM) take content parts and json_schema output. */
export const buildOpenAICompatibleChat = (input: { model: string; system: string; parts: ChatPart[]; schema?: unknown }, name = 'result') => {
  const content = input.parts.map(part => typeof part.text === 'string' ? { type: 'text', text: part.text }
    : { type: 'image_url', image_url: { url: `data:${(part.inlineData as any)?.mimeType || 'image/png'};base64,${part.inlineData?.data}` } });
  return {
    model: input.model, stream: false,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content }],
    ...(input.schema ? { response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: inlineSchemaRefs(input.schema) } } } : {}),
  };
};

/** Only an explicit "no image support" error means the model lacks vision; "image too large" does not. */
export const isVisionUnsupported = (detail?: string): boolean => !!detail && (
  /(?:does ?n[o']t|do ?n[o']t|not|cannot|can't|unable to)\s+(?:support|accept|process|handle)\w*\s+(?:\w+\s+){0,2}(?:images?|vision|multimodal|image input)/i.test(detail)
  || /(?:images?|vision|multimodal|image input)\s+(?:input\s+)?(?:is\s+|are\s+)?(?:not supported|unsupported)/i.test(detail)
  || /missing data required for image input|not a (?:vision|multimodal) model/i.test(detail));

/** OpenAI-compatible servers (LM Studio, llama.cpp, vLLM) get their own guidance, not Ollama commands. */
export const openAICompatibleErrorMessage = (status?: number, detail?: string): string => {
  if (status === 404) return 'The model was not found on the local OpenAI-compatible server. Load it in LM Studio (or your server) and choose it in AI settings.';
  if (isVisionUnsupported(detail)) return 'The selected local model does not support image references. Choose a vision model (for example gemma3 or qwen2.5vl).';
  if (status === 400) return 'The local server rejected this request. Check the model and prompt length.';
  return 'The local OpenAI-compatible server could not finish the request. Check that it is running and LOCAL_OPENAI_BASE_URL is correct.';
};

export const ollamaErrorMessage = (status?: number, detail?: string): string => {
  if (status === 404) return 'The Ollama model was not found. Download it with `ollama pull <model>` and choose it in AI settings.';
  if (isVisionUnsupported(detail)) return 'The selected local model does not support image references. Choose a vision model (for example gemma3 or qwen2.5vl).';
  if (status === 400) return 'Ollama rejected this request. Check the model and prompt length.';
  return 'Ollama could not be reached. Check that it is running (`ollama serve`) and the address is correct.';
};
