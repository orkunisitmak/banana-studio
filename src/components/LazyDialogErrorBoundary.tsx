import React from 'react';

type Props = {
  children: React.ReactNode;
  inline?: boolean;
};

type State = { hasError: boolean };

export class LazyDialogErrorBoundary extends React.Component<Props, State> {
  declare props: Readonly<Props>;
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div role="alert" className={this.props.inline
        ? 'flex flex-col items-center gap-3 py-4 text-center text-sm text-gray-200'
        : 'fixed inset-0 z-[350] flex flex-col items-center justify-center gap-3 bg-black/70 px-4 text-center text-sm text-gray-200 backdrop-blur-sm'}>
        <p>This part of the gallery could not load. Reload to get the latest version.</p>
        <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-white px-4 py-2 font-medium text-gray-900">
          Reload
        </button>
      </div>
    );
  }
}
