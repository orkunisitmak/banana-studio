import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createManifest } from './sign-windows-update.mjs';

// Proves that a manifest signed by the release script verifies in the packaged app,
// using an ephemeral key. No maintainer key or network access is involved.
const root=path.resolve(import.meta.dirname,'..');
const exe=path.join(root,'.build/staging-windows/Banana Studio/BananaStudio.exe');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-update-interop-'));
try{
 const version='9.9.9',archivePath=path.join(directory,`Banana-Studio-${version}-windows-x64.zip`);
 fs.writeFileSync(archivePath,'archive');
 const verificationPath=path.join(directory,'verification-windows-x64.json');
 fs.writeFileSync(verificationPath,JSON.stringify({version,sourceCommit:'0'.repeat(40),platform:'windows-x64',sha256:createHash('sha256').update('archive').digest('hex')}));
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64');
 const manifest=createManifest({archivePath,verificationPath,version,publicKey,privateKeyPem:pair.privateKey.export({format:'pem',type:'pkcs8'})});
 const keyFile=path.join(directory,'public.txt');fs.writeFileSync(keyFile,publicKey+'\n');
 const check=value=>{
  const file=path.join(directory,'windows-update.json');fs.writeFileSync(file,JSON.stringify(value));
  return spawnSync(exe,['--test-update-manifest',file,keyFile]).status;
 };
 if(check(manifest)!==0)throw new Error('The app rejected a manifest signed by the release script.');
 if(check({...manifest,size:manifest.size+1})!==1)throw new Error('The app accepted a changed manifest.');
 console.log('The app verifies manifests from the release script and rejects changed ones.');
}finally{fs.rmSync(directory,{recursive:true,force:true});}
