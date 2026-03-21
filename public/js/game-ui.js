// ── Lobby Background Animation ──────────────────────────────────────
const lobbyBg = document.getElementById('lobby-bg');
const lobbyCtx = lobbyBg.getContext('2d');
let lobbyActive = true;

// Lobby stars (separate from game stars)
const LOBBY_STAR_COUNT = 400;
const lobbyStars = [];
for (let i = 0; i < LOBBY_STAR_COUNT; i++) {
  lobbyStars.push({
    x: Math.random(),
    y: Math.random(),
    size: Math.random() < 0.8 ? 1 : (Math.random() < 0.9 ? 1.5 : 2),
    brightness: 0.2 + Math.random() * 0.8,
    twinkleSpeed: 0.3 + Math.random() * 1.5,
    hue: Math.random() < 0.7 ? 0 : (Math.random() < 0.5 ? 30 : 45),
  });
}

// Drifting particles (slow floating motes)
const LOBBY_MOTE_COUNT = 60;
const lobbyMotes = [];
for (let i = 0; i < LOBBY_MOTE_COUNT; i++) {
  lobbyMotes.push({
    x: Math.random(), y: Math.random(),
    vx: (Math.random() - 0.5) * 0.008,
    vy: -0.002 - Math.random() * 0.006,
    size: 1 + Math.random() * 2,
    alpha: 0.1 + Math.random() * 0.3,
    hue: 30 + Math.random() * 30,
  });
}

function resizeLobbyBg() {
  lobbyBg.width = window.innerWidth;
  lobbyBg.height = window.innerHeight;
}
resizeLobbyBg();
window.addEventListener('resize', () => { if (lobbyActive) resizeLobbyBg(); });

