// Standard-Mapping (Chromium "standard" gamepad mapping)
// Funktioniert fuer DualShock 4, DualSense, Xbox-Controller, Switch Pro, etc.
const STANDARD_MAPPING = {
  confirm: 0,   // Cross / A / B (auf Switch Pro mit "Nintendo-Belegung")
  back: 1,      // Circle / B / A (auf Switch Pro)
  altConfirm: 2, // Square / X / Y
  altBack: 3,   // Triangle / Y / X
  l1: 4,        // L1 / LB / L (Tab links)
  r1: 5,        // R1 / RB / R (Tab rechts)
  settings: 9,  // Options / Start / +
  share: 8,     // Share / Back / -
  touchpad: 17, // Touchpad-Klick (DualSense / DualShock 4)
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
};

const ALTERNATIVE_MAPPING = {
  ...STANDARD_MAPPING,
  confirm: 1,
  back: 0,
};

// Fallback fuer Controller im non-standard Mapping (z.B. DualShock 4 ueber
// einige Bluetooth-Stacks). Hier sind D-Pad Werte ueber Achse 9 codiert.
const NONSTANDARD_DPAD_AXIS = 9;

const CONTROLLER_SETUP_STORAGE_KEY = 'felixel:controller-setup';

const DEFAULT_CONTROLLER_SETUP = {
  version: 1,
  global: {
    deadzone: 0.35,
    vibrationStrength: 1,
    mappingProfile: 'standard',
  },
  controllers: [],
};

// Stichwoerter, an denen wir virtuelle/Phantom-Gamepads erkennen.
const VIRTUAL_GAMEPAD_PATTERNS = [
  /vjoy/i,
  /virtual/i,
  /vigem/i,
  /scpvbus/i,
  /phantom/i,
  /ds4windows/i,
  /vendor:\s*0000.*product:\s*0000/i,
];

function isVirtualGamepad(gamepad) {
  if (!gamepad) return true;
  const id = gamepad.id || '';
  return VIRTUAL_GAMEPAD_PATTERNS.some((pattern) => pattern.test(id));
}

function scoreGamepad(gamepad) {
  if (!gamepad) return -1;
  if (isVirtualGamepad(gamepad)) return -1;
  const id = gamepad.id || '';
  let score = 1;
  if (gamepad.mapping === 'standard') score += 5;
  if (/pro\s*controller|switch/i.test(id)) score += 4;
  if (/dualsense|dualshock|sony|054c/i.test(id)) score += 3;
  if (/xbox|xinput|microsoft/i.test(id)) score += 2;
  return score;
}

function parseControllerInfo(gamepad) {
  const id = gamepad?.id || '';
  const vendorMatch = id.match(/Vendor:?\s*([0-9a-f]{4})/i);
  const productMatch = id.match(/Product:?\s*([0-9a-f]{4})/i);
  const vendorId = vendorMatch ? vendorMatch[1].toLowerCase() : '';
  const productId = productMatch ? productMatch[1].toLowerCase() : '';

  let type = 'generic';
  if (/dualsense|0ce6|0df2/i.test(id)) type = 'dualsense';
  else if (/dualshock|0:054c|054c.*05c4|054c.*09cc|054c.*0ba0/i.test(id) || vendorId === '054c') type = 'dualshock4';
  else if (/pro\s*controller|057e.*2009/i.test(id) || (vendorId === '057e' && productId === '2009')) type = 'switchpro';
  else if (/xbox|xinput|microsoft|045e/i.test(id) || vendorId === '045e') type = 'xbox';

  return {
    id,
    mapping: gamepad?.mapping || '',
    vendorId,
    productId,
    type,
    index: typeof gamepad?.index === 'number' ? gamepad.index : null,
  };
}

