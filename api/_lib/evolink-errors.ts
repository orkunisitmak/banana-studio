// EvoLink can wrap a useful model error inside a generic gateway error.
// Always return text (never an object which becomes "[object Object]").
const genericError = /^(?:internal[ _-](?:server[ _-])?error|task failed|generation failed|video generation failed|api[ _-]error|unknown error)$/i;

const errorText = (value: unknown, depth = 0, includeCodes = false): string[] => {
  if (depth > 6 || value == null) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(item => errorText(item, depth + 1, includeCodes));
  if (typeof value !== 'object') return [];
  const data = value as Record<string, unknown>;
  return ['detail', 'details', 'reason', 'error_message', 'failure_reason', 'fail_reason', 'error', 'message', 'description', 'msg', ...(includeCodes ? ['code'] : [])]
    .flatMap(key => errorText(data[key], depth + 1, includeCodes));
};

export const getEvoLinkErrorMessage = (data: unknown, fallback = 'Video generation failed'): string => {
  const value = data as any;
  // Root messages and status codes must not hide task-specific diagnostics.
  const details = data && typeof data === 'object' && !Array.isArray(data)
    ? { ...value, message: undefined, code: undefined }
    : data;
  const candidates = [
    ...errorText(value?.task_info),
    ...errorText(value?.status_message),
    ...(typeof data === 'object' && data !== null ? errorText(details) : []),
    ...errorText(value?.message),
    // Codes at every nesting depth are considered only after descriptive text.
    ...errorText(value?.task_info, 0, true),
    ...errorText(value?.status_message, 0, true),
    ...errorText(data, 0, true),
    ...(typeof data === 'string' ? errorText(data) : []),
  ];
  return candidates.find(message => !genericError.test(message)) || candidates[0] || fallback;
};

export const describeEvoLinkFailure = (
  data: unknown,
  context: string,
  taskId?: string,
): string => {
  const message = getEvoLinkErrorMessage(data);
  const detail = genericError.test(message)
    ? `The video provider returned an internal error without a specific reason. ${taskId ? 'Check the source video and contact support with this task ID if it persists.' : 'No task ID was received; check provider task history before retrying.'}`
    : message;
  return `${context}: ${detail}${taskId ? ` (Task: ${taskId})` : ''}`;
};
