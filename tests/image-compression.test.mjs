import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import {fileURLToPath} from 'node:url';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/services/imageCompression.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'});
const {compressBase64Image,imageDataMimeType}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const original={Image:globalThis.Image,document:globalThis.document};
function canvasFixture({encodedMime,fail=false}={}){
 const draws=[];const canvas={width:0,height:0,getContext:()=>({drawImage:()=>draws.push('image'),fillRect:()=>draws.push('fill')}),toDataURL:mime=>{if(fail)throw new Error('synthetic encoder error');return `data:${encodedMime||mime};base64,ZW5jb2RlZA==`;}};
 globalThis.document={createElement:()=>canvas};
 globalThis.Image=class{naturalWidth=4000;naturalHeight=2000;set src(v){this.source=v;queueMicrotask(()=>this.onload());}};
 return{canvas,draws};
}
test.after(()=>{Object.assign(globalThis,original);});
test('PNG/WebP keep alpha-capable encoding and JPEG remains JPEG at bounded dimensions',async()=>{
 for(const mime of ['image/png','image/webp','image/jpeg']){
  const {canvas,draws}=canvasFixture();const result=await compressBase64Image('c3ludGhldGlj',mime,{maxDimension:1000});
  assert.equal(result.mimeType,mime);assert.equal(result.data,'ZW5jb2RlZA==');assert.deepEqual(draws,['image']);assert.equal(canvas.width,1000);assert.equal(canvas.height,500);
 }
});
test('data URL and actual encoder MIME override stale metadata; WebP fallback PNG stays correctly labelled',async()=>{
 canvasFixture({encodedMime:'image/png'});const r=await compressBase64Image('data:image/webp;base64,eA==','image/jpeg');assert.equal(r.mimeType,'image/png');assert.equal(imageDataMimeType('data:image/PNG;base64,eA==','image/jpeg'),'image/png');
});
test('unexpected lossy encoder or canvas failure preserves original bytes and actual MIME',async()=>{
 const previous=console.warn;console.warn=()=>{};
 try{for(const config of [{encodedMime:'image/jpeg'},{fail:true}]){canvasFixture(config);assert.deepEqual(await compressBase64Image('data:image/png;base64,eA==','image/jpeg'),{data:'eA==',mimeType:'image/png'});}}finally{console.warn=previous;}
});

test('strict attachment callers still reject compression failures',async()=>{canvasFixture({fail:true});await assert.rejects(compressBase64Image('data:image/png;base64,eA==','image/png',{fallbackToOriginal:false}),/synthetic encoder error/);});
