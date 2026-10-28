import test from 'node:test';
import assert from 'node:assert/strict';
import { getClipboardImages } from '../src/lib/references/clipboardImages.ts';
import { postNativeAction } from '../desktop/shared/nativeBridge.ts';

test('clipboard text stays native; WebKit and Windows image collections work without duplicates',()=>{
 const image=new File(['synthetic'],'copied.png',{type:'image/png'});
 const text=new File(['text'],'note.txt',{type:'text/plain'});
 assert.deepEqual(getClipboardImages({items:[],files:[text]}),[]);
 assert.deepEqual(getClipboardImages(null),[]);
 assert.deepEqual(getClipboardImages({items:[{kind:'file',type:'image/png',getAsFile:()=>image}],files:[image]}),[image]);
 assert.deepEqual(getClipboardImages({items:[],files:[image,text]}),[image]);
 assert.deepEqual(getClipboardImages({items:[{kind:'file',type:'image/png',getAsFile:()=>null}],files:[image]}),[image]);
});
test('native commands reach the matching shell (WKWebView/WebKitGTK or WebView2) and never run on a remote origin',()=>{
 const oldWindow=globalThis.window,oldLocation=globalThis.location;
 const messages=[];
 try {
  globalThis.location={protocol:'http:',hostname:'127.0.0.1'};
  globalThis.window={webkit:{messageHandlers:{bananaNative:{postMessage:value=>messages.push(['mac',value])}}}};
  postNativeAction('keys');
  globalThis.window={chrome:{webview:{postMessage:value=>messages.push(['windows',value])}}};
  postNativeAction('keys');postNativeAction('lock');
  globalThis.location={protocol:'https:',hostname:'example.invalid'};postNativeAction('keys');
  assert.deepEqual(messages,[['mac',{action:'keys'}],['windows',{action:'keys'}],['windows',{action:'lock'}]]);
 } finally {
  if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;
  if(oldLocation===undefined)delete globalThis.location;else globalThis.location=oldLocation;
 }
});
test('Linux and Windows workspaces encode and decode protected-edit pixels without the Mac codec',async()=>{
 if(process.platform==='darwin')return;
 const {decodeRaster,encodeRasterPNG}=await import('../desktop/server/rasterCodec.mjs');
 const pixels=Buffer.from([255,0,0,255,0,255,0,255,0,0,255,128,9,8,7,0]);
 const png=await encodeRasterPNG(pixels,2,2);
 assert.ok(png.subarray(1,4).equals(Buffer.from('PNG')));
 const {data,info}=await decodeRaster(png);
 assert.deepEqual([info.width,info.height,info.channels],[2,2,4]);
 assert.ok(data.equals(pixels));
});
