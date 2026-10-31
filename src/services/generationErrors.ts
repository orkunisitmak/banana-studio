export interface GenerationErrorMessage {
  title: string;
  message: string;
}

// Read only diagnostic fields, never serialize an entire request/response:
// those objects can contain credentials or unrelated user data.
const collectErrorDetails = (value: unknown, seen = new Set<object>(), depth = 0): string[] => {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap(item => collectErrorDetails(item, seen, depth + 1));
  const error = value as Record<string, unknown>;
  const details = ['message', 'detail', 'details', 'error_message', 'error_description', 'failure_reason', 'fail_reason', 'reason', 'error', 'cause', 'code']
    .flatMap(key => collectErrorDetails(error[key], seen, depth + 1));
  const response = error.response as { data?: unknown } | undefined;
  details.push(...collectErrorDetails(response?.data, seen, depth + 1));
  if (typeof error.model === 'string' && error.model.trim()) details.push(`Model: ${error.model.trim()}`);
  const taskId = error.taskId ?? error.task_id;
  if (typeof taskId === 'string' && taskId.trim()) details.push(`Task: ${taskId.trim()}`);
  return details;
};

const collectHttpStatuses = (value: unknown, seen = new Set<object>(), depth = 0): number[] => {
  if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return [];
  seen.add(value);
  const error = value as Record<string, unknown>;
  const statuses = ['status', 'statusCode', 'httpStatus', 'httpStatusCode']
    .map(key => error[key])
    .filter(value => typeof value === 'number' || (typeof value === 'string' && /^\d{3}$/.test(value)))
    .map(Number)
    .filter(status => Number.isInteger(status) && status >= 400 && status <= 599);
  return statuses.concat(...['response', 'error', 'cause'].map(key => collectHttpStatuses(error[key], seen, depth + 1)));
};

export const parseErrorMessage = (error: unknown): GenerationErrorMessage => {
  const statuses = new Set(collectHttpStatuses(error));
  const details = [...new Set(collectErrorDetails(error))];
  const message = details.join('\n') || (statuses.size > 0
    ? `Request failed with HTTP ${[...statuses][0]}.`
    : 'Unknown error');

  // A UUID, model name, duration, or task ID containing 429/401/403 is not an
  // HTTP failure. Require a status label or an HTTP reason phrase in text.
  const statusPattern = /\b(?:http(?:\/\d(?:\.\d)?)?(?:\s+(?:error|status)(?:\s+code)?)?|status(?:\s+code)?|response(?:\s+(?:status|code))?)[\s:=(]+([45]\d{2})\b/gi;
  for (const match of message.matchAll(statusPattern)) statuses.add(Number(match[1]));
  for (const match of message.matchAll(/\b(429)\s+Too Many Requests\b|\b(401)\s+Unauthorized\b|\b(403)\s+Forbidden\b/gi)) {
    statuses.add(Number(match[1] || match[2] || match[3]));
  }

  const describe = (title: string, summary: string): GenerationErrorMessage => ({
    title,
    // Keep the complete provider cause, model, and task ID for both the toast
    // and persisted failure metadata. The renderer can limit visual height.
    message: message === summary ? message : `${summary}\n\n${message}`,
  });
  const lower = message.toLowerCase();
  const isStorageError = (error as { name?: string } | null)?.name === 'QuotaExceededError'
    || /\bstorage\b|\b(?:indexeddb|localstorage|sessionstorage|quotaexceedederror)\b|\bdisk (?:space|full)\b/.test(lower);
  // Checked before rate limits: the workspace's own budget, not a provider quota.
  if (/\bSPENDING_LIMIT\b|\bmonthly spending limit\b/i.test(message)) {
    return { title: 'Spending Limit Reached', message: details.find(detail => /monthly spending limit/i.test(detail)) || message };
  }
  if (statuses.has(429) || (!isStorageError && /\brate[ _-]?limit|\bquota\b/.test(lower))) {
    return describe('Rate Limit Reached', 'Too many requests or insufficient quota. Please check the provider details before retrying.');
  }
  if (/\bsafety\b|\bcontent[ _-]?(?:filter|policy)|\b(?:prompt|content|request) (?:was |is )?blocked\b/.test(lower)) {
    return describe('Content Blocked', 'Your prompt was blocked by safety filters. Try modifying your request.');
  }
  if (/\bmodel refusal\b/i.test(message)) {
    return { title: 'Generation Refused', message: message.replace(/^Model Refusal:\s*/i, '').trim() };
  }
  if (statuses.has(401) || statuses.has(403) || /\bapi[ _-]?key\b/.test(lower)) {
    return describe('Authentication Error', 'Authentication or permission was denied. Check your session and API settings.');
  }
  if (isStorageError) {
    return describe('Storage Error', 'Failed to save data. Your storage might be full or unavailable.');
  }
  if (/input media is invalid|reference[ _-](?:media|video|audio)|unsupported file|file type/.test(lower)) {
    return { title: 'Invalid Reference Media', message };
  }
  if (/\bnetwork(?:error| error)\b|\b(?:failed to fetch|fetch failed|failed to connect)\b|\b(?:econnreset|econnrefused|enotfound|cors)\b/.test(lower)) {
    return describe('Network Error', 'Could not connect to the server. Check your internet connection.');
  }
  if (/\bblocked\b/.test(lower)) {
    return describe('Content Blocked', 'Your prompt was blocked by safety filters. Try modifying your request.');
  }
  return { title: 'Generation Failed', message };
};
