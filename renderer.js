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
let focusSelectionTimer = null;
let nativeControllerUnsubscribe = null;
let nativeControllerAvailable = false;
let touchpadPollFrame = null;
let lastTouchpadActionAt = 0;
const touchpadPressedByGamepad = new Map();
const TOUCHPAD_ACTION_DEBOUNCE_MS = 400;
const nativeControllers = new Map();
const nativeAxisDirections = new Map();

// Zeitpunkt der letzten Controller-Verbindung. Verhindert, dass der Tastendruck,
// der einen Controller im offenen Setup-Popup verbindet, das Popup sofort wieder
// schließt.
let lastControllerConnectAt = 0;
const CONTROLLER_SETUP_CLOSE_GRACE_MS = 1200;

function controllerSetupActive() {
  return typeof window.isControllerSetupOpen === 'function' && window.isControllerSetupOpen();
}

const FOCUS_SELECTION_DELAY_MS = 120;
const RECENT_GAMES_KEY = 'felixel:recent-games';

let currentCategory = 'recent';

const DASHBOARD_VIEWS = ['shelf', 'masonry'];
const DASHBOARD_VIEW_KEY = 'felixel:dashboard-view';
const DASHBOARD_VIEW_LABELS = {
  shelf: 'Reihe',
  masonry: 'Masonry',
};

let currentDashboardView = loadDashboardView();

function loadDashboardView() {
  try {
    const saved = localStorage.getItem(DASHBOARD_VIEW_KEY);
    return DASHBOARD_VIEWS.includes(saved) ? saved : 'shelf';
  } catch {
    return 'shelf';
  }
}

function saveDashboardView() {
  try {
    localStorage.setItem(DASHBOARD_VIEW_KEY, currentDashboardView);
  } catch {
    // Speichern ist optional.
  }
}

function isMasonryView() {
  return currentDashboardView === 'masonry';
}

function applyDashboardView() {
  const shelf = document.getElementById('gameShelf');
  const container = document.getElementById('shelfContainer');
  if (!shelf) return;

  shelf.classList.toggle('is-masonry', isMasonryView());
  shelf.classList.toggle('is-shelf', !isMasonryView());
  container?.classList.toggle('is-masonry-view', isMasonryView());
  updateDashboardViewIndicator();
}

function updateDashboardViewIndicator() {
  const indicator = document.getElementById('dashboardViewIndicator');
  if (!indicator) return;

  const label = DASHBOARD_VIEW_LABELS[currentDashboardView] || currentDashboardView;
  indicator.dataset.view = currentDashboardView;
  indicator.setAttribute('aria-label', `Ansicht: ${label}`);
  indicator.title = `Ansicht: ${label} (Touchpad zum Wechseln)`;

  const text = indicator.querySelector('.dashboard-view-indicator__label');
  if (text) text.textContent = label;
}

function canEmitTouchpadAction() {
  const now = performance.now();
  if (now - lastTouchpadActionAt < TOUCHPAD_ACTION_DEBOUNCE_MS) return false;
  lastTouchpadActionAt = now;
  return true;
}

function isTouchpadPressedOnGamepad(gamepad) {
  if (!gamepad?.buttons?.length) return false;

  const info = window.GamepadUtils?.parseControllerInfo?.(gamepad);
  const indices = info?.type === 'dualsense' || info?.type === 'dualshock4'
    ? [17, 13, 20]
    : [17];

  return indices.some((index) => {
    const button = gamepad.buttons[index];
    if (!button) return false;
    if (typeof button === 'number') return button > 0.5;
    return Boolean(button.pressed) || (button.value || 0) > 0.5;
  });
}

function setupTouchpadInput() {
  if (!navigator.getGamepads || touchpadPollFrame !== null) return;

  const poll = () => {
    if (!controllerSetupActive()) {
      const gamepads = window.GamepadUtils?.getAllRealGamepads?.()
        || Array.from(navigator.getGamepads()).filter(Boolean);

      for (const gamepad of gamepads) {
        const pressed = isTouchpadPressedOnGamepad(gamepad);
        const wasPressed = touchpadPressedByGamepad.get(gamepad.index) || false;

        if (pressed && !wasPressed && canEmitTouchpadAction()) {
          document.body.classList.add('is-gamepad-mode');
          cycleDashboardView();
        }

        touchpadPressedByGamepad.set(gamepad.index, pressed);
      }
    }

    touchpadPollFrame = requestAnimationFrame(poll);
  };

  touchpadPollFrame = requestAnimationFrame(poll);
}

