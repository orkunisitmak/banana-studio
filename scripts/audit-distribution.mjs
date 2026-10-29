import fs from 'node:fs';
import path from 'node:path';

// Apply to the assembled .app, after all copying and signing. Unlike source
// scanning, this never skips dependency/build directories inside the artifact.
export function auditDistribution(directory,{privateMarkers=[]}={}) {
 const root=fs.realpathSync(directory),findings=[];let files=0;
 const visit=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name),name=path.relative(root,file).split(path.sep).join('/');
  if(entry.isSymbolicLink()){
   const link=fs.readlinkSync(file);let target;try{target=fs.realpathSync(file);}catch{}
   if(path.isAbsolute(link)||!target||!target.startsWith(root+path.sep))findings.push({path:name,rule:'external-artifact-symlink'});continue;
  }
  if(entry.isDirectory()){if(/^(?:media|outputs?|\.local-data|\.local-runtime|\.git|\.vercel)$/i.test(entry.name))findings.push({path:name,rule:'private-artifact-directory'});visit(file);continue;}
  files++;
  if(/(?:^|\/)(?:\.env(?:\..*)?|workspace\.sqlite(?:-wal|-shm)?)(?:$)|\.(?:p12|pfx|p8|pem|key|sqlite3?|db|log)$/i.test(name))findings.push({path:name,rule:'private-artifact-file'});
  const bytes=fs.readFileSync(file),text=bytes.toString('utf8');
  if(/(?<![A-Za-z0-9_])(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}|AIza[A-Za-z0-9_-]{30,}|sb_secret_[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{24,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}(?![0-9a-f])|-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----\s*[A-Za-z0-9+/=\r\n]{64,}-----END (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----)/.test(text))findings.push({path:name,rule:'artifact-credential'});
  // Session/service JWTs (a public anon key is allowed).
  for(const token of text.matchAll(/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/g)){
   try{const payload=JSON.parse(Buffer.from(token[0].split('.')[1],'base64url').toString());if((payload.role&&payload.role!=='anon')||payload.sub||payload.session_id){findings.push({path:name,rule:'artifact-session-or-api-jwt'});break;}}catch{/* Not a JWT. */}
  }
  if(privateMarkers.some(marker=>marker.length>=12&&bytes.includes(Buffer.from(marker))))findings.push({path:name,rule:'private-artifact-marker'});
 }};visit(root);return {ok:findings.length===0,files,findings};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
 const root=process.argv[2];if(!root)throw new Error('Pass the assembled app bundle path.');
 const report=auditDistribution(root);console.log(JSON.stringify(report,null,2));process.exitCode=report.ok?0:1;
}
