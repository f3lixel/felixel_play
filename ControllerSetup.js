// Bereitet die Controller-Konfiguration der Emulatoren so vor, dass das im
// Launcher erkannte Gamepad auch im gestarteten Spiel als Player 1 funktioniert.
//
// Unterstuetzte Emulatoren: Dolphin (Wii / Wii U), Ryujinx (Switch),
// Sudachi (Switch). Wir patchen jeweils die User-Konfig-Dateien direkt vor
// dem Spawn des Emulators.

const fs = require('fs');
const path = require('path');
const os = require('os');

// SDL2/SDL3 Standard-GUIDs fuer haeufige Controller. Format: 16 byte hex.
// Quellen: SDL_gamecontrollerdb (Steam Game Controller DB).
const CONTROLLER_PROFILES = {
  dualshock4: {
    label: 'PlayStation 4 Controller',
    sdl2Guid: '030000004c050000cc09000000000000', // DS4 v2 USB
    sdl2GuidBt: '050000004c050000cc09000000810000',
    sdl3Id: '0-00000005-054c-0000-cc09-000000006800',
    sdl3Name: 'PS4 Controller (0)',
    ryujinxControllerType: 'ProController',
  },
  dualsense: {
    label: 'PlayStation 5 DualSense',
    sdl2Guid: '030000004c050000e60c000000000000',
    sdl2GuidBt: '050000004c050000e60c000000810000',
    sdl3Id: '0-00000005-054c-0000-e60c-000000006800',
    sdl3Name: 'DualSense Wireless Controller (0)',
    ryujinxControllerType: 'ProController',
  },
  switchpro: {
    label: 'Nintendo Switch Pro Controller',
    sdl2Guid: '030000007e0500000920000000000000',
    sdl2GuidBt: '050000007e0500000920000001800000',
    sdl3Id: '0-00000005-057e-0000-2009-000000006800',
    sdl3Name: 'Pro Controller (0)',
    ryujinxControllerType: 'ProController',
  },
  xbox: {
    label: 'Xbox Controller',
    sdl2Guid: '030000005e040000130b000000000000',
    sdl2GuidBt: '050000005e040000130b000000010000',
    sdl3Id: '0-00000005-045e-0000-0b13-000000005700',
    sdl3Name: 'Xbox Series Controller (0)',
    ryujinxControllerType: 'ProController',
  },
  generic: {
    label: 'Generic Gamepad',
    sdl2Guid: '030000007e0500000920000000000000', // Fallback Pro Controller
    sdl2GuidBt: '050000007e0500000920000001800000',
    sdl3Id: '0-00000005-057e-0000-2009-000000006800',
    sdl3Name: 'Pro Controller (0)',
    ryujinxControllerType: 'ProController',
  },
};

function getProfile(controllerInfo) {
  if (!controllerInfo) return null;
  return CONTROLLER_PROFILES[controllerInfo.type] || CONTROLLER_PROFILES.generic;
}

function getConfiguredControllers(controllerInfo) {
  const setupControllers = controllerInfo?.setup?.controllers;
  if (Array.isArray(setupControllers) && setupControllers.length > 0) {
    return setupControllers
      .slice(0, 4)
      .sort((a, b) => Number(a.playerSlot || 1) - Number(b.playerSlot || 1))
      .map((entry, index) => ({
        entry,
        slot: Number(entry.playerSlot) || index + 1,
        profile: CONTROLLER_PROFILES[entry.type] || CONTROLLER_PROFILES.generic,
      }));
  }

  const profile = getProfile(controllerInfo);
  return profile ? [{ entry: controllerInfo, slot: controllerInfo.playerSlot || 1, profile }] : [];
}

function getControllerSetting(entry, setup, key, fallback) {
  return entry?.[key] ?? setup?.global?.[key] ?? fallback;
}

// =====================================================================
// RYUJINX
// =====================================================================

