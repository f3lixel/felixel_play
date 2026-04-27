// ===== STATE =====

let allGames = [];
let currentFilter = 'all';
let currentHeroGame = null;
let heroToggle = false; // tracks which hero-bg layer is active

// ===== INIT =====

document.addEventListener('DOMContentLoaded', async () => {
  createParticles();
  setupNavbarScroll();
  setupFilterButtons();

  try {
    allGames = await window.api.readGames();
  } catch {
    allGames = [];
  }

  if (allGames.length > 0) {
    setHeroGame(allGames[0], true);
  }

  renderRows(allGames);

  setTimeout(() => {
    document.getElementById('loadingScreen').classList.add('hidden');
  }, 800);
});

// ===== HERO =====

function setHeroGame(game, immediate = false) {
  if (currentHeroGame?.id === game.id) return;
  currentHeroGame = game;

  const bg1 = document.getElementById('heroBg1');
  const bg2 = document.getElementById('heroBg2');
  const title = document.getElementById('heroTitle');
  const badge = document.getElementById('heroBadge');
  const playBtn = document.getElementById('heroPlayBtn');

  const coverUrl = game.heroArt || game.coverArt || '';
  const activeBg = heroToggle ? bg2 : bg1;
  const inactiveBg = heroToggle ? bg1 : bg2;

  activeBg.style.backgroundImage = `url('${coverUrl}')`;

  if (immediate) {
    activeBg.style.opacity = '1';
    inactiveBg.style.opacity = '0';
  } else {
    activeBg.style.opacity = '1';
    inactiveBg.style.opacity = '0';
  }

  heroToggle = !heroToggle;

  title.textContent = game.title;
  badge.textContent = game.platform === 'WiiU' ? 'Wii U' : game.platform;
  badge.className = `hero-platform-badge badge-${game.platform}`;

  playBtn.onclick = () => launchGame(game);
}

// ===== RENDER ROWS =====

function renderRows(games) {
  const container = document.getElementById('rowsContainer');
  container.innerHTML = '';

  if (games.length === 0) {
    container.innerHTML = `
      <div class="game-row">
        <h2 class="row-title">Keine Spiele gefunden</h2>
        <p style="color: var(--text-secondary); max-width: 560px;">
          Lege deine ROM-Dateien in roms/wii, roms/wiiu oder roms/switch ab.
          Danach erscheinen sie automatisch in felixel play.
        </p>
      </div>
    `;
    return;
  }

  const groups = groupByPlatform(games);
  const rowOrder = [
    { key: 'all', label: 'Alle Spiele' },
    { key: 'Wii', label: 'Wii' },
    { key: 'WiiU', label: 'Wii U' },
    { key: 'Switch', label: 'Nintendo Switch' },
  ];

  for (const { key, label } of rowOrder) {
    const rowGames = key === 'all' ? games : groups[key];
    if (!rowGames || rowGames.length === 0) continue;
    if (currentFilter !== 'all' && key !== currentFilter && key !== 'all') continue;
    if (currentFilter !== 'all' && key === 'all') continue;

    container.appendChild(createRow(label, rowGames));
  }
}

function groupByPlatform(games) {
  return games.reduce((acc, game) => {
    if (!acc[game.platform]) acc[game.platform] = [];
    acc[game.platform].push(game);
    return acc;
  }, {});
}

function createRow(title, games) {
  const row = document.createElement('div');
  row.className = 'game-row';

  const titleEl = document.createElement('h2');
  titleEl.className = 'row-title';
  titleEl.textContent = title;
  row.appendChild(titleEl);

  const wrapper = document.createElement('div');
  wrapper.className = 'row-slider-wrapper';

  const slider = document.createElement('div');
  slider.className = 'row-slider';

  for (const game of games) {
    slider.appendChild(createCard(game));
  }

  const arrowLeft = document.createElement('button');
  arrowLeft.className = 'row-arrow row-arrow-left';
  arrowLeft.innerHTML = '&#8249;';
  arrowLeft.onclick = () => scrollRow(slider, -1);

  const arrowRight = document.createElement('button');
  arrowRight.className = 'row-arrow row-arrow-right';
  arrowRight.innerHTML = '&#8250;';
  arrowRight.onclick = () => scrollRow(slider, 1);

  wrapper.appendChild(arrowLeft);
  wrapper.appendChild(slider);
  wrapper.appendChild(arrowRight);

  slider.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      slider.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  row.appendChild(wrapper);
  return row;
}

function scrollRow(slider, direction) {
  const scrollAmount = slider.clientWidth * 0.75;
  slider.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
}

// ===== GAME CARD =====

function createCard(game) {
  const card = document.createElement('div');
  card.className = 'game-card';

  const imageWrapper = document.createElement('div');
  imageWrapper.className = 'card-image-wrapper';

  const img = new Image();
  img.className = 'card-image';
  img.alt = game.title;
  if (game.coverArt) {
    img.src = game.coverArt;
  } else {
    img.style.display = 'none';
  }
  img.onerror = () => {
    img.style.display = 'none';
    const placeholder = document.createElement('div');
    placeholder.className = 'card-placeholder';
    placeholder.textContent = game.title;
    imageWrapper.insertBefore(placeholder, imageWrapper.firstChild);
  };
  imageWrapper.appendChild(img);

  if (!game.coverArt) {
    const placeholder = document.createElement('div');
    placeholder.className = 'card-placeholder';
    placeholder.textContent = game.title;
    imageWrapper.insertBefore(placeholder, imageWrapper.firstChild);
  }

  const overlay = document.createElement('div');
  overlay.className = 'card-info-overlay';

  const cardTitle = document.createElement('div');
  cardTitle.className = 'card-title';
  cardTitle.textContent = game.title;

  const cardBadge = document.createElement('span');
  cardBadge.className = `card-platform badge-${game.platform}`;
  cardBadge.textContent = game.platform === 'WiiU' ? 'Wii U' : game.platform;

  overlay.appendChild(cardTitle);
  overlay.appendChild(cardBadge);
  imageWrapper.appendChild(overlay);
  card.appendChild(imageWrapper);

  card.addEventListener('pointerenter', () => {
    setHeroGame(game);
    playHoverSound();
  });

  card.addEventListener('click', () => launchGame(game));

  return card;
}

// ===== LAUNCH GAME =====

async function launchGame(game) {
  try {
    const result = await window.api.launchGame(game.platform, game.romPath);
    if (result.success) {
      showToast(`${game.title} wird gestartet...`);
    } else {
      showToast(`Fehler: ${result.error}`, true);
    }
  } catch (err) {
    showToast(`Fehler: ${err.message}`, true);
  }
}

// ===== FILTERS =====

function setupFilterButtons() {
  const buttons = document.querySelectorAll('.filter-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderRows(allGames);
    });
  });
}

// ===== NAVBAR SCROLL =====

function setupNavbarScroll() {
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 50);
  });
}

// ===== HOVER SOUND =====

let audioCtx = null;

function playHoverSound() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.06);

  gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);

  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.12);
}

// ===== PARTICLES =====

function createParticles() {
  const container = document.getElementById('particles');
  const count = 25;

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 4 + 2;
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.left = `${Math.random() * 100}%`;
    p.style.animationDuration = `${Math.random() * 15 + 10}s`;
    p.style.animationDelay = `${Math.random() * 10}s`;
    container.appendChild(p);
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
