const { webFrame } = typeof require === 'function' ? require('electron') : { webFrame: null };

const TV_TEST_ZOOM_FACTOR = 1.3;

function setUiZoomFactor(zoomFactor = 1) {
  if (webFrame) {
    webFrame.setZoomFactor(zoomFactor);
    return true;
  }

  if (window.api?.setZoomFactor) {
    window.api.setZoomFactor(zoomFactor);
    return true;
  }

  console.warn('[Zoom] Electron webFrame ist in diesem Renderer nicht verfügbar.');
  return false;
}

window.setFelixelTvZoom = (enabled = true) => {
  setUiZoomFactor(enabled ? TV_TEST_ZOOM_FACTOR : 1);
};

// ===== STATE =====

let allGames = [];
let currentFocusedGame = null;
let bgToggle = false;
let launchTimeline = null;
let focusedGames = [];
let currentIndex = -1;
let gamepadManager = null;
let gamepadHintTimer = null;
let controllerSetupUI = null;
let focusSelectionTimer = null;
let nativeControllerUnsubscribe = null;
let nativeControllerAvailable = false;
const nativeControllers = new Map();
const nativeAxisDirections = new Map();

const FOCUS_SELECTION_DELAY_MS = 120;
const RECENT_GAMES_KEY = 'felixel:recent-games';

let currentCategory = 'recent';

// ===== INIT =====

document.addEventListener('DOMContentLoaded', async () => {
  setupLauncherEvents();
  setupKeyboardNavigation();
  setupControllerOverlay();
  setupGamepadInput();
  setupInGameOverlay();
  setupTopBarControls();
  setupCategoryTabs();
  startClock();
  startDate();
  updateWifi();
  window.addEventListener('online', updateWifi);
  window.addEventListener('offline', updateWifi);

  // Spiele laden & Shelf rendern parallel zum Intro
  window.api.readGames()
    .then(games => { allGames = games; })
    .catch(() => { allGames = []; })
    .then(() => renderShelf());

  // Video-Intro läuft; wenn es endet, wird der Loading-Screen direkt ausgeblendet.
  // Als Fallback (kein Video / Fehler) greift die Boot-Audio-Sequenz.
  setupVideoIntro();

  // Hover-Sound vorladen (nach erstem Nutzer-Kontext)
  loadHoverSound();

  // Boot-Audio + Loading-Screen (greift sobald Audio endet ODER Video bereits fertig ist)
  try {
    await bootAudioSequence();
  } catch (err) {
    console.warn('Boot audio sequence failed:', err);
  } finally {
    document.getElementById('loadingScreen').classList.add('hidden');
  }
});

// ===== VIDEO INTRO =====

function setupVideoIntro() {
  const overlay = document.getElementById('videoIntro');
  const video   = document.getElementById('introVideo');
  if (!overlay || !video) return;

  // Sicher stumm schalten (video hat bereits muted-Attribut, doppelt hält besser)
  video.volume = 0;
  video.muted  = true;

  const dismiss = () => {
    // Loading-Screen sofort ausblenden – kein Warten auf 15s Boot-Audio mehr
    document.getElementById('loadingScreen')?.classList.add('hidden');

    // Video-Overlay sanft ausblenden
    if (window.gsap) {
      gsap.to(overlay, {
        opacity: 0,
        duration: 0.7,
        ease: 'power2.inOut',
        onComplete: () => overlay.classList.add('hidden'),
      });
    } else {
      overlay.style.transition = 'opacity 0.7s ease';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.classList.add('hidden'), 720);
    }
  };

  video.addEventListener('ended',  dismiss);
  video.addEventListener('error',  () => setTimeout(dismiss, 300));

  // Autoplay starten (in Electron normalerweise immer erlaubt)
  video.play().catch(() => setTimeout(dismiss, 500));
}

// ===== BACKGROUND / FOCUSED GAME =====

// ===== BACKGROUND TRANSITION CONSTANTS =====
const BG_DURATION      = 0.62;   // Gesamtdauer der Einblende-Animation
const BG_FADE_OUT_MUL  = 0.65;   // Fade-Out der alten Schicht: 65% der Gesamtdauer
const BG_SCALE_START   = 1.08;   // Parallax: neue Schicht startet vergrößert
const BG_SCALE_END     = 1.0;    // Parallax: neue Schicht endet bei natürlicher Größe
const BG_BLUR_OUT      = 8;      // Blur in px auf der alten Schicht beim Fade-Out

