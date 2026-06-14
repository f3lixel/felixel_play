// Controller Setup Modal – kümmert sich ausschließlich um den Verbindungsstatus
// von Controllern (kein Tasten-Mapping). Nutzt die native HTML5 Gamepad-API und
// aktualisiert die Anzeige in Echtzeit bei gamepadconnected/gamepaddisconnected.

(() => {
  const MODAL_ID = 'controller-setup-modal';
  const SLOT_COUNT = 4;
  const CLOSE_ANIMATION_MS = 220;
  const POLL_INTERVAL_MS = 600;

  // Spielerfarben (P1–P4) wie im Referenzdesign.
  const PLAYER_COLORS = ['#4ec6e8', '#f15b6c', '#f3c969', '#5bd58a'];
  const ART_PLAYSTATION = 'assets/icons/playsi.svg';
  const ART_SWITCH = 'assets/icons/switchi.svg';

  let modal = null;
  let slotsRoot = null;
  let isOpen = false;
  let pollTimer = null;
  let closeTimer = null;
  let lastFocusedElement = null;
  const slotRefs = [];

  // --- Hilfsfunktionen -------------------------------------------------------

  function getRealGamepads() {
    if (window.GamepadUtils?.getAllRealGamepads) {
      return window.GamepadUtils.getAllRealGamepads();
    }
    if (!navigator.getGamepads) return [];
    return Array.from(navigator.getGamepads()).filter(Boolean);
  }

  function artForGamepad(gamepad) {
    const info = window.GamepadUtils?.parseControllerInfo?.(gamepad);
    const iconType = window.GamepadUtils?.getControllerIconType?.(info?.type);
    return iconType === 'switch' ? ART_SWITCH : ART_PLAYSTATION;
  }

  // Anzahl grüner Dreiecke = Spieler-Slot-Nummer (P1 → 1, P2 → 2, …).
  function playerSlotLevelCount(playerNumber) {
    return Math.max(0, Math.min(4, playerNumber));
  }

  function triangleSvg(filled) {
    return filled
      ? '<svg viewBox="0 0 14 12" class="controller-slot__tri--on" aria-hidden="true"><path d="M7 1 L13 11 L1 11 Z" fill="#3ddc84"/></svg>'
      : '<svg viewBox="0 0 14 12" aria-hidden="true"><path d="M7 1.6 L12.6 11 L1.4 11 Z" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  }

  function renderLevel(el, count) {
    let html = '';
    for (let i = 0; i < 4; i += 1) html += triangleSvg(i < count);
    el.innerHTML = html;
  }

  // --- DOM-Aufbau ------------------------------------------------------------

  const GEAR_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.49.49 0 0 0-.48-.41h-3.84a.49.49 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.13.22.39.31.59.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.04.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.2.09.46 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>';

  function buildSlots() {
    if (!slotsRoot) return;
    slotsRoot.innerHTML = '';
    slotRefs.length = 0;

    for (let i = 0; i < SLOT_COUNT; i += 1) {
      const player = i + 1;

      const li = document.createElement('li');
      li.className = 'controller-slot is-empty';
      li.dataset.player = String(player);
      li.style.setProperty('--player-color', PLAYER_COLORS[i] || '#ffffff');

      const top = document.createElement('div');
      top.className = 'controller-slot__top';

      const num = document.createElement('span');
      num.className = 'controller-slot__num';
      num.textContent = `P${player}`;

      const gear = document.createElement('button');
      gear.type = 'button';
      gear.className = 'controller-slot__gear';
      gear.setAttribute('aria-label', `Einstellungen für Spieler ${player}`);
      gear.innerHTML = GEAR_SVG;
      gear.addEventListener('click', (event) => {
        event.stopPropagation();
        window.showToast?.('Tasten-Mapping folgt bald.');
      });

      top.append(num, gear);

      const art = document.createElement('div');
      art.className = 'controller-slot__art';
      const img = document.createElement('img');
      img.alt = '';
      img.src = ART_PLAYSTATION;
      art.appendChild(img);

      const bottom = document.createElement('div');
      bottom.className = 'controller-slot__bottom';

      const level = document.createElement('div');
      level.className = 'controller-slot__level';

      const state = document.createElement('span');
      state.className = 'controller-slot__state';
      state.textContent = 'CONNECTED';

      bottom.append(level, state);

      li.append(top, art, bottom);
      slotsRoot.appendChild(li);

      slotRefs.push({ li, img, level });
    }
  }

  // --- Rendering -------------------------------------------------------------

  function render() {
    if (slotRefs.length === 0) return;

    const gamepads = getRealGamepads().slice().sort((a, b) => a.index - b.index);

    slotRefs.forEach((slot, i) => {
      const playerNumber = i + 1;
      const gamepad = gamepads[i];
      if (gamepad) {
        slot.li.classList.remove('is-empty');
        slot.li.classList.add('is-connected');
        slot.img.src = artForGamepad(gamepad);
        renderLevel(slot.level, playerSlotLevelCount(playerNumber));
      } else {
        slot.li.classList.remove('is-connected');
        slot.li.classList.add('is-empty');
        renderLevel(slot.level, 0);
      }
    });
  }

  // --- Ansichten (Dashboard / Gerät verbinden) -------------------------------

  function setView(view) {
    if (!modal) return;
    modal.dataset.view = view;
    modal.querySelectorAll('[data-controller-view]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.controllerView === view);
    });
  }

  // --- Öffnen / Schließen ----------------------------------------------------

  function openControllerSetup() {
    if (!modal || isOpen) return;
    isOpen = true;

    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }

    lastFocusedElement = document.activeElement;

    modal.classList.remove('hidden', 'is-closing');
    modal.setAttribute('aria-hidden', 'false');

    setView('dashboard');
    render();
    startPolling();

    modal.querySelector('.controller-modal__close-btn')?.focus({ preventScroll: true });
    window.FelixelFocusManager?.onModalOpen();
  }

  function closeControllerSetup() {
    if (!modal || !isOpen) return;
    isOpen = false;

    stopPolling();
    modal.classList.add('is-closing');
    modal.setAttribute('aria-hidden', 'true');

    closeTimer = setTimeout(() => {
      modal.classList.add('hidden');
      modal.classList.remove('is-closing');
      closeTimer = null;
    }, CLOSE_ANIMATION_MS);

    if (lastFocusedElement instanceof HTMLElement) {
      lastFocusedElement.focus({ preventScroll: true });
    }
    lastFocusedElement = null;
    window.FelixelFocusManager?.onModalClose();
  }

  // --- Echtzeit-Aktualisierung ----------------------------------------------

  function startPolling() {
    stopPolling();
    // Backup zur Eventsteuerung: einige Plattformen melden Controller erst nach
    // dem ersten Tastendruck zuverlässig über navigator.getGamepads().
    pollTimer = setInterval(render, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function handleConnect(event) {
    const gamepad = event?.gamepad || getRealGamepads().slice(-1)[0];
    const strength = window.GamepadUtils?.loadControllerSetupConfig?.().global?.vibrationStrength ?? 1;
    window.GamepadUtils?.playConnectVibration?.(gamepad, strength);
    render();
    // Beim Verbinden im "Gerät verbinden"-View automatisch zurück zum Dashboard,
    // damit der neue Controller sofort sichtbar wird.
    if (isOpen && modal?.dataset.view === 'connect') {
      setView('dashboard');
    }
  }

  function handleDisconnect() {
    render();
  }

  // --- Event-Verkabelung -----------------------------------------------------

  function attachTriggers() {
    document.getElementById('btnControllerSetup')?.addEventListener('click', openControllerSetup);

    const statusTrigger = document.getElementById('ctrlStatusTrigger');
    statusTrigger?.addEventListener('click', openControllerSetup);
    statusTrigger?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openControllerSetup();
      }
    });

    modal.querySelectorAll('[data-controller-close]').forEach((el) => {
      el.addEventListener('click', closeControllerSetup);
    });

    modal.querySelectorAll('[data-controller-view]').forEach((btn) => {
      btn.addEventListener('click', () => setView(btn.dataset.controllerView));
    });

    document.addEventListener('keydown', (event) => {
      if (!isOpen) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        closeControllerSetup();
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        window.FelixelFocusManager?.navigate('up');
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        window.FelixelFocusManager?.navigate('down');
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        window.FelixelFocusManager?.navigate('left');
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        window.FelixelFocusManager?.navigate('right');
      } else if (event.key === 'Enter') {
        event.preventDefault();
        window.FelixelFocusManager?.confirm();
      }
    });
  }

  function init() {
    modal = document.getElementById(MODAL_ID);
    if (!modal) {
      console.warn('[ControllerSetup] Modal-Element nicht gefunden.');
      return;
    }

    slotsRoot = document.getElementById('controllerSlots');
    buildSlots();
    attachTriggers();

    // Native Gamepad-API: Echtzeit-Updates ohne Neu-Öffnen des Popups.
    window.addEventListener('gamepadconnected', handleConnect);
    window.addEventListener('gamepaddisconnected', handleDisconnect);

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Global verfügbar machen (siehe Anforderung).
  window.openControllerSetup = openControllerSetup;
  window.closeControllerSetup = closeControllerSetup;
  // Zustands-Abfrage, damit die Eingabe-Verarbeitung im Renderer die
  // Hintergrund-Steuerung sperren kann, solange das Popup offen ist.
  window.isControllerSetupOpen = () => isOpen;
})();
