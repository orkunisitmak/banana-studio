import React from 'react';

type LazyBoundaryState = { error: Error | null; dismissed: boolean };

/** Keeps a failed lazy chunk from unmounting the whole studio. */
export class LazyBoundary extends React.Component<{ children: React.ReactNode; label?: string; onDismiss?: () => void }, LazyBoundaryState> {
  state: LazyBoundaryState = { error: null, dismissed: false };

  static getDerivedStateFromError(error: Error): Partial<LazyBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('A lazy studio panel failed to load.', error);
  }

  render(): React.ReactNode {
    if (this.state.dismissed) return null;
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        onKeyDown={event => {
          if (event.key === 'Escape') {
            this.props.onDismiss?.();
            this.setState({ dismissed: true });
          }
        }}
        className="fixed inset-0 z-[200] grid place-items-center bg-black/80 p-6 text-white"
      >
        <div className="max-w-sm rounded-2xl border border-red-500/30 bg-[#161b22] p-6 text-center shadow-2xl">
          <h2 className="text-base font-semibold">{this.props.label || 'This panel'} could not load</h2>
          <p className="mt-2 text-xs leading-5 text-gray-400">
            The rest of the studio is still running. Reload to fetch the latest files, or close this panel and keep working.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500"
            >
              Reload
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => {
                this.props.onDismiss?.();
                this.setState({ dismissed: true });
              }}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white"
            >
              Close panel
            </button>
          </div>
        </div>
      </div>
    );
  }
}
