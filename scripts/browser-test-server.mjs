// Test-only Vite instance: no workspace config, provider keys or user data.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const emptyEnv = path.join(root, '.build/browser-tests/empty-env');
fs.mkdirSync(emptyEnv, { recursive: true });
const server = await createServer({ root, configFile: false, envDir: emptyEnv, server: { host: '127.0.0.1', port: 4179, strictPort: true }, plugins: [{
  name: 'synthetic-auth-boundary', enforce: 'pre',
  /** Swap the auth service for the synthetic browser-test session. */
  resolveId(source, importer) {
    if (/\/authService$/.test(source) && importer && /\/(AuthBoundary\.tsx|storageService\.ts)$/.test(importer)) return path.join(root, 'tests/ui/browser-auth.ts');
  },
}, react()] });
await server.listen();
const close = async () => { await server.close(); process.exit(0); };
process.on('SIGTERM', close); process.on('SIGINT', close);
