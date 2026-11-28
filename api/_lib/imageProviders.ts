import { GoogleGenAI } from '@google/genai';
import { OPENROUTER_MODELS, type AIProvider } from '../../src/lib/providers.js';
import { providerImageData } from './providerMedia.js';
import { requestCodexImage } from './codexImage.js';
import { isOpenAIImageModel } from '../../src/lib/images/openaiImage.js';
import { buildNanoBananaRequest, NANO_BANANA_21_MODEL, NANO_BANANA_PRO_MODEL, NANO_BANANA_21_ENDPOINT, NANO_BANANA_PRO_ENDPOINT } from '../../src/lib/images/nanoBanana21.js';
import { falGptImageEndpoint, falGptImageInput } from './falGptImage.js';

export const imageProviderModel = (provider: AIProvider, model: string, references: boolean): string => {
  if (provider === 'codex') return 'codex/image_gen';
  if (provider === 'openrouter') return OPENROUTER_MODELS[model];
  if (provider !== 'fal') return model;
  if (isOpenAIImageModel(model)) return falGptImageEndpoint(model,references);
  const endpoint = model === NANO_BANANA_21_MODEL ? NANO_BANANA_21_ENDPOINT : model === NANO_BANANA_PRO_MODEL ? NANO_BANANA_PRO_ENDPOINT : null;
  if (!endpoint) throw new Error('Unsupported fal image model.');
  return endpoint + (references ? '/edit' : '');
};

/** All destinations and fields are server-owned. One paid request, no provider retry. */
export async function requestImage(provider: AIProvider, model: string, input: Record<string, any>, db: any, key: string, auditId: string): Promise<Response> {
  const signal = AbortSignal.timeout(250_000);
  const { resolution, aspect_ratio, ...openaiInput } = input;
  if (provider === 'codex' && model === 'gpt-image-2.5-sunburst') return requestCodexImage(input, url => providerImageData(db, url), signal);
  if (provider === 'openai') return fetch(`https://api.openai.com/v1/images/${input.images?.length ? 'edits' : 'generations'}`, {
    method: 'POST', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': auditId }, body: JSON.stringify(openaiInput),
  });
  if (provider === 'openrouter') {
    const sunburst = model === 'gpt-image-2.5-sunburst';
    const endpoint = sunburst ? 'openai' : model === 'gemini-3-pro-image-preview' ? 'google-ai-studio/global' : 'google-ai-studio';
    const body = { model: OPENROUTER_MODELS[model], prompt: input.prompt, n: 1,
      ...(sunburst ? { size: input.size, quality: input.quality, background: input.background, output_format: input.output_format }
        : { resolution: input.resolution, aspect_ratio: input.aspect_ratio, output_format: 'png' }),
      ...(input.images?.length ? { input_references: input.images.map((image: any) => ({ type: 'image_url', image_url: { url: image.image_url } })) } : {}),
      provider: { only: [endpoint], allow_fallbacks: false, ...(sunburst ? { options: { openai: { moderation: input.moderation } } } : {}) },
    };
    return fetch('https://openrouter.ai/api/v1/images', { method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'Banana Studio' }, body: JSON.stringify(body) });
  }
  if (provider === 'fal') {
    const images = input.images || [];
    const body = isOpenAIImageModel(model)
      ? falGptImageInput(model,input.prompt,input.size,{ ...input, outputFormat: input.output_format, gifFrameCount: input.frame_count, gifFrameDurationMs: input.frame_duration_ms, complexity: input.complexity } as import('../../src/types.js').OpenAIImageOptions,images,input.markup?.image_url)
      : { ...buildNanoBananaRequest(model,input.prompt,{aspectRatio:input.aspect_ratio,resolution:input.resolution},images.map((image: {image_url:string}) => image.image_url)).input, sync_mode:true };
    const endpoint = imageProviderModel(provider, model, !!input.images?.length);
    const response = await fetch(`https://fal.run/${endpoint}`, {
      method: 'POST', redirect: 'error', signal, headers: { Authorization: 'Key ' + key, 'Content-Type': 'application/json', 'X-Fal-No-Retry':'1' }, body: JSON.stringify(body),
    });
    if (!response.ok) return response;
    const value = await response.json();
    const image = value?.images?.[0];
    let bytes: Buffer;
    const mime = input.output_format === 'svg' ? 'image/svg+xml' : 'image/' + input.output_format;
    const prefix = 'data:' + mime + ';base64,';
    if (typeof image?.url === 'string' && image.url.startsWith(prefix) && image.url.length <= prefix.length + 4*Math.ceil(50*1024*1024/3)) bytes = Buffer.from(image.url.slice(prefix.length), 'base64');
    else {
      const url = new URL(image?.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media'))) throw new Error('fal.ai returned an unsupported image location.');
      const file = await fetch(url, { redirect: 'error', signal });
      if (!file.ok || !file.body || Number(file.headers.get('content-length')) > 50 * 1024 * 1024) throw new Error('Generated image download failed.');
      const reader = file.body.getReader(), chunks: Uint8Array[] = [];
      let total = 0;
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 50*1024*1024) throw new Error('Generated image exceeds the output limit.'); chunks.push(value); } }
      finally { await reader.cancel(); }
      bytes = Buffer.concat(chunks,total);
    }
    if (bytes.length > 50 * 1024 * 1024) throw new Error('Generated image exceeds the output limit.');
    return Response.json({ data: [{ b64_json: bytes.toString('base64') }], output_format: input.output_format }, { headers: { 'x-request-id': response.headers.get('x-fal-request-id') || response.headers.get('x-request-id') || value?.request_id || '' } });
  }
  if (provider === 'gemini' && model.startsWith('gemini-')) {
    const parts: any[] = [];
    for (const image of input.images || []) {
      const data = await providerImageData(db, image.image_url);
      const match = data.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
      if (!match) throw new Error('This reference could not be prepared for Gemini.');
      parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }
    parts.push({ text: input.prompt });
    const result = await new GoogleGenAI({ apiKey: key }).models.generateContent({ model, contents: { parts },
      config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: input.aspect_ratio, imageSize: input.resolution },
        abortSignal: signal, httpOptions: { timeout: 250_000 } } });
    const output = result.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)?.inlineData;
    return Response.json({ data: output?.data ? [{ b64_json: output.data, media_type: output.mimeType }] : [], usage: result.usageMetadata, output_format: output?.mimeType?.split('/')[1] || 'png' });
  }
  throw new Error('Unsupported image provider route.');
}
