const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { applyControllerForPlatform, CONTROLLER_PROFILES } = require('./ControllerSetup');
const { buildLaunchControllerInfo } = require('./ControllerDeviceResolver');
const { NativeControllerManager } = require('./NativeControllerManager');
const { JoyCon2BridgeManager } = require('./JoyCon2BridgeManager');

let mainWindow;
let overlayWindow = null;
let launchHideTimer = null;
let restoreAlwaysOnTopTimer = null;
let controllerSetupConfig = null;
let nativeControllerManager = null;
let joyCon2BridgeManager = null;

// Aktiver Emulator-Prozess – wird beim Spawn gesetzt und beim Exit geleert.
let activeEmulatorPid = null;

// Controller-Eingaben laufen nativ ueber SDL im Main-Prozess und werden per IPC
// an Renderer/Overlay weitergereicht. Die Browser Gamepad API bleibt nur Fallback.

function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icons', 'app-icon.svg');

  mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    thickFrame: false,
    hasShadow: false,
    roundedCorners: false,
    kiosk: false,
    icon: iconPath,
    backgroundColor: '#0D0D0D',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createOverlayWindow() {
  const { bounds } = screen.getPrimaryDisplay();
  // 4px Überstand auf allen Seiten damit kein Rand des Displays durchscheint
  const BLEED = 4;

  overlayWindow = new BrowserWindow({
    x: bounds.x - BLEED,
    y: bounds.y - BLEED,
    width: bounds.width + BLEED * 2,
    height: bounds.height + BLEED * 2,
    transparent: true,
    frame: false,
    hasShadow: false,
    roundedCorners: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.loadFile('overlay.html');

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId('felixel.play');
  controllerSetupConfig = loadControllerSetupFromDisk();
  createWindow();
  createOverlayWindow();
  startNativeControllerMonitor();
  startJoyCon2Bridge();

  globalShortcut.register('Escape', () => {
    app.quit();
  });

  globalShortcut.register('F12', () => {
    mainWindow?.webContents.toggleDevTools();
  });

  // F9 = manueller Overlay-Trigger (Fallback / Test ohne Controller)
  globalShortcut.register('F9', () => {
    if (activeEmulatorPid !== null) {
      console.log('[Overlay] F9-Shortcut – Overlay wird eingeblendet');
      bringOverlayToFront();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopNativeControllerMonitor();
  stopJoyCon2Bridge();
});

app.on('window-all-closed', () => {
  app.quit();
});

// --- Game Library Helpers ---

const ROM_FOLDERS = [
  {
    platform: 'Wii',
    directory: path.join(__dirname, 'roms', 'wii'),
    extensions: ['.iso', '.wbfs', '.rvz', '.gcz', '.ciso'],
  },
  {
    platform: 'WiiU',
    directory: path.join(__dirname, 'roms', 'wiiu'),
    extensions: ['.wud', '.wux', '.rpx', '.iso'],
  },
  {
    platform: 'Switch',
    directory: path.join(__dirname, 'roms', 'switch'),
    extensions: ['.nsp', '.xci', '.nca', '.nro'],
  },
];

const EMULATORS = {
  dolphin: path.join(__dirname, 'emulators', 'dolphin', 'Dolphin-x64', 'Dolphin.exe'),
  sudachi: path.join(__dirname, 'emulators', 'sudachiemulator.org-winpc-1-0-15', 'sudachi.exe'),
  ryujinxCanary: path.join(__dirname, 'emulators', 'ryujinx-canary-1.3.287-win_x64', 'publish', 'Ryujinx.exe'),
};

function toAppPath(filePath) {
  return path.relative(__dirname, filePath).split(path.sep).join('/');
}

function normalizeGamePath(filePath) {
  return filePath.replace(/\\/g, '/').toLowerCase();
}

function resolveAppPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
}

function resolveLaunchPath(romPath, launchPath) {
  const candidates = [launchPath, romPath].filter(Boolean);
  return candidates
    .map((candidate) => ({
      configuredPath: candidate,
      absolutePath: resolveAppPath(candidate),
    }))
    .find((candidate) => fs.existsSync(candidate.absolutePath));
}

function getLaunchEntries(platform, absoluteRomPath) {
  if (platform === 'Switch') {
    return [
      {
        emulator: 'sudachi',
        label: 'Sudachi',
        cmd: EMULATORS.sudachi,
        args: ['-f', '-g', absoluteRomPath],
      },
      {
        emulator: 'ryujinxCanary',
        label: 'Ryujinx Canary 1.3.287',
        cmd: EMULATORS.ryujinxCanary,
        args: [absoluteRomPath, '--fullscreen'],
      },
    ];
  }

  const dolphinEntry = {
    emulator: 'dolphin',
    label: 'Dolphin',
    cmd: EMULATORS.dolphin,
    args: ['-b', '-e', absoluteRomPath],
  };

  if (platform === 'Wii' || platform === 'WiiU') {
    return [dolphinEntry];
  }

  return [];
}

// Pollt per PowerShell bis das Spiel tatsaechlich laeuft (nicht nur die Emulator-UI sichtbar ist).
const WINDOW_POLL_INTERVAL_MS = 500;
const WINDOW_POLL_TIMEOUT_MS = 60000;

// Liefert den aktuellen Fenstertitel des Prozesses (null = kein Fenster / Fehler).
function getWindowTitle(pid) {
  return new Promise((resolve) => {
    const cmd = `powershell -NoProfile -NonInteractive -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowTitle"`;
    exec(cmd, { timeout: 2000 }, (err, stdout) => {
      resolve(err ? null : (stdout.trim() || null));
    });
  });
}

// Prueft anhand des Fenstertitels ob das Spiel wirklich gestartet ist (nicht nur Emulator-UI).
// Ryujinx/Sudachi zeigen "SpielName | Emulator X.Y.Z" sobald das Spiel rendert.
// Waehrend des Dashboards / "Launching..."-Screens steht nur der Emulatorname im Titel.
function isGameRunning(emulator, title) {
  if (!title) return false;
  switch (emulator) {
    case 'dolphin':
      // Dolphin mit -b springt direkt ins Spiel, kein Dashboard – jedes Fenster ist das Spiel
      return true;
    case 'sudachi':
    case 'ryujinxCanary':
      // Spiel laeuft  → "SpielName | Ryujinx 1.x.x"  bzw.  "SpielName | sudachi"
      // Dashboard/Loading → nur "Ryujinx 1.x.x" oder "sudachi" (kein Pipe-Zeichen)
      return title.includes('|');
    default:
      return true;
  }
}

async function waitForEmulatorWindow(pid, emulator) {
  const deadline = Date.now() + WINDOW_POLL_TIMEOUT_MS;
  let lastLoggedTitle = '';

  while (Date.now() < deadline) {
    if (emulator === 'dolphin') {
      // Fuer Dolphin reicht der Fensterhandle-Check (kein Dashboard mit -b)
      const title = await getWindowTitle(pid);
      if (title !== null) return true;
    } else {
      const title = await getWindowTitle(pid);
      if (isGameRunning(emulator, title)) {
        console.log(`[Overlay] Spiel gestartet – Titel: "${title}"`);
        return true;
      }
      if (title && title !== lastLoggedTitle) {
        console.log(`[Overlay] Warte auf Spielstart... Titel: "${title}"`);
        lastLoggedTitle = title;
      }
    }
    await new Promise((r) => setTimeout(r, WINDOW_POLL_INTERVAL_MS));
  }
  return false;
}

function titleFromFileName(filePath) {
  const parsed = path.parse(filePath);
  return parsed.name
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function restoreLauncherWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (launchHideTimer) {
    clearTimeout(launchHideTimer);
    launchHideTimer = null;
  }

  // Kurz alwaysOnTop setzen damit der Launcher zuverlaessig vor dem sterbenden
  // Emulator-Fenster erscheint. Windows blockiert sonst oft focus()-Aufrufe.
  if (restoreAlwaysOnTopTimer) {
    clearTimeout(restoreAlwaysOnTopTimer);
    restoreAlwaysOnTopTimer = null;
  }

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.show();
  mainWindow.setFullScreen(true);
  mainWindow.focus();
  mainWindow.moveTop();
  mainWindow.webContents.send('launcher-restored');

  restoreAlwaysOnTopTimer = setTimeout(() => {
    restoreAlwaysOnTopTimer = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
    }
  }, 400);
}

function readGameMetadata() {
  const gamesPath = path.join(__dirname, 'games.json');
  if (!fs.existsSync(gamesPath)) {
    return [];
  }

  const raw = fs.readFileSync(gamesPath, 'utf-8');
  return JSON.parse(raw);
}

function scanRomDirectory(directory, extensions) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...scanRomDirectory(entryPath, extensions));
      continue;
    }

    if (extensions.includes(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }

  return files;
}

