export type NativeAction = 'keys' | 'lock';

/** Only these two commands cross the shell boundary. Provider credentials never do. */
export function postNativeAction(action: NativeAction): void {
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return;
  // WebKit shells: macOS WKWebView and Linux WebKitGTK expose the same handler.
  const webkit = window.webkit?.messageHandlers?.bananaNative;
  if (webkit) webkit.postMessage({ action });
  else window.chrome?.webview?.postMessage({ action });
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { bananaNative?: { postMessage(value: unknown): void } } };
    chrome?: { webview?: { postMessage(value: unknown): void } };
  }
}
