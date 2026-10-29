import { MODEL_ROUTES } from '../../src/lib/providers.ts';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WorkspaceQuery } from '../shared/query.mjs';

const TABLES = new Set(['generations','folders','templates','reference_images','saved_people','usage_logs','provider_tasks','profiles','authorized_emails']);
const INTERNAL = new Set(['provider_tasks','profiles','authorized_emails']);
const fail = (message, code = 'LOCAL_VALIDATION') => ({ data: null, error: { message, code } });
const clone = value => JSON.parse(JSON.stringify(value));
const ownField = (row, field) => {
  if (typeof field !== 'string' || !/^[a-z_][a-z0-9_]*(?:->>?[a-z0-9_]+)*$/i.test(field)) throw new Error('Invalid field.');
  const parts = field.split(/->>?/); return parts.reduce((v,p) => v == null ? null : Object.hasOwn(v,p) ? v[p] : null, row);
};
// PostgREST compares a jsonb column with JSON text by value, not key order.
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const equal = (x, value) => {
  if (!x || typeof x !== 'object' || typeof value !== 'string') return x === value;
  try { return JSON.stringify(canonical(x)) === JSON.stringify(canonical(JSON.parse(value))); } catch { return false; }
};
const wildcard = pattern => new RegExp('^' + String(pattern).replace(/\\([\\%_])|([%_])|([.*+?^${}()|[\]\\])/g, (_,escaped,wild,special) => escaped ? escaped.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') : wild === '%' ? '.*' : wild === '_' ? '.' : '\\'+special) + '$', 'i');
const filter = (row, { column, operator, value }) => {
  const x = ownField(row,column);
  if (operator?.startsWith('not.')) return !filter(row,{ column, operator:operator.slice(4), value });
  switch(operator) {
    case 'eq': return equal(x, value);
    case 'neq': return x !== value;
    case 'is': return value === null ? x == null : x === value;
    case 'gt': return x > value; case 'gte': return x >= value;
    case 'lt': return x < value; case 'lte': return x <= value;
    case 'in': if (!Array.isArray(value)) throw new Error('Invalid list.'); return value.includes(x);
    case 'ilike': case 'like': return wildcard(value).test(String(x ?? ''));
    case 'contains': return Array.isArray(x) && Array.isArray(value) && value.every(v=>x.includes(v));
    default: throw new Error('Unsupported filter.');
  }
};
const project = (row, columns = '*') => {
  if (columns === '*') return row;
  if (typeof columns !== 'string' || columns.length > 4000) throw new Error('Invalid selection.');
  return Object.fromEntries(columns.split(',').map(s=>s.trim()).filter(Boolean).map(field=>{
    const [alias, source] = field.includes(':') ? field.split(':') : [field,field];
    if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid column.');
    return [alias, ownField(row,source)];
  }));
};

export class LocalWorkspace {
  constructor(directory) {
    fs.mkdirSync(directory,{ recursive:true, mode:0o700 }); fs.chmodSync(directory,0o700);
    this.directory=fs.realpathSync(directory);
    this.mediaRoot=path.join(this.directory,'media'); fs.mkdirSync(this.mediaRoot,{recursive:true,mode:0o700}); fs.chmodSync(this.mediaRoot,0o700);
    this.db=new DatabaseSync(path.join(directory,'workspace.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(collection,id)); CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY,payload TEXT NOT NULL);');
    const identity=this.setting('identity') || { userId:randomUUID(), sessionId:randomUUID() };this.setting('identity',identity);this.identity=identity;
    this.user={id:identity.userId,email:'local@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'};
    this.put('profiles',this.user.id,{...this.user,display_name:'My workspace',role:'admin'});
    this.put('authorized_emails','local',{id:'local',email:this.user.email,is_active:true});
    for(const file of ['workspace.sqlite','workspace.sqlite-wal','workspace.sqlite-shm']) { const p=path.join(directory,file);if(fs.existsSync(p))fs.chmodSync(p,0o600); }
    this.origin='http://127.0.0.1';
  }
  setting(key,value) { if(value!==undefined)this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key,JSON.stringify(value));const row=this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(row.value):null; }
  all(table) { return this.db.prepare('SELECT payload FROM records WHERE collection=?').all(table).map(r=>JSON.parse(r.payload)); }
  get(table,id) { const row=this.db.prepare('SELECT payload FROM records WHERE collection=? AND id=?').get(table,id); return row?JSON.parse(row.payload):null; }
  put(table,id,value) { this.db.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?)').run(table,String(id),JSON.stringify(value)); }
  mediaPath(key) {
    if(typeof key!=='string'||key.length>800||!key||key.includes('\\')||key.includes('\0')||key.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.')))throw new Error('Invalid media path.');
    if(process.platform==='win32'&&key.split('/').some(p=>/[<>:"|?*]/.test(p)||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw new Error('Invalid Windows media path.');
    const result=path.resolve(this.mediaRoot,key);if(!result.startsWith(this.mediaRoot+path.sep))throw new Error('Invalid media path.');
    let current=this.mediaRoot;for(const part of key.split('/')) { current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error('Media symlinks are not allowed.'); }
    return result;
  }
  mediaKey(value) {
    try { const url=new URL(value);if(!['127.0.0.1','localhost'].includes(url.hostname))return null;const m=url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated|sign|public)\/media\/(.+)$/);return m?decodeURIComponent(m[1]):null; } catch{return null;}
  }
  mediaUrl(key) { this.mediaPath(key);return `${this.origin}/storage/v1/object/authenticated/media/${key.split('/').map(encodeURIComponent).join('/')}`; }
  materialize(value) { if(typeof value==='string'){const key=this.mediaKey(value);return key?this.mediaUrl(key):value;}if(Array.isArray(value))return value.map(v=>this.materialize(v));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.materialize(v)]));return value; }
  async upload(key,bytes,options={}) {
    const target=this.mediaPath(key);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    if(fs.existsSync(target)&&!options.upsert)return fail('Media already exists.','23505');
    const temp=target+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});fs.renameSync(temp,target);
    return {data:{path:key},error:null};
  }
  storage() { return { upload:async(key,data,options)=>this.upload(key,Buffer.isBuffer(data)?data:Buffer.from(await data.arrayBuffer()),options),
    download:async key=>{try{return {data:new Blob([fs.readFileSync(this.mediaPath(key))]),error:null};}catch{return {data:null,error:{statusCode:404,message:'Local media not found.'}};}},
    createSignedUrl:async key=>fs.existsSync(this.mediaPath(key))?{data:{signedUrl:this.mediaUrl(key)},error:null}:fail('Local media not found.'),
    createSignedUrls:async keys=>({data:keys.map(key=>({path:key,signedUrl:fs.existsSync(this.mediaPath(key))?this.mediaUrl(key):'',error:fs.existsSync(this.mediaPath(key))?null:'Not found'})),error:null}),
    remove:async keys=>{for(const key of keys)fs.rmSync(this.mediaPath(key),{force:true});return {data:keys,error:null};} }; }
  client(trusted = true) { const send=async plan=>this.materialize(this.execute(plan,trusted));return { from:table=>new WorkspaceQuery(send,table),rpc:(rpc,args)=>new WorkspaceQuery(send,undefined,rpc,args),storage:{from:bucket=>{if(bucket!=='media')throw new Error('Unknown media bucket.');return this.storage();}} }; }
  execute(plan,trusted=false) {
    try {
      if(!plan||typeof plan!=='object'||Array.isArray(plan))throw new Error('Invalid workspace operation.');
      if(plan.rpc)return {data:this.rpc(plan.rpc,plan.args||{},trusted),error:null};
      if(plan.storage){if(!Array.isArray(plan.paths)||plan.paths.length>1000)throw new Error('Invalid media request.');if(plan.storage==='stat')return {data:plan.paths.map(key=>({exists:fs.existsSync(this.mediaPath(key))})),error:null};if(plan.storage==='remove'){for(const key of plan.paths)fs.rmSync(this.mediaPath(key),{force:true});return {data:[],error:null};}throw new Error('Invalid media operation.');}
      const { table, operation='select', filters=[], order=[] }=plan;
      if(!TABLES.has(table)||!['select','insert','upsert','update','delete'].includes(operation)||(!trusted&&INTERNAL.has(table)&&operation!=='select'))throw new Error('Unsupported workspace operation.');
      if(!Array.isArray(filters)||filters.length>30||!Array.isArray(order)||order.length>10)throw new Error('Invalid filters.');
      let rows=this.all(table).filter(row=>filters.every(f=>filter(row,f)));
      if(plan.or) { if(typeof plan.or!=='string'||plan.or.length>2000)throw new Error('Invalid filter.');const ors=plan.or.split(',').map(v=>{const [column,operator,...value]=v.split('.');const raw=value.join('.');return {column,operator,value:raw==='true'?true:raw==='false'?false:raw};});rows=rows.filter(row=>ors.some(f=>filter(row,f))); }
      if(operation==='insert'||operation==='upsert') {
        const values=Array.isArray(plan.value)?plan.value:[plan.value];if(values.length>1000)throw new Error('Too many rows.');
        rows=values.map(value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid row.');const row={created_at:Date.now(),user_id:this.user.id,...clone(value)};row.id??=table==='provider_tasks'?`${row.provider}:${row.task_id}`:randomUUID();if(String(row.id).length>200)throw new Error('Invalid row ID.');const old=this.get(table,row.id);if(old&&operation==='insert')throw Object.assign(new Error('Row already exists.'),{code:'23505'});return {...old,...row};});
        this.db.exec('BEGIN IMMEDIATE');try{for(const row of rows)this.put(table,row.id,row);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
      } else if(operation==='update') { if(!filters.length)throw new Error('An update needs an explicit filter.');rows=rows.map(row=>({...row,...clone(plan.value)}));for(const row of rows)this.put(table,row.id,row);
      } else if(operation==='delete') { if(!filters.length)throw new Error('A deletion needs an explicit filter.');for(const row of rows)this.db.prepare('DELETE FROM records WHERE collection=? AND id=?').run(table,String(row.id)); }
      const count=rows.length;
      if(order.length)rows.sort((a,b)=>{for(const item of order){const x=ownField(a,item.column),y=ownField(b,item.column);if(x!==y)return (x<y?-1:1)*(item.ascending===false?-1:1);}return 0;});
      const from=plan.range?.[0]??0,to=plan.range?.[1];if(!Number.isSafeInteger(from)||from<0||(to!=null&&(!Number.isSafeInteger(to)||to<from)))throw new Error('Invalid range.');
      const limit=plan.limit??(to!=null?to-from+1:10000);if(!Number.isSafeInteger(limit)||limit<0||limit>10000)throw new Error('Invalid limit.');rows=rows.slice(from,from+limit).map(row=>project(row,plan.columns));
      if(plan.single&&(rows.length>1||(plan.single===true&&!rows.length)))return fail('The requested row was not found or is ambiguous.','PGRST116');
      return { data:plan.head?null:plan.single?(rows[0]??null):rows, error:null, ...(plan.count?{count}:{}) };
    } catch(error) { return fail(error.code==='23505'?'Row already exists.':'Local workspace operation could not be completed.',error.code||'LOCAL_VALIDATION'); }
  }
  rpc(name,args,trusted) {
    if(name==='get_provider_preferences')return this.setting('providerRoutes')||{};
    if(name==='save_provider_preference'){
      if(!MODEL_ROUTES[args.p_model] || args.p_provider!=='auto'&&!MODEL_ROUTES[args.p_model].includes(args.p_provider))throw new Error('Unsupported provider choice.');
      this.setting('providerRoutes',{...(this.setting('providerRoutes')||{}),[args.p_model]:args.p_provider});return true;
    }
    if(name==='get_text_model_preferences'||name==='save_text_model_preferences') {
      if(name.startsWith('save'))this.setting('textPreferences',{model:args.p_model,thinkingLevel:args.p_gemini_thinking,reasoningEffort:args.p_openai_reasoning});
      return {...(this.setting('textPreferences')||{model:'anthropic/claude-opus-5.5',thinkingLevel:'MEDIUM',reasoningEffort:'medium'}),source:'personal',canSaveAll:false,revision:1};
    }
    if(name==='get_gallery_search_people')return this.all('generations').filter(row=>!args.p_after_id||row.id>args.p_after_id).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,args.p_limit||500).map(row=>({id:row.id,people:[...new Set((row.reference_images||[]).map(r=>r.personName).filter(Boolean))]}));
    if(!trusted)throw new Error('This operation belongs to the local worker.');
    return this.workerRpc(name,args);
  }
  job(id,value) {if(value!==undefined)this.db.prepare('INSERT OR REPLACE INTO jobs VALUES (?,?)').run(id,JSON.stringify(value));const row=this.db.prepare('SELECT payload FROM jobs WHERE id=?').get(id);return row?JSON.parse(row.payload):null;}
  pendingJobs() {return this.db.prepare('SELECT payload FROM jobs').all().map(r=>JSON.parse(r.payload)).filter(j=>!['completed','failed'].includes(j.state));}
  workerRpc(name,a) {
    this.db.exec('BEGIN IMMEDIATE');try{const value=this.workerOperation(name,a);this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  workerOperation(name,a) {
    if(name==='start_openai_request') { const pending=this.db.prepare('SELECT payload FROM ledger').all().map(r=>JSON.parse(r.payload));if(a.p_generation_id&&pending.some(r=>r.generationId===a.p_generation_id))return {allowed:false,reason:'duplicate'};this.db.prepare('INSERT INTO ledger VALUES (?,?)').run(a.p_id,JSON.stringify({id:a.p_id,kind:a.p_kind,generationId:a.p_generation_id,state:'accepted',at:Date.now()}));return {allowed:true}; }
    if(name==='finish_openai_request') { const r=this.db.prepare('SELECT payload FROM ledger WHERE id=?').get(a.p_id);if(r)this.db.prepare('UPDATE ledger SET payload=? WHERE id=?').run(JSON.stringify({...JSON.parse(r.payload),state:a.p_outcome,providerRequestId:a.p_provider_request_id,status:a.p_provider_status}),a.p_id);return true; }
    if(name==='enqueue_image_job') {
      const existing=this.job(a.p_id);if(existing)return {state:existing.state};if(this.pendingJobs().length>=100)return {error:'full'};
      if(this.get('generations',a.p_id))return {error:'exists'};
      const job={id:a.p_id,userId:this.user.id,payload:a.p_payload,metadata:a.p_metadata,state:'queued',at:Date.now()};
      this.job(a.p_id,job);this.put('generations',a.p_id,{id:a.p_id,user_id:this.user.id,prompt:a.p_payload.displayPrompt,url:'',type:'image',aspect_ratio:a.p_payload.aspectRatio,resolution:a.p_payload.resolution,image_model:a.p_payload.model,folder_id:a.p_payload.folderId,reference_images:a.p_payload.referenceImages,created_at:job.at,status:'pending',is_favorite:false,metadata:{...a.p_metadata,imageQueue:{version:1,queuedAt:job.at},imageStage:'queued',imageJobState:'queued'}});return {state:'queued'};
    }
    if(name==='image_job_outbox')return this.pendingJobs().map(j=>({id:j.id,user_id:j.userId}));
    if(name==='mark_image_job_published')return true;
    const job=this.job(a.p_id);if(!job)return name==='claim_image_job'?{action:'stop'}:false;
    if(name==='claim_image_job') {
      if(['completed','failed'].includes(job.state))return {action:'stop'};
      const audit=job.audit&&this.db.prepare('SELECT payload FROM ledger WHERE id=?').get(job.audit),entry=audit&&JSON.parse(audit.payload);
      if(job.dispatchedAt) {
        // Same as the database: only a provider 429 whose deferral was lost is
        // requeued. Any other dispatch is observed and never submitted again.
        const row=this.get('generations',job.id);
        if(entry?.state==='rejected'&&entry.status===429&&row?.status!=='completed') {
          job.dispatchedAt=null;job.state='queued';job.claim=null;job.audit=null;job.retryAt=Date.now()+60_000;this.job(job.id,job);
          if(row)this.put('generations',job.id,{...row,status:'pending',metadata:{...row.metadata,error:undefined,imageStage:'queued',imageJobState:'queued'}});
          return {action:'wait',retryAfter:60};
        }
        return {action:'observe',claim:job.claim,audit:job.audit,dispatchedAt:job.dispatchedAt};
      }
      // As in SQL (after observe): a removed generation is never sent to the provider.
      if(!this.get('generations',job.id)){job.state='failed';this.job(job.id,job);return {action:'stop'};}
      if(job.state==='preparing'&&job.claimedAt>Date.now()-60_000)return {action:'wait',retryAfter:5};
      if(job.retryAt>Date.now())return {action:'wait',retryAfter:Math.ceil((job.retryAt-Date.now())/1000)};
      // As claim_image_job in Postgres: a stale preparation's audit is rejected before re-claiming.
      if(job.state==='preparing'&&job.audit)this.workerOperation('finish_openai_request',{p_id:job.audit,p_outcome:'rejected'});
      if((job.prepareAttempts||0)>=5) {
        job.state='failed';this.job(job.id,job);const row=this.get('generations',job.id);
        if(row&&row.status!=='completed')this.put('generations',job.id,{...row,status:'failed',metadata:{...row.metadata,error:'Preparing this image did not finish after several attempts. No generation was submitted. Try again, or use fewer or smaller references.',imageJobState:'failed'}});
        return {action:'stop'};
      }
      job.prepareAttempts=(job.prepareAttempts||0)+1;job.claim=a.p_claim;job.claimedAt=Date.now();job.audit=randomUUID();job.state='preparing';this.db.prepare('INSERT INTO ledger VALUES (?,?)').run(job.audit,JSON.stringify({id:job.audit,generationId:job.id,kind:'image',state:'accepted',at:Date.now()}));this.job(job.id,job);return {action:'prepare',payload:this.materialize(job.payload),audit:job.audit,claim:job.claim};
    }
    if(name==='dispatch_image_job') {if(job.claim!==a.p_claim||job.dispatchedAt||job.state!=='preparing'||!this.get('generations',job.id))return false;job.dispatchedAt=new Date().toISOString();job.state='dispatched';job.prepareAttempts=0;this.job(job.id,job);const row=this.get('generations',job.id);if(row)this.put('generations',job.id,{...row,status:'processing',metadata:{...row.metadata,...a.p_metadata,imageJobState:'dispatched'}});return true;}
    if(name==='defer_refused_image_job') {if(job.claim!==a.p_claim)return false;job.dispatchedAt=null;job.state='queued';job.retryAt=Date.now()+Math.min(3600,Math.max(1,a.p_retry_after||60))*1000;this.job(job.id,job);return true;}
    if(name==='finish_image_job') {
      // As in SQL: a finished job never changes again, and a failure never downgrades a completed row.
      if(job.claim!==a.p_claim||['completed','failed'].includes(job.state))return false;job.state=a.p_success?'completed':'failed';this.job(job.id,job);const row=this.get('generations',job.id);if(row&&(a.p_success||row.status!=='completed'))this.put('generations',job.id,{...row,status:job.state,storage_path:a.p_storage_path||row.storage_path,metadata:{...row.metadata,...a.p_metadata,...(a.p_error?{error:a.p_error}:{}),imageJobState:job.state}});return true;
    }
    throw new Error('Unsupported local worker operation.');
  }
  close(){this.db.close();}
}
