const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readGames: () => ipcRenderer.invoke('read-games'),
  launchGame: (platform, romPath, emulator) =>
    ipcRenderer.invoke('launch-game', { platform, romPath, emulator }),
  onLauncherRestored: (callback) => {
    ipcRenderer.on('launcher-restored', callback);
  },
});
