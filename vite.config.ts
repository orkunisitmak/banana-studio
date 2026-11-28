import fs from 'node:fs';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { clientSecretGuard, assertPublicEnvironment } from './scripts/buildSecurity';
import { devApiServer } from './scripts/devApiServer';

// Provider credentials stay exclusively in server routes or macOS Keychain.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  assertPublicEnvironment(env);
  return {
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react(), clientSecretGuard(env), devApiServer(env), { name: 'bundled-license-inventory', generateBundle(_options, bundle) { const modules = Object.values(bundle).flatMap(output => output.type === 'chunk' ? Object.entries(output.modules).filter(([, info]) => info.renderedLength > 0).map(([file]) => file) : []); fs.mkdirSync('.build', { recursive: true }); fs.writeFileSync('.build/web-modules.json', JSON.stringify([...new Set(modules)])); } }],
  build: {
    rollupOptions: { input: { app: path.resolve(__dirname, 'index.html'), share: path.resolve(__dirname, 'share.html') } },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  };
});