function setFocusedGame(game, immediate = false) {
  cancelFocusSelection();

  if (currentFocusedGame?.id === game.id) return;
  currentFocusedGame = game;

  // bgActive  = neue Schicht  → Fade-In  + Parallax scale(1.08 → 1.0)
  // bgPrevious = alte Schicht → Fade-Out + blur(0 → BG_BLUR_OUT px)
  const bgActive   = document.getElementById(bgToggle ? 'bgLayer2' : 'bgLayer1');
  const bgPrevious = document.getElementById(bgToggle ? 'bgLayer1' : 'bgLayer2');
  bgToggle = !bgToggle;

  const coverUrl = game.heroArt || game.coverArt || '';

  // ── Immediate / Fallback ─────────────────────────────────────────────────
  if (immediate || !window.gsap) {
    bgActive.style.backgroundImage = coverUrl ? `url('${coverUrl}')` : '';
    if (window.gsap) {
      gsap.set(bgActive,   { opacity: 1, scale: BG_SCALE_END, filter: 'blur(0px)' });
      gsap.set(bgPrevious, { opacity: 0, scale: BG_SCALE_END, filter: 'blur(0px)' });
    } else {
      bgActive.style.opacity   = '1';
      bgPrevious.style.opacity = '0';
    }
    return;
  }

  // ── Laufende Tweens abbrechen & alte Schicht bereinigen ──────────────────
  gsap.killTweensOf([bgActive, bgPrevious]);
  // Filter der alten Schicht zurücksetzen, falls sie mid-blur abgebrochen wurde
  gsap.set(bgPrevious, { filter: 'blur(0px)', scale: BG_SCALE_END });

  // ── Neue Schicht vorbereiten: neues Bild, unsichtbar, skaliert ───────────
  bgActive.style.backgroundImage = coverUrl ? `url('${coverUrl}')` : '';
  gsap.set(bgActive, { opacity: 0, scale: BG_SCALE_START, filter: 'blur(0px)' });

  // ── Neue Schicht: Fade-In + Parallax-Zoom (spec Punkt 2 + 3) ────────────
  gsap.to(bgActive, {
    opacity: 1,
    scale: BG_SCALE_END,
    duration: BG_DURATION,
    ease: 'power2.out',
    force3D: true,
  });

  // ── Alte Schicht: Fade-Out + Blur (spec Punkt 2) ─────────────────────────
  gsap.to(bgPrevious, {
    opacity: 0,
    filter: `blur(${BG_BLUR_OUT}px)`,
    duration: BG_DURATION * BG_FADE_OUT_MUL,
    ease: 'power2.in',
    force3D: true,
    onComplete() {
      // ── State-Reset (spec Punkt 4): alte Schicht erhält das aktuelle Bild ──
      // Stiller Tausch – keine Sichtbarkeit, da opacity = 0
      bgPrevious.style.backgroundImage = coverUrl ? `url('${coverUrl}')` : '';
      gsap.set(bgPrevious, {
        opacity: 0,
        scale: BG_SCALE_END,
        filter: 'blur(0px)',
      });
    },
  });
}

function scheduleFocusedGame(game) {
  cancelFocusSelection();
  focusSelectionTimer = setTimeout(() => {
    focusSelectionTimer = null;
    setFocusedGame(game);
  }, FOCUS_SELECTION_DELAY_MS);
}

function cancelFocusSelection() {
  if (focusSelectionTimer) {
    clearTimeout(focusSelectionTimer);
    focusSelectionTimer = null;
  }
}

// ===== RENDER SHELF =====

function renderShelf(animate = false) {
  const shelf = document.getElementById('gameShelf');
  if (!shelf) return;

  const doRender = () => {
    shelf.innerHTML = '';

    const sorted = getSortedGames();
    focusedGames = sorted;

    if (sorted.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'shelf-empty';
      const emptyMessages = {
        recent: 'Noch keine Spiele gespielt. Starte ein Spiel, um es hier zu sehen.',
        switch: 'Keine Nintendo Switch Spiele gefunden. Lege ROMs in roms/switch ab.',
        wii: 'Keine Wii / Wii U Spiele gefunden. Lege ROMs in roms/wii oder roms/wiiu ab.',
      };
      empty.textContent = emptyMessages[currentCategory] ?? 'Keine Spiele gefunden.';
      shelf.appendChild(empty);
      currentIndex = -1;

      if (animate && window.gsap) {
        gsap.fromTo(empty, { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power3.out' });
      }
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const [index, game] of sorted.entries()) {
      fragment.appendChild(createShelfCard(game, index));
    }
    shelf.appendChild(fragment);

    currentIndex = currentIndex < 0 ? 0 : Math.min(currentIndex, sorted.length - 1);
    setFocusedGameByIndex(currentIndex, { scroll: true, playSound: false, immediateHero: true });

    if (animate && window.gsap) {
      const cards = Array.from(shelf.querySelectorAll('.shelf-card'));
      gsap.fromTo(
        cards,
        { autoAlpha: 0, y: 36, scale: 0.84 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          stagger: { each: 0.04, from: 'start' },
          duration: 0.42,
          ease: 'power3.out',
          clearProps: 'transform,opacity,visibility',
        },
      );
    }
  };

  const existing = Array.from(shelf.children);
  if (animate && existing.length > 0 && window.gsap) {
    gsap.timeline({ onComplete: doRender }).to(existing, {
      autoAlpha: 0,
      y: -22,
      scale: 0.9,
      stagger: { each: 0.012, from: 'start' },
      duration: 0.18,
      ease: 'power2.in',
    });
  } else {
    doRender();
  }
}

function getSortedGames() {
  const recentIds = getRecentGameIds();

  let pool;
  switch (currentCategory) {
    case 'recent': {
      const played = recentIds.map(id => allGames.find(g => g.id === id)).filter(Boolean);
      pool = played.length > 0
        ? played
        : [...allGames].sort((a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }));
      return pool;
    }
    case 'switch':
      pool = allGames.filter(g => g.platform === 'Switch');
      break;
    case 'wii':
      pool = allGames.filter(g => g.platform === 'Wii' || g.platform === 'WiiU');
      break;
    default:
      pool = [...allGames];
  }

  return pool.sort((a, b) => {
    const ai = recentIds.indexOf(a.id);
    const bi = recentIds.indexOf(b.id);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.title.localeCompare(b.title, 'de', { sensitivity: 'base' });
  });
}

// ===== SHELF CARD =====

function createShelfCard(game, index) {
  const card = document.createElement('div');
  card.className = 'shelf-card game-card';
  card.dataset.gameId = game.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'option');
  card.setAttribute('aria-selected', 'false');
  card.setAttribute('aria-label', `${game.title} starten`);

  if (game.coverArt) {
    const img = new Image();
    img.className = 'shelf-card-img';
    img.alt = game.title;
    img.loading = index < 8 ? 'eager' : 'lazy';
    img.decoding = 'async';
    img.fetchPriority = index < 4 ? 'high' : 'auto';
    img.src = game.coverArt;
    img.onerror = () => {
      img.remove();
      card.appendChild(makePlaceholder(game.title));
    };
    card.appendChild(img);
  } else {
    card.appendChild(makePlaceholder(game.title));
  }

  card.addEventListener('click', () => {
    const idx = focusedGames.findIndex(g => g.id === game.id);
    if (idx === currentIndex) {
      launchGame(game);
    } else {
      setFocusedGameByIndex(idx);
    }
  });

  card.addEventListener('pointerenter', () => {
    const idx = focusedGames.findIndex(g => g.id === game.id);
    if (idx !== -1 && idx !== currentIndex) {
      setFocusedGameByIndex(idx, { scroll: false, playSound: true, updateHero: true });
    }
  });

  card.addEventListener('focus', () => {
    const idx = focusedGames.findIndex(g => g.id === game.id);
    if (idx !== -1 && idx !== currentIndex) {
      setFocusedGameByIndex(idx, { scroll: false, playSound: true, updateHero: true });
    }
  });

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      launchGame(game);
    }
  });

  return card;
}

