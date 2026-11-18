/** Fired after usage is recorded or a limit changes, so spending meters refresh. */
export const SPENDING_CHANGED_EVENT = 'banana:spending-changed';
export const SPENDING_CHANGED_DELAY_MS = 750;

let pending: ReturnType<typeof setTimeout> | undefined;
/** Trailing debounce: a batch of usage records refreshes the meters once. */
export const notifySpendingChanged = () => {
  if (typeof window === 'undefined') return;
  if (pending !== undefined) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = undefined;
    window.dispatchEvent(new Event(SPENDING_CHANGED_EVENT));
  }, SPENDING_CHANGED_DELAY_MS);
};
