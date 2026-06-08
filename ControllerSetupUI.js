// Controller Setup Modal - UI, Persistenz und Synchronisation mit GamepadManager/Main.

const {
  DEFAULT_CONTROLLER_SETUP,
  describeGamepad,
  formatBatteryStatus,
  getAllRealGamepads,
  getControllerIconType,
  getGamepadKey,
  loadControllerSetupConfig,
  parseControllerInfo,
  saveControllerSetupConfig,
} = window.GamepadUtils;

const CONTROLLER_SLOT_COUNT = 4;
const FOCUS_SELECTOR = '[data-controller-focus]';
const ICON_PS = 'assets/icons/playsi.svg';
const ICON_SWITCH = 'assets/icons/switchi.svg';

class ControllerSetupUI {
  constructor(options = {}) {
    this.overlay = document.getElementById('controllerOverlay');
    this.panel = this.overlay?.querySelector('.controller-overlay-panel') || null;
    this.slotEl = document.getElementById('controllerSlots');
    this.listEl = document.getElementById('controllerList');
    this.emptyEl = document.getElementById('controllerEmptyState');
    this.addHintEls = Array.from(document.querySelectorAll('[data-controller-add-hint]'));
    this.statusEls = Array.from(document.querySelectorAll('[data-controller-status-text]'));
    this.btnOpen = document.getElementById('btnController');
    this.btnClose = document.getElementById('btnControllerClose');
    this.btnAdd = document.getElementById('btnAddController');
    this.btnGoToConnectView = document.getElementById('btnGoToConnectView');
    this.btnBackToDashboard = document.getElementById('btnBackToDashboard');
    this.btnViewDashboard = document.getElementById('btnControllerViewDashboard');
    this.btnViewConnect = document.getElementById('btnControllerViewConnect');
    this.btnViewMapping = document.getElementById('btnControllerViewMapping');
    this.viewDashboardEl = document.getElementById('controllerViewDashboard');
    this.viewConnectEl = document.getElementById('controllerViewConnect');
    this.viewMappingEl = document.getElementById('controllerViewMapping');
    this.btnReady = document.getElementById('btnControllerReady');
    this.globalDeadzone = document.getElementById('globalDeadzone');
    this.globalDeadzoneValue = document.getElementById('globalDeadzoneValue');
    this.globalVibration = document.getElementById('globalVibration');
    this.globalVibrationValue = document.getElementById('globalVibrationValue');
    this.globalMapping = document.getElementById('globalMappingProfile');

    this.gamepadManager = options.gamepadManager || window.felixelGamepadManager || null;
    this.config = this.normalizeConfig(loadControllerSetupConfig());
    this.isOpen = false;
    this.isWaitingForNewController = false;
    this.pollFrameId = null;
    this.dragSourceKey = null;
    this.focusIndex = 0;
    this.selectedKey = this.config.controllers[0]?.key || null;
    this.lastFocusedElement = null;
    this.currentView = 'dashboard';
    this._nativeKeys = new Set();

    this.handleOpen = this.handleOpen.bind(this);
    this.handleClose = this.handleClose.bind(this);
    this.handleAddController = this.handleAddController.bind(this);
    this.handleGlobalChange = this.handleGlobalChange.bind(this);
    this.handleGamepadConnect = this.handleGamepadConnect.bind(this);
    this.handleGamepadDisconnect = this.handleGamepadDisconnect.bind(this);
    this.pollWaitingForController = this.pollWaitingForController.bind(this);
    this.handleKeyboard = this.handleKeyboard.bind(this);
    this.handleOverlayPointerDown = this.handleOverlayPointerDown.bind(this);
  }

  init() {
    if (!this.overlay) return;

    this.btnOpen?.addEventListener('click', this.handleOpen);
    this.btnClose?.addEventListener('click', this.handleClose);
    this.btnAdd?.addEventListener('click', this.handleAddController);
    this.btnGoToConnectView?.addEventListener('click', this.handleAddController);
    this.btnBackToDashboard?.addEventListener('click', () => this.setView('dashboard'));
    this.btnViewDashboard?.addEventListener('click', () => this.setView('dashboard'));
    this.btnViewConnect?.addEventListener('click', () => this.setView('connect'));
    this.btnViewMapping?.addEventListener('click', () => this.setView('mapping'));
    this.btnReady?.addEventListener('click', this.handleClose);
    this.globalDeadzone?.addEventListener('input', this.handleGlobalChange);
    this.globalVibration?.addEventListener('input', this.handleGlobalChange);
    this.globalMapping?.addEventListener('change', this.handleGlobalChange);
    this.overlay?.addEventListener('mousedown', this.handleOverlayPointerDown);
    document.addEventListener('keydown', this.handleKeyboard);
    window.addEventListener('gamepadconnected', this.handleGamepadConnect);
    window.addEventListener('gamepaddisconnected', this.handleGamepadDisconnect);

    this.syncConnectedControllers({ silent: true });
    this.renderGlobalSettings();
    this.persistConfig({ syncMain: true, silent: true });
  }