function makePlaceholder(title) {
  const el = document.createElement('div');
  el.className = 'shelf-card-placeholder';
  el.textContent = title;
  return el;
}

// ===== FOCUS MANAGEMENT =====

function setFocusedGameByIndex(index, options = {}) {
  const { scroll = true, playSound = true, updateHero = true, immediateHero = false } = options;
  if (index < 0 || index >= focusedGames.length) return;

  const previous = document.querySelector('.shelf-card.is-focused');
  previous?.classList.remove('is-focused', 'active');
  previous?.setAttribute('aria-selected', 'false');

  currentIndex = index;
  const game = focusedGames[currentIndex];

  const card = document.querySelector(`.shelf-card[data-game-id="${game.id}"]`);
  if (!card) return;

  card.classList.add('is-focused', 'active');
  card.setAttribute('aria-selected', 'true');

  if (updateHero) {
    if (immediateHero) {
      setFocusedGame(game, true);
    } else {
      scheduleFocusedGame(game);
    }
  }

  if (scroll) {
    card.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
  }

  if (playSound) {
    playHoverSound();
  }
}

function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    if (controllerSetupUI?.isOpen) {
      const modalKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape'];
      if (modalKeys.includes(e.key)) return;
    }

    const target = e.target;
    const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    if (isTyping) return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveFocus('left');
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveFocus('right');
        break;
      case 'Enter':
        if (document.activeElement?.classList?.contains('game-card')) return;
        e.preventDefault();
        launchFocusedGame();
        break;
      default:
        break;
    }
  });
}

// ===== TOP BAR CONTROLS =====

function setupTopBarControls() {
  document.getElementById('btnPower')?.addEventListener('click', openSettings);
  document.getElementById('btnChat')?.addEventListener('click', () => showToast('Chat folgt bald.'));
  document.getElementById('btnActivities')?.addEventListener('click', () => showToast('Aktivitäten folgen bald.'));
  document.getElementById('btnCalendar')?.addEventListener('click', () => showToast('Kalender folgt bald.'));
  document.getElementById('btnTrophies')?.addEventListener('click', () => showToast('Trophäen folgen bald.'));
  document.getElementById('btnSwitch')?.addEventListener('click', () => showToast('Wechseln folgt bald.'));
  document.querySelectorAll('.ps5-social-btn').forEach(btn => {
    btn.addEventListener('click', () => showToast('Social-Funktion folgt bald.'));
  });
}

// ===== CATEGORY TABS =====

function setupCategoryTabs() {
  document.querySelectorAll('.ps5-category').forEach(btn => {
    btn.addEventListener('click', () => {
      const category = btn.dataset.category;

      if (category === 'playstation' || category === 'ds') {
        showToast('Diese Kategorie folgt bald.');
        return;
      }

      if (category === currentCategory) return;

      currentCategory = category;

      document.querySelectorAll('.ps5-category').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');

      currentIndex = -1;
      renderShelf(true);
    });
  });
}

// ===== CONTROLLER OVERLAY =====

function setupControllerOverlay() {
  const btnOpen = document.getElementById('btnController');
  const overlay = document.getElementById('controllerOverlay');
  const btnClose = document.getElementById('btnControllerClose');

  if (!window.ControllerSetupUI) {
    console.warn('[ControllerSetup] ControllerSetupUI ist nicht verfügbar.');
    btnOpen?.addEventListener('click', () => overlay?.classList.remove('hidden'));
    btnClose?.addEventListener('click', () => overlay?.classList.add('hidden'));
    return;
  }

  controllerSetupUI = new window.ControllerSetupUI({
    gamepadManager: null,
  });
  controllerSetupUI.init();

  window.api?.getControllerSetup?.().then((remoteConfig) => {
    if (!remoteConfig || !controllerSetupUI) return;
    controllerSetupUI.config = {
      ...controllerSetupUI.config,
      ...remoteConfig,
      global: {
        ...controllerSetupUI.config.global,
        ...(remoteConfig.global || {}),
      },
      controllers: Array.isArray(remoteConfig.controllers) ? remoteConfig.controllers : controllerSetupUI.config.controllers,
    };
    controllerSetupUI.renderGlobalSettings();
    controllerSetupUI.syncConnectedControllers({ silent: true });
    window.felixelGamepadManager?.applySetupConfig(controllerSetupUI.getConfig(), { silent: true });
  }).catch(() => {});

  window.felixelControllerSetupUI = controllerSetupUI;

  btnOpen?.addEventListener('click', () => {
    if (controllerSetupUI?.isOpen) return;
    controllerSetupUI?.handleOpen?.();
  });
}

