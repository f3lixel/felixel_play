const { EventEmitter } = require('events');

const NINTENDO_VENDOR_ID = 0x057e;
const SONY_VENDOR_ID = 0x054c;

const DS4_PRODUCT_IDS = new Set([0x05c4, 0x09cc, 0x0ba0]);
const DUALSENSE_PRODUCT_IDS = new Set([0x0ce6, 0x0df2]);

const NINTENDO_TYPE_PREFIX = 'nintendoSwitch';
const KEEPALIVE_INTERVAL_MS = 12000;
const RESCAN_DELAY_MS = 900;

const DEFAULT_BUTTON_LABELS = {
  a: 'A',
  b: 'B',
  x: 'X',
  y: 'Y',
  guide: 'Guide',
  back: 'Back',
  start: 'Start',
  leftStick: 'Left Stick',
  rightStick: 'Right Stick',
  leftShoulder: 'LB',
  rightShoulder: 'RB',
  leftTrigger: 'LT',
  rightTrigger: 'RT',
  dpadUp: 'DPad Up',
  dpadDown: 'DPad Down',
  dpadLeft: 'DPad Left',
  dpadRight: 'DPad Right',
};

const NINTENDO_BUTTON_LABELS = {
  ...DEFAULT_BUTTON_LABELS,
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
};

const PLAYSTATION_BUTTON_LABELS = {
  ...DEFAULT_BUTTON_LABELS,
  a: 'Cross',
  b: 'Circle',
  x: 'Square',
  y: 'Triangle',
  guide: 'PS',
  back: 'Share',
  start: 'Options',
  leftShoulder: 'L1',
  rightShoulder: 'R1',
  leftTrigger: 'L2',
  rightTrigger: 'R2',
};

function toHexId(value) {
  if (typeof value !== 'number') return '';
  return value.toString(16).padStart(4, '0');
}

function normalizeName(value) {
  return String(value || '').trim();
}

function getDeviceKey(device) {
  const parts = [
    device?.id ?? 'unknown',
    device?.guid || '',
    device?.path || '',
    device?.vendor ?? '',
    device?.product ?? '',
  ];
  return parts.join(':');
}

function identifyController(device = {}, instance = null) {
  const name = normalizeName(device.name || instance?.device?.name || 'Controller');
  const lowerName = name.toLowerCase();
  const sdlType = device.type || instance?.device?.type || null;
  const vendor = device.vendor ?? instance?.device?.vendor ?? null;
  const product = device.product ?? instance?.device?.product ?? null;
  const vendorId = toHexId(vendor);
  const productId = toHexId(product);

  if (
    sdlType === 'ps5'
    || DUALSENSE_PRODUCT_IDS.has(product)
    || /dualsense|dual sense|ps5/.test(lowerName)
  ) {
    return {
      controllerType: 'PS5',
      controllerFamily: 'playstation',
      model: /edge/.test(lowerName) ? 'DualSense Edge' : 'DualSense',
      name,
      sdlType,
      vendorId,
      productId,
    };
  }

  if (
    sdlType === 'ps4'
    || vendor === SONY_VENDOR_ID
    || DS4_PRODUCT_IDS.has(product)
    || /dualshock|dual shock|wireless controller|ps4/.test(lowerName)
  ) {
    return {
      controllerType: 'PS4',
      controllerFamily: 'playstation',
      model: 'DualShock 4',
      name,
      sdlType,
      vendorId,
      productId,
    };
  }

  if (
    vendor === NINTENDO_VENDOR_ID
    || String(sdlType || '').startsWith(NINTENDO_TYPE_PREFIX)
    || /nintendo|switch|joy-?con|pro controller/.test(lowerName)
  ) {
    const model = /joy-?con/.test(lowerName)
      ? 'Nintendo Joy-Con'
      : /switch 2/.test(lowerName)
        ? 'Nintendo Switch 2 Controller'
        : 'Nintendo Switch Controller';

    return {
      controllerType: 'Nintendo',
      controllerFamily: 'nintendo',
      model,
      name,
      sdlType,
      vendorId,
      productId,
    };
  }

  return {
    controllerType: 'Generic',
    controllerFamily: 'generic',
    model: name,
    name,
    sdlType,
    vendorId,
    productId,
  };
}