function applyRyujinxController(controllerInfo) {
  const controllers = getConfiguredControllers(controllerInfo);
  if (controllers.length === 0) return { applied: false, reason: 'no-controller' };

  const configPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Ryujinx', 'Config.json');
  if (!fs.existsSync(configPath)) {
    return { applied: false, reason: 'config-missing', path: configPath };
  }

  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    return { applied: false, reason: `read-failed: ${err.message}` };
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    return { applied: false, reason: `parse-failed: ${err.message}` };
  }

  const playerEntries = controllers.map(({ profile, slot, entry }) => (
    buildRyujinxPlayer(profile, slot, entry, controllerInfo?.setup)
  ));

  if (!Array.isArray(config.input_config)) {
    config.input_config = [];
  }

  // Bestehende Felixel-Player-Slots ersetzen, andere Emulator-Settings unangetastet lassen.
  const felixelPlayers = new Set(['Player1', 'Player2', 'Player3', 'Player4']);
  config.input_config = config.input_config.filter((entry) => !felixelPlayers.has(entry?.player_index));
  config.input_config.unshift(...playerEntries);

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    return { applied: false, reason: `write-failed: ${err.message}` };
  }

  return { applied: true, profile: `${controllers.length} Controller`, path: configPath };
}

function buildRyujinxPlayer(profile, slot = 1, entry = {}, setup = {}) {
  const deadzone = Number(getControllerSetting(entry, setup, 'deadzone', 0.1));
  const vibration = Number(getControllerSetting(entry, setup, 'vibrationStrength', 1));

  return {
    left_joycon_stick: {
      joystick: 'Left',
      invert_stick_x: false,
      invert_stick_y: false,
      rotate90_cw: false,
      stick_button: 'LeftStick',
    },
    right_joycon_stick: {
      joystick: 'Right',
      invert_stick_x: false,
      invert_stick_y: false,
      rotate90_cw: false,
      stick_button: 'RightStick',
    },
    deadzone_left: deadzone,
    deadzone_right: deadzone,
    range_left: 1,
    range_right: 1,
    trigger_threshold: 0.5,
    motion: {
      motion_backend: 'GamepadDriver',
      sensitivity: 100,
      gyro_deadzone: 1,
      enable_motion: true,
    },
    rumble: {
      strong_rumble: vibration,
      weak_rumble: vibration,
      enable_rumble: vibration > 0,
    },
    led: {
      enable_led: false,
      turn_off_led: false,
      use_rainbow: false,
      led_color: 0,
    },
    left_joycon: {
      button_minus: 'Back',
      button_l: 'LeftShoulder',
      button_zl: 'LeftTrigger',
      button_sl: 'SingleLeftTrigger0',
      button_sr: 'SingleRightTrigger0',
      dpad_up: 'DpadUp',
      dpad_down: 'DpadDown',
      dpad_left: 'DpadLeft',
      dpad_right: 'DpadRight',
    },
    right_joycon: {
      button_plus: 'Start',
      button_r: 'RightShoulder',
      button_zr: 'RightTrigger',
      button_sl: 'SingleLeftTrigger1',
      button_sr: 'SingleRightTrigger1',
      button_x: 'Y',
      button_b: 'A',
      button_y: 'X',
      button_a: 'B',
    },
    version: 1,
    backend: 'GamepadSDL3',
    id: profile.sdl3Id,
    name: profile.sdl3Name,
    controller_type: profile.ryujinxControllerType,
    player_index: `Player${slot}`,
  };
}

// =====================================================================
// SUDACHI
// =====================================================================

// SDL Sub-Engine Mapping fuer Yuzu/Sudachi. Quad/Stick/Button strings nach
// Yuzu-Format. guid = SDL2-GUID (32 hex chars).
function buildSudachiButton(guid, button, port = 0) {
  return `"engine:sdl,guid:${guid},port:${port},button:${button}"`;
}

function buildSudachiHat(guid, direction, port = 0) {
  return `"engine:sdl,guid:${guid},port:${port},hat:0,direction:${direction}"`;
}

function buildSudachiAxis(guid, axis, port = 0, threshold = 0.5, direction = '+') {
  return `"engine:sdl,guid:${guid},port:${port},axis:${axis},threshold:${threshold},invert:${direction}"`;
}

function buildSudachiStick(guid, stick, port = 0) {
  const axes = stick === 'left' ? { x: 0, y: 1 } : { x: 2, y: 3 };
  return `"engine:sdl,guid:${guid},port:${port},axis_x:${axes.x},axis_y:${axes.y},offset_x:-0.000000,offset_y:-0.000000,invert_x:+,invert_y:+,deadzone:0.100000,range:1.000000"`;
}

function buildSudachiMotion(guid, motion, port = 0) {
  return `"engine:sdl,guid:${guid},port:${port},motion:${motion}"`;
}

