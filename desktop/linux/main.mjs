import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { directories, approvedSender, childEnvironment, workspaceURL, prepareDirectories } from './security.mjs';
import { bootstrapSession } from './bootstrap.mjs';
import { Vault, VaultReadError, providers } from './vault.mjs';
import { WorkspaceProcess } from './workspace.mjs';
import { workspaceResources } from './resources.mjs';

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const dirs = directories();
const startupAbort = new AbortController();
let workspace, window, origin, keyDialog, quitting = false;
if (process.platform !== 'linux') { process.stderr.write('This shell requires Linux.\n'); app.exit(1); }
try { prepareDirectories(dirs); } catch {
  process.stderr.write('Workspace directories must be owned by your user and must not be symbolic links. Check XDG paths and permissions.\n');
  app.exit(1);
}
app.setName('Banana Studio Linux Alpha');
app.setPath('userData', dirs.config);
app.setPath('sessionData', dirs.cache);
app.enableSandbox();

async function quit() {
  if (quitting) return;
  quitting = true;
  startupAbort.abort();
  keyDialog?.kill();
  window?.destroy();
  await workspace?.stop();
  app.quit();
}
app.on('before-quit', event => { if (!quitting) { event.preventDefault(); void quit(); } });
app.on('window-all-closed', () => void quit());
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void quit());

