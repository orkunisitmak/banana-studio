import type { Plugin } from 'vite';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Only "sk-" needs a left boundary: names such as "task-…", "disk-…" or "dark-sk-…" contain it.
const secretPattern = /(?:(?<![a-zA-Z0-9_-])sk-(?:proj-|svcacct-)?[a-zA-Z0-9_-]{30,}|AIza[a-zA-Z0-9_-]{30,}|sb_secret_[a-zA-Z0-9_-]{20,})/;

export function assertPublicEnvironment(env: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('VITE_') || !value) continue;
    if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name) || secretPattern.test(value)) {
      // Report the variable NAME only. Build logs must never print its value.
      throw new Error(`Unsafe browser environment variable: ${name}. Keep credentials in server-only variables.`);
    }
  }
}

export function clientSecretGuard(env: Record<string, string | undefined>): Plugin {
  let outputDirectory: string;
  const secrets = Object.entries(env)
    .filter(([name, value]) => /(?:API_KEY|SERVICE_ROLE_KEY|FAL_KEY|ADMIN_KEY|SECRET|PASSWORD|PRIVATE_KEY)$/.test(name) && value && value.length >= 16)
    .map(([, value]) => value!);
  const check = (name: string, contents: string) => {
    if (secretPattern.test(contents) || secrets.some(secret => contents.includes(secret))) {
      throw new Error(`Credential detected in browser output: ${name}. Build stopped.`);
    }
  };
  return {
    name: 'client-secret-guard',
    configResolved(config) { outputDirectory = path.resolve(config.root, config.build.outDir); },
    buildStart() { assertPublicEnvironment(env); },
    generateBundle(_options, bundle) {
      for (const [name, output] of Object.entries(bundle)) {
        const contents = output.type === 'chunk' ? output.code : typeof output.source === 'string' ? output.source : Buffer.from(output.source).toString();
        check(name, contents);
      }
    },
    async closeBundle() {
      // Vite copies public/ outside generateBundle. Scan the final output too.
      if (!outputDirectory) return;
      const scan = async (directory: string) => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) { await scan(file); continue; }
          if (/^\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/.test(entry.name)) throw new Error('Private file detected in browser output. Build stopped.');
          check(path.relative(outputDirectory, file), (await readFile(file)).toString());
        }
      };
      await scan(outputDirectory);
    },
  };
}