function describeGamepad(gamepad) {
  const id = gamepad?.id || 'Controller';
  if (/pro\s*controller|switch/i.test(id)) return 'Switch Pro Controller';
  if (/dualsense|ps5/i.test(id)) return 'DualSense (PS5)';
  if (/dualshock|054c|sony|playstation/i.test(id)) return 'DualShock (PS4)';
  if (/xbox|xinput|microsoft/i.test(id)) return 'Xbox Controller';
  if (/nintendo/i.test(id)) return 'Nintendo Controller';
  return id.length > 40 ? `${id.slice(0, 40)}…` : id;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function getGamepadKey(gamepad) {
  const info = parseControllerInfo(gamepad);
  const vendor = info.vendorId || '0000';
  const product = info.productId || '0000';
  const idHash = hashString(info.id || `${vendor}-${product}`);
  return `${vendor}-${product}-${idHash}`;
}

function getBatteryStatus(gamepad) {
  if (!gamepad) return null;

  if (typeof gamepad.battery === 'number') {
    return {
      level: Math.max(0, Math.min(1, gamepad.battery)),
      charging: Boolean(gamepad.charging),
    };
  }

  const id = gamepad.id || '';
  if (/charging/i.test(id)) {
    return { level: null, charging: true, unknown: true };
  }

  return null;
}

function formatBatteryStatus(gamepad) {
  const battery = getBatteryStatus(gamepad);
  if (!battery) return '—';
  if (battery.unknown) return battery.charging ? 'Lädt' : '—';
  if (battery.level === null) return '—';

  const percent = Math.round(battery.level * 100);
  if (battery.charging) return `${percent}% (lädt)`;
  return `${percent}%`;
}

function getControllerIconType(type) {
  if (type === 'xbox') return 'xbox';
  if (type === 'dualsense' || type === 'dualshock4') return 'playstation';
  if (type === 'switchpro' || type === 'nintendo' || type === 'joycon2') return 'switch';
  return 'generic';
}

function getAllRealGamepads() {
  if (!navigator.getGamepads) return [];
  return Array.from(navigator.getGamepads())
    .filter(Boolean)
    .filter((gamepad) => !isVirtualGamepad(gamepad));
}

function getMappingForProfile(profile = 'standard') {
  return profile === 'alternative'
    ? { ...ALTERNATIVE_MAPPING }
    : { ...STANDARD_MAPPING };
}

function loadControllerSetupConfig() {
  try {
    const raw = localStorage.getItem(CONTROLLER_SETUP_STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_CONTROLLER_SETUP);

    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONTROLLER_SETUP,
      ...parsed,
      global: {
        ...DEFAULT_CONTROLLER_SETUP.global,
        ...(parsed.global || {}),
      },
      controllers: Array.isArray(parsed.controllers) ? parsed.controllers : [],
    };
  } catch (err) {
    console.warn('[Gamepad] Controller-Setup konnte nicht geladen werden:', err);
    return structuredClone(DEFAULT_CONTROLLER_SETUP);
  }
}

function saveControllerSetupConfig(config) {
  localStorage.setItem(CONTROLLER_SETUP_STORAGE_KEY, JSON.stringify(config));
}

function playConnectVibration(gamepad, strength = 1) {
  if (!gamepad) return;

  const scale = Math.max(0, Math.min(1, Number(strength) || 1));
  const actuator = gamepad.vibrationActuator;
  if (!actuator) return;

  const duration = 360;
  const weakMagnitude = 0.55 * scale;
  const strongMagnitude = 0.8 * scale;

  if (typeof actuator.playEffect === 'function') {
    actuator.playEffect('dual-rumble', {
      startDelay: 0,
      duration,
      weakMagnitude,
      strongMagnitude,
    }).catch(() => {});
    return;
  }

  if (typeof actuator.pulse === 'function') {
    actuator.pulse(strongMagnitude, duration).catch(() => {});
  }
}