  normalizeConfig(config) {
    const base = typeof structuredClone === 'function'
      ? structuredClone(DEFAULT_CONTROLLER_SETUP)
      : JSON.parse(JSON.stringify(DEFAULT_CONTROLLER_SETUP));

    return {
      ...base,
      ...config,
      global: { ...base.global, ...(config?.global || {}) },
      controllers: Array.isArray(config?.controllers)
        ? config.controllers.slice(0, CONTROLLER_SLOT_COUNT).map((entry, index) => ({
          key: entry.key,
          playerSlot: Number(entry.playerSlot) || index + 1,
          prioritizePlayer1: Boolean(entry.prioritizePlayer1 || index === 0),
          deadzone: entry.deadzone ?? null,
          vibrationStrength: entry.vibrationStrength ?? null,
          mappingProfile: entry.mappingProfile ?? null,
          label: entry.label || 'Controller',
          type: entry.type || 'generic',
          vendorId: entry.vendorId || '',
          productId: entry.productId || '',
          connectionType: entry.connectionType || 'Unknown',
          lastSeenAt: entry.lastSeenAt || null,
        }))
        : [],
    };
  }

  getConfig() {
    return this.config;
  }

  handleOpen() {
    this.isOpen = true;
    this.lastFocusedElement = document.activeElement;
    this.setView('dashboard', { keepFocus: true });
    this.overlay.classList.remove('hidden');
    this.syncConnectedControllers({ silent: true });
    this.syncNativeControllersFromApi();
    this.render();
    this.focusIndex = 0;
    this.applyModalFocus();

    if (window.gsap && this.panel) {
      gsap.killTweensOf([this.overlay, this.panel]);
      gsap.set(this.overlay, { autoAlpha: 1 });
      gsap.fromTo(this.panel, { autoAlpha: 0, y: 34, scale: 0.94 }, {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 0.34,
        ease: 'power3.out',
      });
      gsap.fromTo(
        this.overlay.querySelectorAll('.controller-hero-icon, .controller-slot, .controller-card, .controller-pairing-card, .controller-global-settings'),
        { autoAlpha: 0, y: 18 },
        { autoAlpha: 1, y: 0, duration: 0.36, stagger: 0.035, ease: 'power2.out', delay: 0.06 },
      );
    }
  }

  handleClose() {
    this.stopWaitingForController();
    this.isOpen = false;

    const close = () => {
      this.overlay.classList.add('hidden');
      this.lastFocusedElement?.focus?.({ preventScroll: true });
    };

    if (window.gsap && this.panel) {
      gsap.killTweensOf(this.panel);
      gsap.to(this.panel, { autoAlpha: 0, y: 20, scale: 0.98, duration: 0.18, ease: 'power2.in', onComplete: close });
      return;
    }

    close();
  }

  handleOverlayPointerDown(event) {
    if (!this.isOpen) return;
    if (event.target === this.overlay) this.handleClose();
  }

  setView(view, { keepFocus = false } = {}) {
    this.currentView = view === 'connect' || view === 'mapping' ? view : 'dashboard';
    this.viewDashboardEl?.classList.toggle('hidden', this.currentView !== 'dashboard');
    this.viewDashboardEl?.classList.toggle('is-active', this.currentView === 'dashboard');
    this.viewConnectEl?.classList.toggle('hidden', this.currentView !== 'connect');
    this.viewConnectEl?.classList.toggle('is-active', this.currentView === 'connect');
    this.viewMappingEl?.classList.toggle('hidden', this.currentView !== 'mapping');
    this.viewMappingEl?.classList.toggle('is-active', this.currentView === 'mapping');

    this.btnViewDashboard?.classList.toggle('is-active', this.currentView === 'dashboard');
    this.btnViewConnect?.classList.toggle('is-active', this.currentView === 'connect');
    this.btnViewMapping?.classList.toggle('is-active', this.currentView === 'mapping');

    if (!keepFocus) {
      this.focusIndex = 0;
      this.applyModalFocus();
    }
  }

  handleKeyboard(event) {
    if (!this.isOpen) return;

    const keyMap = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (event.key === 'Escape') {
      event.preventDefault();
      this.handleClose();
      return;
    }
    if (keyMap[event.key]) {
      event.preventDefault();
      this.handleGamepadNavigate(keyMap[event.key]);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.handleGamepadAction('confirm');
    }
  }

