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
const readMessages = Object.freeze({
  read: 'Saved provider keys could not be read. Check ownership and access to provider-keys.enc in the application config directory; symbolic links are refused.',
  unsafe: 'Saved provider keys have unsafe file permissions, ownership, type or size. provider-keys.enc must be a regular file owned by your user with mode 0600 and no larger than 64 KiB.',
  decrypt: 'Saved provider keys could not be decrypted. Unlock the original desktop keyring and restart. If recovery fails, privately back up and move provider-keys.enc aside to enter keys again.',
  invalid: 'Saved provider keys contain invalid data. Privately back up and move provider-keys.enc aside to enter keys again. Do not share this file.',
});
export class VaultReadError extends Error {
  constructor(reason) {
    super(Object.hasOwn(readMessages, reason) ? readMessages[reason] : readMessages.read);
    this.name = 'VaultReadError';
  }
}
export class Vault {
  constructor(directory, storage) { this.file = path.join(directory, 'provider-keys.enc'); this.storage = storage; }
  read() {
    secureStorage(this.storage);
    let fd;
    try { fd = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new VaultReadError('read'); }
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 64 * 1024 || (process.getuid && stat.uid !== process.getuid()) || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new VaultReadError('unsafe');
      const encrypted = fs.readFileSync(fd);
      let plaintext;
      try { plaintext = this.storage.decryptString(encrypted); }
      catch { throw new VaultReadError('decrypt'); }
      try { return validateKeys(JSON.parse(plaintext)); }
      catch { throw new VaultReadError('invalid'); }
    } catch (error) {
      if (error instanceof VaultReadError) throw error;
      throw new VaultReadError('read');
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
