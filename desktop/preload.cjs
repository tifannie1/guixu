const { contextBridge, ipcRenderer, webUtils } = require('electron');

document.addEventListener('drop', event => {
  if (!event.isTrusted || !event.dataTransfer) return;
  const paths = [...event.dataTransfer.files].map(file => webUtils.getPathForFile(file)).filter(Boolean);
  if (paths.length) ipcRenderer.send('island:archive-drop', paths);
}, true);

contextBridge.exposeInMainWorld('island', {
  action: action => ipcRenderer.send('island:action', action),
  onState: listener => ipcRenderer.on('island:state', (_event, state) => listener(state)),
  onBlur: listener => ipcRenderer.on('island:blur', () => listener()),
  fileDrag: (phase, point) => ipcRenderer.send('island:file-drag', phase, point),
  pickArchive: kind => ipcRenderer.invoke('island:archive-pick', kind),
  openArchive: id => ipcRenderer.invoke('island:archive-open', id),
  mediaState: () => ipcRenderer.invoke('island:media-state'),
  mediaControl: command => ipcRenderer.invoke('island:media-control', command),
  onImportProgress: listener => ipcRenderer.on('island:import-progress', (_event, current, total) => listener(current, total)),
  onImportResult: listener => ipcRenderer.on('island:import-result', (_event, ...result) => listener(...result)),
  onImportBusy: listener => ipcRenderer.on('island:import-busy', () => listener()),
});
