export type NativeAction = 'keys' | 'lock';
/** Vault account names the shell may prompt for. The value is typed into a native field, never into the page. */
export const NATIVE_KEY_ACCOUNTS = ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'FAL_KEY', 'EVOLINK_API_KEY', 'YOUTUBE_API_KEY'] as const;
export type NativeKeyAccount = typeof NATIVE_KEY_ACCOUNTS[number];
/** Dispatched by the shell after a key is saved or removed, so the page can refresh provider status. */
export const NATIVE_KEYS_CHANGED = 'banana-native-keys-changed';

/** Only these commands cross the shell boundary. Provider credentials never do:
 * `account` names which native prompt to open, and carries no key value. */
export function postNativeAction(action: NativeAction, account?: NativeKeyAccount): void {
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return;
  if (account !== undefined && (action !== 'keys' || !NATIVE_KEY_ACCOUNTS.includes(account))) return;
  const message = account ? { action, account } : { action };
  const mac = window.webkit?.messageHandlers?.bananaNative;
  if (mac) mac.postMessage(message);
  else window.chrome?.webview?.postMessage(message);
}
export const hasNativeShell = (): boolean => !!(window.webkit?.messageHandlers?.bananaNative || window.chrome?.webview);

declare global {
  interface Window {
    webkit?: { messageHandlers?: { bananaNative?: { postMessage(value: unknown): void } } };
    chrome?: { webview?: { postMessage(value: unknown): void } };
  }
}
