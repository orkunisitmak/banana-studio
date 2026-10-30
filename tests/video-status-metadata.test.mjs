import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// The Supabase client is replaced at the authService import; each query records its write.
const stubs = {
  authService: `export const SUPABASE_URL='https://x.supabase.co';export const getCurrentUserId=async()=>'u1';
    const from=()=>{const op={op:'select'};const q={select(){return q},update(v){op.op='update';op.value=v;return q},eq(){return q},single(){return q},
      then(ok,fail){globalThis.__writes.push(op);return Promise.resolve(globalThis.__respond(op)).then(ok,fail)}};return q;};
    export const supabase={from,storage:{from:()=>({})}};`,
  runtimeConfig: 'export const isLocalWorkspace=()=>false;',
  'tus-js-client': 'export class Upload{}',
};
const compiled = await build({entryPoints:['src/services/storageService.ts'],absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,write:false,format:'esm',platform:'node',
  plugins:[{name:'stubs',setup(b){
    b.onResolve({filter:/^(\.\/authService|.*\/runtimeConfig|tus-js-client)$/},args=>({path:args.path.split('/').pop().replace(/^\./,''),namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
    b.onResolve({filter:/^[^./]/},args=>({path:import.meta.resolve(args.path),external:true}));
  }}]});
const { updateVideoStatus } = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const saved = { falEndpoint: 'minimax/h3-max/text-to-video', falQueueEndpoint: 'minimax/h3-max', videoQuality: '2K' };
const update = async (read, metadata) => {
  const warn = console.warn; console.warn = () => {};
  globalThis.__writes = [];
  globalThis.__respond = op => op.op === 'select' ? read : { data: null, error: null };
  try { await updateVideoStatus('v1', 'processing', { metadata }); } finally { console.warn = warn; }
  return globalThis.__writes.find(op => op.op === 'update')?.value;
};

test('a failed metadata read never overwrites the saved video endpoints, but still saves the status', async () => {
  const written = await update({ data: null, error: { message: 'timeout' } }, { pollingWarning: 'x' });
  assert.equal(written.status, 'processing');
  assert.equal('metadata' in written, false);
});

test('a successful read merges new metadata into the saved video details', async () => {
  const written = await update({ data: { metadata: saved }, error: null }, { pollingWarning: 'x' });
  assert.deepEqual(written.metadata, { ...saved, pollingWarning: 'x' });
});
