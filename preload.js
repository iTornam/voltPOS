/**
 * VoltPOS Preload Script
 * Exposes safe APIs to the renderer process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voltposNative', {
  getDataDir:  () => ipcRenderer.invoke('get-data-dir'),
  openDataDir: () => ipcRenderer.invoke('open-data-dir'),
  getVersion:  () => ipcRenderer.invoke('get-version'),
  platform: process.platform,
  isElectron: true,
});
