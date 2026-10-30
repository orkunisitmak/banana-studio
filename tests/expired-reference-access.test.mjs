import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, transformSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const stale = 'https://private.example/storage/v1/object/sign/media/ref.png?token=expired';
const fresh = stale.replace('expired', 'renewed');
const out = await build({entryPoints:[fileURLToPath(new URL('../src/services/imageEditService.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'synthetic-storage',setup(b){
  b.onResolve({filter:/^\.\/storageService$/},()=>({path:'storage',namespace:'stub'}));
  b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const refreshMediaAccessUrl=(...args)=>globalThis.__renewReference(...args);',loader:'js'}));
}}]});
const imageService = await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));

test('protected editing renews a saved source before decoding and keeps outside pixels intact', async () => {
  const previous = {Image:globalThis.Image,ImageData:globalThis.ImageData,document:globalThis.document,renew:globalThis.__renewReference};
  const renewals = [], loaded = [];
  try {
    globalThis.__renewReference = async (url,provider) => { renewals.push([url,provider]); return url.replace('expired','renewed'); };
    globalThis.Image = class {
      naturalWidth=4;naturalHeight=4;
      async decode(){loaded.push(this.src);if(this.src.includes('expired'))throw new Error('expired synthetic image');}
    };
    globalThis.ImageData = class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
    globalThis.document = {createElement:kind=>{
      assert.equal(kind,'canvas');let pixels;
      const context={drawImage(image){pixels=new Uint8ClampedArray(64).fill(image.src.includes('output')?99:7);},getImageData(){return {data:pixels};},putImageData(image){pixels=image.data;}};
      return {getContext:()=>context,toDataURL:()=>`data:image/png;base64,${Buffer.from(pixels).toString('base64')}`};
    }};
    const reference={id:'saved-source',data:stale,mimeType:'image/png',editRegion:{x:.25,y:.25,width:.5,height:.5}};
    const source=await imageService.prepareProtectedImageSource({imageModel:'nano-banana-pro',referenceImages:[reference],aspectRatio:'1:1'});
    const result=await imageService.finishProtectedImageEdit({id:'output',url:'https://private.example/output.png?token=expired'},source);
    assert.deepEqual(loaded,[fresh,'https://private.example/output.png?token=renewed']);
    assert.deepEqual(renewals,[[stale,false],['https://private.example/output.png?token=expired',false]]);
    const pixels=Buffer.from(result.url.split(',')[1],'base64');
    for(let y=0;y<4;y++)for(let x=0;x<4;x++)assert.equal(pixels[(y*4+x)*4],x>=1&&x<3&&y>=1&&y<3?99:7);
    assert.equal(result.imageEditProtection.preservedOutsideRegion,true);
    assert.equal(reference.data,stale,'renewal must not mutate the saved source reference');
  } finally {for(const key of ['Image','ImageData','document']){if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];}if(previous.renew===undefined)delete globalThis.__renewReference;else globalThis.__renewReference=previous.renew;}
});

const runway=readFileSync(new URL('../src/services/runwayService.ts',import.meta.url),'utf8');
const resolve=runway.slice(runway.indexOf('const resolveReferenceMediaUrl = async'),runway.indexOf('const prepareH3ReferenceAudio = async'));
const prepare=runway.slice(runway.indexOf('const prepareReferenceVideos = async'),runway.indexOf('// A ratio-adapted continuation'));
const runwayCode=transformSync(`module.exports=env=>{const {refreshMediaAccessUrl,getMediaDuration,videoAspectMatchesTarget,extractContinuationFirstFrame}=env;const isHttpUrl=url=>/^https?:/.test(url);${resolve}${prepare}return prepareReferenceVideos;}`,{loader:'ts',format:'cjs'}).code;

test('continuation duration, aspect inspection and frame extraction reuse the renewed video URL',async()=>{
  const consumed=[],renewed=[];
  const mod={exports:{}};new Function('module',runwayCode)(mod);
  const freshVideo=fresh.replace('ref.png','ref.mp4');
  const use=(stage,url)=>{consumed.push([stage,url]);assert.equal(url,freshVideo,`${stage} must not consume an expired saved reference`);};
  const prepare=mod.exports({refreshMediaAccessUrl:async url=>{renewed.push(url);return freshVideo;},getMediaDuration:async url=>{use('duration',url);return 3;},videoAspectMatchesTarget:async url=>{use('aspect',url);return false;},extractContinuationFirstFrame:async url=>{use('frame',url);return {id:'frame',data:'data:synthetic'};}});
  const reference={id:'saved-video',url:stale.replace('ref.png','ref.mp4'),mimeType:'video/mp4',isContinuation:true};
  const result=await prepare([reference],'1:1','720p','seedance-2.0','generate');
  assert.deepEqual(renewed,[reference.url]);assert.equal(result.persistedVideos[0].url,freshVideo);
  assert.deepEqual(consumed.map(x=>x[0]),['duration','aspect','frame']);
  assert.deepEqual(result.extractedVideoIndices,[0]);assert.deepEqual(result.requestVideos,[]);
});

