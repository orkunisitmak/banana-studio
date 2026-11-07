// Additional synthetic entry; application source and production Vite options stay intact.
import fs from 'node:fs';
import path from 'node:path';
import {build,loadConfigFromFile,mergeConfig} from 'vite';
const root=path.resolve(import.meta.dirname,'..');
process.chdir(root);
const input=path.join(root,'.build/lazy-acceptance.html');
fs.mkdirSync(path.dirname(input),{recursive:true});
fs.writeFileSync(input,`<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="connect-src 'self'"></head><body><div id="root"></div><script type="module" src="/tests/ui/lazy-acceptance.bootstrap.ts"></script></body></html>`);
const loaded=await loadConfigFromFile({command:'build',mode:'production'},path.join(root,'vite.config.ts'),root);
if(!loaded)throw new Error('Production Vite config required');
const output=path.join(root,'.build/acceptance-lazy-production');
await build(mergeConfig(loaded.config,{configFile:false,build:{outDir:output,rollupOptions:{input:{acceptance:input}}}}));
fs.copyFileSync(path.join(output,'.build/lazy-acceptance.html'),path.join(output,'index.html'));
