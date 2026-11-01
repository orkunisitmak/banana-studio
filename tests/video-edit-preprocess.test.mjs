import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Each stub path ends a module specifier; records writes made through the server registry client.
const bundle = async (entry, stubs, expose = []) => {
  const compiled = await build({entryPoints:[entry],absWorkingDir:root,bundle:true,write:false,format:'esm',platform:'node',
    plugins:[{name:'stubs',setup(b){
      b.onResolve({filter:/.*/},args=>{const key=Object.keys(stubs).find(stub=>args.path.endsWith(stub));return key?{path:key,namespace:'stub'}:undefined;});
      b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
      // Match the file name only: Windows paths use backslashes.
      if(expose.length)b.onLoad({filter:new RegExp('[\\\\/]'+entry.split('/').pop().replace(/[.]/g,'\\.')+'$')},args=>({contents:fs.readFileSync(args.path,'utf8')+`\nexport { ${expose.join(',')} };`,loader:'ts'}));
      b.onResolve({filter:/^[^./]/},args=>({path:import.meta.resolve(args.path),external:true}));
    }}]});
  return import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
};
const respond = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('Video Edit preprocessing rides out transient poll errors but stops on real failures', async () => {
  const { normalizeVideoForEdit } = await bundle('src/services/runwayService.ts', {
    '/authService': 'export const logUsage=()=>{};export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"t",user:{id:"u1"}}}})}};',
    '/storageService': 'export const uploadBase64ToPublicUrl=async()=>"";export const uploadBlobToPublicUrl=async()=>"";export const uploadVideoBlobToPublicUrl=async()=>"";export const refreshMediaAccessUrl=async u=>u;',
    '/providerRouting': 'export const selectProvider=()=>"evolink";',
  }, ['normalizeVideoForEdit']);
  const timer = globalThis.setTimeout, fetchImpl = globalThis.fetch;
  globalThis.setTimeout = fn => { queueMicrotask(fn); return 0; };
  const poll = async responses => { const queue = [...responses]; globalThis.fetch = async () => queue.shift();
    try { return await normalizeVideoForEdit('https://v/in.mp4', 1280, 720); } catch (error) { return `error: ${error.message}`; } };
  try {
    const submit = () => respond({ requestId: 'scale_1' }), done = () => respond({ status: 'SUCCEEDED', videoUrl: 'https://v/out.mp4' });
    assert.equal(await poll([submit(), respond({ error: 'busy' }, 429), respond({ error: 'gateway' }, 502), done()]), 'https://v/out.mp4');
    assert.equal(await poll([submit(), ...Array.from({ length: 5 }, () => respond({ error: 'down' }, 503))]), 'error: down');
    assert.equal(await poll([submit(), respond({ error: 'missing' }, 404)]), 'error: missing');
    // An unreadable 200 body counts as a failed poll and does not reset the counter.
    const unreadable = () => new Response('<html>', { status: 200 });
    assert.equal(await poll([submit(), unreadable(), respond({ error: 'gateway' }, 502), done()]), 'https://v/out.mp4');
    assert.equal(await poll([submit(), ...Array.from({ length: 5 }, unreadable)]), 'error: Source-video compatibility preprocessing status could not be read.');
  } finally { globalThis.setTimeout = timer; globalThis.fetch = fetchImpl; }
});
