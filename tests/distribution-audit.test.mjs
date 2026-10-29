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

test('distribution audit catches GitHub tokens, fal keys and session JWTs but allows a public anon key', () => {
  const jwt = payload => ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'c2lnbmF0dXJlc2lnbmF0dXJlc2ln'].join('.');
  const scan = text => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-dist-parity-'));
    try { fs.writeFileSync(path.join(dir, 'bundle.js'), text); return auditDistribution(dir).findings.map(f => f.rule); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  assert.deepEqual(scan(`k='${'ghp_' + 'A'.repeat(36)}'`), ['artifact-credential']);
  assert.deepEqual(scan(`k='${'github_pat_' + 'B'.repeat(40)}'`), ['artifact-credential']);
  assert.deepEqual(scan(`k='${['0123abcd-4567-89ab-cdef-0123456789ab', '0123456789abcdef0123456789abcdef'].join(':')}'`), ['artifact-credential']);
  assert.deepEqual(scan(`k='${jwt({ role: 'service_role' })}'`), ['artifact-session-or-api-jwt']);
  assert.deepEqual(scan(`k='${jwt({ sub: 'user-1', role: 'authenticated' })}'`), ['artifact-session-or-api-jwt']);
  assert.deepEqual(scan(`k='${jwt({ sub: 'user-1' })}'`), ['artifact-session-or-api-jwt']);
  assert.deepEqual(scan(`k='${jwt({ session_id: 'session-1' })}'`), ['artifact-session-or-api-jwt']);
  assert.deepEqual(scan(`k='${jwt({ role: 'anon' })}'`), []);
});
