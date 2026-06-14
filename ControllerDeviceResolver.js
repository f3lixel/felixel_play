// Wandelt verbundene SDL-/Joy-Con-Controller in Emulator-taugliche Device-Deskriptoren um.
// Nutzt echte SDL-GUIDs statt statischer Profil-IDs.

const XBOX_FALLBACK_GUID = '030000005e040000130b000000000000';

const VIRTUAL_DEVICE_PATTERNS = [
  /vjoy/i,
  /virtual/i,
  /vigem/i,
  /scpvbus/i,
  /phantom/i,
];

function isVirtualDevice(info = {}) {
  const name = String(info.name || info.model || '').toLowerCase();
  const path = String(info.path || '').toLowerCase();
  return VIRTUAL_DEVICE_PATTERNS.some((pattern) => pattern.test(name) || pattern.test(path));
}

function normalizeSdl2Guid(guid) {
  if (!guid) return '';
  const cleaned = String(guid).replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (cleaned.length < 32) return cleaned.padStart(32, '0');
  return cleaned.slice(0, 32);
}

function parseSdl2Guid(hex) {
  const normalized = normalizeSdl2Guid(hex);
  const bytes = [];
  for (let i = 0; i < 32; i += 2) {
    bytes.push(parseInt(normalized.substr(i, 2), 16));
  }

  const vendor = ((bytes[5] << 8) | bytes[4]).toString(16).padStart(4, '0');
  const product = ((bytes[8] << 8) | bytes[9]).toString(16).padStart(4, '0');
  const serial = ((bytes[14] << 8) | bytes[15]).toString(16).padStart(12, '0');

  return { vendor, product, serial, bytes, normalized };
}

function guidToRyujinxId(guid, instance = 0) {
  const parsed = parseSdl2Guid(guid);
  if (!parsed.normalized) return '';
  return `${instance}-00000005-${parsed.vendor}-0000-${parsed.product}-${parsed.serial}`;
}

function bytesToHex(bytes) {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Sudachi/Yuzu nutzen SDL2-GUIDs. @kmamal/sdl liefert SDL3-Header (z. B. 03008fe5...),
// Sudachi erkennt nur Varianten wie 050000004c050000cc09000000006800.
function toSudachiSdl2Guid(rawGuid) {
  const parsed = parseSdl2Guid(rawGuid);
  if (!parsed.normalized) return '';

  const bytes = [...parsed.bytes];
  bytes[0] = 0x05;
  bytes[1] = 0x00;
  bytes[2] = 0x00;
  bytes[3] = 0x00;
  return bytesToHex(bytes);
}

function normalizeHexId(value) {
  return String(value || '').replace(/^0x/i, '').toLowerCase().padStart(4, '0').slice(-4);
}

function guidMatchesVendorProduct(guid, vendorId, productId) {
  const parsed = parseSdl2Guid(guid);
  if (!parsed.normalized) return false;
  const vendor = normalizeHexId(vendorId);
  const product = normalizeHexId(productId);
  return parsed.vendor === vendor && parsed.product === product;
}

function extractGuidsFromIni(content) {
  const matches = content.match(/guid:([0-9a-f]{32})/gi) || [];
  return [...new Set(matches.map((match) => match.slice(5).toLowerCase()))];
}

function findSudachiKnownGuid(vendorId, productId) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const inputDir = path.join(os.homedir(), 'AppData', 'Roaming', 'sudachi', 'config', 'input');
  if (!fs.existsSync(inputDir)) return '';

  const vendor = normalizeHexId(vendorId);
  const product = normalizeHexId(productId);
  if (!vendor || !product) return '';

  const guidCounts = new Map();

  for (const fileName of fs.readdirSync(inputDir)) {
    if (!fileName.endsWith('.ini')) continue;
    try {
      const guids = extractGuidsFromIni(fs.readFileSync(path.join(inputDir, fileName), 'utf-8'));
      for (const guid of guids) {
        if (!guidMatchesVendorProduct(guid, vendor, product)) continue;
        guidCounts.set(guid, (guidCounts.get(guid) || 0) + 1);
      }
    } catch {
      // ignore unreadable profiles
    }
  }

  if (guidCounts.size === 0) return '';

  return [...guidCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0][0];
}