const controls=readFileSync(new URL('../src/components/Controls.tsx',import.meta.url),'utf8');
const dropStart=controls.indexOf('    // 2. Handle Gallery Drops',controls.indexOf('  const handleDrop = async'));
const dropBody=controls.slice(dropStart,controls.indexOf('\n  };',dropStart));
const dropCode=transformSync(`module.exports=env=>{const {refreshMediaAccessUrl,fetch,processImageFiles,setAttachmentError,config,onChange}=env;const isH3VideoConfig=false,maxReferenceVideos=3;return async e=>{${dropBody}};}`,{loader:'ts',format:'cjs'}).code;
const dropFixture=(failRenew=false)=>{
  const fetched=[],attached=[],errors=[];const mod={exports:{}};new Function('module',dropCode)(mod);
  const handler=mod.exports({refreshMediaAccessUrl:async(url,provider)=>{assert.equal(provider,false);if(failRenew)throw new Error('Private reference media access could not be authorized.');return fresh;},fetch:async url=>{fetched.push(url);return new Response(url===fresh?'synthetic':'expired',{status:url===fresh?200:403,headers:{'Content-Type':'image/png'}});},processImageFiles:async files=>attached.push(...files),setAttachmentError:error=>errors.push(error),config:{referenceImages:[]},onChange:()=>{}});
  return {fetched,attached,errors,run:()=>handler({dataTransfer:{getData:()=>JSON.stringify({url:stale,mediaType:'image'})}})};
};
test('a gallery image dropped after its URL expires renews access before attaching',async()=>{
  const f=dropFixture();await f.run();assert.deepEqual(f.fetched,[fresh]);assert.equal(f.attached.length,1);assert.deepEqual(f.errors,[]);
});
test('a dropped gallery image reports renewal failures and keeps the draft unchanged',async()=>{
  const f=dropFixture(true);await f.run();assert.deepEqual(f.fetched,[]);assert.deepEqual(f.attached,[]);assert.deepEqual(f.errors,['Private reference media access could not be authorized.']);
});

const libraryDrop=controls.slice(controls.indexOf('  const handleGalleryDrop = async'),controls.indexOf('  const handleAddFromGallery'));
const libraryCode=transformSync(`module.exports=env=>{const {refreshMediaAccessUrl,fetch,FileReader,setGenerationError,saveReferenceImage}=env;const config={referenceImages:[]},refGallery=[];const setIsDraggingToGallery=()=>{},setRefGallery=()=>{};${libraryDrop}return handleGalleryDrop;}`,{loader:'ts',format:'cjs'}).code;
for(const failRenew of [false,true])test(`reference library drops ${failRenew?'report inaccessible saved images':'renew expired saved images before copying'}`,async()=>{
  const saved=[],errors=[],fetched=[];const mod={exports:{}};new Function('module',libraryCode)(mod);
  const run=mod.exports({refreshMediaAccessUrl:async(url,provider)=>{assert.equal(provider,false);if(failRenew)throw new Error('Private reference media access could not be authorized.');return fresh;},fetch:async url=>{fetched.push(url);return new Response('synthetic',{status:url===fresh?200:403,headers:{'Content-Type':'image/png'}});},FileReader:class {readAsDataURL(){this.result='data:image/png;base64,c3ludGhldGlj';this.onload();}},setGenerationError:error=>errors.push(error),saveReferenceImage:async image=>saved.push(image)});
  await run({preventDefault(){},dataTransfer:{getData:type=>type==='application/nanogen-media'?JSON.stringify({url:stale}):''}});
  assert.deepEqual(fetched,failRenew?[]:[fresh]);assert.equal(saved.length,failRenew?0:1);
  assert.deepEqual(errors,failRenew?['Private reference media access could not be authorized.']:[]);
});
