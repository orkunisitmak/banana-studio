import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rules = [
  ['provider-credential', /(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}|AIza[A-Za-z0-9_-]{30,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{24,})/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['live-project-address', /https:\/\/[a-z]{20}\.supabase\.co\b/],
  ['machine-path', /(?:^|[^A-Za-z0-9])(?:\/(?:Users|home)\/(?!runner\b|user\b|example\b)[A-Za-z0-9_.-]+\/)/],
  ['machine-path', /(?:^|[^A-Za-z0-9])[A-Za-z]:\\[Uu][Ss][Ee][Rr][Ss]\\(?![Pp][Uu][Bb][Ll][Ii][Cc]\\)[A-Za-z0-9_. -]+\\/],
  ['signed-media-link', /https?:\/\/[^\s"'<>]+\/storage\/v1\/(?:object|render\/image)\/sign\/[^\s"'<>]+[?&]token=[A-Za-z0-9_.-]{25,}/],
];
const forbiddenPath = /(?:^|\/)(?:\.env(?:\..*)?|outputs?|\.local-runtime|\.local-data|\.vercel|\.DS_Store)(?:\/|$)|\.(?:p12|pfx|p8|pem|key|csr|cer|crt|provisionprofile|sqlite(?:3)?|db|log|dmg|zip)$/i;
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', '.build', 'DerivedData', 'release-artifacts', 'bin', 'obj']);

/** Reports rule IDs and paths only. Never print matching credential values. */
export function inspectContent(name, bytes) {
  const findings = [];
  if (name !== '.env.example' && forbiddenPath.test(name)) findings.push({ path: name, rule: 'private-file' });
  if (/(?:^|\/)(?:node_modules|dist|dist-ssr|\.build|DerivedData|release-artifacts)(?:\/|$)|^desktop\/windows\/(?:bin|obj)\//.test(name)) findings.push({path:name,rule:'tracked-build-product'});
  const text = bytes.toString('utf8');
  for (const [rule, pattern] of rules) if (pattern.test(text)) findings.push({ path: name, rule });
  if (name === '.env.example') {
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*(?:#|$)/.test(line)) continue;
      if (!/^[A-Z][A-Z0-9_]*=\s*$/.test(line)) findings.push({ path: name, rule: 'nonempty-environment-template' });
    }
  }
  for (const token of text.matchAll(/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/g)) {
    try {
      const payload = JSON.parse(Buffer.from(token[0].split('.')[1], 'base64url').toString());
      if (payload.role || payload.sub || payload.session_id) findings.push({ path: name, rule: 'embedded-session-or-api-jwt' });
    } catch { /* Not a JWT. */ }
  }
  return findings;
}

async function sourceFiles(root, relative = '') {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    if (entry.isDirectory()) files.push(...await sourceFiles(root, name));
    else files.push(name);
  }
  return files;
}

export async function auditPublicRelease(root, { history = false } = {}) {
  root = path.resolve(root);
  const findings = [];
  const discovered = await sourceFiles(root);
  let tracked=[];
  try { tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0').filter(Boolean); } catch { /* A pre-Git source copy is still audited. */ }
  const files=[...new Set([...discovered,...tracked])];
  for (const name of files) {
    const stat = await fs.lstat(path.join(root, name));
    if (stat.isSymbolicLink()) { findings.push({ path: name, rule: 'unreviewed-symlink' }); continue; }
    findings.push(...inspectContent(name, await fs.readFile(path.join(root, name))));
  }
  let historyBlobs = 0;
  if (history) {
    const historicNames=execFileSync('git',['log','--all','--name-only','--format=','-z'],{cwd:root,encoding:'utf8'}).split('\0').map(name=>name.trim()).filter(Boolean);
    for(const name of new Set(historicNames))findings.push(...inspectContent(name,Buffer.alloc(0)).filter(f=>['private-file','tracked-build-product'].includes(f.rule)).map(f=>({...f,history:true})));
    const objects = execFileSync('git', ['rev-list', '--objects', '--all'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    // Batch object metadata first; trees/commits are not executable source data.
    const metadata = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
      cwd: root, input: objects.map(line => line.split(' ')[0]).join('\n') + '\n', encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    }).trim().split('\n');
    for (const item of metadata) {
      const [oid, type, size] = item.split(' ');
      if (type !== 'blob') continue;
      const name = objects.find(line => line.startsWith(oid + ' '))?.slice(oid.length + 1) || oid;
      if (Number(size) > 20 * 1024 * 1024) { findings.push({ path: name, object: oid, rule: 'oversized-history-object' }); continue; }
      const bytes = execFileSync('git', ['cat-file', 'blob', oid], { cwd: root, maxBuffer: 21 * 1024 * 1024 });
      findings.push(...inspectContent(name, bytes).map(finding => ({ ...finding, object: oid })));
      historyBlobs++;
    }
  }
  return { ok: findings.length === 0, files: files.length, historyBlobs, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const target = process.argv.slice(2).find(arg => !arg.startsWith('--')) || process.cwd();
    const report = await auditPublicRelease(target, { history: process.argv.includes('--history') });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = report.ok ? 0 : 1;
  } catch { process.stderr.write('Public release audit could not complete. Nothing was approved for publication.\n'); process.exitCode = 1; }
}
