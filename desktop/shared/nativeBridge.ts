export type NativeAction = 'keys' | 'lock';

/** Only these two commands cross the shell boundary. Provider credentials never do. */
export function postNativeAction(action: NativeAction): void {
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return;
  const mac = window.webkit?.messageHandlers?.bananaNative;
  if (mac) mac.postMessage({ action });
  else if (window.bananaLinux) window.bananaLinux.postMessage({ action });
  else window.chrome?.webview?.postMessage({ action });
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { bananaNative?: { postMessage(value: unknown): void } } };
    chrome?: { webview?: { postMessage(value: unknown): void } };
    bananaLinux?: { postMessage(value: { action: NativeAction }): void };
  }
}