function renderLobby(now) {
  if (!lobbyActive) return;
  requestAnimationFrame(renderLobby);

  const W = lobbyBg.width, H = lobbyBg.height;
  const t = now / 1000;

  // Dark background with subtle warm gradient
  const bg = lobbyCtx.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.4, Math.max(W, H) * 0.7);
  bg.addColorStop(0, '#14100a');
  bg.addColorStop(1, '#080604');
  lobbyCtx.fillStyle = bg;
  lobbyCtx.fillRect(0, 0, W, H);

  // Nebula clouds — warm amber/earth tones
  const nebulae = [
    { x: 0.25, y: 0.3, r: 0.3, color: [60, 35, 10] },
    { x: 0.75, y: 0.6, r: 0.35, color: [50, 30, 8] },
    { x: 0.5, y: 0.15, r: 0.2, color: [40, 25, 10] },
    { x: 0.6, y: 0.8, r: 0.25, color: [55, 25, 5] },
  ];
  for (const n of nebulae) {
    const nx = n.x * W, ny = n.y * H;
    const nr = n.r * Math.max(W, H);
    const drift = Math.sin(t * 0.1 + n.x * 10) * 20;
    const grad = lobbyCtx.createRadialGradient(nx + drift, ny, 0, nx + drift, ny, nr);
    grad.addColorStop(0, `rgba(${n.color[0]}, ${n.color[1]}, ${n.color[2]}, 0.12)`);
    grad.addColorStop(0.5, `rgba(${n.color[0]}, ${n.color[1]}, ${n.color[2]}, 0.04)`);
    grad.addColorStop(1, `rgba(${n.color[0]}, ${n.color[1]}, ${n.color[2]}, 0)`);
    lobbyCtx.fillStyle = grad;
    lobbyCtx.fillRect(0, 0, W, H);
  }

  // Stars
  for (const star of lobbyStars) {
    const sx = star.x * W, sy = star.y * H;
    const twinkle = 0.5 + 0.5 * Math.sin(t * star.twinkleSpeed + star.x * 100);
    const a = star.brightness * twinkle;
    if (a < 0.05) continue;
    if (star.hue === 0) {
      lobbyCtx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(2)})`;
    } else {
      const r = star.hue === 30 ? 255 : 240;
      const g = star.hue === 30 ? 220 : 200;
      const b = star.hue === 30 ? 160 : 120;
      lobbyCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
    }
    lobbyCtx.fillRect(Math.floor(sx), Math.floor(sy), star.size, star.size);

    // Occasional spike on bright stars
    if (a > 0.85 && star.size >= 1.5) {
      lobbyCtx.fillStyle = `rgba(255, 255, 255, ${(a * 0.3).toFixed(2)})`;
      lobbyCtx.fillRect(Math.floor(sx) - 2, Math.floor(sy), 5, 1);
      lobbyCtx.fillRect(Math.floor(sx), Math.floor(sy) - 2, 1, 5);
    }
  }

  // Floating motes
  for (const m of lobbyMotes) {
    m.x += m.vx * 0.016;
    m.y += m.vy * 0.016;
    if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
    if (m.x < -0.05) m.x = 1.05;
    if (m.x > 1.05) m.x = -0.05;
    const pulse = 0.6 + 0.4 * Math.sin(t * 0.8 + m.x * 20);
    const a = m.alpha * pulse;
    lobbyCtx.fillStyle = `rgba(${Math.floor(180 + m.hue)}, ${Math.floor(120 + m.hue)}, ${Math.floor(40 + m.hue * 0.5)}, ${a.toFixed(2)})`;
    lobbyCtx.beginPath();
    lobbyCtx.arc(m.x * W, m.y * H, m.size, 0, Math.PI * 2);
    lobbyCtx.fill();
  }
}
requestAnimationFrame(renderLobby);

// Start lobby music on first interaction
let lobbyMusicStarted = false;
function startLobbyMusic() {
  if (lobbyMusicStarted) return;
  lobbyMusicStarted = true;
  startMusic();
}
document.getElementById('lobby').addEventListener('click', startLobbyMusic, { once: false });
document.getElementById('lobby').addEventListener('keydown', startLobbyMusic, { once: false });

// Lobby volume controls
const lobbyVolSlider = document.getElementById('lobby-vol-slider');
const lobbyMuteBtn = document.getElementById('lobby-mute-btn');
if (lobbyVolSlider) {
  lobbyVolSlider.value = musicVolume * 100;
  lobbyVolSlider.addEventListener('input', (e) => {
    startLobbyMusic();
    setMusicVolume(e.target.valueAsNumber / 100);
    if (musicMuted) toggleMusicMute();
  });
}
if (lobbyMuteBtn) {
  lobbyMuteBtn.addEventListener('click', () => {
    startLobbyMusic();
    toggleMusicMute();
  });
}
function syncLobbyVolUI() {
  if (lobbyMuteBtn) {
    lobbyMuteBtn.textContent = musicMuted ? '\u266C' : '\u266B';
    lobbyMuteBtn.style.opacity = musicMuted ? '0.4' : '1';
  }
  if (lobbyVolSlider) lobbyVolSlider.value = musicVolume * 100;
}
// Patch syncMusicUI to also update lobby controls
const _origSyncMusicUI = syncMusicUI;
syncMusicUI = function() {
  _origSyncMusicUI();
  syncLobbyVolUI();
};
syncLobbyVolUI();

// ── Input ───────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', (e) => {
  // Game over button clicks
  if (gameOver && e.button === 0) {
    const mx = e.clientX, my = e.clientY;
    if (gameOverBtns.again && mx >= gameOverBtns.again.x && mx <= gameOverBtns.again.x + gameOverBtns.again.w &&
        my >= gameOverBtns.again.y && my <= gameOverBtns.again.y + gameOverBtns.again.h) {
      returnToLobby();
      setTimeout(() => {
        if (room_wasAI) document.getElementById('btn-ai').click();
        else document.getElementById('btn-create').click();
      }, 100);
      return;
    }
    if (gameOverBtns.lobby && mx >= gameOverBtns.lobby.x && mx <= gameOverBtns.lobby.x + gameOverBtns.lobby.w &&
        my >= gameOverBtns.lobby.y && my <= gameOverBtns.lobby.y + gameOverBtns.lobby.h) {
      returnToLobby();
      return;
    }
    return;
  }
  if (!gameStarted || gameOver) return;
  if (heights.length === 0) return;

  // Minimap click — scroll camera
  if (e.button === 0 && isInMinimap(e.clientX, e.clientY)) {
    const { gx, gy } = minimapClickToGrid(e.clientX, e.clientY);
    centerCameraOnGrid(gx, gy);
    return;
  }

  // Inspect mode click
  if (inspectMode && e.button === 0) {
    performInspect(e.clientX, e.clientY);
    return;
  }

  // Magnet mode click
  if (magnetMode && e.button === 0) {
    const { px, py } = screenToGrid(e.clientX, e.clientY);
    sendMessage({ type: 'magnet', x: px, y: py });
    magnetMode = false;
    return;
  }

  // Power targeting click
  if (targetingPower && e.button === 0) {
    const { px, py } = screenToGrid(e.clientX, e.clientY);
    sendMessage({ type: 'power', power: targetingPower, x: px, y: py });
    targetingPower = null;
    updateCursor();
    return;
  }

  if (armageddon) return; // Only camera during armageddon

  if (e.shiftKey && e.button === 0) {
    const { px, py } = screenToGrid(e.clientX, e.clientY);
    sendMessage({ type: 'magnet', x: px, y: py });
    return;
  }
  if (e.button === 0) {
    const { px, py } = screenToGrid(e.clientX, e.clientY);
    sendMessage({ type: 'raise', px, py });
    playSfx('terrain');
  }
  if (e.button === 2) {
    const { px, py } = screenToGrid(e.clientX, e.clientY);
    sendMessage({ type: 'lower', px, py });
    playSfx('terrain');
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function activatePower(powerDef) {
  if (armageddon) return;
  if (myMana < powerDef.cost) return;
  magnetMode = false;
  inspectMode = false;
  inspectData = null;
  if (powerDef.targeted) {
    targetingPower = powerDef.id;
  } else {
    sendMessage({ type: 'power', power: powerDef.id });
  }
  updateCursor();
}

window.addEventListener('keydown', (e) => {
  if (!gameStarted) return;

  if (e.key === 'Escape') {
    targetingPower = null;
    inspectMode = false;
    inspectData = null;
    magnetMode = false;
    updateCursor();
    return;
  }

  if (e.key === 'G' && e.ctrlKey && e.shiftKey) {
    e.preventDefault();
    sendMessage({ type: 'godmode' });
    return;
  }
  if (e.key === 'g' || e.key === 'G') {
    gridMode = (gridMode + 1) % GRID_MODES.length;
  }
  if (e.key === 'h' || e.key === 'H') {
    toggleSetting('hiRes');
  }
  if (e.key === 'f' || e.key === 'F') {
    magnetMode = !magnetMode;
    if (magnetMode) { inspectMode = false; inspectData = null; targetingPower = null; }
    updateCursor();
    return;
  }
  if (e.key === 'i' || e.key === 'I') {
    inspectMode = !inspectMode;
    if (inspectMode) { magnetMode = false; targetingPower = null; }
    if (!inspectMode) inspectData = null;
    updateCursor();
    return;
  }
  if (e.key === 'm' || e.key === 'M') {
    toggleMusicMute();
    return;
  }

  // Power hotkeys
  const key = e.key.toUpperCase();
  const powerDef = POWERS.find(p => p.hotkey === key);
  if (powerDef) {
    activatePower(powerDef);
    return;
  }

  if (armageddon) return;
  if (e.key === '1') sendMessage({ type: 'mode', mode: 0 });
  if (e.key === '2') sendMessage({ type: 'mode', mode: 1 });
  if (e.key === '3') sendMessage({ type: 'mode', mode: 2 });
});

// Pan — middle mouse (purely local)
let panning = false, panSX, panSY, camSX, camSY;
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1) {
    panning = true;
    panSX = e.clientX; panSY = e.clientY;
    camSX = camX; camSY = camY;
    e.preventDefault();
  }
});
window.addEventListener('mousemove', (e) => {
  if (!panning) return;
  camX = camSX + (e.clientX - panSX);
  camY = camSY + (e.clientY - panSY);
  clampCamera();
});
window.addEventListener('mouseup', (e) => { if (e.button === 1) panning = false; });

// Zoom — mouse wheel toward cursor
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  updateViewport();
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  // Min zoom fits entire map diamond in usable viewport (excluding sidebar)
  const mapScreenW = localMapW * 2 * TILE_HALF_W;
  const mapScreenH = localMapH * 2 * TILE_HALF_H + MAX_HEIGHT * HEIGHT_STEP;
  const minZoom = Math.min(_vpW / mapScreenW, canvas.height / mapScreenH) * 0.9;
  const newZoom = Math.max(minZoom, Math.min(5, zoom * factor));
  const mx = e.clientX, my = e.clientY;
  const wx = (mx - _vpCX * (1 - zoom)) / zoom;
  const wy = (my - _vpCY * (1 - zoom)) / zoom;
  const sx = wx * newZoom + _vpCX * (1 - newZoom);
  const sy = wy * newZoom + _vpCY * (1 - newZoom);
  camX += (mx - sx) / newZoom;
  camY += (my - sy) / newZoom;
  zoom = newZoom;
  clampCamera();
}, { passive: false });

// Edge pan — move camera when cursor is near screen edges
const EDGE_SIZE = 30;
const EDGE_PAN_SPEED = 500;
let mouseX = 0, mouseY = 0;
window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});

// ── Lobby Handlers ──────────────────────────────────────────────────
document.getElementById('btn-create').addEventListener('click', () => {
  room_wasAI = false;
  const selPlayers = document.getElementById('sel-players');
  const selMapsize = document.getElementById('sel-mapsize');
  const selVis = document.getElementById('sel-visibility');
  const selTerrain = document.getElementById('sel-terrain');
  const maxPlayers = selPlayers ? parseInt(selPlayers.value) || 2 : 2;
  const mapSize = selMapsize ? selMapsize.value : 'small';
  const isPublic = selVis ? selVis.value === 'public' : true;
  const terrainType = selTerrain ? selTerrain.value : 'continental';
  const gameName = (document.getElementById('game-name').value || '').trim();
  room_lastMaxPlayers = maxPlayers;
  room_lastMapSize = mapSize;
  sendMessage({ type: 'create', maxPlayers, mapSize, terrainType, playerName: getPlayerName(), gameName, isPublic });
});

document.getElementById('btn-ai').addEventListener('click', () => {
  room_wasAI = true;
  const selPlayers = document.getElementById('sel-players');
  const selMapsize = document.getElementById('sel-mapsize');
  const selTerrain = document.getElementById('sel-terrain');
  const maxPlayers = selPlayers ? parseInt(selPlayers.value) || 2 : 2;
  const mapSize = selMapsize ? selMapsize.value : 'small';
  const terrainType = selTerrain ? selTerrain.value : 'continental';
  room_lastMaxPlayers = maxPlayers;
  room_lastMapSize = mapSize;
  sendMessage({ type: 'create_ai', maxPlayers, mapSize, terrainType, playerName: getPlayerName() });
});

document.getElementById('btn-join').addEventListener('click', () => {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (code.length !== 4) {
    document.getElementById('error-text').textContent = 'Enter a 4-letter room code';
    return;
  }
  sendMessage({ type: 'join', code, playerName: getPlayerName() });
});

// Allow pressing Enter in the join input
document.getElementById('join-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});

// Player name change handler
document.getElementById('player-name').addEventListener('change', () => {
  const name = getPlayerName();
  sendMessage({ type: 'set_name', name });
});

// Lobby tab switching
document.querySelectorAll('.lobby-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.lobby-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === target));
    document.querySelectorAll('.lobby-tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + target));
  });
});

// Add AI / Remove AI buttons
document.getElementById('btn-add-ai').addEventListener('click', () => {
  sendMessage({ type: 'add_ai' });
});
document.getElementById('btn-remove-ai').addEventListener('click', () => {
  sendMessage({ type: 'remove_ai' });
});
document.getElementById('btn-start-game').addEventListener('click', () => {
  sendMessage({ type: 'start_game' });
});

// Lobby chat handlers
document.getElementById('lobby-chat-send').addEventListener('click', () => {
  const input = document.getElementById('lobby-chat-input');
  const text = input.value.trim();
  if (!text) return;
  sendMessage({ type: 'lobby_chat', text });
  input.value = '';
});
document.getElementById('lobby-chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('lobby-chat-send').click();
});

// Room chat handlers
document.getElementById('room-chat-send').addEventListener('click', () => {
  const input = document.getElementById('room-chat-input');
  const text = input.value.trim();
  if (!text) return;
  sendMessage({ type: 'room_chat', text });
  input.value = '';
});
document.getElementById('room-chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('room-chat-send').click();
});

// Power bar button click handlers
document.querySelectorAll('.power-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const powerId = btn.dataset.power;
    const powerDef = POWERS.find(p => p.id === powerId);
    if (powerDef) activatePower(powerDef);
  });
});

// Sidebar: mode button click handlers
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!gameStarted || armageddon) return;
    const mode = parseInt(btn.dataset.mode);
    sendMessage({ type: 'mode', mode });
  });
});

// Sidebar: tool button click handlers
document.getElementById('btn-magnet').addEventListener('click', () => {
  if (!gameStarted || armageddon) return;
  magnetMode = !magnetMode;
  if (magnetMode) { inspectMode = false; inspectData = null; targetingPower = null; }
  updateCursor();
});
document.getElementById('btn-inspect').addEventListener('click', () => {
  if (!gameStarted) return;
  inspectMode = !inspectMode;
  if (inspectMode) { magnetMode = false; targetingPower = null; }
  if (!inspectMode) inspectData = null;
  updateCursor();
});

// ── Settings Panel ─────────────────────────────────────────────────
function toggleSetting(key) {
  switch (key) {
    case 'hiRes':
      settingHiRes = !settingHiRes;
      localStorage.setItem('settingHiRes', String(settingHiRes));
      landTileCache = null;
      waterFrames = null;
      break;
    case 'effects':
      settingEffects = !settingEffects;
      localStorage.setItem('settingEffects', String(settingEffects));
      break;
    case 'music':
      settingMusic = !settingMusic;
      localStorage.setItem('settingMusic', String(settingMusic));
      if (!settingMusic) {
        // Stop playback
        if (musicAudio) { musicAudio.pause(); musicAudio = null; }
        musicStarted = false;
      } else {
        startMusic();
      }
      break;
    case 'sfx':
      settingSfx = !settingSfx;
      localStorage.setItem('settingSfx', String(settingSfx));
      break;
    case 'lowZoomSimplify':
      settingLowZoomSimplify = !settingLowZoomSimplify;
      localStorage.setItem('settingLowZoomSimplify', String(settingLowZoomSimplify));
      break;
  }
  syncSettingsUI();
}

function syncSettingsUI() {
  const btns = document.querySelectorAll('.setting-btn');
  const vals = {
    hiRes: settingHiRes,
    effects: settingEffects,
    music: settingMusic,
    sfx: settingSfx,
    lowZoomSimplify: settingLowZoomSimplify,
  };
  for (const btn of btns) {
    const key = btn.dataset.setting;
    if (key in vals) btn.classList.toggle('on', vals[key]);
  }
  // Show/hide volume sliders based on settings
  const volRow = document.getElementById('music-vol-row');
  if (volRow) volRow.style.display = settingMusic ? 'flex' : 'none';
  const sfxRow = document.getElementById('sfx-vol-row');
  if (sfxRow) sfxRow.style.display = settingSfx ? 'flex' : 'none';
}

// Wire setting buttons
for (const btn of document.querySelectorAll('.setting-btn')) {
  btn.addEventListener('click', () => toggleSetting(btn.dataset.setting));
}

// Gear icon toggles settings popup
const settingsPopup = document.getElementById('settings-popup');
document.getElementById('btn-settings-gear').addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPopup.classList.toggle('visible');
});
// Close popup when clicking outside
window.addEventListener('mousedown', (e) => {
  if (settingsPopup.classList.contains('visible') &&
      !settingsPopup.contains(e.target) &&
      e.target.id !== 'btn-settings-gear') {
    settingsPopup.classList.remove('visible');
  }
});

syncSettingsUI();

// ── Guide Modal ─────────────────────────────────────────────────────
const guideOverlay = document.getElementById('guide-overlay');
const guideBody = document.getElementById('guide-body');
let guideLoaded = false;
let guideHtml = '';

function parseMarkdown(md) {
  // Simple markdown to HTML converter for the guide
  let html = '';
  const lines = md.split('\n');
  let inTable = false;
  let inList = false;
  let listType = '';

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Close list if we're no longer in one
    if (inList && !/^\s*[-*\d]/.test(line) && line.trim() !== '') {
      html += listType === 'ul' ? '</ul>' : '</ol>';
      inList = false;
    }

    // Table
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      // Check if separator row
      if (cells.every(c => /^[-:]+$/.test(c))) continue;
      if (!inTable) {
        html += '<table>';
        inTable = true;
        // First row is header
        html += '<tr>' + cells.map(c => '<th>' + inlineFormat(c) + '</th>').join('') + '</tr>';
        continue;
      }
      html += '<tr>' + cells.map(c => '<td>' + inlineFormat(c) + '</td>').join('') + '</tr>';
      continue;
    }
    if (inTable) { html += '</table>'; inTable = false; }

    // Headers
    if (line.startsWith('### ')) { html += '<h3>' + inlineFormat(line.slice(4)) + '</h3>'; continue; }
    if (line.startsWith('## ')) { html += '<h2>' + inlineFormat(line.slice(3)) + '</h2>'; continue; }
    if (line.startsWith('# ')) { html += '<h1>' + inlineFormat(line.slice(2)) + '</h1>'; continue; }

    // Unordered list
    if (/^[-*] /.test(line.trim())) {
      if (!inList || listType !== 'ul') {
        if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
        html += '<ul>';
        inList = true;
        listType = 'ul';
      }
      html += '<li>' + inlineFormat(line.trim().slice(2)) + '</li>';
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line.trim())) {
      if (!inList || listType !== 'ol') {
        if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
        html += '<ol>';
        inList = true;
        listType = 'ol';
      }
      html += '<li>' + inlineFormat(line.trim().replace(/^\d+\.\s/, '')) + '</li>';
      continue;
    }

    // Empty line
    if (line.trim() === '') continue;

    // Paragraph
    html += '<p>' + inlineFormat(line) + '</p>';
  }

  if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
  if (inTable) html += '</table>';
  return html;
}

function inlineFormat(text) {
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Code
  text = text.replace(/`(.+?)`/g, '<code>$1</code>');
  // Italic
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return text;
}

function openGuide() {
  if (!guideLoaded) {
    fetch('guide.md')
      .then(r => r.text())
      .then(md => {
        guideHtml = parseMarkdown(md);
        guideBody.innerHTML = guideHtml;
        guideLoaded = true;
      })
      .catch(() => {
        guideBody.innerHTML = '<p>Failed to load guide.</p>';
      });
  } else {
    guideBody.innerHTML = guideHtml;
  }
  guideOverlay.classList.add('visible');
}

function closeGuide() {
  guideOverlay.classList.remove('visible');
}

document.getElementById('guide-close').addEventListener('click', closeGuide);
guideOverlay.addEventListener('click', (e) => {
  if (e.target === guideOverlay) closeGuide();
});
document.getElementById('lobby-guide-btn').addEventListener('click', openGuide);
const sidebarGuideBtn = document.getElementById('sidebar-guide-btn');
if (sidebarGuideBtn) sidebarGuideBtn.addEventListener('click', openGuide);

// ── Minimap ─────────────────────────────────────────────────────────
const MM_SIZE = 200;
const MM_MARGIN = 10;

function getMMScale() {
  return MM_SIZE / Math.max(localMapW, localMapH);
}

function getMinimapRect() {
  return {
    x: canvas.width - MM_MARGIN - MM_SIZE,
    y: canvas.height - MM_MARGIN - MM_SIZE,
  };
}

function isInMinimap(sx, sy) {
  const mm = getMinimapRect();
  return sx >= mm.x && sx < mm.x + MM_SIZE && sy >= mm.y && sy < mm.y + MM_SIZE;
}

function minimapClickToGrid(sx, sy) {
  const mm = getMinimapRect();
  const mmScale = getMMScale();
  return {
    gx: (sx - mm.x) / mmScale,
    gy: (sy - mm.y) / mmScale,
  };
}

function centerCameraOnGrid(gx, gy) {
  const hx = Math.max(0, Math.min(localMapW, gx));
  const hy = Math.max(0, Math.min(localMapH, gy));
  const h = heightAt(hx, hy);
  camX = -(gx - gy) * TILE_HALF_W;
  camY = canvas.height / 2 - 80 - (gx + gy) * TILE_HALF_H + h * HEIGHT_STEP;
  clampCamera();
}

// Reverse-project screen point to grid coords ignoring height (for viewport outline)
function screenToGridFlat(sx, sy) {
  const wx = (sx - _vpCX * (1 - zoom)) / zoom;
  const wy = (sy - _vpCY * (1 - zoom)) / zoom;
  const o = getOrigin();
  const dx = wx - o.x, dy = wy - o.y;
  return {
    gx: (dx / TILE_HALF_W + dy / TILE_HALF_H) / 2,
    gy: (dy / TILE_HALF_H - dx / TILE_HALF_W) / 2,
  };
}

// Minimap offscreen cache — redrawn only when state changes
let minimapCanvas = null;
let minimapCtx = null;
let minimapDirty = true;

function ensureMinimapCanvas() {
  if (!minimapCanvas || minimapCanvas.width !== MM_SIZE || minimapCanvas.height !== MM_SIZE) {
    minimapCanvas = document.createElement('canvas');
    minimapCanvas.width = MM_SIZE;
    minimapCanvas.height = MM_SIZE;
    minimapCtx = minimapCanvas.getContext('2d');
    minimapDirty = true;
  }
}

function redrawMinimapContent() {
  const mc = minimapCtx;
  const mmScale = getMMScale();
  const cs = Math.ceil(mmScale);

  // Background
  mc.fillStyle = 'rgba(0, 0, 0, 1)';
  mc.fillRect(0, 0, MM_SIZE, MM_SIZE);

  // Pass 1: terrain + crops (single pass, skip fallen tiles)
  for (let ty = 0; ty < localMapH; ty++) {
    for (let tx = 0; tx < localMapW; tx++) {
      if (fallenTiles[ty * localMapW + tx]) continue;
      mc.fillStyle = getTileColor(tx, ty);
      mc.fillRect(tx * mmScale, ty * mmScale, cs, cs);
      const ct = cropTeamTiles[ty * localMapW + tx];
      if (ct) {
        mc.fillStyle = MINIMAP_CROP_COLORS[ct - 1] || MINIMAP_CROP_COLORS[0];
        mc.fillRect(tx * mmScale, ty * mmScale, cs, cs);
      }
    }
  }

  // Pass 2b: trees — iterate flat coord array
  mc.fillStyle = '#2a6a2a';
  for (let i = 0; i < treeCoords.length; i += 2) {
    mc.fillRect(treeCoords[i] * mmScale, treeCoords[i + 1] * mmScale, cs, cs);
  }

  // Pass 2c: swamps
  mc.fillStyle = '#3a5a1a';
  for (const s of swamps) {
    mc.fillRect(s.x * mmScale, s.y * mmScale, cs, cs);
  }

  // Pass 2d: pebbles — iterate flat coord array
  mc.fillStyle = '#8a7a6a';
  for (let i = 0; i < pebbleCoords.length; i += 2) {
    mc.fillRect(pebbleCoords[i] * mmScale, pebbleCoords[i + 1] * mmScale, cs, cs);
  }

  // Pass 2e: ruins
  mc.fillStyle = '#4a3a2a';
  for (const r of ruins) {
    mc.fillRect(r.x * mmScale, r.y * mmScale, cs, cs);
  }

  // Pass 3: settlements (team-colored squares sized to footprint)
  for (const s of settlements) {
    mc.fillStyle = TEAM_COLORS[s.t];
    const sz = Math.ceil(s.sz * mmScale);
    mc.fillRect(s.ox * mmScale, s.oy * mmScale, sz, sz);
  }

  // Pass 4: walkers (single bright pixels)
  for (const w of walkers) {
    mc.fillStyle = TEAM_COLORS[w.team];
    mc.fillRect(Math.floor(w.x * mmScale), Math.floor(w.y * mmScale), 1, 1);
  }

  // Pass 5: magnet flags (bright white dots) — loop all teams
  mc.fillStyle = '#fff';
  for (let t = 0; t < numTeams; t++) {
    if (t >= magnetPos.length) continue;
    const mp = magnetPos[t];
    if (!mp) continue;
    mc.fillRect(Math.floor(mp.x * mmScale) - 1, Math.floor(mp.y * mmScale) - 1, 3, 3);
  }

  minimapDirty = false;
}

function drawMinimap() {
  ensureMinimapCanvas();
  if (minimapDirty) redrawMinimapContent();

  const mm = getMinimapRect();
  const mmScale = getMMScale();

  // Blit cached minimap content
  ctx.drawImage(minimapCanvas, mm.x, mm.y);

  // Pass 6: viewport bounds (changes every frame with camera)
  ctx.save();
  ctx.beginPath();
  ctx.rect(mm.x, mm.y, MM_SIZE, MM_SIZE);
  ctx.clip();

  const corners = [
    screenToGridFlat(0, 0),
    screenToGridFlat(canvas.width, 0),
    screenToGridFlat(canvas.width, canvas.height),
    screenToGridFlat(0, canvas.height),
  ];
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const px = mm.x + corners[i].gx * mmScale;
    const py = mm.y + corners[i].gy * mmScale;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // Border
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.strokeRect(mm.x, mm.y, MM_SIZE, MM_SIZE);
}

// ── Power Bar ───────────────────────────────────────────────────────
function updatePowerBar() {
  const buttons = document.querySelectorAll('.power-btn');
  buttons.forEach(btn => {
    const powerId = btn.dataset.power;
    const power = POWERS.find(p => p.id === powerId);
    if (!power) return;
    const canAfford = myMana >= power.cost;
    const isActive = targetingPower === power.id;
    btn.classList.toggle('disabled', !canAfford || armageddon);
    btn.classList.toggle('active', isActive);
  });
}

// ── Inspect Tool ─────────────────────────────────────────────────────
function performInspect(sx, sy) {
  const { px, py } = screenToGrid(sx, sy);

  // Check settlements first — click must be within footprint
  for (const s of settlements) {
    const sz = (s.sz || 1);
    const ox = s.ox !== undefined ? s.ox : s.tx;
    const oy = s.oy !== undefined ? s.oy : s.ty;
    if (px >= ox && px < ox + sz && py >= oy && py < oy + sz) {
      const levelDef = SETTLEMENT_LEVELS ? SETTLEMENT_LEVELS[s.l] : null;
      inspectData = {
        type: 'settlement', stx: s.tx, sty: s.ty,
        team: s.t, level: s.l,
        name: levelDef ? levelDef.name : 'Level ' + s.l,
        pop: s.p, cap: LEVEL_CAPACITY[s.l] || 0,
        tech: levelDef ? levelDef.tech : 0,
        hasLeader: !!s.hl,
      };
      return;
    }
  }

  // Check walkers
  let closest = null, closestDist = 4;
  for (const w of walkers) {
    const dx = w.x - px, dy = w.y - py;
    const d = dx * dx + dy * dy;
    if (d < closestDist) { closestDist = d; closest = w; }
  }
  if (closest) {
    inspectData = {
      type: 'walker', walkerId: closest.id,
      team: closest.team, strength: closest.strength,
      isLeader: closest.isLeader, isKnight: closest.isKnight,
    };
    return;
  }

  inspectData = null;
}

function drawInspectTooltip() {
  const d = inspectData;
  if (!d) return;

  let anchorX, anchorY;
  if (d.type === 'walker') {
    const w = walkers.find(w => w.id === d.walkerId);
    if (!w) { inspectData = null; return; }
    d.strength = w.strength;
    d.isLeader = w.isLeader;
    d.isKnight = w.isKnight;
    d.team = w.team;
    const h = heightAt(w.x, w.y);
    const p = project(w.x, w.y, h);
    anchorX = p.x * zoom + _vpCX * (1 - zoom);
    anchorY = p.y * zoom + _vpCY * (1 - zoom);
  } else {
    // Settlement — find live data and recompute screen position
    const s = settlements.find(s => s.tx === d.stx && s.ty === d.sty);
    if (!s) { inspectData = null; return; }
    d.pop = s.p;
    d.team = s.t;
    d.level = s.l;
    const levelDef = SETTLEMENT_LEVELS ? SETTLEMENT_LEVELS[s.l] : null;
    d.name = levelDef ? levelDef.name : 'Level ' + s.l;
    d.cap = LEVEL_CAPACITY[s.l] || 0;
    d.tech = levelDef ? levelDef.tech : 0;
    d.hasLeader = !!s.hl;
    const h = heightAt(s.tx + 0.5, s.ty + 0.5);
    const p = project(s.tx + 0.5, s.ty + 0.5, h);
    anchorX = p.x * zoom + _vpCX * (1 - zoom);
    anchorY = p.y * zoom + _vpCY * (1 - zoom);
  }

  // Hide tooltip if subject is off screen
  if (anchorX < 0 || anchorX > canvas.width || anchorY < 0 || anchorY > canvas.height) return;

  const lines = [];
  if (d.type === 'settlement') {
    lines.push(d.name.charAt(0).toUpperCase() + d.name.slice(1) + ' (Lv' + d.level + ')');
    lines.push('Pop: ' + d.pop + ' / ' + d.cap);
    lines.push('Tech: ' + d.tech);
    lines.push('Team: ' + (teamPlayerNames[d.team] || TEAM_NAMES[d.team]));
    if (d.hasLeader) lines.push('Leader inside');
  } else {
    let label = 'Walker';
    if (d.isKnight) label = 'Knight';
    else if (d.isLeader) label = 'Leader';
    lines.push(label);
    lines.push('Strength: ' + d.strength);
    lines.push('Team: ' + (teamPlayerNames[d.team] || TEAM_NAMES[d.team]));
  }

  ctx.font = '11px monospace';
  const lineH = 15;
  const pad = 6;
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
  const tw = maxW + pad * 2;
  const th = lines.length * lineH + pad * 2;
  let tx, ty;
  tx = anchorX - tw / 2;
  ty = anchorY - th - 14;
  if (ty < 0) ty = anchorY + 14;
  if (tx + tw > canvas.width) tx = canvas.width - tw;
  if (tx < 0) tx = 0;
  if (ty < 0) ty = 0;
  if (ty + th > canvas.height) ty = canvas.height - th;

  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(tx, ty, tw, th);
  ctx.strokeStyle = TEAM_COLORS[d.team];
  ctx.lineWidth = 1;
  ctx.strokeRect(tx, ty, tw, th);
  ctx.fillStyle = '#ddd';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], tx + pad, ty + pad + (i + 1) * lineH - 3);
  }
}

// ── Performance Tracking ────────────────────────────────────────────
let perfFrames = 0;
let perfAccum = 0;
let perfRenderAccum = 0;
let perfFps = 0;
let perfFrameMs = 0;

function updatePerfCounter(dt, renderMs) {
  perfFrames++;
  perfAccum += dt;
  perfRenderAccum += renderMs;
  if (perfAccum >= 0.5) {
    perfFps = Math.round(perfFrames / perfAccum);
    perfFrameMs = (perfRenderAccum / perfFrames).toFixed(1);
    perfFrames = 0;
    perfAccum = 0;
    perfRenderAccum = 0;
    const elFps = document.getElementById('perf-fps');
    const elFrame = document.getElementById('perf-frame');
    if (elFps) elFps.textContent = perfFps;
    if (elFrame) elFrame.textContent = perfFrameMs;
  }
}

// ── Game Loop ───────────────────────────────────────────────────────
let lastFrame = 0;

function updateEdgePan(dt) {
  if (!gameStarted || panning) return;
  const w = canvas.width, h = canvas.height;
  let dx = 0, dy = 0;

  if (mouseX < _vpLeft) { /* skip left edge pan (behind sidebar) */ }
  else if (mouseX < _vpLeft + EDGE_SIZE) dx = 1 - (mouseX - _vpLeft) / EDGE_SIZE;
  else if (mouseX > w - EDGE_SIZE) dx = -((mouseX - (w - EDGE_SIZE)) / EDGE_SIZE);

  if (mouseY < EDGE_SIZE) dy = 1 - mouseY / EDGE_SIZE;
  else if (mouseY > h - EDGE_SIZE) dy = -((mouseY - (h - EDGE_SIZE)) / EDGE_SIZE);

  if (dx || dy) {
    const speed = EDGE_PAN_SPEED * dt;
    camX += dx * speed;
    camY += dy * speed;
    clampCamera();
  }
}

function gameLoop(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  updateEdgePan(dt);
  updateFireParticles(dt);
  updateLightningEffects(dt);
  updateMeteorEffects(dt);
  for (let i = earthquakeShakes.length - 1; i >= 0; i--) {
    earthquakeShakes[i].life -= dt;
    if (earthquakeShakes[i].life <= 0) earthquakeShakes.splice(i, 1);
  }
  if (settingEffects) {
    updateArmageddonEffects(dt);
    spawnWaterfallParticles(dt);
    updateWaterfallParticles(dt);
  }
  // Water frame animation
  if (texturesLoaded && (!waterFrames || waterFramesHiRes !== settingHiRes)) buildWaterFrames();
  waterFrameTimer += dt;
  if (waterFrameTimer >= WATER_FRAME_INTERVAL) {
    waterFrameTimer -= WATER_FRAME_INTERVAL;
    waterFrameCounter = (waterFrameCounter + 1) % WATER_FRAME_COUNT;
  }
  const t0 = performance.now();
  render();
  const renderMs = performance.now() - t0;
  updatePerfCounter(dt, renderMs);
  requestAnimationFrame(gameLoop);
}

// ── Resize ──────────────────────────────────────────────────────────
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  updateViewport();
}
window.addEventListener('resize', resize);