// ===== CLOCK, DATE & WIFI =====

function startClock() {
  updateClock();
  setInterval(updateClock, 60000);
}

function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const el = document.getElementById('clockDisplay');
  if (el) el.textContent = `${h}:${m}`;
}

function startDate() {
  updateDate();
  const now = new Date();
  const msToMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
  setTimeout(() => {
    updateDate();
    setInterval(updateDate, 86400000);
  }, msToMidnight);
}

function updateDate() {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const y = now.getFullYear();
  const el = document.getElementById('dateDisplay');
  if (el) el.textContent = `${d}.${m}.${y}`;
}

function updateWifi() {
  const online = navigator.onLine;
  document.getElementById('wifiIcon')?.classList.toggle('hidden', !online);
  document.getElementById('wifiOffIcon')?.classList.toggle('hidden', online);
}

// ===== LAUNCH GAME =====

let isLaunchInProgress = false;
let isLauncherAudioMuted = false;

async function launchGame(game) {
  if (isLaunchInProgress) return;
  isLaunchInProgress = true;

  showLaunchOverlay(game);

  try {
    const controllerInfo = getActiveControllerInfo();
    const result = await window.api.launchGame(
      game.platform,
      game.romPath,
      game.emulator,
      game.launchPath,
      controllerInfo,
    );
    if (result.success) {
      muteLauncherAudio();
      hideLaunchOverlay();
      rememberPlayedGame(game);
      showToast(`${game.title} wird gestartet...`);
    } else {
      unmuteLauncherAudio();
      hideLaunchOverlay();
      showToast(`Fehler: ${result.error}`, true);
      isLaunchInProgress = false;
    }
  } catch (err) {
    unmuteLauncherAudio();
    hideLaunchOverlay();
    showToast(`Fehler: ${err.message}`, true);
    isLaunchInProgress = false;
  }
}

function getActiveControllerInfo() {
  const nativeController = getActiveNativeController();
  if (nativeController) {
    const config = controllerSetupUI?.getConfig?.() || window.GamepadUtils?.loadControllerSetupConfig?.() || null;
    return {
      id: nativeController.name || nativeController.id,
      mapping: 'sdl',
      vendorId: nativeController.vendorId || '',
      productId: nativeController.productId || '',
      type: toSetupControllerType(nativeController),
      playerSlot: nativeController.player || 1,
      mappingProfile: config?.global?.mappingProfile || 'standard',
      deadzone: config?.global?.deadzone ?? 0.35,
      vibrationStrength: config?.global?.vibrationStrength ?? 1,
    };
  }

  const { getAllRealGamepads, parseControllerInfo, resolvePlayerOneGamepad, loadControllerSetupConfig, getGamepadKey } = window.GamepadUtils || {};
  if (!getAllRealGamepads || !parseControllerInfo) return null;

  const gamepads = getAllRealGamepads();
  if (gamepads.length === 0) return null;

  const config = controllerSetupUI?.getConfig?.() || loadControllerSetupConfig?.() || null;
  const pick = resolvePlayerOneGamepad?.(config, gamepads) || gamepads[0];
  if (!pick) return null;

  const info = parseControllerInfo(pick);
  const entry = config?.controllers?.find((controller) => controller.key === getGamepadKey?.(pick));

  return {
    ...info,
    playerSlot: entry?.playerSlot || 1,
    mappingProfile: entry?.mappingProfile || config?.global?.mappingProfile || 'standard',
    deadzone: entry?.deadzone ?? config?.global?.deadzone ?? 0.35,
    vibrationStrength: entry?.vibrationStrength ?? config?.global?.vibrationStrength ?? 1,
  };
}

function getActiveNativeController() {
  if (!nativeControllerAvailable || nativeControllers.size === 0) return null;
  const controllers = Array.from(nativeControllers.values());
  const joycon2 = controllers.find((controller) => controller.source === 'joycon2');
  if (joycon2) return joycon2;
  return controllers.find((controller) => controller.player === 1) || controllers[0];
}

function toSetupControllerType(controller) {
  if (controller.controllerType === 'Nintendo') return 'switchpro';
  if (controller.controllerType === 'PS5') return 'dualsense';
  if (controller.controllerType === 'PS4') return 'dualshock4';
  return 'generic';
}

function rememberPlayedGame(game) {
  const recentIds = getRecentGameIds().filter(id => id !== game.id);
  recentIds.unshift(game.id);
  localStorage.setItem(RECENT_GAMES_KEY, JSON.stringify(recentIds.slice(0, 20)));
}

function getRecentGameIds() {
  try {
    const recentIds = JSON.parse(localStorage.getItem(RECENT_GAMES_KEY) || '[]');
    return Array.isArray(recentIds) ? recentIds : [];
  } catch {
    return [];
  }
}

function getRecentGames() {
  const gameById = new Map(allGames.map(game => [game.id, game]));
  return getRecentGameIds()
    .map(id => gameById.get(id))
    .filter(Boolean);
}

