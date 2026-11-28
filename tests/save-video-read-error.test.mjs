import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// A recording Supabase fake replaces the client at each service's import seam.
const fakeClient = `const from=table=>{const op={table,op:'select'};const q={select(){return q},insert(v){op.op='insert';op.value=v;return q},upsert(v){op.op='upsert';op.value=v;return q},
  update(v){op.op='update';op.value=v;return q},delete(){op.op='delete';return q},eq(k,v){(op.filters||={})[k]=v;return q},in(){return q},is(){return q},order(){return q},limit(){return q},gt(){return q},single(){return q},maybeSingle(){return q},
  then(ok,fail){globalThis.__ops.push(op);return Promise.resolve(globalThis.__respond(op)).then(ok,fail)}};return q;};
  const client={from,storage:{from:()=>({
    info:async source=>({data:{contentType:source.endsWith('.webp')?'image/webp':'image/png'},error:null}),
    copy:async(source,destination)=>{globalThis.__ops.push({op:'copy',source,destination});return {error:globalThis.__copyError||null};},
    download:async source=>{globalThis.__ops.push({op:'download',source});return {data:new Blob(['saved bytes'],{type:'image/png'}),error:null};},
    remove:async paths=>{globalThis.__ops.push({op:'remove',paths});return {error:null};},
    upload:async(destination,blob,options)=>{globalThis.__ops.push({op:'upload',destination,contentType:options?.contentType,bytes:await blob.text()});return {error:null};}
  })},auth:{getSession:async()=>({data:{session:{user:{id:'u1'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};`;
const stubs = {
  authService: `${fakeClient}export const supabase=client;export const SUPABASE_URL='https://x.supabase.co';export const getCurrentUserId=async()=>'u1';`,
  'supabase-js': `${fakeClient}export const createClient=()=>client;export const isAuthSessionMissingError=error=>error?.name==='AuthSessionMissingError';`,
  runtimeConfig: 'export const isLocalWorkspace=()=>Boolean(globalThis.__desktop);export const getWorkspaceConfig=()=>({mode:"cloud"});export const getCloudPublicConfig=()=>({supabaseUrl:"https://x.supabase.co",supabasePublishableKey:"k"});',
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
  const sparse = write((await run(op => op.op === 'select' ? { data: saved, error: null } : ok(),
    () => storage.saveVideo({ ...media, referenceImages: [{ id: 'r1', personId: 2 }] }))).ops);
  assert.equal(sparse.value.reference_images[0].data, merged.value.reference_images[0].data);
  assert.equal(sparse.value.reference_images[0].personId, 2);
  assert.ok(write((await run(ok, () => storage.saveVideo(media))).ops), 'a missing row is saved fresh');
});

