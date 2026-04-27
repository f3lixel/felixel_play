const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readGames: () => ipcRenderer.invoke('read-games'),
  launchGame: (platform, romPath) =>
    ipcRenderer.invoke('launch-game', { platform, romPath }),
});
