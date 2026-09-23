// Мост между страницей матч-центра и приложением. В браузере (`npm start`) его нет —
// страница проверяет window.mc и прячет то, что умеет только приложение.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mc', {
  isApp: true,
  // обновление: { state: none | available | downloading | ready | error, version, percent, notes, error }
  getUpdate: () => ipcRenderer.invoke('update:get'),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, u) => cb(u)),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  // клик по уведомлению: раскрыть матч
  onOpenMatch: (cb) => ipcRenderer.on('open-match', (_e, m) => cb(m)),
  // окно плеера: «поверх всех окон»
  setOnTop: (value) => ipcRenderer.invoke('player:on-top', value),
});
