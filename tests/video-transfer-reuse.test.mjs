import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Storage remembers which source each object came from; the browser-only poster renderer is replaced.
const stubs = {
  authService: `export const SUPABASE_URL='https://x.supabase.co';export const getCurrentUserId=async()=>'u1';
    const from=()=>{const op={op:'select'};const q={select(){return q},upsert(v){op.op='upsert';op.value=v;return q},eq(){return q},maybeSingle(){return q},
      then(ok,fail){globalThis.__ops.push(op);return Promise.resolve(globalThis.__db(op)).then(ok,fail)}};return q;};
    export const supabase={from,auth:{getSession:async()=>({data:{session:{user:{id:'u1'}}}})},storage:{from:()=>({
      upload:async(path,blob)=>{(globalThis.__uploads||=[]).push(path);globalThis.__objects.set(path,globalThis.__blobSource?await blob.text():globalThis.__source);return{error:null};},
      createSignedUrl:async path=>(await globalThis.__signGate?.(path),globalThis.__signFails?.(path))?{data:null,error:{message:'sign failed',statusCode:'500'}}:{data:{signedUrl:'https://x.supabase.co/storage/v1/object/sign/media/'+path},error:null}})}};`,
  runtimeConfig: 'export const isLocalWorkspace=()=>false;',
  'tus-js-client': 'export class Upload{}',
};
const compiled = await build({entryPoints:['src/services/storageService.ts'],absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,write:false,format:'esm',platform:'node',
  plugins:[{name:'stubs',setup(b){
    b.onResolve({filter:/^(\.\/authService|.*\/runtimeConfig|tus-js-client)$/},args=>({path:Object.keys(stubs).find(key=>args.path.endsWith(key)),namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
    b.onLoad({filter:/[\\/]storageService\.ts$/},args=>({loader:'ts',contents:fs.readFileSync(args.path,'utf8').replace('const createVideoThumbnail = (videoBlob: Blob, maxWidth = 640): Promise<Blob> => {',
      'const createVideoThumbnail = (_blob: Blob): Promise<Blob> => Promise.resolve(new Blob([new Uint8Array(8)], { type: "image/png" }));\nconst renderVideoThumbnail = (videoBlob: Blob, maxWidth = 640): Promise<Blob> => {')}));
    b.onResolve({filter:/^[^./]/},args=>({path:import.meta.resolve(args.path),external:true}));
  }}]});
const { saveVideo } = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('a retried video never saves a stored file that another source overwrote', async () => {
  const { warn, error } = console; console.warn = console.error = () => {};
  const fetchImpl = globalThis.fetch;
  globalThis.__objects = new Map();
  globalThis.fetch = async url => { globalThis.__source = String(url); return new Response(new Uint8Array(64), { status: 200, headers: { 'content-type': 'video/mp4' } }); };
  const save = async (url, rowFails) => { globalThis.__ops = []; globalThis.__db = op => op.op === 'upsert' && rowFails ? { error: { message: 'timeout' } } : { data: null, error: null };
    await saveVideo({ id: 'v1', url, prompt: 'p', mediaType: 'video', createdAt: 1, videoModel: 'seedance-2.5', referenceImages: [] });
    return globalThis.__ops.find(op => op.op === 'upsert' && !rowFails); };
  try {
    await save('https://p/A.mp4', true);
    globalThis.__signFails = path => path === 'u1/v1.mp4' && globalThis.__source.endsWith('B.mp4');
    await save('https://p/B.mp4', true);
    globalThis.__signFails = null;
    assert.ok(await save('https://p/A.mp4', false));
    assert.equal(globalThis.__objects.get('u1/v1.mp4'), 'https://p/A.mp4');
  } finally { Object.assign(console, { warn, error }); globalThis.fetch = fetchImpl; }
});

test('a failed row save is retried without moving the video again, and a later save transfers afresh', async () => {
  const { warn, error } = console; console.warn = console.error = () => {};
  const fetchImpl = globalThis.fetch;
  let downloads = 0;
  globalThis.__objects = new Map(); globalThis.__uploads = [];
  globalThis.fetch = async url => { downloads++; globalThis.__source = String(url); return new Response(new Uint8Array(64), { status: 200, headers: { 'content-type': 'video/mp4' } }); };
  const save = async rowFails => { globalThis.__ops = []; globalThis.__db = op => op.op === 'upsert' && rowFails ? { error: { message: 'timeout' } } : { data: null, error: null };
    await saveVideo({ id: 'v2', url: 'https://p/v2.mp4', prompt: 'p', mediaType: 'video', createdAt: 1, videoModel: 'seedance-2.5', referenceImages: [] });
    return globalThis.__ops.find(op => op.op === 'upsert')?.value; };
  const videoUploads = () => globalThis.__uploads.filter(path => path.endsWith('.mp4')).length;
  try {
    await save(true);
    const saved = await save(false);
    assert.deepEqual([downloads, videoUploads()], [1, 1]);
    assert.equal(saved.storage_path, 'u1/v2.mp4');
    assert.equal(saved.thumbnail_path, 'u1/v2_thumb.png');
    await save(false);
    assert.deepEqual([downloads, videoUploads()], [2, 2]);
  } finally { Object.assign(console, { warn, error }); globalThis.fetch = fetchImpl; }
});

test('a poster that cannot be re-signed on retry does not block the row or lose its stored path', async () => {
  const { warn, error } = console; console.warn = console.error = () => {};
  const fetchImpl = globalThis.fetch;
  globalThis.__objects = new Map();
  globalThis.fetch = async url => { globalThis.__source = String(url); return new Response(new Uint8Array(64), { status: 200, headers: { 'content-type': 'video/mp4' } }); };
  const save = async rowFails => { globalThis.__ops = []; globalThis.__db = op => op.op === 'upsert' && rowFails ? { error: { message: 'timeout' } } : { data: null, error: null };
    await saveVideo({ id: 'v3', url: 'https://p/v3.mp4', prompt: 'p', mediaType: 'video', createdAt: 1, videoModel: 'seedance-2.5', referenceImages: [] });
    return globalThis.__ops.find(op => op.op === 'upsert' && !rowFails)?.value; };
  try {
    await save(true);
    globalThis.__signFails = path => path === 'u1/v3_thumb.png';
    const saved = await save(false);
    assert.ok(saved, 'the row is saved even though the poster URL could not be renewed');
    assert.equal(saved.storage_path, 'u1/v3.mp4');
    assert.equal(saved.thumbnail_path, 'u1/v3_thumb.png');
  } finally { globalThis.__signFails = null; Object.assign(console, { warn, error }); globalThis.fetch = fetchImpl; }
});

test('saves of one video that overlap do not let a retry reuse a file the other overwrote', async () => {
  const { warn, error } = console; console.warn = console.error = () => {};
  const fetchImpl = globalThis.fetch;
  globalThis.__objects = new Map(); globalThis.__blobSource = true;
  // Each download's bytes name its source, so the stored file shows which save wrote it last.
  globalThis.fetch = async url => new Response(String(url), { status: 200, headers: { 'content-type': 'video/mp4' } });
  let releaseA, gated = false;
  const signedA = new Promise(resolve => { releaseA = resolve; });
  globalThis.__signGate = path => { if (path === 'u1/v4.mp4' && !gated) { gated = true; return signedA; } };
  const save = (url, rowFails) => { globalThis.__db = op => op.op === 'upsert' && rowFails ? { error: { message: 'timeout' } } : { data: null, error: null };
    return saveVideo({ id: 'v4', url, prompt: 'p', mediaType: 'video', createdAt: 1, videoModel: 'seedance-2.5', referenceImages: [] }); };
  try {
    globalThis.__ops = [];
    const first = save('https://p/A.mp4', true);
    let firstSettled = false;
    first.then(() => { firstSettled = true; }, () => { firstSettled = true; });
    while (!gated && !firstSettled) await new Promise(resolve => setImmediate(resolve));
    assert.ok(gated, 'A finished before it reached the URL signing gate');
    // A has stored its file and waits for its URL; B overwrites the same path meanwhile.
    await save('https://p/B.mp4', true);
    assert.equal(globalThis.__objects.get('u1/v4.mp4'), 'https://p/B.mp4');
    releaseA(); await first;
    globalThis.__ops = [];
    await save('https://p/A.mp4', false);
    assert.ok(globalThis.__ops.find(op => op.op === 'upsert'));
    assert.equal(globalThis.__objects.get('u1/v4.mp4'), 'https://p/A.mp4');
  } finally { globalThis.__signGate = null; globalThis.__blobSource = false; Object.assign(console, { warn, error }); globalThis.fetch = fetchImpl; }
});
