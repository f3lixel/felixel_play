const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readGames: () => ipcRenderer.invoke('read-games'),
  launchGame: (platform, romPath, emulator, launchPath, controllerInfo) =>
    ipcRenderer.invoke('launch-game', { platform, romPath, emulator, launchPath, controllerInfo }),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  setZoomFactor: (zoomFactor) => {
    webFrame.setZoomFactor(zoomFactor);
    return zoomFactor;
  },
  onLauncherRestored: (callback) => {
    ipcRenderer.on('launcher-restored', callback);
  },

  // Overlay-Brücke: Main schickt 'show-overlay', Renderer antwortet über diese Methoden
  onShowOverlay: (callback) => {
    ipcRenderer.on('show-overlay', callback);
  },
  resumeOverlay: () => ipcRenderer.invoke('overlay-resume'),
  quitEmulator: () => ipcRenderer.invoke('overlay-quit'),
  overlayOpenSettings: () => ipcRenderer.invoke('overlay-open-settings'),
});
