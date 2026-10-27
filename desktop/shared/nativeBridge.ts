export type NativeAction = 'keys' | 'lock';

const nativeTarget = () => {
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return undefined;
  const mac = window.webkit?.messageHandlers?.bananaNative;
  return mac ? (value: unknown) => mac.postMessage(value) : window.chrome?.webview ? (value: unknown) => window.chrome!.webview!.postMessage(value) : undefined;
};

/** Only these commands cross the shell boundary. Provider credentials never do. */
export function postNativeAction(action: NativeAction): void {
  nativeTarget()?.({ action });
}

/** Asks the Mac shell for a system notification; the shell shows it only while the app is in the background. */
export function postNativeNotification(title: string, body: string): void {
  nativeTarget()?.({ action: 'notify', title: title.slice(0, 120), body: body.slice(0, 240) });
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { bananaNative?: { postMessage(value: unknown): void } } };
    chrome?: { webview?: { postMessage(value: unknown): void } };
  }
}