test('video inputs are row-owned on cloud and desktop; pending status never writes bearer tokens or inline pixels', async () => {
  const source = 'u1/original.png';
  const signed = `https://x.supabase.co/storage/v1/object/sign/media/${source}?token=temporary`;
  const ref = { id: 'saved-person:person:a', data: signed, mimeType: 'image/png', personId: 2 };
  const unuploaded = { ...ref, id: 'unsent', data: 'data:image/png;base64,AAAA', mask: 'legacy' };
  const pending = await run(ok, () => storage.updateVideoStatus('v2', 'processing', { referenceImages: [ref, unuploaded] }));
  assert.deepEqual(pending.ops.find(op => op.op === 'update').value.reference_images, [
    { ...ref, data: `https://x.supabase.co/storage/v1/object/authenticated/media/${source}` },
    { id: 'unsent', mimeType: 'image/png', personId: 2 },
  ]);
  const save = async (id, reference = ref) => (await run(ok, () => storage.saveVideo({
    id, url: 'data:video/mp4;base64,AAAA', prompt: 'clip', mediaType: 'video', referenceImages: [reference],
  }))).ops;
  const cloud = await save('v2');
  const copy = cloud.find(op => op.op === 'copy');
  assert.equal(copy.source, source);
  assert.match(copy.destination, /^u1\/refs\/[a-f0-9]{64}\.png$/);
  assert.deepEqual(cloud.find(op => op.op === 'upsert').value.reference_images, [
    { ...ref, data: `https://x.supabase.co/storage/v1/object/authenticated/media/${copy.destination}` },
  ]);
  const webp = await save('webp', { ...ref, mimeType: 'image/jpeg', data: signed.replace('.png', '.webp') });
  const [copied] = webp.find(op => op.op === 'upsert').value.reference_images;
  assert.match(copied.data, /\.webp$/);
  assert.equal(copied.mimeType, 'image/webp', 'storage metadata overrides stale draft MIME');
  try {
    globalThis.__copyError = { statusCode: 409, message: 'Already exists' };
    const retry = await save('v2');
    assert.deepEqual(retry.find(op => op.op === 'upsert').value.reference_images, cloud.find(op => op.op === 'upsert').value.reference_images);
    globalThis.__copyError = { statusCode: 403, message: 'Forbidden' };
    assert.ok(!(await save('v3')).some(op => op.op === 'upsert'), 'never claim a refused copy is durable');
    globalThis.__desktop = true;
    const desktop = await save('v3');
    assert.equal(desktop.find(op => op.op === 'download').source, source);
    const upload = desktop.find(op => op.op === 'upload');
    assert.notEqual(upload.destination, copy.destination);
    assert.match(upload.destination, /\.png$/);
    assert.equal(upload.contentType, 'image/png');
    assert.equal(upload.bytes, 'saved bytes');
    assert.ok(!desktop.some(op => op.op === 'copy'));
  } finally {
    delete globalThis.__desktop;
    delete globalThis.__copyError;
  }
});

test('prepared video references are committed before submit against the current pending lease', async () => {
  let writes = 0;
  const url = 'https://x.supabase.co/storage/v1/object/sign/media/u1/frame.png?token=temporary';
  const refs = { referenceImages: [{ id: 'frame', data: url }], referenceVideos: [{ id: 'clip', url, duration: 4 }], referenceAudios: [{ id: 'sound', url }] };
  const save = () => storage.savePreparedVideoReferences('v1', refs, 'u1');
  const committed = await run(op => op.op === 'select'
    ? { data: { metadata: { keep: true, submissionHeartbeatAt: 100 + writes } }, error: null }
    : { data: ++writes === 1 ? null : { id: 'v1' }, error: null }, save);
  assert.equal(committed.outcome, 'resolved');
  assert.equal(writes, 2);
  const updated = committed.ops.at(-1);
  assert.deepEqual(updated.filters, { user_id: 'u1', id: 'v1', type: 'video', status: 'pending', task_id: '', 'metadata->submissionHeartbeatAt': 101 });
  assert.equal(updated.value.metadata.keep, true);
  assert.equal(updated.value.metadata.referenceVideos[0].duration, 4);
  assert.ok(!JSON.stringify(updated.value).includes('token='));
  assert.equal(updated.value.reference_images[0].data, updated.value.metadata.referenceAudios[0].url);
  assert.match((await run(ok, save)).outcome, /No generation was submitted/);
  const unprepared = await run(ok, () => storage.savePreparedVideoReferences('v1', { ...refs, referenceVideos: [{ url: 'blob:temporary' }] }, 'u1'));
  assert.deepEqual(unprepared.ops, []);
  assert.match(unprepared.outcome, /No generation was submitted/);
});

test('folder deletion does not remove a shared legacy input object', async t => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  } });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  });
  const old = 'refs/inside_person.jpg';
  const result = await run(op => {
    if (op.op === 'select' && op.table === 'folders') return { data: [{ id: 'folder', parent_id: null }], error: null };
    if (op.op === 'select' && op.table === 'generations') return { data: [{ id: 'inside', type: 'image',
      storage_path: 'u1/inside.png', thumbnail_path: 'u1/inside_thumb.png', reference_images: [{ id: 'person', data: old }] }], error: null };
    return ok();
  }, () => storage.deleteFolder('folder'));
  assert.equal(result.outcome, 'resolved');
  const removed = result.ops.filter(op => op.op === 'remove').flatMap(op => op.paths);
  assert.deepEqual(removed.sort(), ['u1/inside.png', 'u1/inside_thumb.png']);
});