  handleGamepadNavigate(direction) {
    if (!this.isOpen) return false;

    const focusable = this.getFocusableElements();
    if (focusable.length === 0) return true;

    const columns = 4;
    const current = Math.max(0, Math.min(this.focusIndex, focusable.length - 1));
    let next = current;
    if (direction === 'left') next = Math.max(0, current - 1);
    if (direction === 'right') next = Math.min(focusable.length - 1, current + 1);
    if (direction === 'up') next = Math.max(0, current - columns);
    if (direction === 'down') next = Math.min(focusable.length - 1, current + columns);

    if (next !== current) {
      this.focusIndex = next;
      this.applyModalFocus();
    }
    return true;
  }

  handleGamepadAction(action) {
    if (!this.isOpen) return false;
    if (action === 'back') {
      this.handleClose();
      return true;
    }
    if (action === 'tabLeft') {
      this.moveSelectedController('up');
      return true;
    }
    if (action === 'tabRight') {
      this.moveSelectedController('down');
      return true;
    }
    if (action === 'confirm') {
      this.getFocusableElements()[this.focusIndex]?.click?.();
      return true;
    }
    return true;
  }

  getFocusableElements() {
    return Array.from(this.overlay.querySelectorAll(FOCUS_SELECTOR))
      .filter((el) => !el.disabled && el.offsetParent !== null);
  }

  applyModalFocus() {
    const focusable = this.getFocusableElements();
    if (focusable.length === 0) return;
    this.focusIndex = Math.max(0, Math.min(this.focusIndex, focusable.length - 1));
    focusable.forEach((el, index) => el.classList.toggle('is-controller-focused', index === this.focusIndex));
    focusable[this.focusIndex].focus({ preventScroll: true });
  }

  handleGamepadConnect() {
    this.syncConnectedControllers();
    if (this.isOpen) this.render();
  }

  handleGamepadDisconnect() {
    this.syncConnectedControllers();
    if (this.isOpen) this.render();
  }

  handleAddController() {
    if (this.isWaitingForNewController) {
      this.stopWaitingForController();
      return;
    }
    this.setView('connect', { keepFocus: true });
    this.isWaitingForNewController = true;
    this.addHintEls.forEach((el) => el.classList.remove('hidden'));
    this.btnAdd?.classList.add('is-active');
    if (this.btnAdd) this.btnAdd.textContent = 'Pairing abbrechen';
    this.setStatus('Pairing aktiv: Druecke L + R oder eine beliebige Taste am Controller.');
    this.pollFrameId = requestAnimationFrame(this.pollWaitingForController);
  }

  stopWaitingForController() {
    this.isWaitingForNewController = false;
    this.addHintEls.forEach((el) => el.classList.add('hidden'));
    this.btnAdd?.classList.remove('is-active');
    if (this.btnAdd) this.btnAdd.textContent = 'Controller hinzufügen';
    if (this.pollFrameId) cancelAnimationFrame(this.pollFrameId);
    this.pollFrameId = null;
  }

  pollWaitingForController() {
    if (!this.isWaitingForNewController) return;
    for (const gamepad of getAllRealGamepads()) {
      if (!this.isAnyButtonPressed(gamepad)) continue;
      this.assignController(gamepad);
      this.stopWaitingForController();
      this.setStatus(`${describeGamepad(gamepad)} wurde zugewiesen.`);
      this.render();
      return;
    }
    this.pollFrameId = requestAnimationFrame(this.pollWaitingForController);
  }

  isAnyButtonPressed(gamepad) {
    if (this.gamepadManager?.isAnyButtonPressed) return this.gamepadManager.isAnyButtonPressed(gamepad);
    return (gamepad.buttons || []).some((button) => {
      if (typeof button === 'number') return button > 0.5;
      return Boolean(button?.pressed) || (button?.value || 0) > 0.5;
    });
  }

  assignController(gamepad) {
    const key = getGamepadKey(gamepad);
    const existing = this.config.controllers.find((entry) => entry.key === key);
    if (existing) {
      this.updateEntryFromGamepad(existing, gamepad);
      this.selectedKey = key;
      this.persistConfig();
      return;
    }
    if (this.config.controllers.length >= CONTROLLER_SLOT_COUNT) {
      this.setStatus('Alle vier Player-Slots sind bereits belegt.');
      return;
    }

    const info = parseControllerInfo(gamepad);
    const slot = this.getNextAvailableSlot();
    this.config.controllers.push({
      key,
      playerSlot: slot,
      prioritizePlayer1: this.config.controllers.length === 0 || slot === 1,
      deadzone: null,
      vibrationStrength: null,
      mappingProfile: null,
      label: describeGamepad(gamepad),
      type: info.type,
      vendorId: info.vendorId,
      productId: info.productId,
      connectionType: this.getConnectionType(gamepad),
      lastSeenAt: Date.now(),
    });
    this.selectedKey = key;
    this.ensureSinglePlayerOne();
    this.persistConfig();
  }

