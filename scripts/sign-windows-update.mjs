import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Signs the Windows update manifest with a separate ECDSA P-256 key, which .NET
// verifies without extra packages. The private key stays with the maintainer,
// outside the repository; only desktop/windows/WindowsUpdatePublicKey.txt is tracked.
const root=path.resolve(import.meta.dirname,'..');
const REPOSITORY='orkunisitmak/banana-studio';
const publicKeyDer=key=>createPublicKey({key:Buffer.from(key,'base64'),format:'der',type:'spki'});

export const signedBytes=update=>Buffer.from([
 'banana-studio-windows-update-v1',update.version,update.sourceCommit,update.url,String(update.size),update.sha256,
].join('\n'),'utf8');

export const verifyManifest=(update,publicKey)=>{
 try{return verify('sha256',signedBytes(update),{key:publicKeyDer(publicKey),dsaEncoding:'ieee-p1363'},Buffer.from(update.signature,'base64'));}
 catch{return false;}
};

export function createKeyPair(privateKeyPath){
 if(fs.existsSync(privateKeyPath))throw new Error('Refusing to replace an existing signing key: installed apps trust its public key.');
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 fs.writeFileSync(privateKeyPath,pair.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600,flag:'wx'});
 return pair.publicKey.export({format:'der',type:'spki'}).toString('base64');
}

export function createManifest({archivePath,verificationPath,privateKeyPem,publicKey,version,repository=REPOSITORY}){
 if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Only a plain release version can be published as an update.');
 const name=`Banana-Studio-${version}-windows-x64.zip`;
 if(path.basename(archivePath)!==name)throw new Error(`Expected the archive to be named ${name}.`);
 const bytes=fs.readFileSync(archivePath),sha256=createHash('sha256').update(bytes).digest('hex');
 const verification=JSON.parse(fs.readFileSync(verificationPath,'utf8').replace(/^﻿/,''));
 if(verification.sha256!==sha256||verification.version!==version||verification.platform!=='windows-x64'||!/^[0-9a-f]{40}$/.test(verification.sourceCommit||''))
  throw new Error('The archive does not match its verification record.');
 const update={version,sourceCommit:verification.sourceCommit,url:`https://github.com/${repository}/releases/download/v${version}/${name}`,size:bytes.length,sha256};
 const signature=sign('sha256',signedBytes(update),{key:createPrivateKey(privateKeyPem),dsaEncoding:'ieee-p1363'}).toString('base64');
 const manifest={...update,signature};
 // Stops a release signed with a key that installed apps would reject.
 if(!verifyManifest(manifest,publicKey))throw new Error('The private key does not match the tracked Windows update public key.');
 return manifest;
}

const usage='Usage: node scripts/sign-windows-update.mjs --generate-key <new-private-key.pem>\n       node scripts/sign-windows-update.mjs <archive.zip> --key <private-key.pem>';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),publicKeyFile=path.join(root,'desktop/windows/WindowsUpdatePublicKey.txt');
 if(args[0]==='--generate-key'&&args[1]){
  fs.writeFileSync(publicKeyFile,createKeyPair(args[1])+'\n');
  console.log(`Private key: ${args[1]}. Keep it outside the repository and back it up.\nPublic key: ${path.relative(root,publicKeyFile)}. Commit this file.`);
 }else if(args[1]==='--key'&&args[2]){
  const publicKey=fs.readFileSync(publicKeyFile,'utf8').trim();
  if(!publicKey)throw new Error('No Windows update public key is tracked yet. Run --generate-key first.');
  const archivePath=path.resolve(args[0]),directory=path.dirname(archivePath);
  const manifest=createManifest({archivePath,verificationPath:path.join(directory,'verification-windows-x64.json'),privateKeyPem:fs.readFileSync(args[2]),publicKey,version:JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version});
  fs.writeFileSync(path.join(directory,'windows-update.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(`Signed ${path.join(directory,'windows-update.json')} for ${manifest.version}.`);
 }else{console.error(usage);process.exitCode=2;}
}
