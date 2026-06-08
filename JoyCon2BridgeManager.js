const path = require('path');
const { EventEmitter } = require('events');

const NINTENDO_BUTTON_LABELS = {
  a: 'B',
  b: 'A',
  x: 'Y',
  y: 'X',
  guide: 'Home',
  back: '-',
  start: '+',
  leftShoulder: 'L',
  rightShoulder: 'R',
  leftTrigger: 'ZL',
  rightTrigger: 'ZR',
  leftStick: 'Left Stick',
  rightStick: 'Right Stick',
  dpadUp: 'DPad Up',
  dpadDown: 'DPad Down',
  dpadLeft: 'DPad Left',
  dpadRight: 'DPad Right',
};

const CONTROLLER_TYPE_NAMES = {
  1: 'Joy-Con (Single)',
  2: 'Joy-Con (Dual)',
  3: 'Pro Controller 2',
  4: 'NSO GameCube',
};

function resolveAddonPath() {
  const candidates = [
    path.join(__dirname, 'native', 'joycon2_bridge', 'build', 'Release', 'joycon2_bridge.node'),
    path.join(__dirname, 'native', 'joycon2_bridge', 'build', 'Debug', 'joycon2_bridge.node'),
  ];
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      return require(candidate);
    } catch {
      // try next candidate
    }
  }
  return null;
}

function getButtonLabel(logicalButton) {
  return NINTENDO_BUTTON_LABELS[logicalButton] || logicalButton;
}

function describeControllerType(typeCode, side) {
  const base = CONTROLLER_TYPE_NAMES[typeCode] || 'Joy-Con 2';
  if (typeCode === 1 && side) {
    return `${base} (${side === 'left' ? 'L' : 'R'})`;
  }
  return base;
}

