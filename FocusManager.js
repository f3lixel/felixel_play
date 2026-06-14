// Zonenbasierter Fokus-Manager für vollständige Controller-Navigation.
// Zonen: topbar → categories → shelf (+ modal wenn Controller-Setup offen)

(() => {
  const ZONES = {
    TOPBAR: 'topbar',
    CATEGORIES: 'categories',
    SHELF: 'shelf',
    MODAL: 'modal',
  };

  const TOPBAR_IDS = ['btnActivities', 'btnControllerSetup', 'btnPower'];
  const NAVIGABLE_CATEGORIES = ['recent', 'switch', 'wii'];

  const MODAL_SIDEBAR_VIEWS = ['dashboard', 'connect'];

  const HINTS = {
    [ZONES.TOPBAR]: '✕ Öffnen  ·  ↓ Kategorien',
    [ZONES.CATEGORIES]: '↑ System  ·  ↓ Spiele  ·  ✕ Auswählen  ·  L1/R1 Wechseln',
    [ZONES.SHELF]: '✕ Starten  ·  ↑ Kategorien  ·  L1/R1 Wechseln',
    [ZONES.MODAL]: '↑↓ Navigieren  ·  ✕ Auswählen  ·  ○ Schließen',
  };

  let zone = ZONES.SHELF;
  let topbarIndex = 1;
  let categoryIndex = 0;
  let modalFocus = 'sidebar';
  let modalSidebarIndex = 0;

  const callbacks = {
    onShelfMove: null,
    onShelfConfirm: null,
    onCategorySelect: null,
    onTabSwitch: null,
    onTopBarAction: null,
    onPlayHoverSound: null,
    onHintChange: null,
    isModalOpen: () => false,
    getCategoryIndex: () => 0,
    getShelfCount: () => 0,
    hasShelfFocus: () => false,
  };

  function syncCategoryIndex() {
    const idx = callbacks.getCategoryIndex();
    if (idx >= 0) categoryIndex = idx;
  }

  function getTopBarButton(id) {
    return document.getElementById(id);
  }

  function getCategoryButtons() {
    return NAVIGABLE_CATEGORIES
      .map((cat) => document.querySelector(`.ps5-category[data-category="${cat}"]`))
      .filter(Boolean);
  }

  function getModalSidebarButtons() {
    return Array.from(document.querySelectorAll('[data-controller-view]'));
  }

  function clearNavFocus() {
    document.querySelectorAll('.is-nav-focused').forEach((el) => {
      el.classList.remove('is-nav-focused');
    });
  }

  function updateVisuals() {
    clearNavFocus();

    if (zone === ZONES.TOPBAR) {
      const id = TOPBAR_IDS[topbarIndex];
      getTopBarButton(id)?.classList.add('is-nav-focused');
    } else if (zone === ZONES.CATEGORIES) {
      const buttons = getCategoryButtons();
      buttons[categoryIndex]?.classList.add('is-nav-focused');
    } else if (zone === ZONES.MODAL) {
      if (modalFocus === 'sidebar') {
        const buttons = getModalSidebarButtons();
        buttons[modalSidebarIndex]?.classList.add('is-nav-focused');
      } else if (modalFocus === 'footer') {
        document.querySelector('.controller-modal__close-btn')?.classList.add('is-nav-focused');
      }
    }

    callbacks.onHintChange?.(HINTS[zone] || '');
  }

  function playSound() {
    callbacks.onPlayHoverSound?.();
  }

  function moveHorizontal(delta) {
    if (zone === ZONES.TOPBAR) {
      topbarIndex = (topbarIndex + delta + TOPBAR_IDS.length) % TOPBAR_IDS.length;
      playSound();
      updateVisuals();
      return;
    }

    if (zone === ZONES.CATEGORIES) {
      categoryIndex = (categoryIndex + delta + NAVIGABLE_CATEGORIES.length) % NAVIGABLE_CATEGORIES.length;
      playSound();
      updateVisuals();
      return;
    }

    if (zone === ZONES.SHELF) {
      const dir = delta < 0 ? 'left' : 'right';
      callbacks.onShelfMove?.(dir);
      return;
    }

    if (zone === ZONES.MODAL && modalFocus === 'sidebar') {
      const buttons = getModalSidebarButtons();
      if (buttons.length === 0) return;
      modalSidebarIndex = (modalSidebarIndex + delta + buttons.length) % buttons.length;
      playSound();
      updateVisuals();
    }
  }

  function moveVertical(delta) {
    if (zone === ZONES.SHELF && delta < 0) {
      zone = ZONES.CATEGORIES;
      syncCategoryIndex();
      playSound();
      updateVisuals();
      return;
    }

    if (zone === ZONES.CATEGORIES) {
      if (delta < 0) {
        zone = ZONES.TOPBAR;
        playSound();
        updateVisuals();
      } else {
        zone = ZONES.SHELF;
        callbacks.onShelfMove?.('restore');
        playSound();
        updateVisuals();
      }
      return;
    }

    if (zone === ZONES.TOPBAR && delta > 0) {
      zone = ZONES.CATEGORIES;
      syncCategoryIndex();
      playSound();
      updateVisuals();
      return;
    }

    if (zone === ZONES.MODAL) {
      if (modalFocus === 'sidebar' && delta > 0) {
        modalFocus = 'footer';
        playSound();
        updateVisuals();
      } else if (modalFocus === 'footer' && delta < 0) {
        modalFocus = 'sidebar';
        playSound();
        updateVisuals();
      } else if (modalFocus === 'sidebar') {
        modalSidebarIndex = (modalSidebarIndex + delta + MODAL_SIDEBAR_VIEWS.length) % MODAL_SIDEBAR_VIEWS.length;
        playSound();
        updateVisuals();
      }
    }
  }

  function navigate(direction) {
    if (callbacks.isModalOpen()) {
      zone = ZONES.MODAL;
    } else if (zone === ZONES.MODAL) {
      zone = ZONES.SHELF;
    }

    switch (direction) {
      case 'left':
        moveHorizontal(-1);
        break;
      case 'right':
        moveHorizontal(1);
        break;
      case 'up':
        moveVertical(-1);
        break;
      case 'down':
        moveVertical(1);
        break;
      default:
        break;
    }
  }

  function confirm() {
    if (zone === ZONES.MODAL || callbacks.isModalOpen()) {
      if (modalFocus === 'footer') {
        document.querySelector('.controller-modal__close-btn')?.click();
        return;
      }
      const buttons = getModalSidebarButtons();
      const btn = buttons[modalSidebarIndex];
      if (btn) btn.click();
      return;
    }

    if (zone === ZONES.TOPBAR) {
      const id = TOPBAR_IDS[topbarIndex];
      callbacks.onTopBarAction?.(id);
      return;
    }

    if (zone === ZONES.CATEGORIES) {
      const category = NAVIGABLE_CATEGORIES[categoryIndex];
      callbacks.onCategorySelect?.(category);
      zone = ZONES.SHELF;
      updateVisuals();
      return;
    }

    if (zone === ZONES.SHELF) {
      callbacks.onShelfConfirm?.();
    }
  }

  function switchTab(direction) {
    if (callbacks.isModalOpen()) return;

    if (zone !== ZONES.CATEGORIES) {
      zone = ZONES.CATEGORIES;
      syncCategoryIndex();
    }

    const delta = direction === 'left' ? -1 : 1;
    categoryIndex = (categoryIndex + delta + NAVIGABLE_CATEGORIES.length) % NAVIGABLE_CATEGORIES.length;
    playSound();
    updateVisuals();

    const category = NAVIGABLE_CATEGORIES[categoryIndex];
    callbacks.onCategorySelect?.(category);
    zone = ZONES.SHELF;
    updateVisuals();
  }

  function onModalOpen() {
    zone = ZONES.MODAL;
    modalFocus = 'sidebar';
    modalSidebarIndex = 0;
    clearNavFocus();
    updateVisuals();
  }

  function onModalClose() {
    zone = ZONES.SHELF;
    modalFocus = 'sidebar';
    clearNavFocus();
    updateVisuals();
  }

  function ensureShelfFocus() {
    if (callbacks.isModalOpen()) return;
    if (zone === ZONES.MODAL) {
      zone = ZONES.SHELF;
    }
    if (callbacks.getShelfCount() > 0 && zone === ZONES.SHELF) {
      callbacks.onShelfMove?.('restore');
    }
    updateVisuals();
  }

  function setZone(nextZone) {
    if (Object.values(ZONES).includes(nextZone)) {
      zone = nextZone;
      updateVisuals();
    }
  }

  function getZone() {
    return zone;
  }

  function init(options = {}) {
    Object.assign(callbacks, options);
    syncCategoryIndex();
    updateVisuals();
  }

  function refresh() {
    syncCategoryIndex();
    updateVisuals();
  }

  window.FelixelFocusManager = {
    ZONES,
    init,
    navigate,
    confirm,
    switchTab,
    onModalOpen,
    onModalClose,
    ensureShelfFocus,
    setZone,
    getZone,
    refresh,
    NAVIGABLE_CATEGORIES,
  };
})();