function resolvePlayerOneGamepad(config = loadControllerSetupConfig(), gamepads = getAllRealGamepads()) {
  if (gamepads.length === 0) return null;

  const connectedByKey = new Map(gamepads.map((gamepad) => [getGamepadKey(gamepad), gamepad]));
  const orderedEntries = (config.controllers || [])
    .map((entry) => ({ entry, gamepad: connectedByKey.get(entry.key) }))
    .filter(({ gamepad }) => Boolean(gamepad));

  if (orderedEntries.length > 0) {
    const prioritized = orderedEntries.find(({ entry }) => entry.prioritizePlayer1);
    return prioritized?.gamepad || orderedEntries[0].gamepad;
  }

  const best = gamepads.reduce((currentBest, gamepad) => {
    if (!currentBest) return gamepad;
    return scoreGamepad(gamepad) > scoreGamepad(currentBest) ? gamepad : currentBest;
  }, null);

  return best || gamepads[0];
}

class GamepadManager {
  constructor(options = {}) {
    this.setupConfig = loadControllerSetupConfig();
    this.deadzone = options.deadzone ?? this.setupConfig.global.deadzone ?? 0.35;
    this.repeatDelay = options.repeatDelay ?? 280;
    this.buttonDebounce = options.buttonDebounce ?? 220;
    this.mapping = {
      ...getMappingForProfile(this.setupConfig.global.mappingProfile),
      ...options.mapping,
    };

    this.callbacks = {
      onConnect: options.onConnect || (() => {}),
      onDisconnect: options.onDisconnect || (() => {}),
      onNavigate: options.onNavigate || (() => {}),
      onAction: options.onAction || (() => {}),
      onInputModeChange: options.onInputModeChange || (() => {}),
      onSetupChange: options.onSetupChange || (() => {}),
    };

    this.enabled = true;
    this.running = false;
    this.frameId = null;
    this.activeGamepadIndex = null;
    this.inputMode = 'mouse';
    this.lastInputAt = new Map();
    this.buttonPressed = new Map();
    this.connectedIndexes = new Set();
    this.activeNavigationDirection = null;
    this.lastNavigationAt = 0;
    this.lastScanAt = 0;
    this.scanInterval = options.scanInterval ?? 500;

    this.loop = this.loop.bind(this);
    this.handleConnected = this.handleConnected.bind(this);
    this.handleDisconnected = this.handleDisconnected.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
  }

  start() {
    if (this.running) return;

    this.running = true;
    window.addEventListener('gamepadconnected', this.handleConnected);
    window.addEventListener('gamepaddisconnected', this.handleDisconnected);
    window.addEventListener('mousemove', this.handleMouseMove, { passive: true });
    this.scanConnectedGamepads();
    this.applySetupConfig(this.setupConfig, { silent: true });
    this.frameId = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    window.removeEventListener('gamepadconnected', this.handleConnected);
    window.removeEventListener('gamepaddisconnected', this.handleDisconnected);
    window.removeEventListener('mousemove', this.handleMouseMove);

    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  setMapping(mapping = {}) {
    this.mapping = { ...this.mapping, ...mapping };
  }

  setDeadzone(deadzone) {
    this.deadzone = deadzone;
  }

  getDeadzone() {
    return this.deadzone;
  }

  getSetupConfig() {
    return this.setupConfig;
  }

  applySetupConfig(config, { silent = false } = {}) {
    this.setupConfig = {
      ...DEFAULT_CONTROLLER_SETUP,
      ...config,
      global: {
        ...DEFAULT_CONTROLLER_SETUP.global,
        ...(config?.global || {}),
      },
      controllers: Array.isArray(config?.controllers) ? config.controllers : [],
    };

    this.deadzone = this.setupConfig.global.deadzone ?? 0.35;
    this.setMapping(getMappingForProfile(this.setupConfig.global.mappingProfile));
    this.selectBestGamepad();

    if (!silent) {
      this.callbacks.onSetupChange(this.setupConfig);
    }
  }

  handleConnected(event) {
    const gamepad = event.gamepad;
    this.connectedIndexes.add(gamepad.index);

    if (isVirtualGamepad(gamepad)) {
      console.info(`[Gamepad] Ignoriere virtuelles Gamepad: ${gamepad.id}`);
      return;
    }

    this.selectBestGamepad();
    playConnectVibration(gamepad, this.setupConfig?.global?.vibrationStrength ?? 1);
    this.callbacks.onConnect(gamepad);
  }

  handleDisconnected(event) {
    if (this.activeGamepadIndex === event.gamepad.index) {
      this.activeGamepadIndex = null;
    }

    this.connectedIndexes.delete(event.gamepad.index);
    this.buttonPressed.clear();
    this.activeNavigationDirection = null;
    this.selectBestGamepad();

    if (!isVirtualGamepad(event.gamepad)) {
      this.callbacks.onDisconnect(event.gamepad);
    }
  }

  selectBestGamepad() {
    const playerOne = resolvePlayerOneGamepad(this.setupConfig);
    this.activeGamepadIndex = playerOne ? playerOne.index : null;
  }

  handleMouseMove() {
    this.setInputMode('mouse');
  }

  loop() {
    if (this.enabled) {
      const now = performance.now();
      if (now - this.lastScanAt >= this.scanInterval) {
        this.lastScanAt = now;
        this.scanConnectedGamepads();
      }

      const gamepad = this.activeGamepadIndex !== null ? this.getActiveGamepad() : null;
      if (gamepad) {
        this.pollGamepad(gamepad);
      }
    }

    if (this.running) {
      this.frameId = requestAnimationFrame(this.loop);
    }
  }

  scanConnectedGamepads() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

    for (const gamepad of gamepads) {
      if (!gamepad || this.connectedIndexes.has(gamepad.index)) continue;

      this.connectedIndexes.add(gamepad.index);

      if (isVirtualGamepad(gamepad)) {
        console.info(`[Gamepad] Ignoriere virtuelles Gamepad: ${gamepad.id}`);
        continue;
      }

      this.selectBestGamepad();
      playConnectVibration(gamepad, this.setupConfig?.global?.vibrationStrength ?? 1);
      this.callbacks.onConnect(gamepad);
    }
  }

  getActiveGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

    if (this.activeGamepadIndex !== null) {
      const current = gamepads[this.activeGamepadIndex];
      if (current && !isVirtualGamepad(current)) return current;
    }

    const playerOne = resolvePlayerOneGamepad(this.setupConfig, getAllRealGamepads());
    this.activeGamepadIndex = playerOne ? playerOne.index : null;
    return playerOne;
  }

  getConnectedGamepads() {
    return getAllRealGamepads();
  }

  pollGamepad(gamepad) {
    this.pollNavigation(gamepad);
    this.pollAction(gamepad, 'confirm', this.mapping.confirm);
    this.pollAction(gamepad, 'back', this.mapping.back);
    this.pollAction(gamepad, 'settings', this.mapping.settings);
    this.pollAction(gamepad, 'tabLeft', this.mapping.l1);
    this.pollAction(gamepad, 'tabRight', this.mapping.r1);
    this.pollTouchpad(gamepad);
  }

  pollNavigation(gamepad) {
    const axisX = this.applyDeadzone(gamepad.axes[0] || 0);
    const axisY = this.applyDeadzone(gamepad.axes[1] || 0);
    const direction = this.getNavigationDirection(gamepad, axisX, axisY);

    if (!direction) {
      this.activeNavigationDirection = null;
      return;
    }

    const now = performance.now();

    if (direction !== this.activeNavigationDirection) {
      this.activeNavigationDirection = direction;
      this.lastNavigationAt = now;
      this.emitNavigation(direction);
      return;
    }

    if (now - this.lastNavigationAt >= this.repeatDelay) {
      this.lastNavigationAt = now;
      this.emitNavigation(direction);
    }
  }

  emitNavigation(direction) {
    this.setInputMode('gamepad');
    this.callbacks.onNavigate(direction);
  }

  getNavigationDirection(gamepad, axisX, axisY) {
    if (this.isButtonPressed(gamepad, this.mapping.dpadUp)) return 'up';
    if (this.isButtonPressed(gamepad, this.mapping.dpadDown)) return 'down';
    if (this.isButtonPressed(gamepad, this.mapping.dpadLeft)) return 'left';
    if (this.isButtonPressed(gamepad, this.mapping.dpadRight)) return 'right';

    if (gamepad.mapping !== 'standard' && gamepad.axes.length > NONSTANDARD_DPAD_AXIS) {
      const hat = gamepad.axes[NONSTANDARD_DPAD_AXIS];
      const hatDirection = decodeHatSwitch(hat);
      if (hatDirection) return hatDirection;
    }

    if (Math.abs(axisX) > Math.abs(axisY)) {
      if (axisX < -this.deadzone) return 'left';
      if (axisX > this.deadzone) return 'right';
    }

    if (axisY < -this.deadzone) return 'up';
    if (axisY > this.deadzone) return 'down';

    return null;
  }

  pollAction(gamepad, action, buttonIndex) {
    const pressed = this.isButtonPressed(gamepad, buttonIndex);
    const wasPressed = this.buttonPressed.get(action) || false;

    if (pressed && !wasPressed && this.canEmit(action, this.buttonDebounce)) {
      this.setInputMode('gamepad');
      this.callbacks.onAction(action);
    }

    this.buttonPressed.set(action, pressed);
  }

  pollTouchpad(gamepad) {
    const info = parseControllerInfo(gamepad);
    const indices = info.type === 'dualsense' || info.type === 'dualshock4'
      ? [this.mapping.touchpad, 13, 20]
      : [this.mapping.touchpad];

    const pressed = indices.some((index) => this.isButtonPressed(gamepad, index));
    const wasPressed = this.buttonPressed.get('touchpad') || false;

    if (pressed && !wasPressed && this.canEmit('touchpad', this.buttonDebounce)) {
      this.setInputMode('gamepad');
      this.callbacks.onAction('touchpad');
    }

    this.buttonPressed.set('touchpad', pressed);
  }

  canEmit(key, debounceMs) {
    const now = performance.now();
    const last = this.lastInputAt.get(key) || 0;
    if (now - last < debounceMs) return false;
    this.lastInputAt.set(key, now);
    return true;
  }

  applyDeadzone(value) {
    return Math.abs(value) < this.deadzone ? 0 : value;
  }

  isButtonPressed(gamepad, buttonIndex) {
    if (typeof buttonIndex !== 'number') return false;
    const button = gamepad.buttons[buttonIndex];
    if (!button) return false;
    if (typeof button === 'number') return button > 0.5;
    return Boolean(button.pressed) || (button.value || 0) > 0.5;
  }

  setInputMode(mode) {
    if (this.inputMode === mode) return;

    this.inputMode = mode;
    this.callbacks.onInputModeChange(mode);
  }

  isAnyButtonPressed(gamepad) {
    if (!gamepad?.buttons) return false;
    return gamepad.buttons.some((button) => {
      if (typeof button === 'number') return button > 0.5;
      return Boolean(button?.pressed) || (button?.value || 0) > 0.5;
    });
  }
}

