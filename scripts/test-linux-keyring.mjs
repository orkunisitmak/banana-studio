import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { Vault } from '../desktop/linux/vault.mjs';
import { secureStorage } from '../desktop/linux/security.mjs';

// Launch with the verified development Electron CLI, not with system Node.
// Only an empty mktemp directory directly under /tmp is accepted for --write.
if (process.platform !== 'linux' || !process.versions.electron || process.getuid() === 0) throw new Error('Use Electron as a normal Linux desktop user for the synthetic keyring test.');
const { app, safeStorage } = createRequire(import.meta.url)('electron');
const [mode, supplied] = process.argv.slice(2);
let fixture, phase = 'fixture-validation';
try {
  if (!['--write', '--read'].includes(mode) || !supplied) throw new Error();
  fixture = path.resolve(supplied);
  const stat = fs.lstatSync(fixture);
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077) ||
      fs.realpathSync(path.dirname(fixture)) !== fs.realpathSync(os.tmpdir()) || !path.basename(fixture).startsWith('banana-keyring-test-')) throw new Error();
  if (mode === '--write' && fs.readdirSync(fixture).length) throw new Error();
  let marker;
  if (mode === '--read') {
    const fd = fs.openSync(path.join(fixture, 'test.json'), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.uid !== process.getuid() || stat.size > 4096 || (stat.mode & 0o077)) throw new Error();
      marker = JSON.parse(fs.readFileSync(fd));
    } finally { fs.closeSync(fd); }
    if (marker.purpose !== 'banana-synthetic-keyring-test') throw new Error();
  }
  app.setName('Banana Studio Linux Alpha');
  const profile = path.join(fixture, 'electron-profile'); fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  app.setPath('userData', profile); app.setPath('sessionData', profile); app.enableSandbox();
  if (app.commandLine.hasSwitch('no-sandbox') || app.commandLine.hasSwitch('password-store')) throw new Error();
  await app.whenReady();
  phase = 'secure-backend'; secureStorage(safeStorage);
  const vault = new Vault(fixture, safeStorage);
  const digest = value => createHash('sha256').update(value).digest('hex');
  if (mode === '--write') {
    const synthetic = 'banana-synthetic-' + randomBytes(32).toString('hex');
    phase = 'encrypt'; vault.save({ OPENAI_API_KEY: synthetic });
    fs.writeFileSync(path.join(fixture, 'test.json'), JSON.stringify({ purpose: 'banana-synthetic-keyring-test', digest: digest(synthetic) }), { mode: 0o600, flag: 'wx' });
    phase = 'decrypt'; if (vault.read().OPENAI_API_KEY !== synthetic) throw new Error();
  } else {
    phase = 'restart-decrypt';
    const expected = marker.digest;
    const restored = vault.read().OPENAI_API_KEY;
    if (typeof restored !== 'string' || digest(restored) !== expected) throw new Error();
  }
  console.log(`Synthetic keyring ${mode === '--write' ? 'write/read' : 'separate-process read'} passed; backend=${safeStorage.getSelectedStorageBackend()}. No backend/provider request was made.`);
  app.exit(0);
} catch {
  process.stderr.write(`Synthetic keyring test failed: phase=${phase}. No key, ciphertext or raw error was reported.\n`);
  app.exit(1);
}
