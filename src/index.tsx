import './styles/index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { validateWorkspaceConfig } from './lib/config/runtimeConfig';

// Lazy chunk failures are handled by LazyBoundary. Do not reload automatically:
// an in-flight generation lives only in memory and a reload would lose it.

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(<div role="status" style={{ color: '#d1d5db', padding: 48 }}>Opening Banana Studio…</div>);
const start = async () => {
  try {
    const response = await fetch('/api/workspace-config', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Workspace setup is required.');
    window.__BANANA_STUDIO_CONFIG__ = Object.freeze(validateWorkspaceConfig(await response.json()));
    const { default: App } = await import('./App');
    root.render(<React.StrictMode><App /></React.StrictMode>);
  } catch {
    root.render(<main style={{ maxWidth: 560, margin: '12vh auto', padding: 32, color: '#e5e7eb', fontFamily: 'system-ui' }}>
      <h1>Welcome to Banana Studio</h1>
      <p>This deployment needs its own workspace configuration. Follow the self-hosting guide to connect your Supabase project and server API keys.</p>
      <p>Provider keys belong on your server. Never paste them into a browser console or a public configuration field.</p>
      <a href="https://github.com/orkunisitmak/banana-studio#self-hosting" style={{ color: '#b5e92a' }}>Open the setup guide</a>
    </main>);
  }
};
void start();
