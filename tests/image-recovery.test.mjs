import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// The row comes from a fake user-scoped client; an intact stored PNG exists at the pipeline path.
const stubs = {
  'auth.js': `export const applyCors=()=>{};export const requireUser=async()=>({id:'u1'});
    export const createUserScopedClient=()=>({from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:globalThis.__row,error:null}),update:()=>q,then:(ok,fail)=>Promise.resolve({error:null}).then(ok,fail)};return q;},storage:{from:()=>({})}});`,
  'imageStorage.js': `export const readStoredImage=async(_storage,path)=>path.endsWith('.png')?{size:'1024x1024',bytes:2048}:null;export const signedMediaUrl=async(_storage,path)=>'https://media.example/'+path;`,
};
const compiled = await build({entryPoints:['api/openai-image-recover.ts'],absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,write:false,format:'esm',platform:'node',
  plugins:[{name:'stubs',setup(b){
    b.onResolve({filter:/_lib\/(auth|imageStorage)\.js$/},args=>({path:args.path.split('/').pop(),namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
    b.onResolve({filter:/^[^./]/},args=>({path:import.meta.resolve(args.path),external:true}));
  }}]});
const { default: recover } = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const recoverRow = async image_model => {
  globalThis.__row = { id: 'gen1', image_model, status: 'failed', metadata: { openaiImageOptions: { outputFormat: 'png' } } };
  let status = 0, body; const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { body = value; return this; }, end() { return this; } };
  await recover({ method: 'POST', headers: {}, body: { id: 'gen1' } }, res);
  return { status, body };
};

test('every model saved by the durable image pipeline can recover its stored file', async () => {
  for (const model of ['gpt-image-2.5-sunburst', 'gemini-nano-banana-2.1', 'gemini-3-pro-image-preview']) {
    const result = await recoverRow(model);
    assert.equal(result.status, 200, model);
    assert.equal(result.body.url, 'https://media.example/openai/u1/gen1.png', model);
    assert.equal(result.body.storagePath, 'openai/u1/gen1.png', model);
  }
  assert.equal((await recoverRow('gemini-3.1-flash-image-preview')).status, 404);
});