function showLaunchOverlay(game) {
  const overlay = document.getElementById('launchOverlay');
  const backdrop = document.getElementById('launchBackdrop');
  const logo = overlay?.querySelector('.launch-logo');
  const title = document.getElementById('launchTitle');
  const platform = document.getElementById('launchPlatform');
  const cover = document.getElementById('launchCover');
  const card = document.getElementById('launchCard');
  const status = document.getElementById('launchStatus');
  const bar = overlay?.querySelector('.launch-bar');

  if (!overlay) return;

  const imageUrl = game.heroArt || game.coverArt || '';
  if (backdrop) {
    backdrop.style.backgroundImage = imageUrl ? `url('${imageUrl}')` : '';
  }

  title.textContent = `${game.title} wird gestartet`;
  platform.textContent = game.platform === 'WiiU' ? 'Wii U' : game.platform;
  status.textContent = 'Emulator wird vorbereitet';

  if (cover && card) {
    if (game.coverArt) {
      cover.src = game.coverArt;
      cover.alt = game.title;
      card.classList.remove('hidden');
    } else {
      cover.removeAttribute('src');
      cover.alt = '';
      card.classList.add('hidden');
    }
  }

  overlay.classList.add('visible');

  const gsap = window.gsap;
  if (!gsap) return;

  launchTimeline?.kill();
  gsap.set(overlay, { autoAlpha: 1 });
  gsap.set(backdrop, { scale: 1.08, autoAlpha: 0.42 });

  launchTimeline = gsap.timeline();
  launchTimeline
    .fromTo(backdrop, { scale: 1.14, autoAlpha: 0 }, { scale: 1.08, autoAlpha: 0.48, duration: 0.85, ease: 'power2.out' })
    .fromTo(card, { y: 70, scale: 0.72, rotateX: 14, autoAlpha: 0 }, { y: 0, scale: 1, rotateX: 0, autoAlpha: 1, duration: 0.75, ease: 'power4.out' }, '-=0.55')
    .fromTo([logo, title, platform, status, bar], { y: 22, autoAlpha: 0 }, { y: 0, autoAlpha: 1, stagger: 0.07, duration: 0.48, ease: 'power3.out' }, '-=0.48');
}

function hideLaunchOverlay() {
  const overlay = document.getElementById('launchOverlay');
  if (!overlay) return;

  const gsap = window.gsap;
  launchTimeline?.kill();
  launchTimeline = null;

  if (!gsap) {
    overlay.classList.remove('visible');
    return;
  }

  gsap.to(overlay, {
    autoAlpha: 0,
    duration: 0.22,
    ease: 'power2.in',
    onComplete: () => overlay.classList.remove('visible'),
  });
}

function setupLauncherEvents() {
  window.api.onLauncherRestored?.(() => {
    hideLaunchOverlay();
    unmuteLauncherAudio();
    isLaunchInProgress = false;
    // Re-render shelf to reflect updated sort order
    currentIndex = -1;
    renderShelf();
  });
}

// ===== GAMEPAD UI BRIDGE =====

function setupGamepadInput() {
  if (setupNativeControllerInput()) {
    return;
  }

  setupBrowserGamepadInput();
}

function setupNativeControllerInput() {
  const bridge = window.electronAPI || window.api;
  if (!bridge?.onControllerInput || nativeControllerUnsubscribe) {
    return Boolean(nativeControllerUnsubscribe);
  }

  nativeControllerAvailable = true;
  nativeControllerUnsubscribe = bridge.onControllerInput(handleNativeControllerInput);
  console.info('[Controller] Native IPC-Bridge aktiv (SDL + JoyCon2).');

  bridge.getJoyCon2Status?.()
    .then((status) => {
      if (status?.available) {
        console.info(`[JoyCon2] Bridge bereit. ViGEm: ${status.vigemConnected ? 'ok' : 'fehlt'}`);
      }
    })
    .catch(() => {});

  bridge.getConnectedControllers?.()
    .then((controllers) => {
      if (!Array.isArray(controllers)) return;
      for (const controller of controllers) {
        rememberNativeController(controller);
      }
      if (controllers.length > 0) {
        hideGamepadHint();
        document.body.classList.add('is-gamepad-mode');
      }
    })
    .catch((err) => {
      console.warn('[Controller] Verbundene SDL-Controller konnten nicht abgefragt werden:', err);
    });

  gamepadHintTimer = setTimeout(() => {
    if (nativeControllers.size === 0) {
      showGamepadHint();
    }
  }, 2500);

  return true;
}

function setupBrowserGamepadInput() {
  if (!window.GamepadManager || !navigator.getGamepads) {
    console.warn('[Gamepad] Web Gamepad API ist in diesem Renderer nicht verfügbar.');
    return;
  }

  if (gamepadManager) return;

  gamepadManager = new window.GamepadManager({
    deadzone: window.GamepadUtils?.loadControllerSetupConfig?.().global?.deadzone ?? 0.35,
    onConnect: (gamepad) => {
      const friendlyName = describeGamepad(gamepad);
      console.info(`[Gamepad] Verbunden: ${gamepad.id} (mapping=${gamepad.mapping || 'n/a'})`);
      showToast(`Controller verbunden: ${friendlyName}`);
      hideGamepadHint();
      controllerSetupUI?.syncConnectedControllers?.();
      if (controllerSetupUI?.isOpen) controllerSetupUI.render();
    },
    onDisconnect: (gamepad) => {
      console.info(`[Gamepad] Getrennt: ${gamepad.id}`);
      showToast(`Controller getrennt: ${describeGamepad(gamepad)}`);
      document.body.classList.remove('is-gamepad-mode');
      controllerSetupUI?.syncConnectedControllers?.();
      if (controllerSetupUI?.isOpen) controllerSetupUI.render();
    },
    onNavigate: (direction) => {
      if (controllerSetupUI?.isOpen && controllerSetupUI.handleGamepadNavigate?.(direction)) {
        return;
      }
      moveFocus(direction);
    },
    onAction: (action) => {
      handleGamepadAction(action);
    },
    onInputModeChange: (mode) => {
      document.body.classList.toggle('is-gamepad-mode', mode === 'gamepad');
    },
  });

  gamepadManager.start();
  window.felixelGamepadManager = gamepadManager;

  if (controllerSetupUI) {
    controllerSetupUI.gamepadManager = gamepadManager;
    controllerSetupUI.gamepadManager.applySetupConfig(controllerSetupUI.getConfig(), { silent: true });
  }

  gamepadHintTimer = setTimeout(() => {
    const gamepads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    if (gamepads.length === 0) {
      showGamepadHint();
    }
  }, 2500);
}

