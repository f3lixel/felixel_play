const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readGames: () => ipcRenderer.invoke('read-games'),
  launchGame: (platform, romPath, emulator, launchPath) =>
    ipcRenderer.invoke('launch-game', { platform, romPath, emulator, launchPath }),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  onLauncherRestored: (callback) => {
    ipcRenderer.on('launcher-restored', callback);
  },
});
