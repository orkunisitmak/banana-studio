import React, { Component, Suspense, useEffect, useRef, type ReactNode } from 'react';

interface Props { label: string; onClose: () => void; inline?: boolean; children: ReactNode }
const FeatureFallback = ({ label, inline, onClose, failed = false }: Omit<Props, 'children'> & { failed?: boolean }) => {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (inline) return;
    const previous = document.activeElement as HTMLElement | null;
    const container = ref.current;
    container?.querySelector('button')?.focus();
    return () => {
      // Loaded dialogs may already have focused their own controls.
      if (container?.contains(document.activeElement) || document.activeElement === document.body) previous?.focus();
    };
  }, [inline]);
  const message = <div className="space-y-3 rounded-2xl bg-[#161b22] p-5 text-sm text-gray-200">
    <p role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>{failed
      ? `${label} could not be loaded. Reload the app to try again.` : `Loading ${label}…`}</p>
    {failed && <button type="button" className="mr-2 rounded border border-white/20 px-3 py-2" onClick={() => window.location.reload()}>Reload app</button>}
    {!inline && <button type="button" className="rounded border border-white/20 px-3 py-2" onClick={() => closeRef.current()}>{failed ? 'Close' : 'Cancel'}</button>}
  </div>;
  if (inline) return message;
  return <div ref={ref} role="dialog" aria-modal="true" aria-label={label}
    className="fixed inset-0 z-[1000] grid place-items-center bg-black/75 p-4"
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(ref.current?.querySelectorAll('button') || []);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>{message}</div>;
};

class FeatureErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <FeatureFallback {...this.props} failed /> : this.props.children;
  }
}

/** Chunk loading and failure keep the feature's dialog or inline semantics. */
export const LazyFeature = (props: Props) => <FeatureErrorBoundary {...props}>
  <Suspense fallback={<FeatureFallback {...props} />}>{props.children}</Suspense>
</FeatureErrorBoundary>;
