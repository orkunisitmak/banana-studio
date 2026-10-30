/** Fired after usage is recorded or a limit changes, so spending meters refresh. */
export const SPENDING_CHANGED_EVENT = 'banana:spending-changed';
export const notifySpendingChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SPENDING_CHANGED_EVENT));
};
