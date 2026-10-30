import './styles/index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { loadWorkspace, WorkspaceSetupError } from './lib/config/loadWorkspace';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const start = async () => {
  root.render(<div role="status" style={{ color: '#d1d5db', padding: 48 }}>Opening Banana Studio…</div>);
  try {
    window.__BANANA_STUDIO_CONFIG__ = Object.freeze(await loadWorkspace());
    const { default: App } = await import('./App');
    root.render(<React.StrictMode><App /></React.StrictMode>);
  } catch (error) {
    const setupRequired = error instanceof WorkspaceSetupError;
    root.render(<main style={{ maxWidth: 560, margin: '12vh auto', padding: 32, color: '#e5e7eb', fontFamily: 'system-ui' }}>
      <h1>{setupRequired ? 'Welcome to Banana Studio' : 'Banana Studio could not open'}</h1>
      <p>{setupRequired ? 'This deployment needs its own workspace configuration. Follow the setup guide to connect your workspace.' : 'Check your connection and try again. Your saved workspace has not been changed.'}</p>
      <button type="button" onClick={() => window.location.reload()} style={{ marginRight: 16, color: '#b5e92a' }}>Try again</button>
      {setupRequired && <a href="https://github.com/orkunisitmak/banana-studio#self-hosting" style={{ color: '#b5e92a' }}>Open the setup guide</a>}
    </main>);
  }
};
void start();