function getSudachiPlayerSettings(guid, playerIndex, entry = {}, setup = {}) {
  const prefix = `player_${playerIndex}`;
  const deadzone = Number(getControllerSetting(entry, setup, 'deadzone', 0.1)).toFixed(6);
  // Standard SDL Game Controller Mapping (entspricht "South=0, East=1, West=2, North=3, ...")
  return {
    [`${prefix}_button_a`]: buildSudachiButton(guid, 0, playerIndex),
    [`${prefix}_button_b`]: buildSudachiButton(guid, 1, playerIndex),
    [`${prefix}_button_x`]: buildSudachiButton(guid, 2, playerIndex),
    [`${prefix}_button_y`]: buildSudachiButton(guid, 3, playerIndex),
    [`${prefix}_button_lstick`]: buildSudachiButton(guid, 7, playerIndex),
    [`${prefix}_button_rstick`]: buildSudachiButton(guid, 8, playerIndex),
    [`${prefix}_button_l`]: buildSudachiButton(guid, 9, playerIndex),
    [`${prefix}_button_r`]: buildSudachiButton(guid, 10, playerIndex),
    [`${prefix}_button_zl`]: buildSudachiAxis(guid, 4, playerIndex, 0.5, '+'),
    [`${prefix}_button_zr`]: buildSudachiAxis(guid, 5, playerIndex, 0.5, '+'),
    [`${prefix}_button_plus`]: buildSudachiButton(guid, 6, playerIndex),
    [`${prefix}_button_minus`]: buildSudachiButton(guid, 4, playerIndex),
    [`${prefix}_button_dleft`]: buildSudachiButton(guid, 13, playerIndex),
    [`${prefix}_button_dup`]: buildSudachiButton(guid, 11, playerIndex),
    [`${prefix}_button_dright`]: buildSudachiButton(guid, 14, playerIndex),
    [`${prefix}_button_ddown`]: buildSudachiButton(guid, 12, playerIndex),
    [`${prefix}_button_sl`]: '""',
    [`${prefix}_button_sr`]: '""',
    [`${prefix}_button_home`]: buildSudachiButton(guid, 5, playerIndex),
    [`${prefix}_button_screenshot`]: '""',
    [`${prefix}_button_slleft`]: '""',
    [`${prefix}_button_srleft`]: '""',
    [`${prefix}_button_slright`]: '""',
    [`${prefix}_button_srright`]: '""',
    [`${prefix}_lstick`]: buildSudachiStickWithDeadzone(guid, 'left', playerIndex, deadzone),
    [`${prefix}_rstick`]: buildSudachiStickWithDeadzone(guid, 'right', playerIndex, deadzone),
    [`${prefix}_motionleft`]: buildSudachiMotion(guid, 0, playerIndex),
    [`${prefix}_motionright`]: buildSudachiMotion(guid, 1, playerIndex),
  };
}

function buildSudachiStickWithDeadzone(guid, stick, port, deadzone) {
  const axes = stick === 'left' ? { x: 0, y: 1 } : { x: 2, y: 3 };
  return `"engine:sdl,guid:${guid},port:${port},axis_x:${axes.x},axis_y:${axes.y},offset_x:-0.000000,offset_y:-0.000000,invert_x:+,invert_y:+,deadzone:${deadzone},range:1.000000"`;
}

function applySudachiController(controllerInfo) {
  const controllers = getConfiguredControllers(controllerInfo);
  if (controllers.length === 0) return { applied: false, reason: 'no-controller' };

  const configPath = path.join(os.homedir(), 'AppData', 'Roaming', 'sudachi', 'config', 'qt-config.ini');
  if (!fs.existsSync(configPath)) {
    return { applied: false, reason: 'config-missing', path: configPath };
  }

  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    return { applied: false, reason: `read-failed: ${err.message}` };
  }

  let settings = {};
  let baseOverrides = {};

  for (const { profile, slot, entry } of controllers) {
    const playerIndex = Math.max(0, Math.min(3, slot - 1));
    settings = {
      ...settings,
      ...getSudachiPlayerSettings(profile.sdl2Guid, playerIndex, entry, controllerInfo?.setup),
    };
    baseOverrides = {
      ...baseOverrides,
      [`player_${playerIndex}_type`]: '0', // 0 = Pro Controller
      [`player_${playerIndex}_connected`]: 'true',
      [`player_${playerIndex}_profile_name`]: '"FelixelPlay"',
    };
  }

  let patched = raw;
  for (const [key, value] of Object.entries({ ...settings, ...baseOverrides })) {
    patched = setIniValue(patched, key, value, 'Controls');
  }

  try {
    fs.writeFileSync(configPath, patched, 'utf-8');
  } catch (err) {
    return { applied: false, reason: `write-failed: ${err.message}` };
  }

  return { applied: true, profile: `${controllers.length} Controller`, path: configPath };
}