function cycleDashboardView() {
  const current = DASHBOARD_VIEWS.indexOf(currentDashboardView);
  currentDashboardView = DASHBOARD_VIEWS[(current + 1) % DASHBOARD_VIEWS.length];
  saveDashboardView();
  applyDashboardView();
  window.FelixelFocusManager?.refresh();

  if (currentIndex >= 0) {
    setFocusedGameByIndex(currentIndex, { scroll: true, playSound: false, updateHero: false });
  }

  playHoverSound();
  showToast(`Ansicht: ${DASHBOARD_VIEW_LABELS[currentDashboardView]}`);
}

// ===== INIT =====

document.addEventListener('DOMContentLoaded', async () => {
  setupLauncherEvents();
  setupFocusManager();
  setupKeyboardNavigation();
  setupGamepadInput();
  setupInGameOverlay();
  setupTopBarControls();
  setupCategoryTabs();
  applyDashboardView();
  startClock();
  setupMasonryResize();
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
    applyDashboardView();

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
    if (isMasonryView()) {
      fragment.appendChild(buildMasonryGrid(sorted));
    } else {
      for (const [index, game] of sorted.entries()) {
        fragment.appendChild(createShelfCard(game, index));
      }
    }
    shelf.appendChild(fragment);

    currentIndex = currentIndex < 0 ? 0 : Math.min(currentIndex, sorted.length - 1);
    setFocusedGameByIndex(currentIndex, { scroll: true, playSound: false, immediateHero: true });
    window.FelixelFocusManager?.refresh();

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

// ===== MASONRY LAYOUT =====

const MASONRY_TIER_WEIGHTS = {
  'masonry-card--short': 9,
  'masonry-card--medium': 14,
  'masonry-card--tall': 20,
  'masonry-card--xl': 26,
};

const MASONRY_TIERS = [
  'masonry-card--short',
  'masonry-card--medium',
  'masonry-card--tall',
  'masonry-card--xl',
  'masonry-card--medium',
  'masonry-card--short',
];

let masonryResizeTimer = null;

function getMasonryTier(index) {
  return MASONRY_TIERS[index % MASONRY_TIERS.length];
}

function getMasonryColumnCount() {
  const width = window.innerWidth;
  if (width >= 1600) return 6;
  if (width >= 1280) return 5;
  if (width >= 1024) return 4;
  if (width >= 768) return 3;
  return 2;
}

function estimateMasonryCardHeight(index) {
  const tier = getMasonryTier(index);
  return MASONRY_TIER_WEIGHTS[tier] || 14;
}

function buildMasonryGrid(games) {
  const grid = document.createElement('div');
  grid.className = 'masonry-grid';
  grid.setAttribute('role', 'presentation');

  const columnCount = getMasonryColumnCount();
  const columns = Array.from({ length: columnCount }, () => {
    const column = document.createElement('div');
    column.className = 'masonry-column';
    column.setAttribute('role', 'group');
    grid.appendChild(column);
    return column;
  });

  const columnHeights = Array(columnCount).fill(0);

  for (const [index, game] of games.entries()) {
    const card = createShelfCard(game, index);
    const targetColumn = columnHeights.indexOf(Math.min(...columnHeights));
    columns[targetColumn].appendChild(card);
    columnHeights[targetColumn] += estimateMasonryCardHeight(index);
  }

  return grid;
}

function setupMasonryResize() {
  window.addEventListener('resize', () => {
    if (!isMasonryView()) return;
    clearTimeout(masonryResizeTimer);
    masonryResizeTimer = setTimeout(() => {
      masonryResizeTimer = null;
      if (focusedGames.length > 0) {
        renderShelf();
      }
    }, 180);
  });
}

// ===== SHELF CARD =====

function createShelfCard(game, index) {
  const card = document.createElement('div');
  const masonryTier = isMasonryView() ? getMasonryTier(index) : '';
  card.className = `shelf-card game-card${masonryTier ? ` ${masonryTier}` : ''}`;
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
    card.scrollIntoView({
      behavior: 'auto',
      block: isMasonryView() ? 'nearest' : 'nearest',
      inline: isMasonryView() ? 'nearest' : 'nearest',
    });
  }

  if (playSound) {
    playHoverSound();
  }
}

function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    if (isTyping) return;
    if (controllerSetupActive()) return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveFocus('left');
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveFocus('right');
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus('up');
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveFocus('down');
        break;
      case 'Enter':
        e.preventDefault();
        window.FelixelFocusManager?.confirm();
        break;
      case 'Escape':
        e.preventDefault();
        handleBackAction();
        break;
      case 'v':
      case 'V':
        e.preventDefault();
        cycleDashboardView();
        break;
      default:
        break;
    }
  });
}

