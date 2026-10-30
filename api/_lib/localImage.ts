import { getLocalProviderConfig, localProviderError, type LocalProviderConfig } from './localProvider.js';
import { providerImageData } from './providerMedia.js';

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 72 * 1024 * 1024;

async function readLimited(response: Response, limit: number): Promise<string> {
  if (!response.body || Number(response.headers.get('content-length')) > limit) throw new Error('Invalid Local API response size.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.length;
      if (bytes > limit) throw new Error('Local API response exceeds the output limit.');
      text += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); }
}

/** Some compatible gateways return SSE even when a JSON result was requested.
 * Only a final image is accepted; a disconnected partial image is never saved. */
export async function readLocalImageResponse(response: Response): Promise<any> {
  const text = await readLimited(response, MAX_RESPONSE_BYTES);
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return JSON.parse(text);
  let result: any;
  for (const block of text.replace(/\r\n/g, '\n').split('\n\n')) {
    const payload = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!payload || payload.trim() === '[DONE]') continue;
    const event = JSON.parse(payload);
    const type = event.type || block.match(/^event:\s*(.+)$/m)?.[1]?.trim() || '';
    if (event.error || type === 'error' || type.endsWith('.failed')) throw new Error(localProviderError());
    if (type.includes('partial') || type.includes('progress')) continue;
    if (Array.isArray(event.data)) result = event;
    else if (type.endsWith('.completed') && (event.b64_json || event.url)) result = { ...event, data: [{ b64_json: event.b64_json, url: event.url, media_type: event.media_type }] };
  }
  if (!result) throw new Error('Local API closed before returning a completed image.');
  return result;
}

export async function requestLocalImage(input: Record<string, any>, db: any, signal: AbortSignal, auditId: string, capturedConfig?: LocalProviderConfig): Promise<Response> {
  const config = capturedConfig || getLocalProviderConfig();
  if (!config?.imageModel) throw new Error('Configure the Local API base URL and image model in Provider keys.');
  const images = await Promise.all((input.images || []).map(async (image: any) => ({ image_url: await providerImageData(db, image.image_url) })));
  const body = { model: config.imageModel, prompt: input.prompt, n: 1, size: input.size,
    quality: input.quality, background: input.background, output_format: input.output_format,
    ...(images.length ? { images } : {}) };
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Client-Request-Id': auditId };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const response = await fetch(`${config.baseUrl}/images/${images.length ? 'edits' : 'generations'}`, {
    method: 'POST', redirect: 'error', signal, headers, body: JSON.stringify(body),
  });
  // Upstream error text is never included in a browser response or persisted.
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return Response.json({ error: { message: localProviderError(response.status) } }, { status: response.status });
  }
  const data = await readLocalImageResponse(response);
  const image = data?.data?.[0];
  let b64 = image?.b64_json;
  if (!b64 && typeof image?.url === 'string') {
    const inline = image.url.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (inline) { b64 = inline[2]; image.media_type = `image/${inline[1]}`; }
    else {
      const url = new URL(image.url, config.baseUrl + '/');
      // Credentials go only to the configured provider. Returned URLs cannot
      // turn the server into a downloader for arbitrary private-network hosts.
      if (url.origin !== new URL(config.baseUrl).origin || url.username || url.password || url.hash) throw new Error('Local API must return base64 images or an image URL on its own origin.');
      const file = await fetch(url, { headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}, redirect: 'error', signal });
      const mime = file.headers.get('content-type')?.split(';')[0];
      if (!file.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(mime || '')) throw new Error('Local API image download failed.');
      if (!file.body || Number(file.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Local API image exceeds the output limit.');
      const chunks: Uint8Array[] = [], reader = file.body.getReader();
      let bytes = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > MAX_IMAGE_BYTES) throw new Error('Local API image exceeds the output limit.');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      b64 = Buffer.concat(chunks).toString('base64'); image.media_type = mime;
    }
  }
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || Buffer.byteLength(b64, 'base64') > MAX_IMAGE_BYTES) throw new Error('Local API returned no valid completed image.');
  return Response.json({ data: [{ b64_json: b64, media_type: image?.media_type }], usage: data.usage, size: data.size, output_format: data.output_format || input.output_format }, {
    headers: { 'x-request-id': response.headers.get('x-request-id') || '' },
  });
}