// Setzt key=value und key\default=false innerhalb der angegebenen Section.
// Erstellt den Eintrag falls noch nicht vorhanden.
function setIniValue(content, key, value, section) {
  const lines = content.split(/\r?\n/);
  const sectionRegex = new RegExp(`^\\[${section}\\]`);
  const nextSectionRegex = /^\[[^\]]+\]/;

  let inSection = false;
  let sectionStart = -1;
  let sectionEnd = lines.length;
  let keyLineIdx = -1;
  let defaultLineIdx = -1;
  const defaultKey = `${key}\\default`;

  for (let i = 0; i < lines.length; i++) {
    if (sectionRegex.test(lines[i])) {
      inSection = true;
      sectionStart = i;
      continue;
    }

    if (inSection && nextSectionRegex.test(lines[i]) && !sectionRegex.test(lines[i])) {
      sectionEnd = i;
      break;
    }

    if (!inSection) continue;

    if (lines[i].startsWith(`${key}=`)) keyLineIdx = i;
    if (lines[i].startsWith(`${defaultKey}=`)) defaultLineIdx = i;
  }

  if (sectionStart === -1) {
    // Section fehlt -> am Ende anfuegen.
    lines.push('', `[${section}]`, `${defaultKey}=false`, `${key}=${value}`);
    return lines.join('\n');
  }

  if (keyLineIdx >= 0) {
    lines[keyLineIdx] = `${key}=${value}`;
  } else {
    lines.splice(sectionEnd, 0, `${key}=${value}`);
    sectionEnd += 1;
  }

  if (defaultLineIdx >= 0) {
    lines[defaultLineIdx] = `${defaultKey}=false`;
  } else {
    lines.splice(sectionEnd, 0, `${defaultKey}=false`);
  }

  return lines.join('\n');
}

// =====================================================================
// DOLPHIN
// =====================================================================

// Dolphin findet seinen User-Folder via:
//  1. portable.txt im Programmverzeichnis -> <DolphinDir>/User
//  2. Standard: <Documents>/Dolphin Emulator
// Wir aktivieren Portable, damit alles versioniert beim Launcher liegt.
function ensureDolphinPortable(dolphinExePath) {
  const dolphinDir = path.dirname(dolphinExePath);
  const portableMarker = path.join(dolphinDir, 'portable.txt');
  if (!fs.existsSync(portableMarker)) {
    try {
      fs.writeFileSync(portableMarker, '', 'utf-8');
    } catch (err) {
      console.warn(`[ControllerSetup] portable.txt konnte nicht erstellt werden: ${err.message}`);
    }
  }

  const userDir = path.join(dolphinDir, 'User');
  const configDir = path.join(userDir, 'Config');
  fs.mkdirSync(configDir, { recursive: true });
  return { userDir, configDir };
}

function buildDolphinSdlController(profile, padNumber) {
  const deviceLine = `Device = SDL/0/${profile.sdl3Name.replace(/\s*\(\d+\)$/, '')}`;
  return [
    `[GCPad${padNumber}]`,
    deviceLine,
    'Buttons/A = `Button S`',
    'Buttons/B = `Button E`',
    'Buttons/X = `Button W`',
    'Buttons/Y = `Button N`',
    'Buttons/Z = `Full Axis 5+`',
    'Buttons/Start = `Button Start`',
    'Main Stick/Up = `Left Y-`',
    'Main Stick/Down = `Left Y+`',
    'Main Stick/Left = `Left X-`',
    'Main Stick/Right = `Left X+`',
    'Main Stick/Modifier/Range = 50.000000000000000',
    'C-Stick/Up = `Right Y-`',
    'C-Stick/Down = `Right Y+`',
    'C-Stick/Left = `Right X-`',
    'C-Stick/Right = `Right X+`',
    'Triggers/L = `Full Axis 4+`',
    'Triggers/R = `Full Axis 5+`',
    'Triggers/L-Analog = `Full Axis 4+`',
    'Triggers/R-Analog = `Full Axis 5+`',
    'D-Pad/Up = `Pad N`',
    'D-Pad/Down = `Pad S`',
    'D-Pad/Left = `Pad W`',
    'D-Pad/Right = `Pad E`',
    'Rumble/Motor = `Motor L`',
    '',
  ].join('\n');
}

