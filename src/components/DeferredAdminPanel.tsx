import React, { Component, lazy, Suspense, useEffect, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import type { AdminPanel } from './AdminPanel';

type Props = ComponentProps<typeof AdminPanel>;
const loadPanel = () => lazy(() => import('./AdminPanel').then(module => ({ default: module.AdminPanel })));

class PanelLoadBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  declare props: { children: ReactNode; fallback: ReactNode };
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Load on first use; preserve the mounted panel's filters and tab on reopen. */
export function DeferredAdminPanel(props: Props) {
  const [hasOpened, setHasOpened] = useState(props.isOpen);
  const [Panel, setPanel] = useState(loadPanel);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (props.isOpen) setHasOpened(true); }, [props.isOpen]);
  if (!props.isOpen && !hasOpened) return null;
  const retry = () => { setPanel(loadPanel); setAttempt(value => value + 1); };
  const frame = (children: ReactNode) => props.isOpen ? (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70" role="dialog" aria-modal="true" aria-label="Workspace admin" onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); props.onClose(); } }}>
      <div className="rounded-xl bg-[#161b22] p-6 text-white">
        {children}
        <button autoFocus type="button" onClick={props.onClose} className="mt-4 rounded px-3 py-2">Close</button>
      </div>
    </div>
  ) : null;
  return (
    <PanelLoadBoundary key={attempt} fallback={frame(<div role="alert">Could not load workspace admin. <button type="button" onClick={retry}>Try again</button></div>)}>
      <Suspense fallback={frame(<p role="status">Loading workspace admin…</p>)}>
        <Panel {...props} />
      </Suspense>
    </PanelLoadBoundary>
  );
}