function buildGameLibrary() {
  const metadata = readGameMetadata();
  const metadataByPath = new Map(
    metadata.map((game) => [normalizeGamePath(game.romPath), game])
  );
  const games = [];

  for (const { platform, directory, extensions } of ROM_FOLDERS) {
    const romFiles = scanRomDirectory(directory, extensions);

    for (const romFile of romFiles) {
      const romPath = toAppPath(romFile);
      const existing = metadataByPath.get(normalizeGamePath(romPath));

      games.push({
        id: existing?.id || normalizeGamePath(romPath),
        title: existing?.title || titleFromFileName(romFile),
        platform,
        romPath,
        coverArt: existing?.coverArt || '',
        heroArt: existing?.heroArt || '',
        heroVideo: existing?.heroVideo || '',
        launchPath: existing?.launchPath || '',
        emulator: existing?.emulator || '',
        backgroundMusic: existing?.backgroundMusic || '',
      });
    }
  }

  return games.sort((a, b) => a.title.localeCompare(b.title, 'de'));
}

// --- Controller Setup Persistenz ---

function getControllerSetupPath() {
  return path.join(app.getPath('userData'), 'controller-setup.json');
}

function loadControllerSetupFromDisk() {
  const filePath = getControllerSetupPath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[ControllerSetup] Konfiguration konnte nicht geladen werden: ${err.message}`);
    return null;
  }
}

function saveControllerSetupToDisk(config) {
  const filePath = getControllerSetupPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  controllerSetupConfig = config;
}

function resolveLaunchControllerInfo(rendererFallback) {
  const sdlControllers = nativeControllerManager?.getConnectedControllers() || [];
  const joyconControllers = joyCon2BridgeManager?.getConnectedControllers() || [];
  const savedSetup = controllerSetupConfig || loadControllerSetupFromDisk();

  const resolved = buildLaunchControllerInfo({
    sdlControllers,
    joyconControllers,
    rendererFallback,
    savedSetup,
    profiles: CONTROLLER_PROFILES,
  });

  if (resolved?.controllers?.length) {
    console.log('[ControllerSetup] Verbundene Controller beim Launch:', resolved.controllers.map((controller) => (
      `P${controller.playerSlot}: ${controller.label} (${controller.guid || 'kein-guid'})`
    )).join(', '));
  } else {
    console.warn('[ControllerSetup] Kein verbundener Controller beim Launch erkannt.');
  }

  return resolved;
}

// --- IPC Handlers ---

ipcMain.handle('read-games', async () => {
  return buildGameLibrary();
});

ipcMain.handle('quit-app', () => {
  app.quit();
});

ipcMain.handle('save-controller-setup', async (_event, config) => {
  try {
    saveControllerSetupToDisk(config);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-controller-setup', async () => {
  return controllerSetupConfig || loadControllerSetupFromDisk();
});

ipcMain.handle('get-connected-controllers', async () => {
  const sdlControllers = nativeControllerManager?.getConnectedControllers() || [];
  const joyconControllers = joyCon2BridgeManager?.getConnectedControllers() || [];
  return [...joyconControllers, ...sdlControllers];
});

ipcMain.handle('get-joycon2-status', async () => ({
  available: Boolean(joyCon2BridgeManager?.isAvailable()),
  vigemConnected: Boolean(joyCon2BridgeManager?.isViGEmConnected()),
  scanState: joyCon2BridgeManager?.getScanState() || 'idle',
  players: joyCon2BridgeManager?.getConnectedControllers() || [],
}));

ipcMain.handle('start-joycon2-scan', async (_event, options = {}) => {
  if (!joyCon2BridgeManager?.isAvailable()) {
    return { success: false, error: 'JoyCon2 Native Bridge ist nicht verfuegbar.' };
  }

  const mode = options.mode || 'single';
  try {
    if (mode === 'dual-first') {
      joyCon2BridgeManager.startScanDualFirst(options);
    } else if (mode === 'dual-second') {
      joyCon2BridgeManager.startScanDualSecond();
    } else if (mode === 'pro') {
      joyCon2BridgeManager.startScanPro(options);
    } else {
      joyCon2BridgeManager.startScanSingle(options);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-joycon2-scan', async () => {
  joyCon2BridgeManager?.stopScan();
  return { success: true };
});

ipcMain.handle('disconnect-joycon2', async (_event, playerId) => {
  if (!joyCon2BridgeManager?.isAvailable()) {
    return { success: false, error: 'JoyCon2 Native Bridge ist nicht verfuegbar.' };
  }
  if (playerId) {
    joyCon2BridgeManager.disconnectPlayer(playerId);
  } else {
    joyCon2BridgeManager.disconnectAll();
  }
  return { success: true };
});

ipcMain.handle('launch-game', async (_event, { platform, romPath, emulator, launchPath, controllerInfo }) => {
  const launchTarget = resolveLaunchPath(romPath, launchPath);

  if (!launchTarget) {
    return { success: false, error: `ROM nicht gefunden: ${romPath}` };
  }

  const { absolutePath: absoluteRomPath } = launchTarget;
  const launchEntries = getLaunchEntries(platform, absoluteRomPath);
  if (launchEntries.length === 0) {
    console.error(`Unbekannte Plattform: ${platform}`);
    return { success: false, error: `Unbekannte Plattform: ${platform}` };
  }

  const availableEntries = launchEntries.filter((entry) => fs.existsSync(entry.cmd));
  if (availableEntries.length === 0) {
    const missingEmulators = launchEntries
      .map((entry) => `${entry.label}: ${toAppPath(entry.cmd)}`)
      .join(', ');
    return {
      success: false,
      error: `Emulator nicht gefunden: ${missingEmulators}`,
    };
  }

  let lastError = null;

  for (const entry of availableEntries) {
    const resolvedControllerInfo = resolveLaunchControllerInfo(controllerInfo);
    const result = await launchEmulatorEntry(entry, { platform, controllerInfo: resolvedControllerInfo });
    if (result.success) {
      return result;
    }

    lastError = result.error;
    console.warn(`[Launcher] ${entry.label} konnte nicht starten: ${result.error}`);
  }

  restoreLauncherWindow();
  return {
    success: false,
    error: `Alle Emulatoren wurden sofort beendet. Letzter Fehler: ${lastError || 'unbekannt'}`,
  };
});

// --- Native Controller IPC ---

function broadcastControllerInput(payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send('controller-input', payload);
  }
}

function handleControllerInput(payload) {
  broadcastControllerInput(payload);

  if (
    activeEmulatorPid !== null
    && payload.type === 'button-down'
    && payload.logicalButton === 'guide'
  ) {
    console.log(`[Overlay] ${payload.button}-Taste (${payload.controllerType}/${payload.source || 'sdl'}) - Overlay wird eingeblendet`);
    bringOverlayToFront();
  }
}

function handleNativeControllerInput(payload) {
  handleControllerInput(payload);
}

function startNativeControllerMonitor() {
  nativeControllerManager = new NativeControllerManager({
    onInput: handleNativeControllerInput,
  });

  const started = nativeControllerManager.start();
  if (!started) {
    console.warn('[Controller] Native SDL-Unterstuetzung ist nicht aktiv. Renderer-Fallback bleibt verfuegbar.');
  }
}

function stopNativeControllerMonitor() {
  nativeControllerManager?.stop();
  nativeControllerManager = null;
}

function startJoyCon2Bridge() {
  joyCon2BridgeManager = new JoyCon2BridgeManager({
    onInput: handleControllerInput,
  });

  const started = joyCon2BridgeManager.start();
  if (!started) {
    console.warn('[JoyCon2] BLE/ViGEm-Bridge ist nicht aktiv (Build oder ViGEmBus pruefen).');
  }
}

function stopJoyCon2Bridge() {
  joyCon2BridgeManager?.stop();
  joyCon2BridgeManager = null;
}

// --- Overlay-Helfer ---

function bringOverlayToFront() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  // Overlay-Zustand zuruecksetzen (Fokus auf "Fortsetzen")
  overlayWindow.webContents.send('show-overlay');
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.show();
  overlayWindow.focus();
  overlayWindow.moveTop();
}

function hideOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setAlwaysOnTop(false);
  overlayWindow.hide();
}

function resumeEmulatorView() {
  hideOverlayWindow();
}

function quitActiveEmulator() {
  hideOverlayWindow();
  if (activeEmulatorPid !== null) {
    try {
      process.kill(activeEmulatorPid);
    } catch (err) {
      console.warn(`[Overlay] Emulator-Kill fehlgeschlagen: ${err.message}`);
    }
    activeEmulatorPid = null;
  }
  restoreLauncherWindow();
}

// IPC-Antworten des Overlays
ipcMain.handle('overlay-resume', () => {
  resumeEmulatorView();
});

ipcMain.handle('overlay-quit', () => {
  quitActiveEmulator();
});

ipcMain.handle('overlay-open-settings', () => {
  hideOverlayWindow();
  restoreLauncherWindow();
  mainWindow?.webContents.send('open-settings');
});

function applyControllerForEntry(entry, platform, controllerInfo) {
  if (!controllerInfo) {
    return { applied: false, reason: 'no-controller' };
  }

  try {
    const result = applyControllerForPlatform({
      platform,
      emulator: entry.emulator,
      controllerInfo,
      dolphinExePath: EMULATORS.dolphin,
    });
    if (result.applied) {
      const profileInfo = Array.isArray(result.profiles) && result.profiles.length > 0
        ? ` | Profile: ${result.profiles.join(', ')}`
        : '';
      console.log(`[ControllerSetup] ${entry.label}: ${result.profile} konfiguriert: ${result.path}${profileInfo}`);
    } else {
      console.warn(`[ControllerSetup] ${entry.label}: Nicht angewendet: ${result.reason}`);
    }
    return result;
  } catch (err) {
    console.warn(`[ControllerSetup] ${entry.label}: Fehler: ${err.message}`);
    return { applied: false, reason: err.message };
  }
}

function launchEmulatorEntry(entry, { platform, controllerInfo }) {
  const controllerSetupResult = applyControllerForEntry(entry, platform, controllerInfo);

  return new Promise((resolve) => {
    const workingDirectory = path.dirname(entry.cmd);

    const child = spawn(entry.cmd, entry.args, {
      cwd: workingDirectory,
      stdio: 'ignore',
      detached: true,
      windowsHide: false,
    });

    let settled = false;

    function hideLauncherAndSettle() {
      if (settled) return;
      if (launchHideTimer) {
        clearTimeout(launchHideTimer);
        launchHideTimer = null;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(false);
        mainWindow.hide();
      }
      settled = true;
      child.unref();
      activeEmulatorPid = child.pid;
      console.log(`[Overlay] Emulator laeuft – PID ${child.pid}, Guide/Home-Taste aktiv`);
      resolve({
        success: true,
        controllerSetup: controllerSetupResult,
      });
    }

    child.once('error', (err) => {
      if (launchHideTimer) {
        clearTimeout(launchHideTimer);
        launchHideTimer = null;
      }
      console.error(`Fehler beim Starten von ${entry.label}: ${err.message}`);
      settled = true;
      resolve({ success: false, error: err.message });
    });

    child.once('spawn', () => {
      console.log(`Gestartet (${entry.label}): ${entry.cmd} ${entry.args.join(' ')}`);
      const spawnTime = Date.now();

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.setFullScreen(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.focus();
        mainWindow.moveTop();
      }

      // Fallback: Launcher spaetestens nach WINDOW_POLL_TIMEOUT_MS verstecken
      if (launchHideTimer) clearTimeout(launchHideTimer);
      launchHideTimer = setTimeout(() => {
        console.log(`[Overlay] Fallback-Timeout – Launcher wird versteckt (${entry.label})`);
        hideLauncherAndSettle();
      }, WINDOW_POLL_TIMEOUT_MS);

      // Warte bis das Spiel wirklich laeuft (Titel-Erkennung), dann:
      //  - Mindestens MIN_LOADING_MS seit Spawn einhalten
      //  - Zusaetzlich POST_GAME_DELAY_MS nach Spielstart warten (Uebergang fliessend)
      const MIN_LOADING_MS = 4000;
      const POST_GAME_DELAY_MS = 1500;

      waitForEmulatorWindow(child.pid, entry.emulator).then((windowFound) => {
        if (!windowFound) {
          console.log(`[Overlay] Fenster-Polling Timeout – Launcher wird versteckt (${entry.label})`);
          hideLauncherAndSettle();
          return;
        }

        const elapsed = Date.now() - spawnTime;
        const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
        const totalDelay = remaining + POST_GAME_DELAY_MS;

        console.log(`[Overlay] Spiel erkannt nach ${elapsed}ms – warte noch ${totalDelay}ms vor Uebergang`);

        setTimeout(() => {
          hideLauncherAndSettle();
        }, totalDelay);
      });
    });

    child.once('exit', (code, signal) => {
      console.log(`${entry.label} beendet: code=${code} signal=${signal}`);
      activeEmulatorPid = null;
      console.log('[Overlay] Emulator beendet – Guide/Home-Taste deaktiviert');

      restoreLauncherWindow();

      if (!settled) {
        if (launchHideTimer) {
          clearTimeout(launchHideTimer);
          launchHideTimer = null;
        }
        settled = true;
        resolve({
          success: false,
          error: `${entry.label} wurde sofort beendet (Code ${code ?? 'unbekannt'})`,
        });
      }
    });
  });
}
