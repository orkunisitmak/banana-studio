/** A caller may retry only when the server explicitly confirms no paid dispatch. */
export const isUncertainVideoSubmissionFailure = (status: number, body: unknown): boolean => {
  const result = body && typeof body === 'object' ? body as {
    dispatched?: unknown; code?: unknown;
  } : null;
  if (status === 401 || status === 403 || result?.dispatched === false) return false;
  return status >= 500 || !result || (status === 409 && result.code === 'GENERATION_SUBMITTING');
};
