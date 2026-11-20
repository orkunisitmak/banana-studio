import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// A recording Supabase fake replaces the client at each service's import seam.
const fakeClient = `const from=table=>{const op={table,op:'select'};const q={select(){return q},insert(v){op.op='insert';op.value=v;return q},upsert(v){op.op='upsert';op.value=v;return q},
  update(v){op.op='update';op.value=v;return q},delete(){op.op='delete';return q},eq(){return q},order(){return q},limit(){return q},gt(){return q},single(){return q},maybeSingle(){return q},
  then(ok,fail){globalThis.__ops.push(op);return Promise.resolve(globalThis.__respond(op)).then(ok,fail)}};return q;};
  const client={from,storage:{from:()=>({})},auth:{getSession:async()=>({data:{session:{user:{id:'u1'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};`;
const stubs = {
  authService: `${fakeClient}export const supabase=client;export const SUPABASE_URL='https://x.supabase.co';export const getCurrentUserId=async()=>'u1';`,
  'supabase-js': `${fakeClient}export const createClient=()=>client;export const isAuthSessionMissingError=error=>error?.name==='AuthSessionMissingError';`,
  runtimeConfig: 'export const isLocalWorkspace=()=>false;export const getWorkspaceConfig=()=>({mode:"cloud"});export const getCloudPublicConfig=()=>({supabaseUrl:"https://x.supabase.co",supabasePublishableKey:"k"});',
  browserClient: 'export const createLocalWorkspaceClient=()=>({});',
  'tus-js-client': 'export class Upload{}',
};
const load = async entry => {
  const compiled = await build({entryPoints:[entry],absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,write:false,format:'esm',platform:'node',
    plugins:[{name:'stubs',setup(b){
      b.onResolve({filter:/^(\.\/authService|@supabase\/supabase-js|.*\/runtimeConfig|.*\/browserClient|tus-js-client)$/},args=>({path:Object.keys(stubs).find(key=>args.path.endsWith(key)),namespace:'stub'}));
      b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
      b.onResolve({filter:/^[^./]/},args=>({path:import.meta.resolve(args.path),external:true}));
    }}]});
  return import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
};
globalThis.window = { location: { origin: 'https://app.example' } };
const storage = await load('src/services/storageService.ts');

const run = async (respond, action) => {
  const { warn, error } = console; console.warn = console.error = () => {};
  globalThis.__ops = []; globalThis.__respond = respond;
  try { await action(); return { outcome: 'resolved', ops: globalThis.__ops }; }
  catch (failure) { return { outcome: failure.message, ops: globalThis.__ops }; }
  finally { Object.assign(console, { warn, error }); }
};
const ok = () => ({ data: null, error: null });

test('saveVideo never overwrites a row it could not read, and still saves a new row', async () => {
  const media = { id: 'v1', url: 'data:video/mp4;base64,AAAA', prompt: 'p', mediaType: 'video', createdAt: 1, videoModel: 'minimax-h3',
    generationCost: { usd: 0.6, source: 'published_estimate' }, referenceImages: [] };
  const write = ops => ops.find(op => op.op === 'upsert');
  const failedRead = await run(op => op.op === 'select' ? { data: null, error: { message: 'timeout' } } : ok(), () => storage.saveVideo(media));
  assert.equal(write(failedRead.ops), undefined);
  const saved = { metadata: { generationCost: { usd: 0.42, source: 'provider_actual' }, h3UsageLogId: 'log-1' },
    reference_images: [{ id: 'r1', data: 'https://x.supabase.co/storage/v1/object/authenticated/media/u1/r1.png', mimeType: 'image/png' }] };
  const merged = write((await run(op => op.op === 'select' ? { data: saved, error: null } : ok(), () => storage.saveVideo(media))).ops);
  assert.equal(merged.value.metadata.generationCost.source, 'provider_actual');
  assert.equal(merged.value.metadata.h3UsageLogId, 'log-1');
  assert.equal(merged.value.reference_images.length, 1);
  assert.ok(write((await run(ok, () => storage.saveVideo(media))).ops), 'a missing row is saved fresh');
});