function rememberNativeController(controller) {
  if (!controller?.id) return;
  const entry = { ...controller, source: controller.source || 'sdl' };
  nativeControllers.set(controller.id, entry);
  controllerSetupUI?.registerNativeController?.(entry);
}

function forgetNativeController(controllerId) {
  nativeControllers.delete(controllerId);
  controllerSetupUI?.unregisterNativeController?.(controllerId);
  if (nativeControllers.size === 0) {
    nativeAxisDirections.clear();
    document.body.classList.remove('is-gamepad-mode');
  }
}

function describeNativeController(payload) {
  return payload?.controllerModel || payload?.model || payload?.name || payload?.controllerType || 'Controller';
}

function handleNativeControllerInput(payload) {
  if (!payload?.type) return;

  if (payload.type === 'connect') {
    rememberNativeController(payload);
    console.info(`[Controller] Verbunden: ${describeNativeController(payload)}`);
    showToast(`Controller verbunden: ${describeNativeController(payload)}`);
    hideGamepadHint();
    document.body.classList.add('is-gamepad-mode');
    if (controllerSetupUI?.isOpen) controllerSetupUI.render();
    return;
  }

  if (payload.type === 'disconnect') {
    console.info(`[Controller] Getrennt: ${describeNativeController(payload)}`);
    showToast(`Controller getrennt: ${describeNativeController(payload)}`);
    forgetNativeController(payload.id);
    if (controllerSetupUI?.isOpen) controllerSetupUI.render();
    return;
  }

  if (payload.type === 'button-down') {
    handleNativeButtonDown(payload);
    return;
  }

  if (payload.type === 'axis') {
    handleNativeAxis(payload);
  }
}

function handleNativeButtonDown(payload) {
  document.body.classList.add('is-gamepad-mode');

  // Beispiel-Filter fuer physische Controller-Labels:
  if (payload.controllerType === 'Nintendo' && payload.button === 'A') {
    console.info('[Controller Beispiel] Nintendo A gedrueckt', payload);
  }

  if (payload.controllerType === 'Nintendo' && payload.source === 'joycon2' && payload.button === 'Home') {
    console.info('[Controller Beispiel] Joy-Con 2 Home gedrueckt', payload);
  }

  // DualSense Cross ist SDL-logisch "a", wird hier als "Cross" normalisiert.
  if (payload.controllerType === 'PS5' && payload.button === 'Cross') {
    console.info('[Controller Beispiel] PS5 Cross gedrueckt', payload);
  }

  const direction = nativeButtonToDirection(payload.logicalButton);
  if (direction) {
    emitNativeNavigation(direction);
    return;
  }

  const action = nativeButtonToAction(payload.logicalButton);
  if (action) {
    handleGamepadAction(action);
  }
}

function handleNativeAxis(payload) {
  const axis = payload.logicalAxis || payload.axis;
  if (!axis) return;

  const deadzone = controllerSetupUI?.getConfig?.().global?.deadzone ?? 0.35;
  const value = Number(payload.value) || 0;
  let direction = null;

  if (axis === 'leftStickX') {
    if (value < -deadzone) direction = 'left';
    if (value > deadzone) direction = 'right';
  } else if (axis === 'leftStickY') {
    if (value < -deadzone) direction = 'up';
    if (value > deadzone) direction = 'down';
  }

  const previous = nativeAxisDirections.get(axis) || null;
  if (previous === direction) return;

  nativeAxisDirections.set(axis, direction);
  if (direction) {
    emitNativeNavigation(direction);
  }
}

function emitNativeNavigation(direction) {
  document.body.classList.add('is-gamepad-mode');
  if (controllerSetupUI?.isOpen && controllerSetupUI.handleGamepadNavigate?.(direction)) {
    return;
  }
  moveFocus(direction);
}

function nativeButtonToDirection(button) {
  switch (button) {
    case 'dpadLeft':
      return 'left';
    case 'dpadRight':
      return 'right';
    case 'dpadUp':
      return 'up';
    case 'dpadDown':
      return 'down';
    default:
      return null;
  }
}

function nativeButtonToAction(button) {
  switch (button) {
    case 'a':
      return 'confirm';
    case 'b':
      return 'back';
    case 'start':
      return 'settings';
    case 'leftShoulder':
      return 'tabLeft';
    case 'rightShoulder':
      return 'tabRight';
    default:
      return null;
  }
}

function describeGamepad(gamepad) {
  if (window.GamepadUtils?.describeGamepad) {
    return window.GamepadUtils.describeGamepad(gamepad);
  }

  const id = gamepad?.id || 'Controller';
  return id.length > 40 ? `${id.slice(0, 40)}…` : id;
}

