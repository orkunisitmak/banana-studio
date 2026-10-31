import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { auditPublicRelease, inspectContent } from '../scripts/audit-public-release.mjs';

test('release auditing detects secrets without returning their values', () => {
  const secret = ['sk', 'proj', 'A'.repeat(40)].join('-');
  const findings = inspectContent('source.ts', Buffer.from(secret));
  assert.equal(findings[0].rule, 'provider-credential');
  assert.ok(!JSON.stringify(findings).includes(secret));
  assert.equal(inspectContent('.env.local', Buffer.from('EMPTY=')).at(0).rule, 'private-file');
  assert.deepEqual(inspectContent('.env.example', Buffer.from('OPENAI_API_KEY=\nSUPABASE_URL=\n')), []);
  assert.ok(inspectContent('.env.example', Buffer.from('OPENAI_API_KEY=anything\n')).length);
  const windowsPath = ['const workspace = "' + String.fromCharCode(67) + ':', ['Us','ers'].join(''), 'Ada', 'Documents', 'banana";'].join(String.fromCharCode(92));
  assert.deepEqual(inspectContent('source.ts', Buffer.from(windowsPath)), [{ path: 'source.ts', rule: 'machine-path' }]);
  assert.deepEqual(inspectContent('unix.ts', Buffer.from(['const workspace = "', ['/', 'home/Runner/Documents/banana'].join(''), '";'].join(''))), [{ path: 'unix.ts', rule: 'machine-path' }]);
  assert.deepEqual(inspectContent('unix.ts', Buffer.from('const workspace = "/home/runner/Documents/banana";')), []);
});

test('fresh source scans reject unexpected private files and external symlinks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'banana-release-audit-'));
  try {
    await fs.writeFile(path.join(root, 'source.ts'), 'export const name = "Banana Studio";');
    assert.equal((await auditPublicRelease(root)).ok, true);
    await fs.writeFile(path.join(root, '.env.local'), 'OPENAI_API_KEY=');
    await fs.symlink(os.tmpdir(), path.join(root, 'external'),process.platform==='win32'?'junction':'dir');
    const result = await auditPublicRelease(root);
    assert.equal(result.ok, false);
    assert.deepEqual(result.findings.map(f => f.rule).sort(), ['private-file', 'unreviewed-symlink']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('a deleted secret in an earlier commit still blocks publishing the repository', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'banana-history-audit-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    await fs.writeFile(path.join(root, 'source.ts'), ['sb', 'secret', 'A'.repeat(40)].join('_'));
    git('add', '.'); git('commit', '-m', 'Initial');
    await fs.writeFile(path.join(root, 'source.ts'), 'export const clean = true;');
    git('add', '.'); git('commit', '-m', 'Remove secret');
    assert.equal((await auditPublicRelease(root)).ok, true);
    const result = await auditPublicRelease(root, { history: true });
    assert.equal(result.ok, false);
    assert.equal(result.historyBlobs, 2);
    assert.ok(result.findings.some(f => f.rule === 'provider-credential' && f.object));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
