import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createKeyPair, createManifest, createTrackedKeyPair, verifyManifest } from '../scripts/sign-windows-update.mjs';

const commit='0123456789abcdef0123456789abcdef01234567';
const fixture=(t,version='1.2.3',overrides={})=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-windows-update-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const archivePath=path.join(directory,`Banana-Studio-${version}-windows-x64.zip`);
 fs.writeFileSync(archivePath,'archive');
 const sha256=createHash('sha256').update('archive').digest('hex');
 const verificationPath=path.join(directory,'verification-windows-x64.json');
 fs.writeFileSync(verificationPath,JSON.stringify({version,sourceCommit:commit,platform:'windows-x64',sha256,...overrides}));
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 return {directory,archivePath,verificationPath,version,
  privateKeyPem:pair.privateKey.export({format:'pem',type:'pkcs8'}),
  publicKey:pair.publicKey.export({format:'der',type:'spki'}).toString('base64')};
};

test('a signed manifest describes the exact archive and verifies',t=>{
 const {directory,...input}=fixture(t);
 const manifest=createManifest(input);
 assert.equal(manifest.url,'https://github.com/orkunisitmak/banana-studio/releases/download/v1.2.3/Banana-Studio-1.2.3-windows-x64.zip');
 assert.equal(manifest.size,7);
 assert.equal(manifest.sourceCommit,commit);
 assert.equal(Buffer.from(manifest.signature,'base64').length,64);
 assert.ok(verifyManifest(manifest,input.publicKey));
});

test('every signed field is protected',t=>{
 const {directory,...input}=fixture(t);
 const manifest=createManifest(input);
 for(const change of [{version:'9.9.9'},{sourceCommit:'f'.repeat(40)},{url:'https://example.com/a.zip'},{size:8},{sha256:'a'.repeat(64)},{signature:'AAAA'}])
  assert.equal(verifyManifest({...manifest,...change},input.publicKey),false,JSON.stringify(change));
});

test('a key the installed apps would reject stops signing',t=>{
 const {directory,...input}=fixture(t);
 const other=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'der',type:'spki'}).toString('base64');
 assert.throws(()=>createManifest({...input,publicKey:other}),/does not match the tracked/);
});

test('an archive that differs from its verification record is refused',t=>{
 const {directory,...input}=fixture(t,'1.2.3',{sha256:'a'.repeat(64)});
 assert.throws(()=>createManifest(input),/does not match its verification/);
});

test('a prerelease cannot become an update',t=>{
 const {directory,...input}=fixture(t,'1.2.3-beta');
 assert.throws(()=>createManifest(input),/plain release version/);
});

test('an existing signing key is never replaced',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-windows-key-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const file=path.join(directory,'key.pem');
 assert.ok(createKeyPair(file).length>0);
 assert.throws(()=>createKeyPair(file),/Refusing to replace/);
});

test('a tracked public key is never replaced by a new key pair',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-windows-tracked-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const publicKeyFile=path.join(directory,'public.txt');
 fs.writeFileSync(publicKeyFile,'\n');
 createTrackedKeyPair(path.join(directory,'first.pem'),publicKeyFile);
 const tracked=fs.readFileSync(publicKeyFile,'utf8');
 assert.ok(tracked.trim().length>0);
 assert.throws(()=>createTrackedKeyPair(path.join(directory,'second.pem'),publicKeyFile),/already tracked/);
 assert.equal(fs.readFileSync(publicKeyFile,'utf8'),tracked);
 assert.equal(fs.existsSync(path.join(directory,'second.pem')),false);
});
