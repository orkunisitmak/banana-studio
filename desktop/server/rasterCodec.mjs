import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runCodec=request=>new Promise((resolve,reject)=>{
 const executable=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../MacOS/BananaStudio');
 const child=spawn(executable,['--raster-codec'],{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','ignore']});
 const parts=[];let size=0,settled=false;
 const timer=setTimeout(()=>{child.kill('SIGTERM');fail();},30_000);
 const fail=()=>{if(settled)return;settled=true;clearTimeout(timer);reject(new Error('macOS could not process the image. The protected edit was not saved.'));};
 child.on('error',fail);child.stdout.on('data',part=>{size+=part.length;if(size>200*1024*1024){child.kill('SIGTERM');fail();}else parts.push(part);});
 child.on('close',code=>{if(settled)return;if(code!==0)return fail();try{const value=JSON.parse(Buffer.concat(parts));settled=true;clearTimeout(timer);resolve(value);}catch{fail();}});
 child.stdin.on('error',fail);child.stdin.end(JSON.stringify(request));
});
export const decodeRaster=async bytes=>{
 if(process.platform==='win32'||process.platform==='linux'){
  const {default:sharp}=await import('sharp');
  return sharp(bytes,{limitInputPixels:33_554_432,failOn:'error'}).autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
 }
 const result=await runCodec({operation:'decode',data:bytes.toString('base64')});
 const data=Buffer.from(result.data,'base64');if(!Number.isInteger(result.width)||!Number.isInteger(result.height)||data.length!==result.width*result.height*4)throw new Error('Invalid macOS image response.');
 return {data,info:{width:result.width,height:result.height,channels:4}};
};
export const encodeRasterPNG=async(pixels,width,height)=>{
 if(process.platform==='win32'||process.platform==='linux'){
  const {default:sharp}=await import('sharp');
  return sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer();
 }
 const result=await runCodec({operation:'encode',data:Buffer.from(pixels).toString('base64'),width,height});return Buffer.from(result.data,'base64');
};
