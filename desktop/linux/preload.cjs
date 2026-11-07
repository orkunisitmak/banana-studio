const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bananaLinux', Object.freeze({
  postAction(action) {
    if (action === 'keys' || action === 'lock') ipcRenderer.send('banana:native-action', action);
  },
}));