function handleGamepadAction(action) {
  if (controllerSetupUI?.isOpen && controllerSetupUI.handleGamepadAction?.(action)) {
    return;
  }

  switch (action) {
    case 'confirm':
      launchFocusedGame();
      break;
    case 'back':
      handleBackAction();
      break;
    case 'settings':
      openSettings();
      break;
    case 'tabLeft':
      navigateTab('left');
      break;
    case 'tabRight':
      navigateTab('right');
      break;
    default:
      break;
  }
}

// ===== TAB NAVIGATION =====

const NAVIGABLE_TABS = ['recent', 'switch', 'wii'];

function navigateTab(direction) {
  const idx = NAVIGABLE_TABS.indexOf(currentCategory);
  const currentIdx = idx === -1 ? 0 : idx;

  const nextIdx = direction === 'left'
    ? (currentIdx - 1 + NAVIGABLE_TABS.length) % NAVIGABLE_TABS.length
    : (currentIdx + 1) % NAVIGABLE_TABS.length;

  const nextCategory = NAVIGABLE_TABS[nextIdx];
  document.querySelector(`.ps5-category[data-category="${nextCategory}"]`)?.click();
}

function moveFocus(direction) {
  if (focusedGames.length === 0) return;

  let delta = 0;
  if (direction === 'left') delta = -1;
  else if (direction === 'right') delta = 1;
  else return;

  const nextIndex = Math.max(0, Math.min(focusedGames.length - 1, currentIndex + delta));
  if (nextIndex !== currentIndex) {
    setFocusedGameByIndex(nextIndex);
    document.querySelector('.game-card.active')?.focus({ preventScroll: true });
  }
}

function launchFocusedGame() {
  const game = focusedGames[currentIndex];
  if (!game) return;
  launchGame(game);
}

function launchGameById(gameId) {
  const game = allGames.find(candidate => candidate.id === gameId);
  if (!game) return;
  launchGame(game);
}

function handleBackAction() {
  if (controllerSetupUI?.isOpen) {
    controllerSetupUI.handleClose();
    return;
  }

  const controllerOverlay = document.getElementById('controllerOverlay');
  if (!controllerOverlay?.classList.contains('hidden')) {
    controllerOverlay.classList.add('hidden');
    return;
  }

  const launchOverlay = document.getElementById('launchOverlay');
  if (launchOverlay?.classList.contains('visible')) {
    hideLaunchOverlay();
  }
}

function openSettings() {
  showToast('Einstellungen kommen bald.');
}

function showGamepadHint() {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = 'Controller erkannt? Drücke einen Knopf zum Aktivieren.';
  toast.className = 'toast visible';
}

function hideGamepadHint() {
  if (gamepadHintTimer) {
    clearTimeout(gamepadHintTimer);
    gamepadHintTimer = null;
  }
}

// ===== BOOT AUDIO SEQUENCE =====

let audioCtx = null;

/**
 * Lädt bootsound.wav und dashboard final sound.wav, spielt sie mit einem
 * präzisen 2-Sekunden-Crossfade ab und gibt ein Promise zurück, das sich
 * auflöst, sobald bootsound.wav endet (≈ t=15s).
 *
 * GainNode-Kette:
 *   bootSource → bootGain ─┐
 *                           ├─► AudioContext.destination
 *   dashSource → dashGain ─┘
 */
async function bootAudioSequence() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Beide WAV-Dateien parallel laden und dekodieren
  const [bootBuffer, dashBuffer] = await Promise.all([
    fetch('assets/sounds/bootsound/bootsound.wav')
      .then(r => r.arrayBuffer())
      .then(b => audioCtx.decodeAudioData(b)),
    fetch('assets/sounds/bootsound/dashboard final sound.wav')
      .then(r => r.arrayBuffer())
      .then(b => audioCtx.decodeAudioData(b)),
  ]);

  const t0 = audioCtx.currentTime;
  const crossfadeStart = t0 + 13.0; // Crossfade-Fenster beginnt bei Sekunde 13
  const crossfadeEnd   = t0 + 15.0; // Crossfade endet bei Sekunde 15

  // --- Boot-Sound: startet sofort, Fade-Out über die letzten 2 Sekunden ---
  const bootSource = audioCtx.createBufferSource();
  bootSource.buffer = bootBuffer;

  const bootGain = audioCtx.createGain();
  bootGain.gain.setValueAtTime(1.0, t0);              // volle Lautstärke ab Start
  bootGain.gain.setValueAtTime(1.0, crossfadeStart);  // Anker: hält 1.0 bis t=13s
  bootGain.gain.linearRampToValueAtTime(0.0, crossfadeEnd); // lineares Fade-Out 13→15s

  bootSource.connect(bootGain);
  bootGain.connect(audioCtx.destination);
  bootSource.start(t0);
  bootSource.stop(crossfadeEnd); // Source wird bei t=15s automatisch gestoppt

  // --- Dashboard-Loop: startet bei t=13s stumm, Fade-In auf volle Lautstärke ---
  const dashSource = audioCtx.createBufferSource();
  dashSource.buffer = dashBuffer;
  dashSource.loop = true; // läuft nach t=15s unendlich weiter

  const dashGain = audioCtx.createGain();
  dashGain.gain.setValueAtTime(0.0, crossfadeStart);  // stumm bei t=13s (Anker)
  dashGain.gain.linearRampToValueAtTime(1.0, crossfadeEnd); // lineares Fade-In 13→15s

  dashSource.connect(dashGain);
  dashGain.connect(audioCtx.destination);
  dashSource.start(crossfadeStart); // startet frame-perfekt bei t=13s

  // Promise löst sich auf, sobald bootSource gestoppt wird (= t≈15s)
  return new Promise(resolve => {
    bootSource.onended = resolve;
  });
}