  syncConnectedControllers({ silent = false } = {}) {
    let changed = false;
    // Native-registered vendor+product combos to skip browser gamepad duplicates
    const nativeVP = new Set(
      this.config.controllers
        .filter((e) => e.isNative && e.vendorId && e.productId)
        .map((e) => `${e.vendorId}:${e.productId}`),
    );
    for (const gamepad of getAllRealGamepads()) {
      const info = parseControllerInfo(gamepad);
      if (info.vendorId && info.productId && nativeVP.has(`${info.vendorId}:${info.productId}`)) continue;
      const key = getGamepadKey(gamepad);
      const existing = this.config.controllers.find((entry) => entry.key === key);
      if (!existing) {
        if (this.config.controllers.length < CONTROLLER_SLOT_COUNT) {
          this.assignController(gamepad);
          changed = true;
        }
        continue;
      }
      changed = this.updateEntryFromGamepad(existing, gamepad) || changed;
    }
    this.sortControllers();
    this.ensureSinglePlayerOne();
    if (changed && !silent) this.persistConfig();
    if (changed && silent) {
      saveControllerSetupConfig(this.config);
      this.gamepadManager?.applySetupConfig(this.config, { silent: true });
    }
  }

  updateEntryFromGamepad(entry, gamepad) {
    const info = parseControllerInfo(gamepad);
    const updates = {
      label: describeGamepad(gamepad),
      type: info.type,
      vendorId: info.vendorId,
      productId: info.productId,
      connectionType: this.getConnectionType(gamepad),
    };
    let changed = false;
    for (const [field, value] of Object.entries(updates)) {
      if (entry[field] !== value) {
        entry[field] = value;
        changed = true;
      }
    }
    entry.lastSeenAt = Date.now();
    return changed;
  }

  getConnectionType(gamepad) {
    const id = gamepad?.id || '';
    if (/bluetooth|wireless|bt/i.test(id)) return 'Wireless';
    if (/usb|xinput|vendor/i.test(id)) return 'USB';
    return 'Unknown';
  }

  getNextAvailableSlot() {
    const used = new Set(this.config.controllers.map((entry) => Number(entry.playerSlot)));
    for (let slot = 1; slot <= CONTROLLER_SLOT_COUNT; slot += 1) {
      if (!used.has(slot)) return slot;
    }
    return CONTROLLER_SLOT_COUNT;
  }

  assignSlot(key, slot) {
    const entry = this.config.controllers.find((item) => item.key === key);
    if (!entry) return;
    const other = this.config.controllers.find((item) => item.key !== key && item.playerSlot === slot);
    if (other) other.playerSlot = entry.playerSlot;
    entry.playerSlot = slot;
    this.selectedKey = key;
    this.sortControllers();
    this.ensureSinglePlayerOne();
    this.persistConfig();
    this.render();
  }

  moveSelectedController(direction) {
    if (this.selectedKey) this.moveController(this.selectedKey, direction);
  }

