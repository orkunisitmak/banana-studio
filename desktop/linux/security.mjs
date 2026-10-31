import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export function directories(env = process.env, home = os.homedir()) {
  const base = (name, fallback) => env[name] && path.isAbsolute(env[name]) ? env[name] : path.join(home, fallback);
  return {
    data: path.join(base('XDG_DATA_HOME', '.local/share'), 'banana-studio'),
    config: path.join(base('XDG_CONFIG_HOME', '.config'), 'banana-studio'),
    cache: path.join(base('XDG_CACHE_HOME', '.cache'), 'banana-studio'),
  };
}
export function localOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) > 0 &&
      !url.username && !url.password && value === url.origin;
  } catch { return false; }
}
export function approvedSender(event, contents, origin) {
  try { return Boolean(origin && event.sender === contents && event.senderFrame === contents.mainFrame &&
    workspaceURL(event.senderFrame.url, origin)); } catch { return false; }
}
export function secureStorage(storage) {
  // Only the synchronous API's explicitly identified keyring providers are allowed.
  // Never enable plaintext encryption, including when Chromium selects basic_text.
  if (!storage.isEncryptionAvailable() ||
      !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(storage.getSelectedStorageBackend())) {
    throw new Error('Secure Linux key storage is unavailable. Unlock GNOME Keyring or KWallet in your desktop session and restart. basic_text is refused.');
  }
}
export const childEnvironment = () => ({ PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' });

export function workspaceURL(value, origin) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.origin === origin && !url.username && !url.password;
  } catch { return false; }
}

/** Secure only the application's leaf directories; never chmod a symlink target. */
export function prepareDirectories(dirs) {
  for (const directory of Object.values(dirs)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isDirectory() || stat.uid !== process.getuid()) throw new Error('Unsafe workspace directory.');
      fs.fchmodSync(fd, 0o700);
    } finally { fs.closeSync(fd); }
  }
}
