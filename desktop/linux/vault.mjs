import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { secureStorage } from './security.mjs';

export const providers = ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'FAL_KEY', 'EVOLINK_API_KEY', 'YOUTUBE_API_KEY'];
export function validateKeys(keys) {
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error('Invalid provider keys.');
  for (const [name, value] of Object.entries(keys)) {
    if (!providers.includes(name) || typeof value !== 'string' || value.length > 2560 || /[\r\n\t\0]/.test(value)) throw new Error('Invalid provider keys.');
  }
  return keys;
}
export class Vault {
  constructor(directory, storage) { this.file = path.join(directory, 'provider-keys.enc'); this.storage = storage; }
  read() {
    secureStorage(this.storage);
    let fd;
    try { fd = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('Secure key file could not be opened.'); }
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 64 * 1024 || (process.getuid && stat.uid !== process.getuid()) || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('Unsafe secure key file.');
      return validateKeys(JSON.parse(this.storage.decryptString(fs.readFileSync(fd))));
    } finally { fs.closeSync(fd); }
  }
  save(keys) {
    secureStorage(this.storage);
    const encrypted = this.storage.encryptString(JSON.stringify(validateKeys(keys)));
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.file);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
}
