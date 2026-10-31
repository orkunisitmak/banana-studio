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

test('release auditing covers database sidecars, Windows profiles and fal keys without flagging kebab-case names', () => {
  const rules = (name, text = '') => inspectContent(name, Buffer.from(text)).map(f => f.rule);
  assert.deepEqual(rules('workspace.sqlite-wal'), ['private-file']);
  assert.deepEqual(rules('data/workspace.sqlite-shm'), ['private-file']);
  assert.deepEqual(rules('notes.md', ['C:', 'Users', 'someone', 'AppData', 'x'].join('\\')), ['machine-path']);
  assert.deepEqual(rules('config.json', JSON.stringify({ dir: ['C:', 'Users', 'someone', 'Desktop', 'x'].join('\\') })), ['machine-path']);
  assert.deepEqual(rules('notes.md', ['', 'Users', 'runner-someone', 'x', ''].join('/')), ['machine-path']);
  assert.deepEqual(rules('notes.md', ['', 'Users', 'runner', 'work', ''].join('/')), []);
  const falKey = ['0123abcd-4567-89ab-cdef-0123456789ab', '0123456789abcdef0123456789abcdef'].join(':');
  assert.deepEqual(rules('deploy.md', `FAL_KEY="${falKey}"`), ['provider-credential']);
  assert.ok(!JSON.stringify(inspectContent('deploy.md', Buffer.from(falKey))).includes(falKey));
  assert.deepEqual(rules('style.css', '.task-list-item-checkbox-container-wrapper{}'), []);
  assert.deepEqual(rules('theme.css', '.dark-sk-' + 'a'.repeat(30) + '{}'), []);
  assert.deepEqual(rules('a.ts', 'x' + 'AIza' + 'A'.repeat(40)), ['provider-credential']);
  assert.deepEqual(rules('a.ts', 'x' + ['ghp', 'A'.repeat(36)].join('_')), ['provider-credential']);
  assert.deepEqual(rules('a.ts', `const k = "${['sk', 'proj', 'A'.repeat(40)].join('-')}"`), ['provider-credential']);
});

test('a source copy without Git still scans nested bin and dist folders but skips nested build outputs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'banana-pregit-audit-'));
  try {
    await fs.mkdir(path.join(root, 'tools', 'bin'), { recursive: true });
    await fs.writeFile(path.join(root, 'tools', 'bin', 'config.txt'), ['sk', 'proj', 'B'.repeat(40)].join('-'));
    await fs.mkdir(path.join(root, 'packages', 'web', 'dist'), { recursive: true });
    await fs.writeFile(path.join(root, 'packages', 'web', 'dist', 'app.js'), ['sk', 'proj', 'C'.repeat(40)].join('-'));
    // A local Swift build or package install below the root is never source.
    for (const folder of ['desktop/macos/.build/debug', 'desktop/macos/DerivedData', 'packages/app/node_modules/x']) {
      await fs.mkdir(path.join(root, folder), { recursive: true });
      await fs.writeFile(path.join(root, folder, 'output.db'), 'build output');
    }
    const result = await auditPublicRelease(root);
    assert.equal(result.ok, false);
    const scanned = ['tools/bin/config.txt', 'packages/web/dist/app.js'];
    for (const file of scanned) assert.ok(result.findings.some(f => f.path === file && f.rule === 'provider-credential'), file);
    assert.deepEqual(result.findings.filter(f => !scanned.includes(f.path)), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
