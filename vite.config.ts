import fs from 'node:fs';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { clientSecretGuard, assertPublicEnvironment } from './scripts/buildSecurity';

// Provider credentials stay exclusively in server routes or macOS Keychain.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  assertPublicEnvironment(env);
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      clientSecretGuard(env),
      {
        name: 'bundled-license-inventory',
        generateBundle(_options, bundle) {
          const modules = Object.values(bundle).flatMap((output) =>
            output.type === 'chunk'
              ? Object.entries(output.modules)
                  .filter(([, info]) => info.renderedLength > 0)
                  .map(([file]) => file)
              : [],
          );
          fs.mkdirSync('.build', { recursive: true });
          fs.writeFileSync('.build/web-modules.json', JSON.stringify([...new Set(modules)]));
        },
      },
    ],
    build: {
      rollupOptions: {
        input: { app: path.resolve(__dirname, 'index.html'), share: path.resolve(__dirname, 'share.html') },
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, '/');
            // Keep the largest studio modules in their own chunks so the entry
            // document does not ship one multi-hundred-kilobyte bundle.
            if (normalized.includes('/src/components/Gallery.tsx')) return 'studio-gallery';
            if (normalized.includes('/src/components/Controls.tsx')) return 'studio-controls';
            if (normalized.includes('/src/services/storageService.ts')) return 'studio-storage';
            if (normalized.includes('/src/services/geminiService.ts')) return 'studio-generation';
            if (!normalized.includes('/node_modules/')) return undefined;
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(normalized)) return 'vendor-react';
            if (/\/node_modules\/@supabase\//.test(normalized)) return 'vendor-supabase';
            if (/\/node_modules\/lucide-react\//.test(normalized)) return 'vendor-icons';
            if (/\/node_modules\/(@fal-ai|@google\/genai|jszip|tus-js-client|sharp)\//.test(normalized))
              return 'vendor-media';
            return 'vendor';
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  };
});
