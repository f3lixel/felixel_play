// Zentrale Controller-Button-Icons aus assets/icons/controller-icons/
(() => {
  const ICON_DIR = 'assets/icons/controller-icons/';

  const ICON_FILES = {
    cross: 'Cross.png',
    circle: 'Circle.png',
    square: 'Square.png',
    triangle: 'Triangle.png',
    dpad: 'D-Pad.png',
    'dpad-up': 'D-Pad Up.png',
    'dpad-down': 'D-Pad Down.png',
    'dpad-left': 'D-Pad Left.png',
    'dpad-right': 'D-Pad Right.png',
    l1: 'L1.png',
    r1: 'R1.png',
    l2: 'L2.png',
    r2: 'R2.png',
    home: 'Home.png',
    options: 'Options.png',
    create: 'Create.png',
    'touchpad-press': 'Touch Pad Press.png',
  };

  function iconUrl(key) {
    const file = ICON_FILES[key];
    if (!file) return '';
    return `${ICON_DIR}${encodeURI(file)}`;
  }

  function icon(key, options = {}) {
    const src = iconUrl(key);
    if (!src) return '';

    const className = options.className || 'ctrl-btn-icon';
    const sizeClass = options.sizeClass ? ` ${options.sizeClass}` : '';
    const height = options.height;

    let style = '';
    if (height) {
      style = ` style="height:${height};width:auto"`;
    }

    return `<img class="${className}${sizeClass}" src="${src}" alt="" aria-hidden="true"${style}>`;
  }

  function icons(keys, options = {}) {
    return keys.map((key) => icon(key, options)).join('');
  }

  function hintItem(iconKeys, label, options = {}) {
    const iconMarkup = Array.isArray(iconKeys)
      ? icons(iconKeys, options)
      : icon(iconKeys, options);

    return `<span class="ctrl-hint-item">${iconMarkup}<span class="ctrl-hint-label">${label}</span></span>`;
  }

  function hintRow(items) {
    return items.map((item) => hintItem(item.keys, item.label, item.options)).join('');
  }

  function startPromptHtml() {
    return `Press ${icon('cross', { className: 'ctrl-btn-icon ctrl-btn-icon--prompt' })} to start`;
  }

  function overlayNavigationHint() {
    return hintRow([
      { keys: ['dpad-up', 'dpad-down'], label: 'Navigieren', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
      { keys: 'cross', label: 'Bestätigen', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
    ]);
  }

  function focusHints(dashboardView = 'shelf') {
    const shelfHints = dashboardView === 'masonry'
      ? hintRow([
        { keys: ['dpad-up', 'dpad-down', 'dpad-left', 'dpad-right'], label: 'Navigieren', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
        { keys: 'touchpad-press', label: 'Ansicht', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
        { keys: 'cross', label: 'Starten', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
      ])
      : hintRow([
        { keys: ['dpad-left', 'dpad-right'], label: 'Navigieren', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
        { keys: 'touchpad-press', label: 'Ansicht', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
        { keys: 'cross', label: 'Starten', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
      ]);

    return {
      topbar: hintRow([
        { keys: ['dpad-left', 'dpad-right'], label: 'Navigieren', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
        { keys: 'cross', label: 'Auswählen', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
      ]),
      categories: hintRow([
        { keys: ['l1', 'r1'], label: 'Wechseln', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
        { keys: 'cross', label: 'Auswählen', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
      ]),
      shelf: shelfHints,
      modal: hintRow([
        { keys: ['dpad-up', 'dpad-down'], label: 'Navigieren', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
        { keys: 'cross', label: 'Bestätigen', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
        { keys: 'circle', label: 'Schließen', options: { className: 'ctrl-btn-icon ctrl-btn-icon--hint' } },
      ]),
    };
  }

  function applyDataIcons(root = document) {
    root.querySelectorAll('[data-controller-icon]').forEach((el) => {
      const key = el.getAttribute('data-controller-icon');
      const className = el.getAttribute('data-controller-icon-class') || 'ctrl-btn-icon';
      el.innerHTML = icon(key, { className });
    });
  }

  function initStaticHints() {
    const startPrompt = document.getElementById('startPrompt');
    if (startPrompt && !document.body.classList.contains('is-gamepad-mode')) {
      startPrompt.innerHTML = startPromptHtml();
    }

    const gameOverlayHint = document.getElementById('gameOverlayHint');
    if (gameOverlayHint) {
      gameOverlayHint.innerHTML = overlayNavigationHint();
    }

    applyDataIcons();
  }

  window.ControllerButtonIcons = {
    ICON_DIR,
    ICON_FILES,
    iconUrl,
    icon,
    icons,
    hintItem,
    hintRow,
    startPromptHtml,
    overlayNavigationHint,
    focusHints,
    applyDataIcons,
    initStaticHints,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStaticHints);
  } else {
    initStaticHints();
  }
})();
