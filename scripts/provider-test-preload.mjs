// Loaded only by the isolated packaged integration-test child. Every network
// destination is intercepted; no real credentials or paid requests are used.
import fs from 'node:fs';
import path from 'node:path';
const root=process.env.BANANA_TEST_ROOT;
if(!root)throw new Error('An isolated test directory is required.');
const output=fs.readFileSync(path.join(root,'provider.png')).toString('base64');
const record=value=>fs.appendFileSync(path.join(root,'provider-calls.jsonl'),JSON.stringify(value)+'\n');
const json=value=>Response.json(value,{headers:{'x-request-id':'synthetic-request'}});
globalThis.fetch=async(url,options={})=>{
 const target=String(url),input=options.body?JSON.parse(options.body):{},method=options.method||'GET';
 const upstream=new URL(target);if(!['api.openai.com','fal.run','openrouter.ai','generativelanguage.googleapis.com','queue.fal.run','router.inference.ai.exchange'].includes(upstream.hostname))throw new Error('Unexpected network request blocked by test');
 if(target.includes('/chat/completions')){
  record({kind:'text',input,hasCookie:!!options.headers.Cookie});
  const analysis=input.response_format?.json_schema?.name==='youtube_video_analysis';
  const text=analysis?JSON.stringify({videoAvailable:true,brief:'Synthetic episode',premise:'Synthetic promise',evidence:[{timestamp:'00:03',fact:'Synthetic observation',relevance:'premise'}],limitation:''}):input.response_format?JSON.stringify({ideas:{idea_1:'First idea',idea_2:'Second idea',idea_3:'Third idea',idea_4:'Fourth idea',idea_5:'Fifth idea'}}):'Enhanced synthetic prompt.';
  return json({id:'synthetic-text',choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}],...(upstream.hostname==='router.inference.ai.exchange'?{usage:{prompt_tokens:10,completion_tokens:20},exchange:{charge:{total_usd:0.0123}}}:{usage:{cost:0.0123}})});
 }
 if(target.includes('/api/v1/videos')||upstream.hostname==='queue.fal.run'){
  record({kind:'video',target:upstream.origin+upstream.pathname,method,input,hasCookie:!!options.headers.Cookie});
  if(method==='POST')return json(upstream.hostname==='queue.fal.run'?{request_id:'synthetic-video'}:{id:'synthetic-video',status:'pending'});
  if(upstream.hostname==='queue.fal.run')return json(target.endsWith('/status')?{status:'COMPLETED'}:{video:{url:'https://example.invalid/generated-video.mp4'}});
  return json({status:'completed',urls:['https://example.invalid/generated-video.mp4'],usage:{cost:0.75}});
 }
 const reference=input.images?.[0]?.image_url||input.input_references?.[0]?.image_url?.url||input.image_urls?.[0];
 const inline=input.contents?.[0]?.parts?.some(part=>!!part.inlineData?.data);
 record({kind:'image',target:upstream.origin+upstream.pathname,input,hasDataURL:reference?.startsWith('data:image/png;base64,')||!!inline,hasCookie:!!options.headers.Cookie});
 if(String(input.prompt).includes('[simulate-uncertain]'))throw new Error('Synthetic connection lost after submission');
 if(upstream.hostname==='fal.run')return json({images:[{url:'data:image/png;base64,'+output}]});
 if(upstream.hostname==='generativelanguage.googleapis.com')return json({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{inlineData:{mimeType:'image/png',data:output}}]}}],usageMetadata:{promptTokenCount:0,candidatesTokenCount:0}});
 return json({data:[{b64_json:output,media_type:'image/png'}],usage:upstream.hostname==='openrouter.ai'?{cost:0.1234}:{input_tokens:0,output_tokens:0}});
};
