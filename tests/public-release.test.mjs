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

test('linked worktree metadata is excluded without skipping source, tracked artifacts or history', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'banana-worktree-audit-'));
  const repository = path.join(temporary, 'Users', 'fixture', 'repository');
  const worktree = path.join(temporary, 'linked');
  await fs.mkdir(repository, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: repository, stdio: 'pipe' });
  const secret = ['sk', 'proj', 'A'.repeat(40)].join('-');
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    await fs.writeFile(path.join(repository, 'source.ts'), secret);
    git('add', '.'); git('commit', '-m', 'Synthetic historical credential');
    await fs.writeFile(path.join(repository, 'source.ts'), 'export const clean = true;');
    git('add', '.'); git('commit', '-m', 'Clean source');
    git('worktree', 'add', '--detach', worktree, 'HEAD');
    const pointer = await fs.readFile(path.join(worktree, '.git'));
    assert.ok(inspectContent('.git', Buffer.from(pointer.toString().replaceAll('\\', '/'))).some(f => f.rule === 'machine-path'));
    const clean = await auditPublicRelease(worktree);
    assert.equal(clean.ok, true); assert.equal(clean.files, 1);
    assert.deepEqual(await fs.readFile(path.join(worktree, '.git')), pointer);
    const historical = await auditPublicRelease(worktree, { history: true });
    assert.ok(historical.findings.some(f => f.rule === 'provider-credential' && f.object));
    await fs.mkdir(path.join(worktree, 'dist'));
    await fs.writeFile(path.join(worktree, 'dist', 'bundle.js'), secret);
    execFileSync('git', ['add', '-f', 'dist/bundle.js'], { cwd: worktree, stdio: 'pipe' });
    await fs.writeFile(path.join(worktree, '.env.local'), 'SYNTHETIC=');
    await fs.writeFile(path.join(worktree, 'untracked.ts'), secret);
    const unsafe = await auditPublicRelease(worktree);
    assert.ok(unsafe.findings.some(f => f.path === 'dist/bundle.js' && f.rule === 'tracked-build-product'));
    assert.ok(unsafe.findings.some(f => f.path === 'dist/bundle.js' && f.rule === 'provider-credential'));
    assert.ok(unsafe.findings.some(f => f.path === '.env.local' && f.rule === 'private-file'));
    assert.ok(unsafe.findings.some(f => f.path === 'untracked.ts' && f.rule === 'provider-credential'));
    // A pointer with extra content is not exempt, even if Git accepts its first line.
    await fs.appendFile(path.join(worktree, '.git'), secret + '\n');
    assert.ok((await auditPublicRelease(worktree)).findings.some(f => f.path === '.git' && f.rule === 'provider-credential'));
    await fs.writeFile(path.join(worktree, '.git'), pointer);
  } finally {
    try { git('worktree', 'remove', '--force', worktree); } catch { /* Cleanup after a failed assertion. */ }
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('an arbitrary .git file or .git symlink remains scanned', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'banana-gitfile-audit-'));
  try {
    const secret = ['sk', 'proj', 'A'.repeat(40)].join('-');
    await fs.writeFile(path.join(root, '.git'), secret);
    assert.ok((await auditPublicRelease(root)).findings.some(f => f.path === '.git' && f.rule === 'provider-credential'));
    await fs.rm(path.join(root, '.git'));
    await fs.mkdir(path.join(root, 'target'));
    await fs.symlink(path.join(root, 'target'), path.join(root, '.git'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.ok((await auditPublicRelease(root)).findings.some(f => f.path === '.git' && f.rule === 'unreviewed-symlink'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
