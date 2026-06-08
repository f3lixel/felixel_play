const { contextBridge, ipcRenderer, webFrame } = require('electron');

function onControllerInput(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }

  const listener = (_event, payload) => {
    callback(payload);
  };

  ipcRenderer.on('controller-input', listener);
  return () => {
    ipcRenderer.removeListener('controller-input', listener);
  };
}

function getConnectedControllers() {
  return ipcRenderer.invoke('get-connected-controllers');
}

function getJoyCon2Status() {
  return ipcRenderer.invoke('get-joycon2-status');
}

function startJoyCon2Scan(options) {
  return ipcRenderer.invoke('start-joycon2-scan', options);
}

function stopJoyCon2Scan() {
  return ipcRenderer.invoke('stop-joycon2-scan');
}

function disconnectJoyCon2(playerId) {
  return ipcRenderer.invoke('disconnect-joycon2', playerId);
}

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
  saveControllerSetup: (config) => ipcRenderer.invoke('save-controller-setup', config),
  getControllerSetup: () => ipcRenderer.invoke('get-controller-setup'),
  getConnectedControllers,
  onControllerInput,
  getJoyCon2Status,
  startJoyCon2Scan,
  stopJoyCon2Scan,
  disconnectJoyCon2,

  // Overlay-Brücke: Main schickt 'show-overlay', Renderer antwortet über diese Methoden
  onShowOverlay: (callback) => {
    ipcRenderer.on('show-overlay', callback);
  },
  resumeOverlay: () => ipcRenderer.invoke('overlay-resume'),
  quitEmulator: () => ipcRenderer.invoke('overlay-quit'),
  overlayOpenSettings: () => ipcRenderer.invoke('overlay-open-settings'),
});

contextBridge.exposeInMainWorld('electronAPI', {
  getConnectedControllers,
  onControllerInput,
  getJoyCon2Status,
  startJoyCon2Scan,
  stopJoyCon2Scan,
  disconnectJoyCon2,
});
