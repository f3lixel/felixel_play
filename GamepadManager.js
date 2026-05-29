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
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
};

// Fallback fuer Controller im non-standard Mapping (z.B. DualShock 4 ueber
// einige Bluetooth-Stacks). Hier sind D-Pad Werte ueber Achse 9 codiert.
const NONSTANDARD_DPAD_AXIS = 9;

// Stichwoerter, an denen wir virtuelle/Phantom-Gamepads erkennen.
// Diese werden von Tools wie vJoy, ViGEm, DS4Windows, JoyToKey etc. erzeugt
// und sollen in unserem Launcher ignoriert werden.
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

// Bewertung fuer die Gamepad-Auswahl: hoeher = bevorzugt.
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

class GamepadManager {
  constructor(options = {}) {
    this.deadzone = options.deadzone ?? 0.35;
    this.repeatDelay = options.repeatDelay ?? 280;
    this.buttonDebounce = options.buttonDebounce ?? 220;
    this.mapping = { ...STANDARD_MAPPING, ...options.mapping };

    this.callbacks = {
      onConnect: options.onConnect || (() => {}),
      onDisconnect: options.onDisconnect || (() => {}),
      onNavigate: options.onNavigate || (() => {}),
      onAction: options.onAction || (() => {}),
      onInputModeChange: options.onInputModeChange || (() => {}),
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

  handleConnected(event) {
    const gamepad = event.gamepad;
    this.connectedIndexes.add(gamepad.index);

    if (isVirtualGamepad(gamepad)) {
      console.info(`[Gamepad] Ignoriere virtuelles Gamepad: ${gamepad.id}`);
      return;
    }

    this.selectBestGamepad();
    this.callbacks.onConnect(gamepad);
  }

  handleDisconnected(event) {
    if (this.activeGamepadIndex === event.gamepad.index) {
      this.activeGamepadIndex = null;
    }

    this.connectedIndexes.delete(event.gamepad.index);
    this.buttonPressed.clear();
    this.activeNavigationDirection = null;

    // Falls ein anderes echtes Gamepad noch da ist, Wechsel auf dieses.
    this.selectBestGamepad();

    if (!isVirtualGamepad(event.gamepad)) {
      this.callbacks.onDisconnect(event.gamepad);
    }
  }

  selectBestGamepad() {
    const gamepads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    let best = null;
    let bestScore = -1;

    for (const gamepad of gamepads) {
      if (!gamepad) continue;
      const score = scoreGamepad(gamepad);
      if (score > bestScore) {
        best = gamepad;
        bestScore = score;
      }
    }

    if (best) {
      this.activeGamepadIndex = best.index;
    } else {
      this.activeGamepadIndex = null;
    }
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
      this.callbacks.onConnect(gamepad);
    }
  }

  getActiveGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

    if (this.activeGamepadIndex !== null) {
      const current = gamepads[this.activeGamepadIndex];
      if (current && !isVirtualGamepad(current)) return current;
    }

    // Aktive Auswahl ist weg oder virtuell -> bestes echtes Gamepad waehlen.
    let best = null;
    let bestScore = -1;
    for (const gamepad of gamepads) {
      if (!gamepad) continue;
      const score = scoreGamepad(gamepad);
      if (score > bestScore) {
        best = gamepad;
        bestScore = score;
      }
    }

    this.activeGamepadIndex = best ? best.index : null;
    return best;
  }

  pollGamepad(gamepad) {
    this.pollNavigation(gamepad);
    this.pollAction(gamepad, 'confirm', this.mapping.confirm);
    this.pollAction(gamepad, 'back', this.mapping.back);
    this.pollAction(gamepad, 'settings', this.mapping.settings);
    this.pollAction(gamepad, 'tabLeft', this.mapping.l1);
    this.pollAction(gamepad, 'tabRight', this.mapping.r1);
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

    // Halte-Repeat: bei dauerhaftem Druecken mit repeatDelay wiederholen.
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

    // Fallback fuer non-standard Mappings: D-Pad ueber Achse 9 (Hat Switch)
    // Werte ca: -1=up, -0.71=up-right, -0.43=right, -0.14=down-right,
    //           0.14=down, 0.43=down-left, 0.71=left, 1=up-left
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
}

// HID Hat-Switch decodieren. Chromium liefert auf nicht-standard Mappings
// einen Achsenwert mit 8 Richtungen + "released":
//   -1.000 up         -0.714 up-right   -0.428 right    -0.142 down-right
//    0.142 down        0.428 down-left   0.714 left      1.000 up-left
//   ~1.286 released
function decodeHatSwitch(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  if (value > 1.1) return null;

  const tolerance = 0.15;
  const directions = [
    { value: -1.0, dir: 'up' },
    { value: -0.714, dir: 'up' },     // up-right -> als "up" behandeln
    { value: -0.428, dir: 'right' },
    { value: -0.142, dir: 'down' },   // down-right -> als "down"
    { value: 0.142, dir: 'down' },
    { value: 0.428, dir: 'down' },    // down-left -> als "down"
    { value: 0.714, dir: 'left' },
    { value: 1.0, dir: 'up' },        // up-left -> als "up"
  ];

  for (const candidate of directions) {
    if (Math.abs(value - candidate.value) < tolerance) {
      return candidate.dir;
    }
  }

  return null;
}

window.GamepadManager = GamepadManager;
