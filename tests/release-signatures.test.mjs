import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifySignedFeed, verifyReleaseArtifacts } from '../scripts/release-signatures.mjs';

const pair=()=>{const keys=generateKeyPairSync('ed25519');return {...keys,public:keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64')};};
const signed=(xml,key)=>{
 const bytes=Buffer.from(xml),signature=sign(null,bytes,key).toString('base64');
 return Buffer.concat([bytes,Buffer.from(`<!-- sparkle-signatures:\nedSignature: ${signature}\nlength: ${bytes.length}\n-->\n`)]);
};
test('public-key feed verification rejects changed bytes, another key, missing signatures and ambiguous signing blocks',()=>{
 const keys=pair(),xml='<?xml version="1.0"?><rss version="2.0"><channel><title>Synthetic</title></channel></rss>\n',feed=signed(xml,keys.privateKey);
 assert.equal(verifySignedFeed(feed,keys.public),xml);
 for(const invalid of [Buffer.from(xml),Buffer.from(feed.toString().replace('Synthetic','Modified!')),Buffer.concat([feed,feed]),Buffer.concat([feed,Buffer.from('unsigned suffix')]),Buffer.from(feed.toString().replace(/length: [0-9]+/,'length: 1'))])assert.throws(()=>verifySignedFeed(invalid,keys.public),/verification failed/);
 assert.throws(()=>verifySignedFeed(feed,pair().public),/verification failed/);
 assert.throws(()=>verifySignedFeed(signed('<!DOCTYPE rss [<!ENTITY extra SYSTEM "file:///private/canary">]><rss/>',keys.privateKey),keys.public),/verification failed/);
});

test('the release CLI fails closed without echoing untrusted record contents or changing files',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'banana-release-cli-')),directory=path.join(temporary,'0.1.0'),canary='synthetic-private-record-canary';
 try {
  fs.mkdirSync(directory);const record=path.join(directory,'verification-arm64.json'),contents=JSON.stringify({version:canary,privateNote:canary});fs.writeFileSync(record,contents);
  const result=spawnSync(process.execPath,[path.resolve(import.meta.dirname,'../scripts/verify-macos-release.mjs'),directory,'arm64'],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/verification failed/);assert.ok(!result.stderr.includes(canary)&&!result.stderr.includes(temporary));
  assert.equal(fs.readFileSync(record,'utf8'),contents);assert.deepEqual(fs.readdirSync(directory),['verification-arm64.json']);
 } finally {fs.rmSync(temporary,{recursive:true,force:true});}
});

test('release verification binds both signatures to one version, architecture, exact archive and intended repository',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'banana-release-verify-')),keys=pair();
 const version='0.1.0',build='7',architecture='arm64',sourceCommit='f'.repeat(40),archiveName='Banana-Studio-0.1.0-macos-arm64.zip',archivePath=path.join(temporary,archiveName),feedPath=path.join(temporary,'appcast-arm64.xml');
 const archive=Buffer.from('synthetic archive contents'),signature=sign(null,archive,keys.privateKey).toString('base64');
 const enclosure=`<enclosure url="https://github.com/orkunisitmak/banana-studio/releases/download/v${version}/${archiveName}" length="${archive.length}" type="application/octet-stream" sparkle:edSignature="${signature}"/>`;
 const xml=`<?xml version="1.0"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><item><link>https://github.com/orkunisitmak/banana-studio/commit/${sourceCommit}</link><sparkle:version>${build}</sparkle:version><sparkle:shortVersionString>${version}</sparkle:shortVersionString><sparkle:minimumSystemVersion>13.5.0</sparkle:minimumSystemVersion><sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>${enclosure}</item></channel></rss>\n`;
 const options={archivePath,feedPath,publicKey:keys.public,version,build,architecture,sourceCommit};
 try {
  fs.writeFileSync(archivePath,archive);fs.writeFileSync(feedPath,signed(xml,keys.privateKey));
  const report=verifyReleaseArtifacts(options);assert.equal(report.signatureVerified,true);assert.match(report.archiveSha256,/^[a-f0-9]{64}$/);assert.equal(report.archive,archiveName);
  fs.writeFileSync(feedPath,signed(xml.replace(enclosure,enclosure.replace('/>','></enclosure>')),keys.privateKey));assert.equal(verifyReleaseArtifacts(options).signatureVerified,true);
  fs.writeFileSync(archivePath,Buffer.alloc(archive.length,1));assert.throws(()=>verifyReleaseArtifacts(options),/verification failed/);fs.writeFileSync(archivePath,archive);
  for(const modified of [xml.replace('/orkunisitmak/banana-studio/','/another-owner/another-repo/'),xml.replace(enclosure,enclosure+enclosure),xml.replace('length="'+archive.length+'"','length="1"'),xml.replace('<sparkle:version>7','<sparkle:version>8')]){
   fs.writeFileSync(feedPath,signed(modified,keys.privateKey));assert.throws(()=>verifyReleaseArtifacts(options),/verification failed/);
  }
  fs.writeFileSync(feedPath,signed(xml,keys.privateKey));assert.throws(()=>verifyReleaseArtifacts({...options,build:'8'}),/verification failed/);assert.throws(()=>verifyReleaseArtifacts({...options,sourceCommit:'e'.repeat(40)}),/verification failed/);
  fs.rmSync(archivePath);
  try {
   fs.symlinkSync(feedPath,archivePath);assert.throws(()=>verifyReleaseArtifacts(options),/verification failed/);
  } catch(err) {
   if (err?.code !== 'EPERM' || process.platform !== 'win32') throw err;
  }
 } finally {fs.rmSync(temporary,{recursive:true,force:true});}
});