function decodeHatSwitch(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  if (value > 1.1) return null;

  const tolerance = 0.15;
  const directions = [
    { value: -1.0, dir: 'up' },
    { value: -0.714, dir: 'up' },
    { value: -0.428, dir: 'right' },
    { value: -0.142, dir: 'down' },
    { value: 0.142, dir: 'down' },
    { value: 0.428, dir: 'down' },
    { value: 0.714, dir: 'left' },
    { value: 1.0, dir: 'up' },
  ];

  for (const candidate of directions) {
    if (Math.abs(value - candidate.value) < tolerance) {
      return candidate.dir;
    }
  }

  return null;
}

window.GamepadManager = GamepadManager;
window.GamepadUtils = {
  CONTROLLER_SETUP_STORAGE_KEY,
  DEFAULT_CONTROLLER_SETUP,
  STANDARD_MAPPING,
  ALTERNATIVE_MAPPING,
  isVirtualGamepad,
  scoreGamepad,
  parseControllerInfo,
  describeGamepad,
  getGamepadKey,
  getBatteryStatus,
  formatBatteryStatus,
  getControllerIconType,
  getAllRealGamepads,
  getMappingForProfile,
  loadControllerSetupConfig,
  saveControllerSetupConfig,
  resolvePlayerOneGamepad,
  playConnectVibration,
};