// ===== HOVER SOUND =====

let hoverSoundBuffer = null;

async function loadHoverSound() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const response = await fetch('assets/sounds/636677__cogfirestudios__app-ui-sound.wav');
    const arrayBuffer = await response.arrayBuffer();
    hoverSoundBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (err) {
    console.warn('[HoverSound] Konnte Sound nicht laden:', err);
  }
}

function playHoverSound() {
  if (isLauncherAudioMuted) return;

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (hoverSoundBuffer) {
    const source = audioCtx.createBufferSource();
    const gain   = audioCtx.createGain();

    source.buffer = hoverSoundBuffer;
    source.connect(gain);
    gain.connect(audioCtx.destination);

    gain.gain.setValueAtTime(0.55, audioCtx.currentTime);
    source.start(audioCtx.currentTime);
  }
}

function muteLauncherAudio() {
  isLauncherAudioMuted = true;
  if (audioCtx?.state === 'running') {
    audioCtx.suspend().catch(err => console.warn('[Audio] Launcher-Audio konnte nicht pausiert werden:', err));
  }
}

function unmuteLauncherAudio() {
  isLauncherAudioMuted = false;
  if (audioCtx?.state === 'suspended') {
    audioCtx.resume().catch(err => console.warn('[Audio] Launcher-Audio konnte nicht fortgesetzt werden:', err));
  }
}

// ===== TOAST =====

let toastTimeout = null;

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast visible${isError ? ' error' : ''}`;

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('visible');
  }, 3000);
}

// ===== IN-GAME PAUSE OVERLAY =====

const OVERLAY_ITEMS = ['resume', 'settings', 'quit'];

let overlayActive = false;
let overlayFocusIndex = 0;
let overlayRafId = null;
let overlayActionFired = false;
let overlayNavPrev = { up: false, down: false, confirm: false };

function setupInGameOverlay() {
  // Das Overlay läuft jetzt als separates transparentes Fenster (overlay.html).
  // Der alte show-overlay Handler wird hier nicht mehr benötigt.
  if (!window.api?.onShowOverlay) return;

  document.querySelectorAll('.overlay-action').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      overlayFocusIndex = i;
      confirmOverlayAction();
    });
    btn.addEventListener('pointerenter', () => {
      overlayFocusIndex = i;
      updateOverlayFocus();
    });
  });
}

function showGameOverlay() {
  const overlay = document.getElementById('gameOverlay');
  if (!overlay) return;

  overlayActive = true;
  overlayFocusIndex = 0;
  overlayActionFired = false;
  overlayNavPrev = { up: false, down: false, confirm: false };

  overlay.classList.remove('hidden');
  updateOverlayFocus();

  gamepadManager?.setEnabled(false);
  startOverlayGamepadPoll();
}

function hideGameOverlay() {
  const overlay = document.getElementById('gameOverlay');
  if (!overlay) return;

  overlayActive = false;
  overlay.classList.add('hidden');
  stopOverlayGamepadPoll();

  setTimeout(() => {
    gamepadManager?.setEnabled(true);
  }, 450);
}

function updateOverlayFocus() {
  document.querySelectorAll('.overlay-action').forEach((btn, i) => {
    btn.classList.toggle('is-focused', i === overlayFocusIndex);
  });
}

function startOverlayGamepadPoll() {
  stopOverlayGamepadPoll();

  function poll() {
    if (!overlayActive) return;

    const gp = Array.from(navigator.getGamepads?.() ?? []).find(Boolean);

    if (gp) {
      const axisY = gp.axes[1] ?? 0;
      const up = (gp.buttons[12]?.pressed) || axisY < -0.5;
      const down = (gp.buttons[13]?.pressed) || axisY > 0.5;
      const confirm = gp.buttons[0]?.pressed ?? false;

      if (up && !overlayNavPrev.up) {
        overlayFocusIndex = (overlayFocusIndex - 1 + OVERLAY_ITEMS.length) % OVERLAY_ITEMS.length;
        updateOverlayFocus();
        playHoverSound();
      }
      if (down && !overlayNavPrev.down) {
        overlayFocusIndex = (overlayFocusIndex + 1) % OVERLAY_ITEMS.length;
        updateOverlayFocus();
        playHoverSound();
      }
      if (confirm && !overlayNavPrev.confirm) {
        confirmOverlayAction();
      }

      overlayNavPrev = { up, down, confirm };
    }

    overlayRafId = requestAnimationFrame(poll);
  }

  overlayRafId = requestAnimationFrame(poll);
}

function stopOverlayGamepadPoll() {
  if (overlayRafId !== null) {
    cancelAnimationFrame(overlayRafId);
    overlayRafId = null;
  }
}

function confirmOverlayAction() {
  if (overlayActionFired) return;
  overlayActionFired = true;

  const action = OVERLAY_ITEMS[overlayFocusIndex];

  switch (action) {
    case 'resume':
      hideGameOverlay();
      window.api.resumeOverlay();
      break;
    case 'settings':
      hideGameOverlay();
      window.api.resumeOverlay();
      openSettings();
      break;
    case 'quit':
      hideGameOverlay();
      window.api.quitEmulator();
      break;
    default:
      break;
  }
}
