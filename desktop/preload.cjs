// Electron sandboxed preload scripts use its limited CommonJS loader.
// oxlint-disable-next-line typescript/no-require-imports
const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (name, value) => {
  const response = await ipcRenderer.invoke(`documents:${name}`, value);
  if (!response.ok) throw Object.assign(new Error(response.error), { code: response.code });
  return response.value;
};
contextBridge.exposeInMainWorld('documents', {
  siteCache: () => invoke('site-cache'), siteSync: () => invoke('site-sync'), siteLogin: password => invoke('site-login', password),
  init: () => invoke('init'), save: value => invoke('save', value), list: () => invoke('list'),
  export: value => invoke('export', value), openExport: file => invoke('open-export', file),
  backup: () => invoke('backup'), import: () => invoke('import'), folder: () => invoke('folder'), close: () => invoke('close'),
  onBeforeClose: callback => { ipcRenderer.on('documents:before-close', () => callback()); },
});