function resolveSudachiGuid(entry = {}) {
  const rawGuid = normalizeSdl2Guid(entry.sdl2Guid || entry.guid);
  if (!rawGuid) return '';

  const knownGuid = findSudachiKnownGuid(entry.vendorId, entry.productId);
  if (knownGuid) return knownGuid;

  return toSudachiSdl2Guid(rawGuid);
}

const KNOWN_TYPES = new Set(['dualshock4', 'dualsense', 'switchpro', 'xbox', 'generic']);

function resolveControllerType(info = {}) {
  const type = String(info.type || '').toLowerCase();
  if (KNOWN_TYPES.has(type)) return type;

  const controllerType = String(info.controllerType || '');
  if (controllerType === 'PS5') return 'dualsense';
  if (controllerType === 'PS4') return 'dualshock4';
  if (controllerType === 'Nintendo') return 'switchpro';

  const name = String(info.name || info.model || '').toLowerCase();
  if (/dualsense|ps5/.test(name)) return 'dualsense';
  if (/dualshock|ps4|wireless controller|054c/.test(name)) return 'dualshock4';
  if (/xbox|xinput|microsoft|045e/.test(name)) return 'xbox';
  if (/switch|pro controller|joy-?con|nintendo|057e/.test(name)) return 'switchpro';
  return 'generic';
}

function buildSdl3Name(name, instanceIndex = 0) {
  const base = String(name || 'Controller').replace(/\s*\(\d+\)\s*$/, '').trim() || 'Controller';
  return `${base} (${Math.max(0, instanceIndex)})`;
}

function buildDeviceEntry(info = {}, slot = 1, profiles = {}) {
  const type = resolveControllerType(info);
  const profile = profiles[type] || profiles.generic || {};
  const guid = normalizeSdl2Guid(info.guid) || profile.sdl2Guid || XBOX_FALLBACK_GUID;
  const instanceIndex = typeof info.player === 'number'
    ? Math.max(0, info.player)
    : Math.max(0, slot - 1);
  const displayName = info.name || info.model || info.controllerModel || profile.label || 'Controller';
  const sdl3Id = guidToRyujinxId(guid, instanceIndex);
  const sdl3Name = buildSdl3Name(displayName, instanceIndex);

  return {
    type,
    label: displayName,
    name: displayName,
    vendorId: info.vendorId || '',
    productId: info.productId || '',
    playerSlot: slot,
    sdlPort: typeof info.player === 'number' ? Math.max(0, info.player) : Math.max(0, slot - 1),
    guid,
    sdl2Guid: guid,
    sdl3Id: sdl3Id || profile.sdl3Id,
    sdl3Name,
    sdlDeviceName: displayName.replace(/\s*\(\d+\)\s*$/, '').trim() || profile.sdl3Name.replace(/\s*\(\d+\)\s*$/, ''),
    source: info.source || 'sdl',
    deadzone: info.deadzone,
    vibrationStrength: info.vibrationStrength,
    mappingProfile: info.mappingProfile,
  };
}

function buildEntryFromRendererFallback(fallback = {}, profiles = {}) {
  if (!fallback?.type && !fallback?.vendorId) return null;
  return buildDeviceEntry({
    ...fallback,
    name: fallback.id || fallback.label,
    guid: fallback.guid || '',
    player: Math.max(0, (fallback.playerSlot || 1) - 1),
    source: fallback.mapping === 'sdl' ? 'sdl' : 'renderer',
  }, fallback.playerSlot || 1, profiles);
}

