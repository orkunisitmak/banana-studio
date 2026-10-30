import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {compressBase64Image} from '../../src/services/imageCompression';
import {compressImage} from '../../src/services/storageService';
import '../../src/styles/index.css';
window.fetch=async()=>{throw new Error('Network blocked by synthetic fixture');};
const pixels=async(data:string)=>{const img=new Image();img.src=data;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d')!;ctx.drawImage(img,0,0);return Array.from(ctx.getImageData(0,0,c.width,c.height).data);};
function Fixture(){
 const [rows,setRows]=useState<any[]>([]),[error,setError]=useState('');
 const run=async()=>{try{
  const c=document.createElement('canvas');c.width=2;c.height=1;const ctx=c.getContext('2d')!;ctx.fillStyle='#e03040';ctx.fillRect(1,0,1,1);
  const results=[];
  for(const mime of ['image/png','image/webp']){const input=c.toDataURL(mime);const result=await compressBase64Image(input,'image/jpeg');const url=`data:${result.mimeType};base64,${result.data}`;const values=await pixels(url);results.push({path:'text reference',inputMime:mime,outputMime:result.mimeType,transparentAlpha:values[3],opaqueAlpha:values[7],passed:values[3]===0&&values[7]===255,url});}
  const stored=await compressImage(c.toDataURL('image/png'));const values=await pixels(stored);results.push({path:'attachment / saved person',outputMime:stored.slice(5,stored.indexOf(';')),transparentAlpha:values[3],opaqueAlpha:values[7],passed:values[3]===0&&values[7]===255,url:stored});setRows(results);
 }catch(e){setError(String(e));}};
 return <main className="min-h-screen bg-[#0d1117] p-8 text-white"><h1 className="mb-4 text-2xl">Reference transparency review</h1><p>Synthetic 2×1 image only. Checkerboard shows the transparent pixel. No user media or provider calls.</p><button className="my-4 rounded bg-violet-600 p-3" onClick={run}>Run alpha checks</button><p role="alert">{error}</p>{rows.map((r,i)=><section key={i} className="my-5"><h2>{r.path} · {r.outputMime}</h2><img alt={`Transparency result ${i+1}`} src={r.url} style={{width:240,height:120,imageRendering:'pixelated',background:'repeating-conic-gradient(#ccc 0% 25%, #777 0% 50%) 50% / 20px 20px'}}/><pre>{JSON.stringify({...r,url:undefined},null,2)}</pre></section>)}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
