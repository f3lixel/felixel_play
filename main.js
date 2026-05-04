const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;
let launchHideTimer = null;

function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icons', 'app-icon.svg');

  mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    kiosk: false,
    icon: iconPath,
    backgroundColor: '#141414',
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

app.whenReady().then(() => {
  app.setAppUserModelId('felixel.play');
  createWindow();

  globalShortcut.register('Escape', () => {
    app.quit();
  });

  globalShortcut.register('F12', () => {
    mainWindow?.webContents.toggleDevTools();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
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
  sudachi: path.join(__dirname, 'emulators', 'Sudachi', 'sudachi.exe'),
  ryujinxCanary: path.join(__dirname, 'emulators', 'ryujinx-canary--win_x64', 'Ryujinx.exe'),
};

function toAppPath(filePath) {
  return path.relative(__dirname, filePath).split(path.sep).join('/');
}

function normalizeGamePath(filePath) {
  return filePath.replace(/\\/g, '/').toLowerCase();
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

  mainWindow.setAlwaysOnTop(false);
  mainWindow.show();
  mainWindow.setFullScreen(true);
  mainWindow.focus();
  mainWindow.webContents.send('launcher-restored');
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

ipcMain.handle('launch-game', async (_event, { platform, romPath, emulator }) => {
  const absoluteRomPath = path.join(__dirname, romPath);

  if (!fs.existsSync(absoluteRomPath)) {
    return { success: false, error: `ROM nicht gefunden: ${romPath}` };
  }

  const switchCommand = emulator === 'ryujinxCanary'
    ? { cmd: EMULATORS.ryujinxCanary, args: [absoluteRomPath], hideDelayMs: 6500 }
    : { cmd: EMULATORS.sudachi, args: ['-f', '-g', absoluteRomPath], hideDelayMs: 6500 };

  const commands = {
    Wii:    { cmd: EMULATORS.dolphin, args: ['--batch', '-C', 'Dolphin.Interface.OnScreenDisplayMessages=false', '-C', 'Graphics.Settings.DumpTextures=false', '-C', 'Graphics.Settings.HiresTextures=false', '--exec', absoluteRomPath], hideDelayMs: 7000 },
    WiiU:   { cmd: EMULATORS.dolphin, args: ['--batch', '-C', 'Dolphin.Interface.OnScreenDisplayMessages=false', '-C', 'Graphics.Settings.DumpTextures=false', '-C', 'Graphics.Settings.HiresTextures=false', '--exec', absoluteRomPath], hideDelayMs: 7000 },
    Switch: switchCommand,
  };

  const entry = commands[platform];
  if (!entry) {
    console.error(`Unbekannte Plattform: ${platform}`);
    return { success: false, error: `Unbekannte Plattform: ${platform}` };
  }

  if (!fs.existsSync(entry.cmd)) {
    return {
      success: false,
      error: `Emulator nicht gefunden: ${toAppPath(entry.cmd)}`,
    };
  }

  return new Promise((resolve) => {
    const workingDirectory = path.dirname(entry.cmd);

    const child = spawn(entry.cmd, entry.args, {
      cwd: workingDirectory,
      stdio: 'ignore',
      windowsHide: false,
    });

    let settled = false;

    child.once('error', (err) => {
      console.error(`Fehler beim Starten: ${err.message}`);
      settled = true;
      if (launchHideTimer) {
        clearTimeout(launchHideTimer);
        launchHideTimer = null;
      }
      restoreLauncherWindow();
      resolve({ success: false, error: err.message });
    });

    child.once('spawn', () => {
      console.log(`Gestartet: ${entry.cmd} ${entry.args.join(' ')}`);
      mainWindow?.setAlwaysOnTop(true, 'screen-saver');
      mainWindow?.setFullScreen(true);
      mainWindow?.focus();
      mainWindow?.moveTop();

      if (launchHideTimer) {
        clearTimeout(launchHideTimer);
      }

      launchHideTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(false);
          mainWindow.hide();
        }
        launchHideTimer = null;
      }, entry.hideDelayMs);

      settled = true;
      resolve({ success: true });
    });

    child.once('exit', (code, signal) => {
      console.log(`Emulator beendet: code=${code} signal=${signal}`);
      restoreLauncherWindow();

      if (!settled) {
        settled = true;
        resolve({
          success: false,
          error: `Emulator wurde sofort beendet (Code ${code ?? 'unbekannt'})`,
        });
      }
    });
  });
});