// ===== FOCUS MANAGER =====

function setupFocusManager() {
  if (!window.FelixelFocusManager) return;

  window.FelixelFocusManager.init({
    isModalOpen: controllerSetupActive,
    getCategoryIndex: () => NAVIGABLE_TABS.indexOf(currentCategory),
    getDashboardView: () => currentDashboardView,
    getShelfCount: () => focusedGames.length,
    hasShelfFocus: () => currentIndex >= 0,
    onShelfMove: handleShelfMove,
    onShelfConfirm: launchFocusedGame,
    onCategorySelect: (category) => {
      document.querySelector(`.ps5-category[data-category="${category}"]`)?.click();
    },
    onTopBarAction: handleTopBarAction,
    onPlayHoverSound: playHoverSound,
    onHintChange: updateGamepadHint,
  });
}

function handleShelfMove(direction) {
  if (direction === 'restore') {
    if (focusedGames.length > 0 && currentIndex < 0) {
      setFocusedGameByIndex(0, { scroll: true, playSound: false });
    }
    document.querySelector('.shelf-card.is-focused')?.focus({ preventScroll: true });
    return true;
  }

  if (focusedGames.length === 0) return false;

  let nextIndex = currentIndex;

  if (isMasonryView()) {
    nextIndex = findSpatialShelfIndex(direction);
    if (nextIndex < 0) return false;
  } else if (direction === 'left' || direction === 'right') {
    const delta = direction === 'left' ? -1 : 1;
    nextIndex = Math.max(0, Math.min(focusedGames.length - 1, currentIndex + delta));
  } else {
    return false;
  }

  if (nextIndex !== currentIndex) {
    setFocusedGameByIndex(nextIndex);
    document.querySelector('.shelf-card.is-focused')?.focus({ preventScroll: true });
    return true;
  }

  return false;
}

function findSpatialShelfIndex(direction) {
  const cards = Array.from(document.querySelectorAll('.shelf-card'));
  if (cards.length === 0) return -1;

  const currentCard = cards.find((card) => card.classList.contains('is-focused'))
    || cards[currentIndex]
    || cards[0];
  if (!currentCard) return -1;

  const currentRect = currentCard.getBoundingClientRect();
  const cx = currentRect.left + currentRect.width / 2;
  const cy = currentRect.top + currentRect.height / 2;
  const edgePadding = 12;

  let bestCard = null;
  let bestScore = Infinity;

  for (const card of cards) {
    if (card === currentCard) continue;

    const rect = card.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    let inDirection = false;
    switch (direction) {
      case 'left':
        inDirection = x < cx - edgePadding;
        break;
      case 'right':
        inDirection = x > cx + edgePadding;
        break;
      case 'up':
        inDirection = y < cy - edgePadding;
        break;
      case 'down':
        inDirection = y > cy + edgePadding;
        break;
      default:
        break;
    }
    if (!inDirection) continue;

    const primary = direction === 'left' || direction === 'right'
      ? Math.abs(x - cx)
      : Math.abs(y - cy);
    const secondary = direction === 'left' || direction === 'right'
      ? Math.abs(y - cy)
      : Math.abs(x - cx);
    const score = primary + secondary * 0.35;

    if (score < bestScore) {
      bestScore = score;
      bestCard = card;
    }
  }

  if (!bestCard) return currentIndex;
  const nextIndex = focusedGames.findIndex((game) => game.id === bestCard.dataset.gameId);
  return nextIndex >= 0 ? nextIndex : currentIndex;
}

