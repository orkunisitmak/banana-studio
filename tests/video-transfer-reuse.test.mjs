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
    export const supabase={from,auth:{getSession:async()=>{globalThis.__sessionReads=(globalThis.__sessionReads||0)+1;return{data:{session:{user:{id:'u1'}}}}}},storage:{from:()=>({
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

test('a cached retry and a different source save for one video are serialized', async () => {
  const { warn, error } = console; console.warn = console.error = () => {};
  const fetchImpl = globalThis.fetch;
  globalThis.__objects = new Map(); globalThis.__uploads = []; globalThis.__blobSource = true;
  globalThis.__sessionReads = 0; globalThis.__ops = []; globalThis.__rows = [];
  globalThis.__signFails = null; globalThis.__signGate = null;
  globalThis.fetch = async url => new Response(String(url), { status: 200, headers: { 'content-type': 'video/mp4' } });
  let failFirstUpsert = true;
  globalThis.__db = op => {
    if (op.op === 'upsert') {
      if (failFirstUpsert) { failFirstUpsert = false; return { error: { message: 'timeout' } }; }
      globalThis.__rows.push(op.value);
    }
    return { data: null, error: null };
  };
  const media = (url, prompt, id = 'v5') => ({ id, url, prompt, mediaType: 'video', createdAt: 1, videoModel: 'seedance-2.5', referenceImages: [] });
  let releaseRetry;
  const retryGate = new Promise(resolve => { releaseRetry = resolve; });
  let gateEnabled = false;
  let retryGated = false;
  globalThis.__signGate = path => {
    if (gateEnabled && path === 'u1/v5.mp4' && !retryGated) { retryGated = true; return retryGate; }
  };
  let retryA;
  let saveB;
  let independentSave;
  try {
    await saveVideo(media('https://p/A.mp4', 'source A'));
    gateEnabled = true;
    let retrySettled = false;
    retryA = saveVideo(media('https://p/A.mp4', 'source A'));
    retryA.then(() => { retrySettled = true; }, () => { retrySettled = true; });
    while (!retryGated && !retrySettled) await new Promise(resolve => setImmediate(resolve));
    assert.ok(retryGated, 'cached retry reached the video URL signing gate');

    const sessionReadsBeforeB = globalThis.__sessionReads;
    saveB = saveVideo(media('https://p/B.mp4', 'source B'));
    await new Promise(resolve => setImmediate(resolve));
    const bWaitedBehindA = globalThis.__sessionReads === sessionReadsBeforeB;
    // On the unfixed code B runs while A is paused; finish B first to make the stale-row race deterministic.
    if (!bWaitedBehindA) await saveB;

    let independentSettled = false;
    let independentError;
    independentSave = saveVideo(media('https://p/C.mp4', 'source C', 'v6')).then(
      () => { independentSettled = true; },
      error => { independentError = error; independentSettled = true; },
    );
    const independentDeadline = Date.now() + 5000;
    while (!independentSettled && Date.now() < independentDeadline) await new Promise(resolve => setTimeout(resolve, 1));
    assert.ok(independentSettled, 'a different generation can save while A is paused');
    assert.equal(independentError, undefined);
    assert.ok(globalThis.__rows.some(row => row.id === 'v6'), 'the independent generation row was persisted');

    releaseRetry();
    await Promise.all([retryA, saveB]);

    const finalRow = globalThis.__rows.at(-1);
    assert.ok(finalRow, 'the same-generation save persisted a final row');
    assert.equal(globalThis.__objects.get(finalRow.storage_path), `https://p/${finalRow.prompt === 'source A' ? 'A' : 'B'}.mp4`);
    assert.equal(finalRow.prompt, 'source B');
    assert.ok(bWaitedBehindA, 'the second source waited until the cached retry finished');
  } finally {
    releaseRetry();
    await Promise.allSettled([retryA, saveB, independentSave].filter(Boolean));
    globalThis.__signGate = null; globalThis.__blobSource = false; globalThis.__signFails = null;
    Object.assign(console, { warn, error }); globalThis.fetch = fetchImpl;
  }
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
    // B uses the same ID and waits for A's durable URL and row write to finish.
    const sessionsBeforeB = globalThis.__sessionReads;
    const second = save('https://p/B.mp4', true);
    await new Promise(resolve => setImmediate(resolve));
    const bWaitedBehindA = globalThis.__sessionReads === sessionsBeforeB;
    if (!bWaitedBehindA) await second;
    releaseA(); await Promise.all([first, second]);
    assert.ok(bWaitedBehindA, 'B waits until A releases the generation save slot');
    assert.equal(globalThis.__objects.get('u1/v4.mp4'), 'https://p/B.mp4');
    globalThis.__ops = [];
    await save('https://p/A.mp4', false);
    assert.ok(globalThis.__ops.find(op => op.op === 'upsert'));
    assert.equal(globalThis.__objects.get('u1/v4.mp4'), 'https://p/A.mp4');
  } finally { globalThis.__signGate = null; globalThis.__blobSource = false; Object.assign(console, { warn, error }); globalThis.fetch = fetchImpl; }
});