function getButtonLabel(info, logicalButton) {
  if (info.controllerFamily === 'nintendo') {
    return NINTENDO_BUTTON_LABELS[logicalButton] || logicalButton;
  }
  if (info.controllerFamily === 'playstation') {
    return PLAYSTATION_BUTTON_LABELS[logicalButton] || logicalButton;
  }
  return DEFAULT_BUTTON_LABELS[logicalButton] || logicalButton;
}

class NativeControllerManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.onInput = options.onInput || (() => {});
    this.sdl = null;
    this.controllerApi = null;
    this.controllers = new Map();
    this.started = false;
    this.rescanTimer = null;

    this.handleDeviceAdd = this.handleDeviceAdd.bind(this);
    this.handleDeviceRemove = this.handleDeviceRemove.bind(this);
  }

  start() {
    if (this.started) return true;

    try {
      this.sdl = require('@kmamal/sdl');
      this.controllerApi = this.sdl.controller;
    } catch (err) {
      console.warn(`[Controller] @kmamal/sdl konnte nicht geladen werden: ${err.message}`);
      return false;
    }

    if (!this.controllerApi?.devices || !this.controllerApi?.openDevice) {
      console.warn('[Controller] @kmamal/sdl stellt keine Controller-API bereit.');
      return false;
    }

    this.started = true;
    this.controllerApi.on?.('deviceAdd', this.handleDeviceAdd);
    this.controllerApi.on?.('deviceRemove', this.handleDeviceRemove);
    this.scanDevices();
    console.log('[Controller] SDL Controller Manager aktiv.');
    return true;
  }

  stop() {
    this.started = false;
    if (this.rescanTimer) {
      clearTimeout(this.rescanTimer);
      this.rescanTimer = null;
    }

    this.controllerApi?.removeListener?.('deviceAdd', this.handleDeviceAdd);
    this.controllerApi?.removeListener?.('deviceRemove', this.handleDeviceRemove);

    for (const entry of this.controllers.values()) {
      this.closeController(entry, { emitDisconnect: false });
    }
    this.controllers.clear();
  }

  getConnectedControllers() {
    return Array.from(this.controllers.values()).map((entry) => ({ ...entry.info }));
  }

  handleDeviceAdd(event) {
    this.openDevice(event?.device || event);
  }

  handleDeviceRemove(event) {
    const device = event?.device || event;
    const key = getDeviceKey(device);
    const entry = this.controllers.get(key);
    if (!entry) {
      this.scheduleRescan();
      return;
    }
    this.closeController(entry, { emitDisconnect: true });
    this.controllers.delete(key);
    this.scheduleRescan();
  }

  scanDevices() {
    if (!this.started) return;
    for (const device of this.controllerApi.devices || []) {
      this.openDevice(device);
    }
  }

  scheduleRescan(delay = RESCAN_DELAY_MS) {
    if (this.rescanTimer) return;
    this.rescanTimer = setTimeout(() => {
      this.rescanTimer = null;
      this.scanDevices();
    }, delay);
  }

  openDevice(device) {
    if (!device) return null;
    const key = getDeviceKey(device);
    if (this.controllers.has(key)) return this.controllers.get(key).instance;

    let instance;
    try {
      instance = this.controllerApi.openDevice(device);
    } catch (err) {
      console.warn(`[Controller] SDL-Controller konnte nicht geoeffnet werden (${device.name || device.id}): ${err.message}`);
      return null;
    }

    const info = {
      id: key,
      deviceId: device.id ?? null,
      guid: device.guid || '',
      path: device.path || '',
      player: device.player ?? null,
      mapping: device.mapping || '',
      serialNumber: instance.serialNumber || null,
      firmwareVersion: instance.firmwareVersion ?? null,
      power: instance.power || null,
      ...identifyController(device, instance),
    };

    const entry = {
      key,
      device,
      instance,
      info,
      keepAliveTimer: null,
    };

    this.controllers.set(key, entry);
    this.attachInstanceEvents(entry);
    this.startKeepAlive(entry);
    this.emitInput(this.buildBaseEvent(entry, 'connect'));
    console.log(`[Controller] Verbunden: ${info.controllerType} - ${info.name}`);
    return instance;
  }

  attachInstanceEvents(entry) {
    const { instance } = entry;

    instance.on('buttonDown', (event) => {
      const payload = this.buildButtonEvent(entry, 'button-down', event?.button || event);
      this.emitInput(payload);
    });

    instance.on('buttonUp', (event) => {
      const payload = this.buildButtonEvent(entry, 'button-up', event?.button || event);
      this.emitInput(payload);
    });

    instance.on('axisMotion', (event) => {
      const payload = this.buildAxisEvent(entry, event);
      this.emitInput(payload);
    });

    instance.on('powerUpdate', (event) => {
      entry.info.power = event?.power || event || null;
      this.emitInput({
        ...this.buildBaseEvent(entry, 'power-update'),
        power: entry.info.power,
      });
    });

    instance.on('remap', () => {
      this.emitInput(this.buildBaseEvent(entry, 'remap'));
    });

    instance.on('close', () => {
      if (!this.controllers.has(entry.key)) return;
      this.closeController(entry, { emitDisconnect: true, alreadyClosed: true });
      this.controllers.delete(entry.key);
      if (entry.info.controllerFamily === 'nintendo') {
        this.scheduleRescan(RESCAN_DELAY_MS);
      }
    });
  }

  closeController(entry, options = {}) {
    const { emitDisconnect = true, alreadyClosed = false } = options;
    if (entry.keepAliveTimer) {
      clearInterval(entry.keepAliveTimer);
      entry.keepAliveTimer = null;
    }

    if (!alreadyClosed && !entry.instance.closed) {
      try {
        entry.instance.close();
      } catch (err) {
        console.warn(`[Controller] Schliessen fehlgeschlagen (${entry.info.name}): ${err.message}`);
      }
    }

    if (emitDisconnect) {
      this.emitInput(this.buildBaseEvent(entry, 'disconnect'));
      console.log(`[Controller] Getrennt: ${entry.info.controllerType} - ${entry.info.name}`);
    }
  }

  startKeepAlive(entry) {
    if (entry.info.controllerFamily !== 'nintendo') return;

    entry.keepAliveTimer = setInterval(() => {
      if (entry.instance.closed) return;
      try {
        if (typeof entry.instance.setPlayer === 'function' && entry.info.player !== null) {
          entry.instance.setPlayer(entry.info.player);
        }
        if (entry.instance.hasRumble && typeof entry.instance.rumble === 'function') {
          entry.instance.rumble(0, 0, 1);
        }
      } catch (err) {
        console.warn(`[Controller] Nintendo-Keepalive fehlgeschlagen (${entry.info.name}): ${err.message}`);
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  buildBaseEvent(entry, type) {
    return {
      source: 'sdl',
      type,
      id: entry.info.id,
      controllerId: entry.info.id,
      controllerType: entry.info.controllerType,
      controllerFamily: entry.info.controllerFamily,
      controllerModel: entry.info.model,
      name: entry.info.name,
      vendorId: entry.info.vendorId,
      productId: entry.info.productId,
      guid: entry.info.guid,
      player: entry.info.player,
      power: entry.info.power,
      serialNumber: entry.info.serialNumber,
      sdlType: entry.info.sdlType,
      timestamp: Date.now(),
    };
  }

  buildButtonEvent(entry, type, logicalButton) {
    const button = String(logicalButton || '');
    return {
      ...this.buildBaseEvent(entry, type),
      logicalButton: button,
      button: getButtonLabel(entry.info, button),
      pressed: type === 'button-down',
    };
  }

  buildAxisEvent(entry, event = {}) {
    const axis = String(event.axis || '');
    return {
      ...this.buildBaseEvent(entry, 'axis'),
      logicalAxis: axis,
      axis,
      value: typeof event.value === 'number' ? event.value : 0,
    };
  }

  emitInput(payload) {
    this.emit('input', payload);
    this.onInput(payload);
  }
}

module.exports = {
  NativeControllerManager,
  identifyController,
};