function mergeSetupPreferences(entries, savedSetup = null) {
  if (!savedSetup?.controllers?.length) return entries;

  return entries.map((entry) => {
    const match = savedSetup.controllers.find((saved) => {
      if (saved.key && entry.guid && saved.key.includes(entry.vendorId)) return true;
      if (saved.type === entry.type) return true;
      return false;
    });

    if (!match) return entry;

    return {
      ...entry,
      playerSlot: match.playerSlot || entry.playerSlot,
      deadzone: match.deadzone ?? entry.deadzone,
      vibrationStrength: match.vibrationStrength ?? entry.vibrationStrength,
      mappingProfile: match.mappingProfile ?? entry.mappingProfile,
    };
  });
}

function buildLaunchControllerInfo({
  sdlControllers = [],
  joyconControllers = [],
  rendererFallback = null,
  savedSetup = null,
  profiles = {},
} = {}) {
  const connected = [];

  const sortedJoycon = [...joyconControllers]
    .sort((a, b) => Number(a.player || a.id || 0) - Number(b.player || b.id || 0));
  for (const joycon of sortedJoycon) {
    if (connected.length >= 4) break;
    connected.push(buildDeviceEntry({
      ...joycon,
      source: 'joycon2',
      guid: joycon.guid || profiles.xbox?.sdl2Guid || XBOX_FALLBACK_GUID,
      name: joycon.controllerModel || joycon.name || 'Joy-Con 2',
      player: connected.length,
    }, connected.length + 1, profiles));
  }

  const sortedSdl = [...sdlControllers]
    .sort((a, b) => {
      const virtualDelta = Number(isVirtualDevice(a)) - Number(isVirtualDevice(b));
      if (virtualDelta !== 0) return virtualDelta;
      const playerA = typeof a.player === 'number' ? a.player : 99;
      const playerB = typeof b.player === 'number' ? b.player : 99;
      return playerA - playerB;
    });

  for (const controller of sortedSdl) {
    if (connected.length >= 4) break;
    if (isVirtualDevice(controller) && connected.some((entry) => entry.source === 'joycon2')) {
      const vigemEntry = buildDeviceEntry({
        ...controller,
        source: 'vigem',
      }, connected.length + 1, profiles);
      connected.push(vigemEntry);
      continue;
    }
    if (isVirtualDevice(controller) && connected.length > 0) continue;
    connected.push(buildDeviceEntry(controller, connected.length + 1, profiles));
  }

  if (connected.length === 0) {
    const fallbackEntry = buildEntryFromRendererFallback(rendererFallback, profiles);
    if (fallbackEntry) connected.push(fallbackEntry);
  }

  const controllers = mergeSetupPreferences(connected, savedSetup);
  const primary = controllers[0];

  if (!primary) {
    return null;
  }

  return {
    ...primary,
    controllers,
    setup: {
      ...(savedSetup || {}),
      controllers,
      global: savedSetup?.global || {
        deadzone: 0.35,
        vibrationStrength: 1,
        mappingProfile: 'standard',
      },
    },
  };
}

function resolveDeviceProfile(entry = {}, profiles = {}) {
  const base = profiles[entry.type] || profiles.generic || {};
  const guid = normalizeSdl2Guid(entry.sdl2Guid || entry.guid) || base.sdl2Guid;
  const instanceIndex = Math.max(0, (entry.playerSlot || 1) - 1);

  return {
    ...base,
    sdl2Guid: guid,
    sdl3Id: entry.sdl3Id || guidToRyujinxId(guid, instanceIndex) || base.sdl3Id,
    sdl3Name: entry.sdl3Name || buildSdl3Name(entry.sdlDeviceName || entry.name || base.sdl3Name, instanceIndex),
  };
}

module.exports = {
  buildLaunchControllerInfo,
  buildDeviceEntry,
  resolveDeviceProfile,
  resolveControllerType,
  normalizeSdl2Guid,
  guidToRyujinxId,
  parseSdl2Guid,
  isVirtualDevice,
  toSudachiSdl2Guid,
  resolveSudachiGuid,
  findSudachiKnownGuid,
};
