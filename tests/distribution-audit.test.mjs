import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditDistribution } from '../scripts/audit-distribution.mjs';
test('artifact audit checks all dependency files and rejects external links and private data',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'banana-artifact-'));
 try{
  fs.mkdirSync(path.join(root,'node_modules/dependency'),{recursive:true});fs.writeFileSync(path.join(root,'node_modules/dependency/file.js'),'export const value=1;');assert.equal(auditDistribution(root).ok,true);
  fs.writeFileSync(path.join(root,'node_modules/dependency/.env'),'');fs.symlinkSync(os.tmpdir(),path.join(root,'escape'),process.platform==='win32'?'junction':'dir');fs.writeFileSync(path.join(root,'bundle.js'),'synthetic-private-canary');
  const r=auditDistribution(root,{privateMarkers:['synthetic-private-canary']});assert.equal(r.ok,false);assert.deepEqual(new Set(r.findings.map(f=>f.rule)),new Set(['private-artifact-file','external-artifact-symlink','private-artifact-marker']));assert.ok(!JSON.stringify(r).includes('synthetic-private-canary'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
