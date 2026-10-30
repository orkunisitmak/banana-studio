import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceQuery } from '../desktop/shared/query.mjs';

const f = globalThis.__storageIntegrity = { userId: 'user-a' };
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
f.client = { from: table => new WorkspaceQuery(plan => f.send(plan), table), rpc: async () => ({ data: [], error: null }), storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) } };
const bundled = await build({ stdin: { contents: "export { saveImage, deleteImages, clearImages, getTemplates, saveTemplate, deleteTemplate, renameFolder, updateImageStatus, updateVideoStatus, clearLocalMediaCache, getImages, getImageById, deleteFolder } from './src/services/storageService';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', banner: { js: "import {createRequire} from 'node:module';const require=createRequire(process.cwd()+'/package.json');" }, plugins: [{ name: 'storage-boundaries', setup(b) {
 b.onResolve({ filter: /\/authService$|^tus-js-client$/ }, a => ({ path: a.path, namespace: 'boundary' }));
 b.onLoad({ filter: /.*/, namespace: 'boundary' }, a => ({ contents: a.path === 'tus-js-client' ? 'export class Upload {}' : "export const supabase=globalThis.__storageIntegrity.client; export const getCurrentUserId=async()=>globalThis.__storageIntegrity.userId,SUPABASE_URL='https://example.invalid';" }));
} }] });
const storage = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
async function dbFor(userId) {
 const opening = indexedDB.open(`NanoGenDB:${userId}`, 5);
 opening.onupgradeneeded = () => { for (const name of ['images','templates','folders','referenceGallery']) opening.result.createObjectStore(name, { keyPath: 'id' }); };
 return request(opening);
}
async function setup(t) {
 await storage.clearLocalMediaCache();
 globalThis.indexedDB = new IDBFactory(); f.userId = 'user-a'; values.clear();
 f.send = async () => ({ data: null, error: null });
 t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
 t.after(() => storage.clearLocalMediaCache());
}
for (const [name, args] of [
 ['saveTemplate', [{ id: 'template', name: 'Example', config: {}, createdAt: 1 }]],
 ['deleteTemplate', ['template']], ['renameFolder', ['folder','Renamed']],
 ['updateImageStatus', ['image','completed']], ['updateVideoStatus', ['video','completed']],
]) test(`${name} rejects an authoritative backend write failure`, async t => {
 await setup(t); f.send = async () => ({ data: null, error: { message: 'Synthetic backend failure' } });
 await assert.rejects(storage[name](...args), /Synthetic backend failure/);
});

test('video status never overwrites metadata after a failed read', async t => {
 await setup(t); let writes = 0;
 f.send = async p => { if (p.operation === 'update') writes++; return { data: null, error: p.operation === 'select' ? { message: 'Metadata unavailable' } : null }; };
 await assert.rejects(storage.updateVideoStatus('v','completed',{ metadata: { generationTime: 5 } }), /Metadata unavailable/);
 assert.equal(writes, 0);
});

test('logout preserves unsynced work for its owner while another account cannot read it', async t => {
 await setup(t); const db = await dbFor('user-a');
 await request(db.transaction('images','readwrite').objectStore('images').put({ id: 'unsynced', url: 'data:image/png;base64,c3ludGhldGlj', syncStatus: 'local-only', createdAt: 1 })); db.close();
 values.set('nanogen_pending_deletions:user-a','["deleted"]');
 await storage.clearLocalMediaCache('user-a');
 assert.equal((await storage.getImageById('unsynced'))?.id, 'unsynced');
 assert.equal(values.get('nanogen_pending_deletions:user-a'), '["deleted"]');
 f.userId = 'user-b'; assert.equal(await storage.getImageById('unsynced'), null);
});

test('folder deletion reads past the server row cap before deleting anything', async t => {
 await setup(t);
 const media = new Map(Array.from({length:1001},(_,i)=>[`m${String(i).padStart(4,'0')}`, { id:`m${String(i).padStart(4,'0')}`,type:'image',folder_id:'folder',storage_path:`user-a/${i}.png` }]));
 let folderDeleted = false;
 f.send = async p => {
  if(p.operation==='select') {
   let rows=p.table==='folders'?[{id:'folder',parent_id:null}]:[...media.values()];
   for(const filter of p.filters) if(filter.column==='id'&&filter.operator==='gt') rows=rows.filter(row=>row.id>filter.value);
   if(p.range) rows=rows.slice(p.range[0],p.range[1]+1);
   return { data: rows.slice(0,p.limit||1000),error:null };
  }
  if(p.table==='generations') for(const id of p.filters.find(v=>v.column==='id').value) media.delete(id);
  if(p.table==='folders') folderDeleted=true;
  return {data:[],error:null};
 };
 const result=await storage.deleteFolder('folder');
 assert.equal(folderDeleted,true); assert.equal(result.mediaIds.length,1001); assert.equal(media.size,0);
});


test('failed cloud and local saves reject instead of reporting an unsynced success', async t => {
 await setup(t); f.send=async()=>({data:null,error:{message:'Cloud unavailable'}});
 t.mock.method(globalThis.indexedDB,'open',()=>{throw new Error('Local quota exceeded');});
 await assert.rejects(storage.saveImage({id:'unpersisted',url:'data:image/png;base64,c3ludGhldGlj',mediaType:'image',createdAt:1},'user-a'), /Local quota exceeded/);
});

