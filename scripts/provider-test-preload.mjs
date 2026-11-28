// Loaded only by the isolated packaged integration-test child. Every network
// destination is intercepted; no real credentials or paid requests are used.
import fs from 'node:fs';
import path from 'node:path';
import { Socket } from 'node:net';
const root=process.env.BANANA_TEST_ROOT;
if(!root)throw new Error('An isolated test directory is required.');
// Catch SDKs that bypass fetch as well. This process accepts loopback HTTP
// connections but never needs to initiate a real outbound socket.
Socket.prototype.connect = function () { throw new Error('Outbound sockets disabled in the offline provider fixture.'); };
const output=fs.readFileSync(path.join(root,'provider.png')).toString('base64');
const record=value=>fs.appendFileSync(path.join(root,'provider-calls.jsonl'),JSON.stringify(value)+'\n');
const json=value=>Response.json(value,{headers:{'x-request-id':'synthetic-request'}});
let videoId=0;
const videoURL='https://example.invalid/generated-video.mp4';
const seedreamImage={url:'data:image/png;base64,'+output,content_type:'image/png'};
globalThis.fetch=async(url,options={})=>{
 const target=String(url),input=options.body?JSON.parse(options.body):{},method=options.method||'GET';
 const upstream=new URL(target),host=upstream.hostname,hasCookie=new Headers(options.headers).has('cookie');
 if(!['api.openai.com','fal.run','openrouter.ai','generativelanguage.googleapis.com','queue.fal.run','api.evolink.ai','api.fal.ai'].includes(host))throw new Error('Unexpected network request blocked by test');
 if(target.includes('/chat/completions')){
  record({kind:'text',target:upstream.origin+upstream.pathname,input,hasCookie});
  const text=input.response_format?JSON.stringify({ideas:{idea_1:'First idea',idea_2:'Second idea',idea_3:'Third idea',idea_4:'Fourth idea',idea_5:'Fifth idea'}}):'Enhanced synthetic prompt.';
  return json({id:'synthetic-text',choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}],usage:{cost:0.0123}});
 }
 if(host==='generativelanguage.googleapis.com'&&upstream.pathname.includes('gemini-4-hydrogen:generateContent')){
  record({kind:'footage',input,hasCookie});
  return json({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:'Synthetic footage observation.'}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:5}});
 }
 if(host==='queue.fal.run'&&upstream.pathname.startsWith('/bytedance/seedream/')){
  record({kind:'seedream',target:upstream.pathname,method,numImages:input.num_images,hasDataURL:!!input.image_urls?.[0]?.startsWith('data:image/png;base64,'),hasCookie});
  if(method==='POST')return json({request_id:'synthetic-seedream'});
  if(upstream.pathname.endsWith('/requests/synthetic-seedream/status'))return json({status:'COMPLETED'});
  if(upstream.pathname.endsWith('/requests/synthetic-seedream'))return json({images:[seedreamImage,seedreamImage]});
  throw new Error('Unexpected Seedream queue request');
 }
 if(host==='api.evolink.ai'){
  record({kind:'video',target:upstream.origin+upstream.pathname,method,input,hasCookie});
  if(method==='POST'&&upstream.pathname==='/v1/videos/generations')return json({id:`synthetic-video-${++videoId}`});
  if(method==='GET'&&upstream.pathname.startsWith('/v1/tasks/synthetic-video-'))return json({status:'completed',progress:100,results:[videoURL]});
  throw new Error('Unexpected EvoLink request');
 }
 if(host==='api.fal.ai'&&method==='GET'){
  record({kind:'billing',target:upstream.pathname,hasCookie});
  return json({billing_events:[],has_more:false,next_cursor:null});
 }
 if(target.includes('/api/v1/videos')||upstream.hostname==='queue.fal.run'){
  record({kind:'video',target:upstream.origin+upstream.pathname,method,input,hasCookie});
  if(method==='POST'){const id=`synthetic-video-${++videoId}`;return json(host==='queue.fal.run'?{request_id:id}:{id,status:'pending'});}
  if(host==='queue.fal.run')return json(upstream.pathname.endsWith('/status')?{status:'COMPLETED'}:{video:{url:videoURL}});
  return json({status:'completed',urls:[videoURL],usage:{cost:0.75}});
 }
 const reference=input.images?.[0]?.image_url||input.input_references?.[0]?.image_url?.url||input.image_urls?.[0];
 const inline=input.contents?.[0]?.parts?.some(part=>!!part.inlineData?.data);
 record({kind:'image',target:upstream.origin+upstream.pathname,uncertain:String(input.prompt).includes('[simulate-uncertain]'),hasDataURL:reference?.startsWith('data:image/png;base64,')||!!inline,hasCookie});
 if(String(input.prompt).includes('[simulate-uncertain]'))throw new Error('Synthetic connection lost after submission');
 if(upstream.hostname==='fal.run')return json({images:[{url:'data:image/png;base64,'+output}]});
 if(upstream.hostname==='generativelanguage.googleapis.com')return json({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{inlineData:{mimeType:'image/png',data:output}}]}}],usageMetadata:{promptTokenCount:0,candidatesTokenCount:0}});
 return json({data:[{b64_json:output,media_type:'image/png'}],usage:upstream.hostname==='openrouter.ai'?{cost:0.1234}:{input_tokens:0,output_tokens:0}});
};
