/** Only the workspace owner/native vault controls destinations and credentials. */
export type LocalProviderConfig = { baseUrl: string; textModel: string; imageModel: string; apiKey: string };
const modelId = (value: string | undefined): string => {
  const model = value?.trim() || '';
  if (model.length > 200 || /[\s\p{Cc}]/u.test(model)) throw new Error('Invalid Local API model ID.');
  return model;
};
export function getLocalProviderConfig(env = process.env): LocalProviderConfig | null {
  const value = env.LOCAL_API_BASE_URL?.trim();
  if (!value || env.LOCAL_ENABLED === 'false') return null;
  if (value.length >= 4096 || !/^https?:\/\//i.test(value) || /[\s\\?#\p{Cc}]/u.test(value)) throw new Error('Enter a valid Local API base URL.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter a valid Local API base URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.port === '0' || url.username || url.password || value.split('://')[1]?.split('/')[0].includes('@') || url.search || url.hash) {
    throw new Error('Local API requires an HTTP(S) base URL without credentials, query or fragment.');
  }
  const apiKey = env.LOCAL_API_KEY?.trim() || '';
  if (apiKey.length >= 4096 || /[\r\n]/.test(apiKey)) throw new Error('Invalid Local API key.');
  return { baseUrl: url.href.replace(/\/+$/, ''), textModel: modelId(env.LOCAL_TEXT_MODEL), imageModel: modelId(env.LOCAL_IMAGE_MODEL), apiKey };
}
export function localProviderSettings() {
  try {
    const config = getLocalProviderConfig();
    return config ? { baseUrl: config.baseUrl, textModel: config.textModel, imageModel: config.imageModel } : null;
  } catch { return null; }
}
export const localProviderError = (status?: number): string => status === 401 || status === 403
  ? 'Local API authentication failed. Check the key in Provider keys or LOCAL_API_KEY.'
  : status === 404 ? 'Local API endpoint or model was not found. Check the base URL and model ID.'
  : status === 429 ? 'Local API request limit reached. Check provider usage before submitting again.'
  : status === 400 || status === 422 ? 'Local API rejected the request. Check model support for the prompt, references and image settings.'
  : 'Local API could not finish the request. Check the server connection and provider usage before submitting again.';
