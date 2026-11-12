import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { renderToString, renderToPipeableStream } from 'react-dom/server';
import { PassThrough } from 'node:stream';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const root=fileURLToPath(new URL('..',import.meta.url));
const result=await build({entryPoints:[path.join(root,'src/components/DeferredAdminPanel.tsx')],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'synthetic-admin',setup(b){
 b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));
 b.onResolve({filter:/\/AdminPanel$/},()=>({path:'admin',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from 'react';export function AdminPanel({isOpen}){return isOpen?React.createElement('p',null,'synthetic admin loaded'):null;}`,loader:'js'}));
}}]});
const {DeferredAdminPanel}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const props={isOpen:false,onClose(){},onViewUserGallery(){}};
test('closed admin contributes no rendered UI before first use',()=>assert.equal(renderToString(React.createElement(DeferredAdminPanel,props)),''));
test('first open resolves a lazy component through Suspense',async()=>{
 const html=await new Promise((resolve,reject)=>{const out=new PassThrough();let html='';out.on('data',chunk=>html+=chunk);out.on('end',()=>resolve(html));out.on('error',reject);
 const stream=renderToPipeableStream(React.createElement(DeferredAdminPanel,{...props,isOpen:true}),{onAllReady(){stream.pipe(out);},onError:reject});});
 assert.match(html,/synthetic admin loaded/);assert.doesNotMatch(html,/Could not load/);
});