test('clear history enumerates every page and deletes rows before storage', async t => {
 await setup(t); const rows=new Map(Array.from({length:1001},(_,i)=>{const id=`m${String(i).padStart(4,'0')}`;return [id,{id,type:'image',storage_path:`user-a/${id}.png`}];}));
 f.send=async p=>{if(p.operation==='select'){let data=[...rows.values()];for(const filter of p.filters)if(filter.column==='id'&&filter.operator==='gt')data=data.filter(row=>row.id>filter.value);return{data:data.slice(0,p.limit||1000),error:null};}assert.equal(p.filters.find(v=>v.column==='user_id').value,'user-a');rows.clear();return{data:[],error:null};};
 t.mock.method(f.client.storage,'from',()=>({remove:async()=>{assert.equal(rows.size,0,'database deletion precedes destructive file cleanup');return{data:[],error:null};}}));
 await storage.clearImages(); assert.equal(rows.size,0);
});

test('templates load beyond the server cap in saved order',async t=>{
 await setup(t);const all=Array.from({length:1001},(_,i)=>({id:`t${String(i).padStart(4,'0')}`,name:'Synthetic',config:{},created_at:i}));
 f.send=async p=>{let data=all;for(const filter of p.filters)if(filter.column==='id'&&filter.operator==='gt')data=data.filter(row=>row.id>filter.value);return{data:data.slice(0,p.limit||1000),error:null};};
 const result=await storage.getTemplates();assert.equal(result.length,1001);assert.equal(result[0].id,'t1000');
});

test('a previous account clear cannot erase the next account offline creations',async t=>{
 await setup(t);const db=await dbFor('user-b');await request(db.transaction('images','readwrite').objectStore('images').put({id:'b-offline',url:'data:image/png;base64,c3ludGhldGlj',syncStatus:'local-only'}));db.close();
 let release,entered;const started=new Promise(resolve=>{entered=resolve;});const held=new Promise(resolve=>{release=resolve;});
 f.send=async()=>{entered();await held;return{data:[],error:null};};
 const clearing=storage.clearImages();await started;await storage.clearLocalMediaCache('user-a');f.userId='user-b';release();
 await assert.rejects(clearing,/session changed/i);
 const after=await dbFor('user-b');assert.equal(await request(after.transaction('images','readonly').objectStore('images').count()),1);after.close();
});


test('cloud gallery restores accepted video task handles before resuming rows',async t=>{
 await setup(t);const oldWindow=globalThis.window;globalThis.window={__BANANA_STUDIO_CONFIG__:{mode:'cloud'}};t.after(()=>{globalThis.window=oldWindow;});
 f.send=async p=>({data:(p.range?.[0]||0)>0?[]:[{id:'accepted-video',user_id:'user-a',type:'video',status:'processing',url:'',created_at:1,task_id:null,metadata:{videoModel:'seedance-2.5'}}],error:null});
 let recovered=0;t.mock.method(f.client,'rpc',async(name,args)=>{assert.equal(name,'recover_video_tasks');assert.deepEqual(args,{p_generation_ids:['accepted-video']});recovered++;return{data:[{id:'accepted-video',task_id:'bs_openrouter_existing',status:'processing',metadata:{videoModel:'seedance-2.5',falEndpoint:'bytedance/seedance-2.5'}}],error:null};},{create:true});
 const media=await storage.getImages();assert.equal(media[0].taskId,'bs_openrouter_existing');assert.equal(recovered,1);
});


test('bulk deletion reports local failures and keeps owner-scoped deletion intents',async t=>{
 await setup(t);f.send=async()=>({data:[],error:null});
 t.mock.method(indexedDB,'open',()=>{throw new Error('Local quota failure');});
 await assert.rejects(storage.deleteImages([{id:'a',mediaType:'image'},{id:'b',mediaType:'image'}]),/could not be fully deleted/i);
 assert.deepEqual(JSON.parse(values.get('nanogen_pending_deletions:user-a')),['a','b']);
});

test('failed local history clear stays retryable and deleted cache copies cannot return',async t=>{
 await setup(t);const db=await dbFor('user-a');await request(db.transaction('images','readwrite').objectStore('images').put({id:'removed',url:'data:image/png;base64,c3ludGhldGlj',syncStatus:'local-only',createdAt:1}));db.close();
 f.send=async p=>({data:p.operation==='select'&&!p.filters.some(v=>v.operator==='gt')?[{id:'removed',type:'image',storage_path:'user-a/removed.png'}]:[],error:null});
 const broken=t.mock.method(indexedDB,'open',()=>{throw new Error('Local quota failure');});
 await assert.rejects(storage.clearImages(),/Local quota failure/);
 assert.deepEqual(JSON.parse(values.get('nanogen_pending_deletions:user-a')),['removed']);
 broken.mock.restore();f.send=async()=>({data:[],error:null});
 assert.deepEqual(await storage.getImages(),[]);
});
