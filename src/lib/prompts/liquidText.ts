// Server-safe definitions for Liquid Inference (https://inference.ai.exchange).
// OpenAI-compatible chat completions; model ids verified against
// GET https://router.inference.ai.exchange/v1/models on 2026-11-02.
export const LIQUID_CHAT_ENDPOINT = 'https://router.inference.ai.exchange/v1/chat/completions';

/** The exchange reports the actual charge in `exchange.charge.total_usd`
 * (there is no OpenRouter-style `usage.cost`). */
export const calculateLiquidTextCost = (usage: any): number | null => {
  const value = usage?.charge?.total_usd ?? usage?.total_usd;
  const cost = typeof value === 'string' ? Number(value) : value;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
};

export const liquidErrorMessage = (status?: number): string => {
  if (status === 401 || status === 403) return 'Check the Liquid Inference API key and model access.';
  if (status === 402) return 'Liquid Inference balance is too low. Top up the workspace and try again.';
  if (status === 404) return 'Liquid Inference does not list this model right now. Choose another provider in AI settings.';
  if (status === 429 || status === 503) return 'Liquid Inference is busy or the request limit was reached. Try again shortly.';
  if (status === 400 || status === 422) return 'Liquid Inference could not accept this request. Check the prompt and references.';
  return 'The Liquid Inference request could not be completed. Check recorded usage before trying again.';
};