function handleTopBarAction(buttonId) {
  switch (buttonId) {
    case 'btnControllerSetup':
      window.openControllerSetup?.();
      break;
    case 'btnPower':
      openSettings();
      break;
    case 'btnActivities':
      showToast('Aktivitäten folgen bald.');
      break;
    default:
      break;
  }
}

function updateGamepadHint(text) {
  const prompt = document.getElementById('startPrompt');
  if (!prompt) return;

  if (!document.body.classList.contains('is-gamepad-mode')) {
    prompt.innerHTML = window.ControllerButtonIcons?.startPromptHtml?.() || 'Press to start';
    return;
  }

  prompt.innerHTML = text || window.ControllerButtonIcons?.startPromptHtml?.() || 'Press to start';
}

// ===== TOP BAR CONTROLS =====

function setupTopBarControls() {
  document.getElementById('btnPower')?.addEventListener('click', openSettings);
  document.getElementById('btnChat')?.addEventListener('click', () => showToast('Chat folgt bald.'));
  document.getElementById('btnActivities')?.addEventListener('click', () => showToast('Aktivitäten folgen bald.'));
  document.getElementById('btnCalendar')?.addEventListener('click', () => showToast('Kalender folgt bald.'));
  document.getElementById('btnTrophies')?.addEventListener('click', () => showToast('Trophäen folgen bald.'));
  document.getElementById('btnSwitch')?.addEventListener('click', () => showToast('Wechseln folgt bald.'));
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
      window.FelixelFocusManager?.refresh();
    });
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
    const controllerInfo = getConnectedControllersForLaunch();
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
      if (result.controllerSetup?.applied === false) {
        showToast('Spiel startet – Controller konnte im Emulator nicht automatisch registriert werden.', true);
      } else if (result.controllerSetup?.applied && result.controllerSetup?.profile) {
        showToast(`${game.title} wird gestartet (${result.controllerSetup.profile})`);
      } else {
        showToast(`${game.title} wird gestartet...`);
      }
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

function buildControllerInfoEntry(controller, slot, config = null) {
  return {
    id: controller.name || controller.id,
    label: controller.name || controller.model || controller.controllerModel || controller.id,
    name: controller.name || controller.model || controller.controllerModel || controller.id,
    mapping: controller.mapping || 'sdl',
    vendorId: controller.vendorId || '',
    productId: controller.productId || '',
    type: toSetupControllerType(controller),
    playerSlot: slot,
    guid: controller.guid || '',
    source: controller.source || 'sdl',
    mappingProfile: config?.global?.mappingProfile || 'standard',
    deadzone: config?.global?.deadzone ?? 0.35,
    vibrationStrength: config?.global?.vibrationStrength ?? 1,
  };
}

function getConnectedControllersForLaunch() {
  const config = window.GamepadUtils?.loadControllerSetupConfig?.() || null;
  const controllers = [];

  if (nativeControllerAvailable && nativeControllers.size > 0) {
    const sorted = Array.from(nativeControllers.values())
      .sort((a, b) => (a.player ?? 99) - (b.player ?? 99));
    sorted.forEach((controller, index) => {
      controllers.push(buildControllerInfoEntry(controller, controller.player || index + 1, config));
    });
  } else {
    const { getAllRealGamepads, parseControllerInfo, getGamepadKey } = window.GamepadUtils || {};
    const gamepads = getAllRealGamepads?.() || [];
    gamepads.forEach((gamepad, index) => {
      const info = parseControllerInfo?.(gamepad) || {};
      const entry = config?.controllers?.find((item) => item.key === getGamepadKey?.(gamepad));
      controllers.push({
        ...info,
        id: gamepad.id,
        label: info.id || gamepad.id,
        name: info.id || gamepad.id,
        guid: '',
        playerSlot: entry?.playerSlot || index + 1,
        mappingProfile: entry?.mappingProfile || config?.global?.mappingProfile || 'standard',
        deadzone: entry?.deadzone ?? config?.global?.deadzone ?? 0.35,
        vibrationStrength: entry?.vibrationStrength ?? config?.global?.vibrationStrength ?? 1,
        source: 'web-gamepad',
      });
    });
  }

  if (controllers.length === 0) return null;

  return {
    ...controllers[0],
    controllers,
    setup: {
      ...(config || {}),
      controllers,
      global: config?.global || {
        deadzone: 0.35,
        vibrationStrength: 1,
        mappingProfile: 'standard',
      },
    },
  };
}

