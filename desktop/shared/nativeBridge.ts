export type NativeAction = 'keys' | 'lock';

/** Only these two commands cross the shell boundary. Provider credentials never do. */
export function postNativeAction(action: NativeAction): void {
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return;
  const mac = window.webkit?.messageHandlers?.bananaNative;
  if (mac) mac.postMessage({ action });
  else if (window.bananaLinux) window.bananaLinux.postAction(action);
  else window.chrome?.webview?.postMessage({ action });
}

declare global {
  interface Window {
    bananaLinux?: { postAction(action: NativeAction): void };
    webkit?: { messageHandlers?: { bananaNative?: { postMessage(value: unknown): void } } };
    chrome?: { webview?: { postMessage(value: unknown): void } };
  }
}