function buildDolphinWiimote(profile, padNumber) {
  const deviceLine = `Device = SDL/0/${profile.sdl3Name.replace(/\s*\(\d+\)$/, '')}`;
  return [
    `[Wiimote${padNumber}]`,
    'Source = 1',
    deviceLine,
    'Extension = Classic',
    'Buttons/A = `Button S`',
    'Buttons/B = `Button E`',
    'Buttons/Minus = `Button Back`',
    'Buttons/Plus = `Button Start`',
    'Buttons/Home = `Button Guide`',
    'Buttons/1 = `Button W`',
    'Buttons/2 = `Button N`',
    'D-Pad/Up = `Pad N`',
    'D-Pad/Down = `Pad S`',
    'D-Pad/Left = `Pad W`',
    'D-Pad/Right = `Pad E`',
    'Classic/Buttons/A = `Button E`',
    'Classic/Buttons/B = `Button S`',
    'Classic/Buttons/X = `Button N`',
    'Classic/Buttons/Y = `Button W`',
    'Classic/Buttons/-= `Button Back`',
    'Classic/Buttons/+ = `Button Start`',
    'Classic/Buttons/Home = `Button Guide`',
    'Classic/Buttons/ZL = `Shoulder L`',
    'Classic/Buttons/ZR = `Shoulder R`',
    'Classic/Triggers/L = `Full Axis 4+`',
    'Classic/Triggers/R = `Full Axis 5+`',
    'Classic/Left Stick/Up = `Left Y-`',
    'Classic/Left Stick/Down = `Left Y+`',
    'Classic/Left Stick/Left = `Left X-`',
    'Classic/Left Stick/Right = `Left X+`',
    'Classic/Right Stick/Up = `Right Y-`',
    'Classic/Right Stick/Down = `Right Y+`',
    'Classic/Right Stick/Left = `Right X-`',
    'Classic/Right Stick/Right = `Right X+`',
    'Classic/D-Pad/Up = `Pad N`',
    'Classic/D-Pad/Down = `Pad S`',
    'Classic/D-Pad/Left = `Pad W`',
    'Classic/D-Pad/Right = `Pad E`',
    '',
  ].join('\n');
}

function applyDolphinController(controllerInfo, dolphinExePath) {
  const controllers = getConfiguredControllers(controllerInfo);
  if (controllers.length === 0) return { applied: false, reason: 'no-controller' };
  if (!dolphinExePath || !fs.existsSync(dolphinExePath)) {
    return { applied: false, reason: 'dolphin-missing' };
  }

  const { configDir } = ensureDolphinPortable(dolphinExePath);

  const gcPadIni = ['# Generated by felixel play launcher', '']
    .concat(controllers.map(({ profile, slot }) => buildDolphinSdlController(profile, slot)))
    .join('\n');
  const wiimoteIni = ['# Generated by felixel play launcher', '']
    .concat(controllers.map(({ profile, slot }) => buildDolphinWiimote(profile, slot)))
    .join('\n');

  try {
    fs.writeFileSync(path.join(configDir, 'GCPadNew.ini'), gcPadIni, 'utf-8');
    fs.writeFileSync(path.join(configDir, 'WiimoteNew.ini'), wiimoteIni, 'utf-8');
  } catch (err) {
    return { applied: false, reason: `write-failed: ${err.message}` };
  }

  return { applied: true, profile: `${controllers.length} Controller`, path: configDir };
}

// =====================================================================
// PUBLIC API
// =====================================================================

function applyControllerForPlatform({ platform, emulator, controllerInfo, dolphinExePath }) {
  if (!controllerInfo) {
    return { applied: false, reason: 'no-controller' };
  }

  const profile = getProfile(controllerInfo);
  console.log(`[ControllerSetup] Aktiver Controller: ${profile?.label || 'unbekannt'} (${controllerInfo.type})`);

  if (platform === 'Wii' || platform === 'WiiU') {
    return applyDolphinController(controllerInfo, dolphinExePath);
  }

  if (platform === 'Switch') {
    if (emulator === 'ryujinxCanary') {
      return applyRyujinxController(controllerInfo);
    }
    return applySudachiController(controllerInfo);
  }

  return { applied: false, reason: 'unknown-platform' };
}

module.exports = {
  applyControllerForPlatform,
  applyDolphinController,
  applyRyujinxController,
  applySudachiController,
  CONTROLLER_PROFILES,
};