function external(value) {
  try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password) void shell.openExternal(url.href).catch(() => {}); } catch { /* Refuse other schemes. */ }
}
// Report only fixed classifications and allowlisted process status, never raw
// errors/stdout/stderr: execFile errors can embed the complete form output.
function keyFailureDetails(error, stderr = '') {
  const details = [];
  if (Number.isInteger(error?.code) && error.code >= 0 && error.code <= 255) details.push(`exit=${error.code}`);
  else if (['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'EIO', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(error?.code)) details.push(`code=${error.code}`);
  if (['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV'].includes(error?.signal)) details.push(`signal=${error.signal}`);
  if (stderr.includes('Invalid byte sequence in conversion input')) details.push('reason=locale-conversion');
  else if (stderr.toLowerCase().includes('cannot open display')) details.push('reason=display-unavailable');
  return details.length ? ' ' + details.join(' ') : '';
}
const keyFailureMessages = {
  'vault-read': 'Saved keys could not be read. Check your unlocked Linux keyring.',
  'zenity': 'The native key form failed. Check Zenity and your graphical desktop session.',
  'form-parse': 'The native key form returned an invalid response. No keys were saved.',
  'vault-save': 'Keys could not be saved securely. Check your keyring and config directory permissions.',
  'workspace-refresh': 'Keys were saved, but could not be activated. Restart Banana Studio.',
};
async function showKeys(vault) {
  if (keyDialog || quitting || !origin) return;
  let phase = 'vault-read', nativeDiagnostic = '';
  try {
    const current = vault.read();
    const args = ['--forms', '--title=Banana Studio — Provider API Keys',
      '--text=Blank keeps a saved key. Enter REMOVE to delete it. Keys stay encrypted using your Linux keyring.',
      '--separator=\t', ...providers.map(name => `--add-password=${name}${current[name] ? ' (saved)' : ''}`)];
    phase = 'zenity';
    const result = await new Promise((resolve, reject) => {
      keyDialog = execFile('/usr/bin/zenity', args, {
        shell: false, maxBuffer: 20000,
        // GLib converts --title and other string arguments from this locale.
        // Without it the Unicode title fails in the C/ASCII locale before UI creation.
        env: { ...childEnvironment(), LC_ALL: 'C.UTF-8',
          ...Object.fromEntries(['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'HOME', 'XAUTHORITY', 'XDG_CURRENT_DESKTOP'].filter(name => process.env[name]).map(name => [name, process.env[name]])) },
      }, (error, stdout, stderr) => {
        keyDialog = undefined;
        nativeDiagnostic = error ? keyFailureDetails(error, stderr) : '';
        if (error?.code === 1 && !error.signal && !nativeDiagnostic.includes('reason=')) resolve(null); // Native Cancel.
        else if (error) reject(new Error('Native key form failed.'));
        else resolve(stdout);
      });
    });
    if (result === null || quitting) return;
    phase = 'form-parse';
    const values = result.replace(/\n$/, '').split('\t');
    if (values.length !== providers.length) throw new Error('Invalid key dialog response.');
    providers.forEach((name, i) => {
      const value = values[i].trim();
      if (value === 'REMOVE') delete current[name];
      else if (value) current[name] = value;
    });
    phase = 'vault-save';
    vault.save(current);
    phase = 'workspace-refresh';
    await workspace.send({ action: 'keys', keys: current });
  } catch (error) {
    if (!quitting) {
      const diagnostic = `Provider Keys: phase=${phase}${nativeDiagnostic || keyFailureDetails(error)}`;
      process.stderr.write(`[Banana Studio] ${diagnostic}\n`);
      dialog.showErrorBox('Provider API Keys', `${diagnostic}\n${keyFailureMessages[phase]}`);
    }
  }
}

async function start() {
  if (process.platform !== 'linux') throw new Error('This shell is only for Linux. Use the existing native application on macOS or Windows.');
  if (process.getuid?.() === 0 || app.commandLine.hasSwitch('no-sandbox') || app.commandLine.hasSwitch('disable-web-security')) throw new Error('Run as a normal desktop user with Chromium sandboxing and web security enabled.');
  const resources = workspaceResources({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, developmentRoot: root, runtime: process.env.BANANA_NODE_RUNTIME });
  const { runtime } = resources;
  if (!runtime || !path.isAbsolute(runtime)) throw new Error('Start with npm run start:linux using Node.js 24. Electron’s embedded Node is not the workspace runtime.');
  try {
    const result = await execute(runtime, ['--input-type=module', '-e', "import 'node:sqlite'; import sharp from 'sharp'; sharp(); if(process.versions.node.split('.')[0]!=='24')process.exit(1);"], { cwd: resources.cwd, env: childEnvironment(), timeout: 10000 });
    if (result.stdout) throw new Error();
    await execute('/usr/bin/zenity', ['--version'], { env: childEnvironment(), timeout: 10000 });
  } catch { throw new Error(app.isPackaged ? 'Bundled workspace prerequisites failed. Check /usr/bin/zenity and reinstall the Linux alpha if necessary.' : 'Install Node.js 24 with node:sqlite, the root sharp dependency and /usr/bin/zenity before starting the Linux alpha.'); }
  if (quitting) return;
  for (const file of [path.join(resources.web, 'index.html'), resources.server]) if (!fs.existsSync(file)) throw new Error(app.isPackaged ? 'Bundled workspace files are missing. Reinstall the Linux alpha.' : 'Run npm run build and npm run build:desktop first.');
  const vault = new Vault(dirs.config, safeStorage);
  const keys = vault.read(); // Fail closed even when no keys have been saved yet.
  const bootstrap = randomBytes(32).toString('hex');
  workspace = new WorkspaceProcess({ runtime, server: resources.server,
    launch: { dataDirectory: dirs.data, webRoot: resources.web, bootstrap, keys },
    onFailure: () => { dialog.showErrorBox('Banana Studio', 'The local workspace stopped. Restart the app. Saved workspace data is preserved.'); void quit(); },
  });
  origin = await workspace.start();
  if (quitting) return;
  const browserSession = session.fromPartition(`banana-${randomBytes(16).toString('hex')}`);
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  // Bootstrap in the main process. Only the HttpOnly cookie enters the session;
  // the token never enters a page, preload, URL or renderer request header.
  await bootstrapSession(origin, bootstrap, browserSession.cookies, { signal: startupAbort.signal });
  if (quitting) return;
  window = new BrowserWindow({ title: 'Banana Studio — Linux Alpha', width: 1400, height: 900, minWidth: 760, minHeight: 560,
    icon: app.isPackaged ? path.join(process.resourcesPath, 'banana-studio.png') : path.join(root, 'public/icon-512.png'),
    backgroundColor: '#0d1117', webPreferences: {
      session: browserSession, preload: path.join(import.meta.dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, devTools: false,
    },
  });
  window.on('close', event => { if (!quitting) { event.preventDefault(); void quit(); } });
  window.webContents.on('will-navigate', event => { if (!workspaceURL(event.url, origin)) { event.preventDefault(); external(event.url); } });
  window.webContents.on('will-redirect', event => { if (event.isMainFrame && !workspaceURL(event.url, origin)) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => void quit());
  browserSession.on('will-download', (event, item, contents) => {
    const url = item.getURL();
    if (quitting || contents !== window.webContents || item.getInitiatorOrigin() !== origin || (!url.startsWith(`${origin}/`) && !url.startsWith(`blob:${origin}/`))) event.preventDefault();
    // Electron's default download dialog asks for the destination.
  });
  ipcMain.on('banana:native-action', (event, action) => {
    if (quitting || !approvedSender(event, window.webContents, origin)) return;
    if (action === 'keys') void showKeys(vault);
    if (action === 'lock') void quit();
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'File', submenu: [
    { label: 'Provider API Keys…', accelerator: 'Control+,', click: () => void showKeys(vault) },
    { label: 'Quit', click: () => void quit() },
  ] }, { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  { label: 'View', submenu: [{ role: 'togglefullscreen' }] }]));
  await window.loadURL(origin);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(start).catch(error => {
    if (quitting) return;
    // Only deliberately authored startup messages reach this dialog.
    const safe = /^(This shell|Run as|Start with|Install Node|Run npm|Bundled workspace|Secure Linux|Local workspace authentication)/.test(error.message);
    dialog.showErrorBox('Banana Studio Linux Alpha', error instanceof VaultReadError || safe ? error.message : 'The workspace could not start. Check the desktop build, Node.js 24, sharp and your unlocked Linux keyring.');
    void quit();
  });
}