function getActiveControllerInfo() {
  const payload = getConnectedControllersForLaunch();
  if (!payload) return null;
  return {
    ...payload,
    playerSlot: payload.playerSlot || 1,
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
  setupTouchpadInput();

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
        window.FelixelFocusManager?.ensureShelfFocus();
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
      lastControllerConnectAt = performance.now();
      const friendlyName = describeGamepad(gamepad);
      console.info(`[Gamepad] Verbunden: ${gamepad.id} (mapping=${gamepad.mapping || 'n/a'})`);
      showToast(`Controller verbunden: ${friendlyName}`);
      hideGamepadHint();
      window.FelixelFocusManager?.ensureShelfFocus();
    },
    onDisconnect: (gamepad) => {
      console.info(`[Gamepad] Getrennt: ${gamepad.id}`);
      showToast(`Controller getrennt: ${describeGamepad(gamepad)}`);
      document.body.classList.remove('is-gamepad-mode');
    },
    onNavigate: (direction) => {
      moveFocus(direction);
    },
    onAction: (action) => {
      handleGamepadAction(action);
    },
    onInputModeChange: (mode) => {
      document.body.classList.toggle('is-gamepad-mode', mode === 'gamepad');
      window.FelixelFocusManager?.refresh();
    },
  });

  gamepadManager.start();
  window.felixelGamepadManager = gamepadManager;

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
}

function forgetNativeController(controllerId) {
  nativeControllers.delete(controllerId);
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
    lastControllerConnectAt = performance.now();
    rememberNativeController(payload);
    console.info(`[Controller] Verbunden: ${describeNativeController(payload)}`);
    showToast(`Controller verbunden: ${describeNativeController(payload)}`);
    hideGamepadHint();
    document.body.classList.add('is-gamepad-mode');
    window.FelixelFocusManager?.ensureShelfFocus();
    return;
  }

  if (payload.type === 'disconnect') {
    console.info(`[Controller] Getrennt: ${describeNativeController(payload)}`);
    showToast(`Controller getrennt: ${describeNativeController(payload)}`);
    forgetNativeController(payload.id);
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

  const deadzone = window.GamepadUtils?.loadControllerSetupConfig?.().global?.deadzone ?? 0.35;
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
    case 'misc1':
    case 'misc2':
    case 'touchpad':
      return 'touchpad';
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
  if (controllerSetupActive()) {
    const sinceConnect = performance.now() - lastControllerConnectAt;
    if (action === 'back' && sinceConnect > CONTROLLER_SETUP_CLOSE_GRACE_MS) {
      window.closeControllerSetup();
      return;
    }
    if (action === 'confirm') {
      window.FelixelFocusManager?.confirm();
      return;
    }
    return;
  }

  switch (action) {
    case 'confirm':
      window.FelixelFocusManager?.confirm();
      break;
    case 'back':
      handleBackAction();
      break;
    case 'settings':
      window.openControllerSetup?.();
      break;
    case 'tabLeft':
      window.FelixelFocusManager?.switchTab('left');
      break;
    case 'tabRight':
      window.FelixelFocusManager?.switchTab('right');
      break;
    case 'touchpad':
      if (canEmitTouchpadAction()) {
        cycleDashboardView();
      }
      break;
    default:
      break;
  }
}

// ===== TAB NAVIGATION =====

const NAVIGABLE_TABS = ['recent', 'switch', 'wii'];

function moveFocus(direction) {
  window.FelixelFocusManager?.navigate(direction);
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
  if (controllerSetupActive()) {
    const sinceConnect = performance.now() - lastControllerConnectAt;
    if (sinceConnect > CONTROLLER_SETUP_CLOSE_GRACE_MS) {
      window.closeControllerSetup();
    }
    return;
  }

  const focusZone = window.FelixelFocusManager?.getZone();
  if (focusZone === 'topbar' || focusZone === 'categories') {
    window.FelixelFocusManager?.setZone('shelf');
    return;
  }

  const launchOverlay = document.getElementById('launchOverlay');
  if (launchOverlay?.classList.contains('visible')) {
    hideLaunchOverlay();
  }
}

function openSettings() {
  window.openControllerSetup?.();
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
