'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The whole surface the window gets. Nothing here can reach the network or
// disk directly; every call goes to the main process.
contextBridge.exposeInMainWorld('agent', {
  verifyCalculator: () => ipcRenderer.invoke('calculator:verify'),
  loadCredentials: () => ipcRenderer.invoke('credentials:load'),
  forgetCredentials: () => ipcRenderer.invoke('credentials:forget'),
  pickFile: () => ipcRenderer.invoke('file:pick'),
  fetchData: (args) => ipcRenderer.invoke('data:fetch', args),
  preview: (args) => ipcRenderer.invoke('signal:preview', args),
  send: (args) => ipcRenderer.invoke('signal:send', args),
  cancel: () => ipcRenderer.invoke('signal:cancel'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  onNetLog: (fn) => ipcRenderer.on('net-log', (_e, entry) => fn(entry)),
  onPairing: (fn) => ipcRenderer.on('pairing', (_e, p) => fn(p)),
  onPairingApproved: (fn) => ipcRenderer.on('pairing-approved', (_e, p) => fn(p)),
});
