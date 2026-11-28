import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const compiled = await build({stdin:{resolveDir:fileURLToPath(new URL('..',import.meta.url)),contents:`
  export * from './api/_lib/falGptImage.ts';
  export {completeGeneratedImage} from './api/_lib/imageStorage.ts';
  export {buildReferenceImageUrls, pollImageTask, FalImageTaskFailedError} from './src/services/falImageService.ts';`},bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'offline',setup(b){
    b.onResolve({filter:/^\.\/(storageService|authService)$/},({path})=>({path,namespace:'offline'}));
    b.onLoad({filter:/.*/,namespace:'offline'},({path})=>({contents:path.endsWith('authService')?'export const supabase={};':'export const uploadBase64ToPublicUrl=async()=>{throw Error("unexpected upload")}; export const refreshMediaAccessUrl=async url=>url;'}));
  }}]});
const {falGptImageEndpoint,falGptImageInput,completeGeneratedImage,buildReferenceImageUrls,pollImageTask,FalImageTaskFailedError}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const m25='gpt-image-2.5-sunburst',m26='gpt-image-2.6-sunburst';
const settings={quality:'high',background:'auto',outputFormat:'png'};

test('fal Sunburst routes retain version; only 2.6 receives reasoning, animation and markup',()=>{
  for(const [model,version] of [[m25,'2.5'],[m26,'2.6']])for(const edit of [false,true])assert.equal(falGptImageEndpoint(model,edit),`openai/gpt-image-${version}/sunburst/${edit?'edit':'text-to-image'}`);
  const first=falGptImageInput(m25,'Illustrate','auto',settings,[]);
  assert.deepEqual(first,{prompt:'Illustrate',num_images:1,image_size:'auto',quality:'high',background:'auto',output_format:'png',sync_mode:true});
  const gif=falGptImageInput(m26,'Animate','512x512',{...settings,outputFormat:'gif',complexity:'low',gifFrameCount:6,gifFrameDurationMs:200},[]);
  assert.deepEqual([gif.image_size,gif.reasoning_effort,gif.frame_count,gif.frame_duration_ms],[{width:512,height:512},'low',6,200]);
  const edit=falGptImageInput(m26,'Edit','auto',settings,[{image_url:'source'},{image_url:'donor'}],'outline');
  assert.deepEqual(edit.image_urls,['source','donor']);assert.equal(edit.markup_image_url,'outline');assert.equal(edit.mask_url,undefined);assert.equal(edit.output_format,'png');
});

test('only static vector graphics can be saved or recovered as SVG',()=>{
  const wrap=child=>Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50">'+child+'</svg>');
  assert.equal(completeGeneratedImage(wrap('<defs><linearGradient id="g"><stop offset="0%" stop-color="red"/></linearGradient></defs><path fill="url(#g)" d="M 0 0 L 1 1"/>'),'svg'),true);
  for(const child of ['<script/>','<foreignObject/>','<path onclick="alert(1)"/>','<use href="data:text/html,test"/>','<path style="fill:url(https://example.invalid/track)"/>','<image/>','<!DOCTYPE svg>','<rect></g>','<g xmlns="http://www.w3.org/1999/xhtml"/>'])assert.equal(completeGeneratedImage(wrap(child),'svg'),false);
  assert.equal(completeGeneratedImage(wrap('<path/>'),'png'),false);
  assert.equal(completeGeneratedImage(Buffer.from('<html>bad</html>'),'gif'),false);
});

test('a missing reference cannot silently change input ordering or turn an edit into text-to-image',async()=>{
  const valid={id:'first',data:'https://refs.example.invalid/first.png'};
  assert.deepEqual(await buildReferenceImageUrls([valid]),[valid.data]);
  for(const data of [undefined,null,'','  '])await assert.rejects(buildReferenceImageUrls([valid,{id:'second',data}]),/reference image could not be loaded/);
});

test('the browser treats only an explicit provider rejection/cancellation as a terminal image failure',async t=>{
  for (const status of ['FAILED','CANCELLED']) {
    const mock=t.mock.method(globalThis,'fetch',async()=>Response.json({status,error:'Declared by provider'}));
    await assert.rejects(pollImageTask('task','bytedance/seedream/v5.5/edit'),e=>e instanceof FalImageTaskFailedError && e.message==='Declared by provider');
    assert.equal(mock.mock.callCount(),1);mock.mock.restore();
  }
});