  moveController(key, direction) {
    this.sortControllers();
    const index = this.config.controllers.findIndex((entry) => entry.key === key);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= this.config.controllers.length) return;
    const currentSlot = this.config.controllers[index].playerSlot;
    this.config.controllers[index].playerSlot = this.config.controllers[targetIndex].playerSlot;
    this.config.controllers[targetIndex].playerSlot = currentSlot;
    this.selectedKey = key;
    this.sortControllers();
    this.ensureSinglePlayerOne();
    this.persistConfig();
    this.render();
  }

  updateControllerSetting(key, field, value) {
    const entry = this.config.controllers.find((item) => item.key === key);
    if (!entry) return;
    if (field === 'prioritizePlayer1' && value) {
      this.assignSlot(key, 1);
      return;
    }
    entry[field] = value;
    this.selectedKey = key;
    this.persistConfig();
    this.render();
  }

  removeController(key) {
    this.config.controllers = this.config.controllers.filter((entry) => entry.key !== key);
    if (this.selectedKey === key) this.selectedKey = this.config.controllers[0]?.key || null;
    this.ensureSinglePlayerOne();
    this.persistConfig();
    this.render();
  }

  sortControllers() {
    this.config.controllers.sort((a, b) => Number(a.playerSlot) - Number(b.playerSlot));
  }

  ensureSinglePlayerOne() {
    const playerOne = this.config.controllers.find((entry) => Number(entry.playerSlot) === 1) || this.config.controllers[0];
    this.config.controllers.forEach((entry) => {
      entry.prioritizePlayer1 = Boolean(playerOne && entry.key === playerOne.key);
    });
  }

  handleGlobalChange() {
    this.config.global.deadzone = Number(this.globalDeadzone?.value ?? DEFAULT_CONTROLLER_SETUP.global.deadzone);
    this.config.global.vibrationStrength = Number(this.globalVibration?.value ?? DEFAULT_CONTROLLER_SETUP.global.vibrationStrength);
    this.config.global.mappingProfile = this.globalMapping?.value || 'standard';
    this.renderGlobalSettings();
    this.persistConfig();
  }

  renderGlobalSettings() {
    if (this.globalDeadzone) this.globalDeadzone.value = String(this.config.global.deadzone);
    if (this.globalDeadzoneValue) this.globalDeadzoneValue.textContent = `${Math.round(this.config.global.deadzone * 100)}%`;
    if (this.globalVibration) this.globalVibration.value = String(this.config.global.vibrationStrength);
    if (this.globalVibrationValue) this.globalVibrationValue.textContent = `${Math.round(this.config.global.vibrationStrength * 100)}%`;
    if (this.globalMapping) this.globalMapping.value = this.config.global.mappingProfile || 'standard';
  }

  persistConfig({ syncMain = true, silent = false } = {}) {
    this.config = this.normalizeConfig(this.config);
    saveControllerSetupConfig(this.config);
    this.gamepadManager?.applySetupConfig(this.config, { silent });
    if (syncMain && window.api?.saveControllerSetup) {
      window.api.saveControllerSetup(this.config).catch((err) => {
        console.warn('[ControllerSetupUI] IPC-Sync fehlgeschlagen:', err);
      });
    }
    if (!silent) this.renderGlobalSettings();
  }

  render() {
    this.renderSlots();
    this.renderControllerList();
    this.renderGlobalSettings();
    this.updateStatus();
    this.applyModalFocus();
  }

  renderSlots() {
    if (!this.slotEl) return;
    const connectedByKey = this.getConnectedByKey();
    this.slotEl.innerHTML = '';

    for (let slot = 1; slot <= CONTROLLER_SLOT_COUNT; slot += 1) {
      const entry = this.config.controllers.find((controller) => Number(controller.playerSlot) === slot);
      const connected = entry ? connectedByKey.has(entry.key) : false;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.slot = String(slot);
      button.setAttribute('data-controller-focus', '');

      if (entry) {
        const iconType = getControllerIconType(entry.type || 'generic');
        const triangles = connected ? slot : 0;
        button.className = `controller-figma-card controller-figma-card--p${slot}${connected ? ' is-connected' : ''}${this.selectedKey === entry.key ? ' is-selected' : ''}`;
        button.title = `${entry.label} — ${connected ? 'connected' : 'paired'}`;
        button.setAttribute('aria-label', `Player ${slot}: ${entry.label}`);
        button.innerHTML = `
          <span class="controller-figma-pnum">P${slot}</span>
          ${this.selectedKey === entry.key ? '<span class="controller-figma-cog" aria-hidden="true">⚙</span>' : ''}
          <span class="controller-figma-art controller-figma-art--${iconType}">${this.getControllerArtSvg(iconType, `p${slot}`)}</span>
          <span class="controller-figma-triangles">${this.getTriangleRowSvg(triangles)}</span>
          <span class="controller-figma-state">${connected ? 'CONNECTED' : 'PAIRED'}</span>
        `;
        button.addEventListener('click', () => {
          this.selectedKey = entry.key;
          this.render();
        });
      } else {
        button.className = `controller-figma-card controller-figma-card--empty`;
        button.setAttribute('aria-label', `Player ${slot}: frei`);
        button.innerHTML = `
          <span class="controller-figma-pnum controller-figma-pnum--empty">P${slot}</span>
          <span class="controller-figma-triangles">${this.getTriangleRowSvg(0, true)}</span>
          <span class="controller-figma-state">FREE</span>
        `;
        button.addEventListener('click', () => {
          if (this.selectedKey) this.assignSlot(this.selectedKey, slot);
          this.setView('connect');
        });
      }

      this.slotEl.appendChild(button);
    }
  }

  renderControllerList() {
    if (!this.listEl) return;
    const connectedByKey = this.getConnectedByKey();
    this.emptyEl?.classList.toggle('hidden', this.config.controllers.length > 0);
    this.listEl.innerHTML = '';
    this.sortControllers();
    this.config.controllers.forEach((entry, index) => {
      this.listEl.appendChild(this.createControllerCard(entry, connectedByKey.get(entry.key), index));
    });
  }

  getConnectedByKey() {
    const map = new Map(getAllRealGamepads().map((gamepad) => [getGamepadKey(gamepad), gamepad]));
    for (const key of this._nativeKeys) {
      if (!map.has(key)) map.set(key, { _isNative: true });
    }
    return map;
  }

  getNativeControllerType(payload) {
    const src = (payload.source || '').toLowerCase();
    const family = (payload.controllerFamily || '').toLowerCase();
    const vendor = (payload.vendorId || '').toLowerCase();
    const ctype = (payload.controllerType || '').toLowerCase();
    const model = (payload.controllerModel || payload.name || '').toLowerCase();
    if (src === 'joycon2' || family === 'nintendo' || vendor === '057e' || ctype === 'nintendo') return 'nintendo';
    if (family === 'playstation' || vendor === '054c' || ctype === 'ps4' || ctype === 'ps5') return 'dualsense';
    if (/xbox|microsoft/i.test(model) || vendor === '045e') return 'xbox';
    return 'generic';
  }

  registerNativeController(payload) {
    if (!payload?.id) return;
    const key = `native:${payload.id}`;
    const type = this.getNativeControllerType(payload);
    const label = payload.controllerModel || payload.name || payload.controllerType || 'Controller';
    const existing = this.config.controllers.find((e) => e.key === key);
    if (existing) {
      existing.type = type;
      existing.label = label;
      existing.lastSeenAt = Date.now();
    } else {
      if (this.config.controllers.length >= CONTROLLER_SLOT_COUNT) return;
      const slot = this.getNextAvailableSlot();
      this.config.controllers.push({
        key,
        playerSlot: slot,
        prioritizePlayer1: this.config.controllers.length === 0,
        deadzone: null,
        vibrationStrength: null,
        mappingProfile: null,
        label,
        type,
        vendorId: payload.vendorId || '',
        productId: payload.productId || '',
        connectionType: 'Wireless',
        lastSeenAt: Date.now(),
        isNative: true,
      });
    }
    this._nativeKeys.add(key);
    this.sortControllers();
    this.ensureSinglePlayerOne();
    if (this.isOpen) this.render();
  }

  syncNativeControllersFromApi() {
    const api = window.electronAPI || window.api;
    if (!api?.getConnectedControllers) return;
    api.getConnectedControllers().then((controllers) => {
      if (!Array.isArray(controllers)) return;
      controllers.forEach((ctrl) => this.registerNativeController(ctrl));
      if (controllers.length > 0) this.render();
    }).catch(() => {});
  }

  unregisterNativeController(id) {
    const key = `native:${id}`;
    this.config.controllers = this.config.controllers.filter((e) => e.key !== key);
    this._nativeKeys.delete(key);
    if (this.selectedKey === key) this.selectedKey = this.config.controllers[0]?.key || null;
    this.ensureSinglePlayerOne();
    if (this.isOpen) this.render();
  }

  createControllerCard(entry, gamepad, index) {
    const card = document.createElement('article');
    const iconType = getControllerIconType(entry.type || parseControllerInfo(gamepad || { id: entry.label }).type);
    const battery = gamepad ? formatBatteryStatus(gamepad) : '--';
    const connection = gamepad ? this.getConnectionType(gamepad) : entry.connectionType || 'Unknown';
    const mappingProfile = entry.mappingProfile || this.config.global.mappingProfile || 'standard';
    const deadzone = entry.deadzone ?? this.config.global.deadzone;
    const vibration = entry.vibrationStrength ?? this.config.global.vibrationStrength;

    card.className = `controller-card${entry.prioritizePlayer1 ? ' is-prioritized' : ''}${this.selectedKey === entry.key ? ' is-selected' : ''}${gamepad ? ' is-connected' : ' is-disconnected'}`;
    card.dataset.key = entry.key;
    card.draggable = true;
    card.setAttribute('role', 'listitem');
    card.innerHTML = `
      <button type="button" class="controller-card-main" data-controller-focus data-key="${this.escapeHtml(entry.key)}" aria-label="${this.escapeHtml(entry.label)} auswählen">
        <span class="controller-card-icon controller-card-icon--${iconType}" aria-hidden="true">${this.getControllerIconSvg(iconType)}</span>
        <span class="controller-card-info">
          <span class="controller-card-title">${this.escapeHtml(entry.label || 'Controller')}</span>
          <span class="controller-card-meta">
            <span class="controller-slot-badge">Player ${entry.playerSlot}</span>
            <span>${gamepad ? 'Online' : 'Offline'}</span>
            <span>${connection}</span>
            <span>Batterie ${battery}</span>
          </span>
        </span>
      </button>
      <div class="controller-card-actions">
        <button type="button" class="controller-move-btn" data-controller-focus data-action="up" aria-label="Controller nach oben" ${index === 0 ? 'disabled' : ''}>&uarr;</button>
        <button type="button" class="controller-move-btn" data-controller-focus data-action="down" aria-label="Controller nach unten" ${index === this.config.controllers.length - 1 ? 'disabled' : ''}>&darr;</button>
        <button type="button" class="controller-remove-btn" data-controller-focus data-action="remove" aria-label="Controller entfernen">Entfernen</button>
      </div>
      <div class="controller-card-settings">
        <label class="controller-setting">
          <span>Deadzone</span>
          <input type="range" min="0.05" max="0.8" step="0.05" value="${deadzone}" data-field="deadzone" data-controller-focus>
          <strong data-value-for="deadzone">${Math.round(deadzone * 100)}%</strong>
        </label>
        <label class="controller-setting">
          <span>Vibration</span>
          <input type="range" min="0" max="1" step="0.05" value="${vibration}" data-field="vibrationStrength" data-controller-focus>
          <strong data-value-for="vibrationStrength">${Math.round(vibration * 100)}%</strong>
        </label>
        <label class="controller-setting controller-setting--select">
          <span>Mapping Profile</span>
          <select data-field="mappingProfile" data-controller-focus>
            <option value="standard" ${mappingProfile === 'standard' ? 'selected' : ''}>Standard</option>
            <option value="alternative" ${mappingProfile === 'alternative' ? 'selected' : ''}>Alternative</option>
          </select>
        </label>
        <label class="controller-setting controller-setting--checkbox">
          <input type="checkbox" data-field="prioritizePlayer1" data-controller-focus ${entry.prioritizePlayer1 ? 'checked' : ''}>
          <span>Als Player 1 priorisieren</span>
        </label>
      </div>
    `;

    card.querySelector('.controller-card-main')?.addEventListener('click', () => {
      this.selectedKey = entry.key;
      this.render();
    });
    card.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedKey = entry.key;
        if (button.dataset.action === 'remove') this.removeController(entry.key);
        else this.moveController(entry.key, button.dataset.action);
      });
    });
    card.querySelectorAll('[data-field]').forEach((input) => this.bindSettingInput(card, input, entry.key));
    this.bindDragAndDrop(card, entry);
    return card;
  }

  bindSettingInput(card, input, key) {
    const field = input.dataset.field;
    const eventName = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(eventName, () => {
      let value = input.value;
      if (input.type === 'checkbox') value = input.checked;
      if (field === 'deadzone' || field === 'vibrationStrength') {
        value = Number(value);
        const valueEl = card.querySelector(`[data-value-for="${field}"]`);
        if (valueEl) valueEl.textContent = `${Math.round(value * 100)}%`;
      }
      this.updateControllerSetting(key, field, value);
    });
  }

  bindDragAndDrop(card, entry) {
    card.addEventListener('dragstart', (event) => {
      this.dragSourceKey = entry.key;
      this.selectedKey = entry.key;
      card.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', entry.key);
    });
    card.addEventListener('dragend', () => {
      this.dragSourceKey = null;
      card.classList.remove('is-dragging');
      this.listEl?.querySelectorAll('.controller-card').forEach((item) => item.classList.remove('is-drop-target'));
    });
    card.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (this.dragSourceKey && this.dragSourceKey !== entry.key) card.classList.add('is-drop-target');
    });
    card.addEventListener('dragleave', () => card.classList.remove('is-drop-target'));
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      card.classList.remove('is-drop-target');
      const sourceKey = event.dataTransfer.getData('text/plain') || this.dragSourceKey;
      const source = this.config.controllers.find((item) => item.key === sourceKey);
      const target = this.config.controllers.find((item) => item.key === entry.key);
      if (!source || !target || source.key === target.key) return;
      const sourceSlot = source.playerSlot;
      source.playerSlot = target.playerSlot;
      target.playerSlot = sourceSlot;
      this.selectedKey = source.key;
      this.sortControllers();
      this.ensureSinglePlayerOne();
      this.persistConfig();
      this.render();
    });
  }

  setStatus(message) {
    this.statusEls.forEach((el) => {
      el.textContent = message;
    });
  }

  updateStatus() {
    if (this.isWaitingForNewController) return;
    const connectedCount = getAllRealGamepads().length;
    this.setStatus(connectedCount > 0
      ? `${connectedCount} Controller verbunden. Two players are also supported.`
      : 'Noch kein Controller aktiv. Schalte einen Controller ein und druecke L + R.');
  }

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  getDualSenseSvg(uid) {
    const id = `ds-${uid}`;
    return `
      <svg class="controller-dualsense" viewBox="0 0 240 168" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="168">
            <rect width="240" height="168" fill="#000"/>
            <path d="M40 40 C72 22 168 22 200 40 C226 54 238 84 232 110 C227 134 210 152 187 150 C172 149 164 138 153 127 C144 118 135 114 120 114 C105 114 96 118 87 127 C76 138 68 149 53 150 C30 152 13 134 8 110 C2 84 14 54 40 40 Z" fill="#fff"/>
            <g fill="#000">
              <rect x="98" y="40" width="44" height="30" rx="7"/>
              <rect x="68" y="70" width="12" height="36" rx="4"/>
              <rect x="56" y="82" width="36" height="12" rx="4"/>
              <circle cx="167" cy="70" r="7.5"/>
              <circle cx="183" cy="86" r="7.5"/>
              <circle cx="167" cy="102" r="7.5"/>
              <circle cx="151" cy="86" r="7.5"/>
              <circle cx="97" cy="118" r="14"/>
              <circle cx="143" cy="118" r="14"/>
              <circle cx="120" cy="96" r="4"/>
            </g>
          </mask>
        </defs>
        <rect width="240" height="168" fill="currentColor" mask="url(#${id})"/>
      </svg>
    `;
  }

  getControllerArtSvg(type, uid) {
    if (type === 'switch') {
      return `<img src="${ICON_SWITCH}" alt="" draggable="false">`;
    }
    if (type === 'playstation') {
      return `<img src="${ICON_PS}" alt="" draggable="false">`;
    }
    if (type === 'xbox') {
      return `
        <svg class="controller-xbox" viewBox="0 0 140 95" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M20 18 C34 9 48 8 70 18 C92 8 106 9 120 18 C134 26 138 41 132 72 C123 81 109 82 95 72 C84 65 56 65 45 72 C31 82 17 81 8 72 C2 41 6 26 20 18Z" fill="none" stroke="currentColor" stroke-width="4"/>
          <circle cx="45" cy="42" r="10" fill="none" stroke="currentColor" stroke-width="3"/>
          <circle cx="95" cy="52" r="10" fill="none" stroke="currentColor" stroke-width="3"/>
        </svg>
      `;
    }
    return `<img src="${ICON_PS}" alt="" draggable="false">`;
  }

  getTriangleRowSvg(activeCount = 0, dimmed = false) {
    const items = [0, 1, 2, 3].map((index) => {
      const active = index < activeCount;
      const fill = active ? '#39df84' : 'none';
      const stroke = active ? '#39df84' : (dimmed ? '#2f2f2f' : '#3b3b3b');
      return `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M5 1 L9 9 L1 9 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    });
    return items.join('');
  }

  getControllerIconSvg(type) {
    if (type === 'xbox') {
      return '<svg viewBox="0 0 76 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 22c2-10 8-14 17-11 5 2 17 2 22 0 9-3 15 1 17 11l2 11c1 6-5 10-10 6l-8-6H26l-8 6c-5 4-11 0-10-6l2-11z"/><path d="M24 23h10M29 18v10"/><circle cx="51" cy="19" r="2.8"/><circle cx="58" cy="25" r="2.8"/><circle cx="51" cy="31" r="2.8"/><circle cx="44" cy="25" r="2.8"/></svg>';
    }
    if (type === 'playstation') {
      return '<svg viewBox="0 0 76 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 24c2-10 8-14 17-11 5 2 19 2 24 0 9-3 15 1 17 11l2 10c1 6-5 10-10 6l-9-7H26l-9 7c-5 4-11 0-10-6l2-10z"/><path d="M24 22v10M19 27h10"/><path d="M50 18l4 4-4 4-4-4z"/><circle cx="59" cy="30" r="3"/><circle cx="41" cy="30" r="3"/></svg>';
    }
    if (type === 'switch') {
      return '<svg viewBox="0 0 76 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="13" y="7" width="19" height="34" rx="8"/><rect x="44" y="7" width="19" height="34" rx="8"/><rect x="32" y="11" width="12" height="26" rx="3"/><circle cx="23" cy="18" r="3"/><circle cx="23" cy="30" r="3"/><circle cx="53" cy="24" r="4"/></svg>';
    }
    return '<svg viewBox="0 0 76 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 24c2-10 8-14 17-11 5 2 17 2 22 0 9-3 15 1 17 11l2 10c1 6-5 10-10 6l-8-6H26l-8 6c-5 4-11 0-10-6l2-10z"/><circle cx="26" cy="25" r="5"/><circle cx="50" cy="25" r="5"/></svg>';
  }
}

window.ControllerSetupUI = ControllerSetupUI;
