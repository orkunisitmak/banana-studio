import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFalClient } from '@fal-ai/client';

class ReferenceUploadError extends Error {}
const MIME={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',avif:'image/avif',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',aac:'audio/aac',flac:'audio/flac',ogg:'audio/ogg'};
const keyName=provider=>provider==='fal'?'FAL_KEY':provider==='openrouter'?'OPENROUTER_API_KEY':'EVOLINK_API_KEY';

/** Only selected media URL fields leave the local workspace. Plain prompts and
 * unrelated metadata are never treated as files. Provider URLs live in memory;
 * gallery records keep their original local references. */
export function createMediaUploader(workspace,{fetchImpl=fetch,falUpload}={}) {
  const cache=new Map();
  const upload=async(provider,value)=>{
    const key=workspace.mediaKey(value);if(!key)return value;
    const file=workspace.mediaPath(key),stat=fs.statSync(file),ext=path.extname(key).slice(1).toLowerCase(),type=MIME[ext];
    if(!type)throw new ReferenceUploadError('This reference file format is not supported.');
    if(provider==='openrouter') {
      if(!['image/png','image/jpeg','image/webp'].includes(type)||stat.size>20*1024*1024)throw new ReferenceUploadError('OpenRouter frame/reference images must be PNG, JPEG or WebP, up to 20 MB.');
      return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
    }
    const token=process.env[keyName(provider)];if(!token)throw new ReferenceUploadError(`Add your ${provider==='fal'?'fal.ai':'EvoLink'} key in Provider keys before using this reference.`);
    const limit=provider==='fal'?512*1024*1024:100*1024*1024;if(stat.size>limit)throw new ReferenceUploadError(`The reference exceeds the ${Math.round(limit/1024/1024)} MB provider upload limit.`);
    const cacheKey=[provider,key,stat.mtimeMs,stat.size].join(':');const cached=cache.get(cacheKey);if(cached&&cached.expires>Date.now())return cached.promise;
    const promise=(async()=>{
      const name=`reference-${randomUUID()}.${ext}`;
      const blob=await fs.openAsBlob(file,{type});
      let url;
      if(provider==='fal') {
        url=falUpload?await falUpload(new File([blob],name,{type})):await createFalClient({credentials:token}).storage.upload(new File([blob],name,{type}),{lifecycle:{expiresIn:86400}});
      } else {
        const form=new FormData();form.append('file',blob,name);
        const response=await fetchImpl('https://files-api.evolink.ai/api/v1/files/upload/stream',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`},body:form,signal:AbortSignal.timeout(180_000)});
        const result=await response.json().catch(()=>null);
        if(!response.ok||result?.success!==true)throw new Error('EvoLink could not accept the reference upload. No video generation was submitted.');url=result?.data?.file_url;
      }
      const target=new URL(url);if(target.protocol!=='https:'||target.username||target.password)throw new Error('The provider returned an invalid reference URL.');return target.href;
    })();
    cache.set(cacheKey,{promise,expires:Date.now()+55*60_000});promise.catch(()=>cache.delete(cacheKey));return promise;
  };
  const walk=async(provider,value,mediaField=false,depth=0)=>{
    if(depth>20)throw new Error('The reference request is too deeply nested.');
    if(typeof value==='string')return mediaField?upload(provider,value):value;
    if(Array.isArray(value))return Promise.all(value.map(v=>walk(provider,v,mediaField,depth+1)));
    if(value&&typeof value==='object')return Object.fromEntries(await Promise.all(Object.entries(value).map(async([key,v])=>[key,await walk(provider,v,/(?:url|urls)$/i.test(key),depth+1)])));
    return value;
  };
  return async(provider,value)=>{try{return await walk(provider,value);}catch(error){if(error instanceof ReferenceUploadError)throw error;throw new ReferenceUploadError('The provider could not prepare this reference. No generation was submitted.');}};
}