class JoyCon2BridgeManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.onInput = options.onInput || (() => {});
    this.addon = null;
    this.available = false;
    this.started = false;
    this.vigemConnected = false;
    this.scanState = 'idle';
    this.players = new Map();
  }

  start() {
    if (this.started) return this.available;

    this.addon = resolveAddonPath();
    if (!this.addon) {
      console.warn('[JoyCon2] Native Addon nicht gefunden. Fuehre npm run rebuild:native aus.');
      return false;
    }

    try {
      const ok = this.addon.initialize((event) => this.handleNativeEvent(event));
      this.vigemConnected = Boolean(this.addon.isViGEmConnected?.());
      this.available = this.vigemConnected;
      this.started = true;
      if (this.available) {
        console.log('[JoyCon2] Native BLE/ViGEm-Bridge aktiv.');
      } else if (ok) {
        console.warn('[JoyCon2] Bridge initialisiert, aber ViGEmBus ist nicht verbunden.');
      } else {
        console.warn('[JoyCon2] Bridge-Initialisierung fehlgeschlagen.');
      }
    } catch (err) {
      console.warn(`[JoyCon2] Addon-Ladefehler: ${err.message}`);
      this.available = false;
    }

    return this.available;
  }

  stop() {
    if (!this.started) return;
    try {
      this.addon?.shutdown();
    } catch (err) {
      console.warn(`[JoyCon2] Shutdown-Fehler: ${err.message}`);
    }
    this.players.clear();
    this.started = false;
    this.available = false;
    this.addon = null;
  }

  isAvailable() {
    return this.available;
  }

  isViGEmConnected() {
    return this.vigemConnected;
  }

  getScanState() {
    return this.scanState;
  }

  getConnectedControllers() {
    return Array.from(this.players.values());
  }

  startScanSingle({ side = 'left', orientation = 'upright' } = {}) {
    if (!this.addon) return false;
    const sideCode = side === 'right' ? 1 : 0;
    const orientationCode = orientation === 'sideways' ? 1 : 0;
    this.addon.startScanSingle(sideCode, orientationCode);
    return true;
  }

  startScanDualFirst({ gyroSource = 'both' } = {}) {
    if (!this.addon) return false;
    const gyroMap = { both: 0, left: 1, right: 2 };
    this.addon.startScanDualFirst(gyroMap[gyroSource] ?? 0);
    return true;
  }

  startScanDualSecond() {
    if (!this.addon) return false;
    this.addon.startScanDualSecond();
    return true;
  }

  startScanPro({ type = 'pro' } = {}) {
    if (!this.addon) return false;
    const typeCode = type === 'nso-gc' ? 4 : 3;
    this.addon.startScanPro(typeCode);
    return true;
  }

  stopScan() {
    this.addon?.stopScan();
  }

  disconnectPlayer(playerId) {
    this.addon?.disconnectPlayer(playerId);
  }

  disconnectAll() {
    this.addon?.disconnectAll();
  }

  handleNativeEvent(event) {
    if (!event?.type) return;

    switch (event.type) {
      case 'vigem-status':
        this.vigemConnected = Boolean(event.connected);
        this.emit('vigem-status', { connected: this.vigemConnected });
        break;
      case 'scan-state':
        this.scanState = event.state || 'idle';
        this.emit('scan-state', { state: this.scanState });
        break;
      case 'player-connected':
        this.rememberPlayer(event);
        this.emitInput(this.buildConnectPayload(event));
        break;
      case 'player-disconnected':
        this.forgetPlayer(event.playerId);
        this.emitInput(this.buildDisconnectPayload(event.playerId));
        break;
      case 'button-down':
      case 'button-up':
        this.emitInput(this.buildButtonPayload(event));
        break;
      case 'axis':
        this.emitInput(this.buildAxisPayload(event));
        break;
      case 'error':
        console.warn(`[JoyCon2] ${event.message || 'Unbekannter Fehler'}`);
        this.emit('error', event);
        break;
      default:
        break;
    }
  }

  rememberPlayer(event) {
    const model = describeControllerType(event.controllerType, event.side);
    this.players.set(event.playerId, {
      id: event.playerId,
      source: 'joycon2',
      controllerType: 'Nintendo',
      controllerFamily: 'nintendo',
      controllerModel: model,
      name: model,
      side: event.side || '',
      player: this.players.size + 1,
      vendorId: '057e',
      productId: '',
    });
  }

  forgetPlayer(playerId) {
    this.players.delete(playerId);
  }

  buildBasePayload(playerId, type) {
    const player = this.players.get(playerId) || {
      id: playerId,
      controllerType: 'Nintendo',
      controllerFamily: 'nintendo',
      controllerModel: 'Joy-Con 2',
      name: 'Joy-Con 2',
    };

    return {
      source: 'joycon2',
      type,
      id: player.id,
      controllerId: player.id,
      controllerType: player.controllerType,
      controllerFamily: player.controllerFamily,
      controllerModel: player.controllerModel,
      name: player.name,
      vendorId: player.vendorId || '057e',
      productId: player.productId || '',
      player: player.player || 1,
      timestamp: Date.now(),
    };
  }

  buildConnectPayload(event) {
    return this.buildBasePayload(event.playerId, 'connect');
  }

  buildDisconnectPayload(playerId) {
    return this.buildBasePayload(playerId, 'disconnect');
  }

  buildButtonPayload(event) {
    const logicalButton = event.logicalButton;
    return {
      ...this.buildBasePayload(event.playerId, event.type),
      logicalButton,
      button: getButtonLabel(logicalButton),
      pressed: event.type === 'button-down',
    };
  }

  buildAxisPayload(event) {
    return {
      ...this.buildBasePayload(event.playerId, 'axis'),
      logicalAxis: event.logicalAxis,
      axis: event.logicalAxis,
      value: Number(event.value) || 0,
    };
  }

  emitInput(payload) {
    this.emit('input', payload);
    this.onInput(payload);
  }
}

module.exports = {
  JoyCon2BridgeManager,
  resolveAddonPath,
};
