const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { applyControllerForPlatform } = require('./ControllerSetup');

let mainWindow;
let overlayWindow = null;
let launchHideTimer = null;
let restoreAlwaysOnTopTimer = null;

// Aktiver Emulator-Prozess – wird beim Spawn gesetzt und beim Exit geleert.
let activeEmulatorPid = null;

// Hinweis: Die Controller-Eingaben werden komplett ueber die Web Gamepad API
// im Renderer (siehe GamepadManager.js) verarbeitet. Das ist robuster als
// node-gamepad, das auf hardkodierte vendor/productIDs angewiesen ist und
// im Fehlerfall sogar process.exit() aufruft.

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
  createWindow();
  createOverlayWindow();
  startDS4Monitor();

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
  stopDS4Monitor();
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

// --- IPC Handlers ---

ipcMain.handle('read-games', async () => {
  return buildGameLibrary();
});

ipcMain.handle('quit-app', () => {
  app.quit();
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
    const result = await launchEmulatorEntry(entry, { platform, controllerInfo });
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

// --- DualShock-4 HID Hintergrund-Monitor ---

// Sony Vendor-ID und bekannte DS4 Product-IDs
const DS4_VENDOR_ID = 0x054c;
const DS4_PRODUCT_IDS = new Set([0x05c4, 0x09cc, 0x0ba0]);

let ds4Device = null;
let ds4PsButtonPrev = false;
let ds4RetryTimer = null;

function onPsButtonPressed() {
  // Nur reagieren, wenn gerade ein Emulator laeuft
  if (activeEmulatorPid === null) return;
  console.log('[DS4] PS-Taste – Overlay wird eingeblendet');
  bringOverlayToFront();
}

function tryOpenDS4() {
  if (ds4Device) return;

  let HID;
  try {
    HID = require('node-hid');
  } catch (err) {
    console.warn('[DS4] node-hid nicht ladbar:', err.message);
    return;
  }

  // Alle DS4-Interfaces einsammeln (Controller kann mehrere HID-Paths liefern)
  let candidates;
  try {
    candidates = HID.devices().filter(
      d => d.vendorId === DS4_VENDOR_ID && DS4_PRODUCT_IDS.has(d.productId)
    );
  } catch (err) {
    console.warn('[DS4] Geraetesuche fehlgeschlagen:', err.message);
    return;
  }

  if (candidates.length === 0) return;

  console.log(`[DS4] ${candidates.length} Interface(s) gefunden – versuche Oeffnen…`);

  // Erstes oeffenbares Interface verwenden
  for (const deviceInfo of candidates) {
    try {
      const device = new HID.HID(deviceInfo.path);
      ds4Device = device;

      const label = `${deviceInfo.product || 'Wireless Controller'} (usage=${deviceInfo.usagePage}/${deviceInfo.usage})`;
      console.log(`[DS4] HID-Monitor aktiv: ${label}`);

      // Die ersten 3 Reports in den Log schreiben, damit der Byte-Offset
      // sichtbar ist – hilft bei Diagnosebedarf.
      let diagCount = 0;

      device.on('data', (data) => {
        if (diagCount < 3) {
          const hex = Array.from(data.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' ');
          console.log(`[DS4] Report #${diagCount} ID=0x${data[0].toString(16)} [${hex}]`);
          diagCount++;
        }

        // DS4 schickt je nach Verbindungstyp unterschiedliche Report-IDs:
        //   0x01  – USB oder Bluetooth Standard-HID  → PS-Taste: Byte 7 Bit 0
        //   0x11  – Bluetooth Extended Mode          → PS-Taste: Byte 9 Bit 0
        let psPressed;
        if (data[0] === 0x11) {
          psPressed = (data[9] & 0x01) !== 0;
        } else {
          psPressed = (data[7] & 0x01) !== 0;
        }

        if (psPressed && !ds4PsButtonPrev) {
          // Steigende Flanke: Taste gerade eben erst gedrueckt
          onPsButtonPressed();
        }
        ds4PsButtonPrev = psPressed;
      });

      device.on('error', (err) => {
        console.warn(`[DS4] Verbindung verloren: ${err.message}`);
        ds4Device = null;
        ds4PsButtonPrev = false;
        scheduleDs4Retry();
      });

      break; // Erstes funktionierendes Interface reicht
    } catch (err) {
      console.warn(`[DS4] Interface nicht oeffenbar (${deviceInfo.path}): ${err.message}`);
    }
  }
}

function scheduleDs4Retry() {
  if (ds4RetryTimer) return;
  ds4RetryTimer = setInterval(() => {
    tryOpenDS4();
    if (ds4Device) {
      clearInterval(ds4RetryTimer);
      ds4RetryTimer = null;
    }
  }, 5000);
}

function startDS4Monitor() {
  tryOpenDS4();
  if (!ds4Device) {
    scheduleDs4Retry();
  }
}

function stopDS4Monitor() {
  if (ds4RetryTimer) {
    clearInterval(ds4RetryTimer);
    ds4RetryTimer = null;
  }
  if (ds4Device) {
    try { ds4Device.close(); } catch (_) {}
    ds4Device = null;
  }
}

function applyControllerForEntry(entry, platform, controllerInfo) {
  if (!controllerInfo) {
    return;
  }

  if (entry.emulator === 'ryujinxCanary') {
    console.log('[ControllerSetup] Ryujinx wird nicht automatisch gepatcht, damit die Emulator-Konfiguration stabil bleibt.');
    return;
  }

  try {
    const result = applyControllerForPlatform({
      platform,
      emulator: entry.emulator,
      controllerInfo,
      dolphinExePath: EMULATORS.dolphin,
    });
    if (result.applied) {
      console.log(`[ControllerSetup] ${entry.label}: ${result.profile} konfiguriert: ${result.path}`);
    } else {
      console.warn(`[ControllerSetup] ${entry.label}: Nicht angewendet: ${result.reason}`);
    }
  } catch (err) {
    console.warn(`[ControllerSetup] ${entry.label}: Fehler: ${err.message}`);
  }
}

function launchEmulatorEntry(entry, { platform, controllerInfo }) {
  applyControllerForEntry(entry, platform, controllerInfo);

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
      console.log(`[Overlay] Emulator laeuft – PID ${child.pid}, PS-Taste aktiv`);
      tryOpenDS4();
      resolve({ success: true });
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
      console.log('[Overlay] Emulator beendet – PS-Taste deaktiviert');

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
