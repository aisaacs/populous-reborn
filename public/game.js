'use strict';

// ── Client-only Constants ───────────────────────────────────────────
// Shared constants (MAP_W, MAP_H, etc.) loaded via <script> from /shared/constants.js
const WATER_COLOR = '#2244aa';
const TERRAIN_COLORS = {
  1: '#2a7a2a', 2: '#2a7a2a',
  3: '#44aa44', 4: '#44aa44',
  5: '#66bb33', 6: '#66bb33',
  7: '#887755', 8: '#887755',
};
const SLOPE_DARKEN = 20;
const GRID_MODES = [null, 'rgba(0,0,0,0.15)', 'rgba(255,255,255,0.25)'];
let gridMode = 2;

// ── Terrain Textures ────────────────────────────────────────────────
const TEX_NAMES = ['grass', 'rock', 'water', 'sand', 'snow', 'swamp'];
const terrainTextures = {};
let texturesLoaded = false;
let textureOpacity = parseFloat(localStorage.getItem('texOpacity') ?? '0.4');

(function loadTextures() {
  let count = 0;
  for (const name of TEX_NAMES) {
    const img = new Image();
    img.src = 'gfx/' + name + '.jpg';
    img.onload = () => { if (++count === TEX_NAMES.length) texturesLoaded = true; };
    terrainTextures[name] = img;
  }
})();

function getTileTexture(tx, ty) {
  if (swampSet.has(tx + ',' + ty)) return terrainTextures.swamp;

  const t = heights[tx][ty], r = heights[tx + 1][ty];
  const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];

  if (t <= seaLevel && r <= seaLevel && b <= seaLevel && l <= seaLevel) {
    return terrainTextures.water;
  }

  const avg = (t + r + b + l) / 4;
  if (avg <= 1) return terrainTextures.sand;
  if (avg <= 5) return terrainTextures.grass;
  if (avg <= 7) return terrainTextures.rock;
  return terrainTextures.snow;
}

// ── Settlement Sprites ──────────────────────────────────────────────
const SETT_LEVEL_NAMES = ['tent', 'hut', 'house', 'manor', 'castle'];
const settlementSprites = {};
let settlementSpritesLoaded = false;

(function loadSettlementSprites() {
  let count = 0;
  const total = SETT_LEVEL_NAMES.length * 2;
  for (const name of SETT_LEVEL_NAMES) {
    for (const team of ['blue', 'red']) {
      const key = name + '-' + team;
      const img = new Image();
      img.src = 'gfx/' + key + '.png';
      img.onload = () => { if (++count === total) settlementSpritesLoaded = true; };
      settlementSprites[key] = img;
    }
  }
})();

// ── Boulder Sprite ──────────────────────────────────────────────────
const boulderImg = new Image();
let boulderLoaded = false;
boulderImg.src = 'gfx/boulders.png';
boulderImg.onload = () => { boulderLoaded = true; };

// ── Music System ───────────────────────────────────────────────────
const MUSIC_TRACKS = ['music/001.mp3', 'music/002.mp3', 'music/003.mp3'];
let musicQueue = [];
let musicAudio = null;
let musicMuted = localStorage.getItem('musicMuted') === 'true';
let musicVolume = parseFloat(localStorage.getItem('musicVolume') ?? '0.3');
let musicStarted = false;

function shuffleTracks() {
  musicQueue = MUSIC_TRACKS.slice();
  for (let i = musicQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [musicQueue[i], musicQueue[j]] = [musicQueue[j], musicQueue[i]];
  }
}

function playNextTrack() {
  if (musicQueue.length === 0) shuffleTracks();
  const src = musicQueue.shift();
  musicAudio = new Audio(src);
  musicAudio.volume = musicMuted ? 0 : musicVolume;
  musicAudio.addEventListener('ended', playNextTrack);
  musicAudio.play().catch(() => {});
}

function startMusic() {
  if (musicStarted) return;
  musicStarted = true;
  shuffleTracks();
  playNextTrack();
  syncMusicUI();
}

function setMusicVolume(v) {
  musicVolume = Math.max(0, Math.min(1, v));
  localStorage.setItem('musicVolume', String(musicVolume));
  if (musicAudio) musicAudio.volume = musicMuted ? 0 : musicVolume;
  syncMusicUI();
}

function toggleMusicMute() {
  musicMuted = !musicMuted;
  localStorage.setItem('musicMuted', String(musicMuted));
  if (musicAudio) musicAudio.volume = musicMuted ? 0 : musicVolume;
  syncMusicUI();
}

function syncMusicUI() {
  const btn = document.getElementById('btn-mute');
  if (btn) btn.textContent = musicMuted ? '\u266C' : '\u266B';
  if (btn) btn.style.opacity = musicMuted ? '0.4' : '1';
  const slider = document.getElementById('music-vol');
  if (slider) slider.value = musicVolume * 100;
}

// Volume slider
document.getElementById('music-vol').addEventListener('input', (e) => {
  setMusicVolume(e.target.valueAsNumber / 100);
  if (musicMuted) toggleMusicMute();
});

// Mute button
document.getElementById('btn-mute').addEventListener('click', () => {
  if (!musicStarted) startMusic();
  else toggleMusicMute();
});

// Texture opacity slider
document.getElementById('tex-opacity').addEventListener('input', (e) => {
  textureOpacity = e.target.valueAsNumber / 100;
  localStorage.setItem('texOpacity', String(textureOpacity));
});
document.getElementById('tex-opacity').value = textureOpacity * 100;

// Init UI from saved prefs
syncMusicUI();

// ── Game State (received from server) ───────────────────────────────
let heights = [];
let walkers = [];
let settlements = [];
let magnetPos = [{ x: 10, y: 10 }, { x: 50, y: 50 }];
let teamMode = [MODE_SETTLE, MODE_SETTLE];
let myMana = 0;
let myTeam = -1;
let walkerGrid = new Array(MAP_W * MAP_H);

// Power system state
let swamps = [];
let swampSet = new Set();
let rocks = new Set();
let seaLevel = SEA_LEVEL;
let leaders = [-1, -1];
let armageddon = false;
let targetingPower = null;

// ── Walker Interpolation ────────────────────────────────────────────
let prevWalkers = [];
let currWalkers = [];
let lastTickTime = 0;

function getInterpolatedWalkers() {
  if (prevWalkers.length === 0) return currWalkers;

  const now = performance.now();
  const elapsed = now - lastTickTime;
  const fraction = Math.min(1, elapsed / TICK_INTERVAL);

  // Build lookup for prev walkers by id
  const prevMap = new Map();
  for (const w of prevWalkers) prevMap.set(w.id, w);

  const result = [];
  for (const w of currWalkers) {
    const pw = prevMap.get(w.id);
    if (pw) {
      result.push({
        id: w.id,
        team: w.t,
        strength: w.s,
        x: pw.x + (w.x - pw.x) * fraction,
        y: pw.y + (w.y - pw.y) * fraction,
        isLeader: w.l,
        isKnight: w.k,
      });
    } else {
      result.push({
        id: w.id,
        team: w.t,
        strength: w.s,
        x: w.x,
        y: w.y,
        isLeader: w.l,
        isKnight: w.k,
      });
    }
  }
  return result;
}

// ── Canvas ──────────────────────────────────────────────────────────
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let camX = 0, camY = 0;
let zoom = 2;

function getOrigin() {
  return {
    x: Math.floor(canvas.width / 2) + camX,
    y: 80 + camY,
  };
}

// Clamp camera so viewport edges never scroll past the map edges.
// The map diamond's bounding box in world space (relative to origin) is:
//   left:   -MAP_H * TILE_HALF_W   (vertex 0,MAP_H)
//   right:   MAP_W * TILE_HALF_W   (vertex MAP_W,0)
//   top:    -MAX_HEIGHT * HEIGHT_STEP (vertex 0,0 at max height)
//   bottom: (MAP_W+MAP_H) * TILE_HALF_H (vertex MAP_W,MAP_H)
// We require viewport edges to stay inside this box.
function clampCamera() {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const hvw = cx / zoom; // half viewport width in world space
  const hvh = cy / zoom; // half viewport height in world space

  const pad = 48; // pixels of slack around the map
  const mapL = -MAP_H * TILE_HALF_W - pad;
  const mapR =  MAP_W * TILE_HALF_W + pad;
  const mapT = -MAX_HEIGHT * HEIGHT_STEP - pad;
  const mapB = (MAP_W + MAP_H) * TILE_HALF_H + pad;

  // Viewport in world: [cx - hvw, cx + hvw] x [cy - hvh, cy + hvh]
  // Map in world: [cx + camX + mapL, cx + camX + mapR] x [80 + camY + mapT, 80 + camY + mapB]
  // Constraints: viewport left >= map left, viewport right <= map right, etc.
  const minCamX = hvw - mapR;
  const maxCamX = -mapL - hvw;
  const minCamY = cy + hvh - 80 - mapB;
  const maxCamY = cy - hvh - 80 - mapT;

  if (minCamX <= maxCamX) {
    camX = Math.max(minCamX, Math.min(maxCamX, camX));
  } else {
    camX = (minCamX + maxCamX) / 2; // map fits in viewport — center it
  }

  if (minCamY <= maxCamY) {
    camY = Math.max(minCamY, Math.min(maxCamY, camY));
  } else {
    camY = (minCamY + maxCamY) / 2;
  }
}

// ── Projection ──────────────────────────────────────────────────────
function project(px, py, h) {
  const o = getOrigin();
  return {
    x: o.x + (px - py) * TILE_HALF_W,
    y: o.y + (px + py) * TILE_HALF_H - h * HEIGHT_STEP,
  };
}

// ── Color ───────────────────────────────────────────────────────────
function darkenColor(hex, amt) {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amt);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amt);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amt);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function getTileColor(tx, ty) {
  const t = heights[tx][ty], r = heights[tx + 1][ty];
  const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];

  if (t <= seaLevel && r <= seaLevel && b <= seaLevel && l <= seaLevel) {
    return WATER_COLOR;
  }

  const avg = (t + r + b + l) / 4;
  const idx = Math.max(1, Math.min(MAX_HEIGHT, Math.round(avg)));
  const base = TERRAIN_COLORS[idx];
  const isFlat = (t === r && r === b && b === l);
  return isFlat ? base : darkenColor(base, SLOPE_DARKEN);
}

function getSettlementDiamondColor(team, level) {
  const base = TEAM_COLORS[team];
  const brighten = level * 4;
  const r = Math.min(255, parseInt(base.slice(1, 3), 16) + brighten);
  const g = Math.min(255, parseInt(base.slice(3, 5), 16) + brighten);
  const b = Math.min(255, parseInt(base.slice(5, 7), 16) + brighten);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// ── Height Interpolation (for rendering) ────────────────────────────
function heightAt(fx, fy) {
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const cx = Math.max(0, Math.min(MAP_W, ix));
  const cy = Math.max(0, Math.min(MAP_H, iy));
  const cx1 = Math.min(MAP_W, cx + 1);
  const cy1 = Math.min(MAP_H, cy + 1);
  const fx2 = fx - ix, fy2 = fy - iy;
  const h00 = heights[cx][cy], h10 = heights[cx1][cy];
  const h01 = heights[cx][cy1], h11 = heights[cx1][cy1];
  return h00 * (1 - fx2) * (1 - fy2) + h10 * fx2 * (1 - fy2) +
         h01 * (1 - fx2) * fy2 + h11 * fx2 * fy2;
}

// ── Drawing ─────────────────────────────────────────────────────────
function drawTile(tx, ty) {
  const t = heights[tx][ty], r = heights[tx + 1][ty];
  const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];

  const isWater = (t <= seaLevel && r <= seaLevel && b <= seaLevel && l <= seaLevel);

  const pTop    = project(tx,     ty,     isWater ? 0 : t);
  const pRight  = project(tx + 1, ty,     isWater ? 0 : r);
  const pBottom = project(tx + 1, ty + 1, isWater ? 0 : b);
  const pLeft   = project(tx,     ty + 1, isWater ? 0 : l);

  ctx.beginPath();
  ctx.moveTo(pTop.x, pTop.y);
  ctx.lineTo(pRight.x, pRight.y);
  ctx.lineTo(pBottom.x, pBottom.y);
  ctx.lineTo(pLeft.x, pLeft.y);
  ctx.closePath();
  ctx.fillStyle = getTileColor(tx, ty);
  ctx.fill();

  // Texture overlay — split into 2 triangles for correct projection on slopes
  if (texturesLoaded && textureOpacity > 0) {
    const tex = getTileTexture(tx, ty);
    const iw = tex.width, ih = tex.height;
    const hcx = canvas.width / 2;
    const hcy = canvas.height / 2;
    const zox = hcx * (1 - zoom), zoy = hcy * (1 - zoom);

    // Triangle 1: Top → Right → Bottom
    // Maps image (0,0)→pTop, (iw,0)→pRight, (iw,ih)→pBottom
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pTop.x, pTop.y);
    ctx.lineTo(pRight.x, pRight.y);
    ctx.lineTo(pBottom.x, pBottom.y);
    ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = textureOpacity;
    ctx.setTransform(
      zoom * (pRight.x - pTop.x) / iw,
      zoom * (pRight.y - pTop.y) / iw,
      zoom * (pBottom.x - pRight.x) / ih,
      zoom * (pBottom.y - pRight.y) / ih,
      zoom * pTop.x + zox,
      zoom * pTop.y + zoy
    );
    ctx.drawImage(tex, 0, 0);
    ctx.restore();

    // Triangle 2: Top → Bottom → Left
    // Maps image (0,0)→pTop, (iw,ih)→pBottom, (0,ih)→pLeft
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pTop.x, pTop.y);
    ctx.lineTo(pBottom.x, pBottom.y);
    ctx.lineTo(pLeft.x, pLeft.y);
    ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = textureOpacity;
    ctx.setTransform(
      zoom * (pBottom.x - pLeft.x) / iw,
      zoom * (pBottom.y - pLeft.y) / iw,
      zoom * (pLeft.x - pTop.x) / ih,
      zoom * (pLeft.y - pTop.y) / ih,
      zoom * pTop.x + zox,
      zoom * pTop.y + zoy
    );
    ctx.drawImage(tex, 0, 0);
    ctx.restore();

    // Rebuild diamond path (destroyed by clip's beginPath)
    ctx.beginPath();
    ctx.moveTo(pTop.x, pTop.y);
    ctx.lineTo(pRight.x, pRight.y);
    ctx.lineTo(pBottom.x, pBottom.y);
    ctx.lineTo(pLeft.x, pLeft.y);
    ctx.closePath();
  }

  // Swamp overlay
  if (swampSet.has(tx + ',' + ty)) {
    ctx.fillStyle = 'rgba(80, 100, 30, 0.5)';
    ctx.fill();
  }

  if (GRID_MODES[gridMode]) {
    ctx.strokeStyle = GRID_MODES[gridMode];
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Boulder sprite on rock tiles
  if (rocks.has(tx + ',' + ty) && boulderLoaded) {
    const midX = (pTop.x + pBottom.x) / 2;
    const midY = (pTop.y + pBottom.y) / 2;
    const tileW = (pRight.x - pLeft.x);
    const scale = tileW * 0.7 / boulderImg.width;
    const sw = boulderImg.width * scale;
    const sh = boulderImg.height * scale;
    ctx.drawImage(boulderImg, midX - sw / 2, midY - sh * 0.75, sw, sh);
  }
}

function rebuildWalkerGrid() {
  for (let i = 0; i < MAP_W * MAP_H; i++) walkerGrid[i] = null;
  for (let i = 0; i < walkers.length; i++) {
    const w = walkers[i];
    const tx = Math.floor(w.x), ty = Math.floor(w.y);
    if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) continue;
    const key = ty * MAP_W + tx;
    if (!walkerGrid[key]) walkerGrid[key] = [];
    walkerGrid[key].push(w);
  }
}

function drawWalker(w) {
  const h = heightAt(w.x, w.y);
  const p = project(w.x, w.y, h);
  const isKnight = w.isKnight;
  const isLeader = w.isLeader;
  const radius = isKnight ? 4 + Math.min(3, Math.floor(w.strength / 50)) : 2 + Math.min(3, Math.floor(w.strength / 50));
  ctx.beginPath();
  ctx.arc(p.x, p.y - 3, radius, 0, Math.PI * 2);
  ctx.fillStyle = TEAM_COLORS[w.team];
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Leader: gold crown
  if (isLeader) {
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.moveTo(p.x - 4, p.y - 8);
    ctx.lineTo(p.x - 3, p.y - 12);
    ctx.lineTo(p.x - 1, p.y - 9);
    ctx.lineTo(p.x, p.y - 13);
    ctx.lineTo(p.x + 1, p.y - 9);
    ctx.lineTo(p.x + 3, p.y - 12);
    ctx.lineTo(p.x + 4, p.y - 8);
    ctx.closePath();
    ctx.fill();
  }

  // Knight: white cross
  if (isKnight) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 10);
    ctx.lineTo(p.x, p.y - 15);
    ctx.moveTo(p.x - 2.5, p.y - 13);
    ctx.lineTo(p.x + 2.5, p.y - 13);
    ctx.stroke();
  }
}

function drawSettlement(s) {
  const h = heights[s.tx][s.ty];

  // Colored diamond (covering area) at 50% opacity — always drawn
  const cx = s.ox + s.sz * 0.5;
  const cy = s.oy + s.sz * 0.5;
  const he = s.sz * 0.5;

  const pTop    = project(cx - he, cy - he, h);
  const pRight  = project(cx + he, cy - he, h);
  const pBottom = project(cx + he, cy + he, h);
  const pLeft   = project(cx - he, cy + he, h);

  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.moveTo(pTop.x, pTop.y);
  ctx.lineTo(pRight.x, pRight.y);
  ctx.lineTo(pBottom.x, pBottom.y);
  ctx.lineTo(pLeft.x, pLeft.y);
  ctx.closePath();

  ctx.fillStyle = getSettlementDiamondColor(s.t, s.l);
  ctx.fill();

  ctx.strokeStyle = darkenColor(TEAM_COLORS[s.t], 40);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Sprite on top, sized to 50% of the footprint
  if (settlementSpritesLoaded && s.l >= 1 && s.l <= 5) {
    const team = s.t === TEAM_BLUE ? 'blue' : 'red';
    const key = SETT_LEVEL_NAMES[s.l - 1] + '-' + team;
    const img = settlementSprites[key];
    if (img && img.complete) {
      const he2 = s.sz * 0.5 * 0.5;
      const pSprTop = project(cx - he2, cy - he2, h);
      const pSprBot = project(cx + he2, cy + he2, h);
      const scale = (pSprBot.y - pSprTop.y) / (img.height / 2);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, pSprTop.x - dw / 2, pSprTop.y - dh / 2, dw, dh);
    }
  }
}

function drawMagnetFlag(team) {
  const mp = magnetPos[team];
  const h = heightAt(mp.x, mp.y);
  const p = project(mp.x, mp.y, h);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x, p.y - 16);
  ctx.stroke();
  ctx.fillStyle = TEAM_COLORS[team];
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 16);
  ctx.lineTo(p.x + 8, p.y - 13);
  ctx.lineTo(p.x, p.y - 10);
  ctx.closePath();
  ctx.fill();
}

function getTeamStats(team) {
  let pop = 0, set = 0, walk = 0;
  for (const s of settlements) {
    if (s.t !== team) continue;
    pop += s.p;
    set++;
  }
  for (const w of walkers) {
    if (w.team !== team) continue;
    walk++;
    pop += w.strength;
  }
  return { pop, set, walk };
}

function drawUI() {
  const margin = 10;
  const barW = 120, barH = 10;
  ctx.font = '12px monospace';

  const otherTeam = myTeam === 0 ? 1 : 0;

  // My team stats — bottom left
  const myStats = getTeamStats(myTeam);
  const myLabel = TEAM_NAMES[myTeam] + ' (You)';
  ctx.fillStyle = TEAM_COLORS[myTeam];
  ctx.fillText(`${myLabel}: ${MODE_NAMES[teamMode[myTeam]]}`, margin, canvas.height - 70);
  ctx.fillText(`Pop: ${myStats.pop}  Set: ${myStats.set}  Walk: ${myStats.walk}`, margin, canvas.height - 55);
  // Mana bar
  ctx.fillStyle = '#333';
  ctx.fillRect(margin, canvas.height - 40, barW, barH);
  ctx.fillStyle = TEAM_COLORS[myTeam];
  ctx.fillRect(margin, canvas.height - 40, barW * Math.min(1, myMana / 1000), barH);
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.strokeRect(margin, canvas.height - 40, barW, barH);
  ctx.fillStyle = '#ccc';
  ctx.fillText(`Mana: ${Math.floor(myMana)}`, margin, canvas.height - 15);

  // Opponent stats — bottom right (no mana bar)
  const oppStats = getTeamStats(otherTeam);
  const rx = canvas.width - margin - barW;
  ctx.fillStyle = TEAM_COLORS[otherTeam];
  ctx.fillText(`${TEAM_NAMES[otherTeam]}: ${MODE_NAMES[teamMode[otherTeam]]}`, rx, canvas.height - 70);
  ctx.fillText(`Pop: ${oppStats.pop}  Set: ${oppStats.set}  Walk: ${oppStats.walk}`, rx, canvas.height - 55);
}

function centerOnHome() {
  const home = myTeam === 0 ? { x: 10, y: 10 } : { x: 50, y: 50 };
  // Set camera so home tile projects to screen center (before zoom, since zoom is around center)
  // project(hx,hy,h) = (origin.x + (hx-hy)*THW, origin.y + (hx+hy)*THH - h*HS)
  // origin = (canvas.width/2 + camX, 80 + camY)
  // We want projected point = screen center = (canvas.width/2, canvas.height/2)
  const h = 3; // approximate land height
  camX = -(home.x - home.y) * TILE_HALF_W;
  camY = canvas.height / 2 - 80 - (home.x + home.y) * TILE_HALF_H + h * HEIGHT_STEP;
  clampCamera();
}

function render() {
  if (heights.length === 0) return;

  // Get interpolated walkers for smooth rendering
  walkers = getInterpolatedWalkers();

  // Clear at identity transform
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Apply zoom around screen center
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.setTransform(zoom, 0, 0, zoom, cx * (1 - zoom), cy * (1 - zoom));

  rebuildWalkerGrid();

  // Pass 1: terrain
  for (let row = 0; row < MAP_H; row++) {
    for (let col = 0; col < MAP_W; col++) {
      drawTile(col, row);
    }
  }

  // Pass 2: settlements
  const sortedSettlements = settlements.slice().sort((a, b) => (a.ox + a.oy) - (b.ox + b.oy));
  for (const s of sortedSettlements) drawSettlement(s);

  // Pass 3: walkers via grid
  for (let row = 0; row < MAP_H; row++) {
    for (let col = 0; col < MAP_W; col++) {
      const wlist = walkerGrid[row * MAP_W + col];
      if (wlist) {
        for (const w of wlist) drawWalker(w);
      }
    }
  }

  // Targeting overlay
  if (targetingPower) {
    const powerDef = POWERS.find(p => p.id === targetingPower);
    if (powerDef) {
      // Get grid position under cursor
      const { px, py } = screenToGrid(mouseX, mouseY);
      let radius = 0;
      if (targetingPower === 'earthquake') radius = EARTHQUAKE_RADIUS;
      else if (targetingPower === 'volcano') radius = VOLCANO_RADIUS;

      if (radius > 0) {
        // Draw radius overlay
        for (let tx = Math.max(0, px - radius); tx < Math.min(MAP_W, px + radius); tx++) {
          for (let ty = Math.max(0, py - radius); ty < Math.min(MAP_H, py + radius); ty++) {
            const dx = tx + 0.5 - px, dy = ty + 0.5 - py;
            if (dx * dx + dy * dy < radius * radius) {
              const t = heights[tx][ty], r = heights[tx + 1][ty];
              const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];
              const pTop    = project(tx,     ty,     t);
              const pRight  = project(tx + 1, ty,     r);
              const pBottom = project(tx + 1, ty + 1, b);
              const pLeft   = project(tx,     ty + 1, l);
              ctx.beginPath();
              ctx.moveTo(pTop.x, pTop.y);
              ctx.lineTo(pRight.x, pRight.y);
              ctx.lineTo(pBottom.x, pBottom.y);
              ctx.lineTo(pLeft.x, pLeft.y);
              ctx.closePath();
              ctx.fillStyle = 'rgba(255, 140, 0, 0.25)';
              ctx.fill();
            }
          }
        }
      } else if (targetingPower === 'swamp') {
        // Single tile highlight
        const tx = Math.floor(px), ty = Math.floor(py);
        if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) {
          const t = heights[tx][ty], r = heights[tx + 1][ty];
          const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];
          const pTop    = project(tx,     ty,     t);
          const pRight  = project(tx + 1, ty,     r);
          const pBottom = project(tx + 1, ty + 1, b);
          const pLeft   = project(tx,     ty + 1, l);
          ctx.beginPath();
          ctx.moveTo(pTop.x, pTop.y);
          ctx.lineTo(pRight.x, pRight.y);
          ctx.lineTo(pBottom.x, pBottom.y);
          ctx.lineTo(pLeft.x, pLeft.y);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255, 140, 0, 0.35)';
          ctx.fill();
        }
      }
    }
  }

  // Magnet flags
  drawMagnetFlag(TEAM_BLUE);
  drawMagnetFlag(TEAM_RED);

  // Reset transform for HUD (drawn in screen space)
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // HUD
  drawUI();
  updatePowerBar();

  // Minimap (drawn on top of HUD, in screen space)
  drawMinimap();

  // Armageddon overlay
  if (armageddon && !gameOver) {
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 50, 0, 0.8)';
    ctx.fillText('ARMAGEDDON', canvas.width / 2, 60);
    ctx.textAlign = 'left';
  }

  // Game over overlay
  if (gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 48px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = TEAM_COLORS[gameWinner];
    ctx.fillText(`${TEAM_NAMES[gameWinner]} Wins!`, canvas.width / 2, canvas.height / 2 - 20);
    ctx.font = '20px monospace';
    ctx.fillStyle = '#ccc';
    ctx.fillText(gameWinner === myTeam ? 'Victory!' : 'Defeat', canvas.width / 2, canvas.height / 2 + 20);
    ctx.textAlign = 'left';
  }
}

// ── Picking ─────────────────────────────────────────────────────────
function screenToGrid(sx, sy) {
  // Reverse zoom transform to get world-space screen coords
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  sx = (sx - cx * (1 - zoom)) / zoom;
  sy = (sy - cy * (1 - zoom)) / zoom;

  const o = getOrigin();
  const dx = sx - o.x, dy = sy - o.y;
  const fpx = (dx / TILE_HALF_W + dy / TILE_HALF_H) / 2;
  const fpy = (dy / TILE_HALF_H - dx / TILE_HALF_W) / 2;

  let bestDist = Infinity, bestPx = Math.round(fpx), bestPy = Math.round(fpy);
  const bx = Math.floor(fpx), by = Math.floor(fpy);
  const R = Math.ceil(MAX_HEIGHT / 2) + 1;

  for (let ix = bx - R; ix <= bx + R; ix++) {
    for (let iy = by - R; iy <= by + R; iy++) {
      if (ix < 0 || ix > MAP_W || iy < 0 || iy > MAP_H) continue;
      const sp = project(ix, iy, heights[ix][iy]);
      const d = (sp.x - sx) ** 2 + (sp.y - sy) ** 2;
      if (d < bestDist) { bestDist = d; bestPx = ix; bestPy = iy; }
    }
  }
  return { px: bestPx, py: bestPy };
}

// ── WebSocket Client ────────────────────────────────────────────────
let ws = null;
let gameStarted = false;
let gameOver = false;
let gameWinner = -1;

function connectToServer() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(protocol + '//' + location.host);

  ws.onopen = () => {
    console.log('Connected to server');
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleServerMessage(msg);
  };

  ws.onclose = () => {
    console.log('Disconnected from server');
  };
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'created':
      myTeam = msg.team;
      document.getElementById('room-code').textContent = msg.code;
      document.getElementById('create-section').style.display = 'none';
      document.getElementById('join-section').style.display = 'none';
      document.getElementById('waiting-section').style.display = 'block';
      break;

    case 'joined':
      myTeam = msg.team;
      document.getElementById('create-section').style.display = 'none';
      document.getElementById('join-section').style.display = 'none';
      document.getElementById('waiting-section').style.display = 'block';
      document.getElementById('waiting-text').textContent = 'Joining game...';
      break;

    case 'start':
      if (myTeam < 0) myTeam = 0; // AI game — default to blue
      gameStarted = true;
      document.getElementById('lobby').style.display = 'none';
      document.getElementById('game').style.display = 'block';
      document.getElementById('ui').style.display = 'block';
      showPowerBar();
      startMusic();
      resize();
      centerOnHome();
      lastFrame = performance.now();
      requestAnimationFrame(gameLoop);
      break;

    case 'state':
      applyStateSnapshot(msg);
      break;

    case 'gameover':
      gameOver = true;
      gameWinner = msg.winner;
      break;

    case 'error':
      document.getElementById('error-text').textContent = msg.message;
      break;
  }
}

function applyStateSnapshot(msg) {
  // Reconstruct heights from flat array
  const flat = msg.heights;
  if (heights.length === 0) {
    for (let x = 0; x <= MAP_W; x++) {
      heights[x] = [];
      for (let y = 0; y <= MAP_H; y++) {
        heights[x][y] = 0;
      }
    }
  }
  let idx = 0;
  for (let y = 0; y <= MAP_H; y++) {
    for (let x = 0; x <= MAP_W; x++) {
      heights[x][y] = flat[idx++];
    }
  }

  // Shift walker snapshots for interpolation
  prevWalkers = currWalkers;
  currWalkers = msg.walkers;
  lastTickTime = performance.now();

  // Unpack settlements
  settlements = msg.settlements;

  // Other state
  magnetPos = msg.magnetPos;
  teamMode = msg.teamMode;
  myMana = msg.mana;

  // Power system state
  swamps = msg.swamps || [];
  swampSet = new Set();
  for (const s of swamps) swampSet.add(s.x + ',' + s.y);

  rocks = new Set();
  if (msg.rocks) {
    for (let i = 0; i < msg.rocks.length; i += 2) {
      rocks.add(msg.rocks[i] + ',' + msg.rocks[i + 1]);
    }
  }

  seaLevel = msg.seaLevel !== undefined ? msg.seaLevel : SEA_LEVEL;
  leaders = msg.leaders || [-1, -1];
  armageddon = msg.armageddon || false;
}

function sendMessage(msg) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
}

// ── Input ───────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', (e) => {
  if (!gameStarted || gameOver) return;
  if (heights.length === 0) return;

  // Minimap click — scroll camera
  if (e.button === 0 && isInMinimap(e.clientX, e.clientY)) {
    const { gx, gy } = minimapClickToGrid(e.clientX, e.clientY);
    centerCameraOnGrid(gx, gy);
    return;
  }

  // Power targeting click
  if (targetingPower && e.button === 0) {
    const { px, py } = screenToGrid(e.clientX, e.clientY);
    sendMessage({ type: 'power', power: targetingPower, x: px, y: py });
    targetingPower = null;
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
  }
  if (e.button === 2) {
    const { px, py } = screenToGrid(e.clientX, e.clientY);
    sendMessage({ type: 'lower', px, py });
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function activatePower(powerDef) {
  if (armageddon) return;
  if (myMana < powerDef.cost) return;
  if (powerDef.targeted) {
    targetingPower = powerDef.id;
  } else {
    sendMessage({ type: 'power', power: powerDef.id });
  }
}

window.addEventListener('keydown', (e) => {
  if (!gameStarted) return;

  if (e.key === 'Escape') {
    targetingPower = null;
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
  if (e.key === '4') sendMessage({ type: 'mode', mode: 3 });
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
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const newZoom = Math.max(1, Math.min(5, zoom * factor));
  // Adjust camera so the world point under the cursor stays fixed
  const mx = e.clientX, my = e.clientY;
  const cx = canvas.width / 2, cy = canvas.height / 2;
  // World-space coords under mouse before zoom change
  const wx = (mx - cx * (1 - zoom)) / zoom;
  const wy = (my - cy * (1 - zoom)) / zoom;
  // Where that world point would end up with new zoom
  const sx = wx * newZoom + cx * (1 - newZoom);
  const sy = wy * newZoom + cy * (1 - newZoom);
  // Shift camera to compensate
  camX += (mx - sx) / newZoom;
  camY += (my - sy) / newZoom;
  zoom = newZoom;
  clampCamera();
}, { passive: false });

// Edge pan — move camera when cursor is near screen edges
const EDGE_SIZE = 30;       // pixels from edge to trigger
const EDGE_PAN_SPEED = 500; // pixels/sec at full intensity
let mouseX = 0, mouseY = 0;
window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});

// ── Lobby Handlers ──────────────────────────────────────────────────
document.getElementById('btn-create').addEventListener('click', () => {
  connectToServer();
  ws.onopen = () => {
    sendMessage({ type: 'create' });
  };
});

document.getElementById('btn-ai').addEventListener('click', () => {
  connectToServer();
  ws.onopen = () => {
    sendMessage({ type: 'create_ai' });
  };
});

document.getElementById('btn-join').addEventListener('click', () => {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (code.length !== 4) {
    document.getElementById('error-text').textContent = 'Enter a 4-letter room code';
    return;
  }
  connectToServer();
  ws.onopen = () => {
    sendMessage({ type: 'join', code });
  };
});

// Allow pressing Enter in the join input
document.getElementById('join-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});

// Power bar button click handlers
document.querySelectorAll('.power-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const powerId = btn.dataset.power;
    const powerDef = POWERS.find(p => p.id === powerId);
    if (powerDef) activatePower(powerDef);
  });
});

// ── Minimap ─────────────────────────────────────────────────────────
const MM_SIZE = 200;
const MM_MARGIN = 10;
const MM_SCALE = MM_SIZE / MAP_W; // ~3.125 px per tile

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
  return {
    gx: (sx - mm.x) / MM_SCALE,
    gy: (sy - mm.y) / MM_SCALE,
  };
}

function centerCameraOnGrid(gx, gy) {
  const hx = Math.max(0, Math.min(MAP_W, gx));
  const hy = Math.max(0, Math.min(MAP_H, gy));
  const h = heightAt(hx, hy);
  camX = -(gx - gy) * TILE_HALF_W;
  camY = canvas.height / 2 - 80 - (gx + gy) * TILE_HALF_H + h * HEIGHT_STEP;
  clampCamera();
}

// Reverse-project screen point to grid coords ignoring height (for viewport outline)
function screenToGridFlat(sx, sy) {
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const wx = (sx - cx * (1 - zoom)) / zoom;
  const wy = (sy - cy * (1 - zoom)) / zoom;
  const o = getOrigin();
  const dx = wx - o.x, dy = wy - o.y;
  return {
    gx: (dx / TILE_HALF_W + dy / TILE_HALF_H) / 2,
    gy: (dy / TILE_HALF_H - dx / TILE_HALF_W) / 2,
  };
}

function drawMinimap() {
  const mm = getMinimapRect();
  const cs = Math.ceil(MM_SCALE);

  ctx.save();
  ctx.beginPath();
  ctx.rect(mm.x, mm.y, MM_SIZE, MM_SIZE);
  ctx.clip();

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(mm.x, mm.y, MM_SIZE, MM_SIZE);

  // Pass 1: terrain
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      ctx.fillStyle = getTileColor(tx, ty);
      ctx.fillRect(mm.x + tx * MM_SCALE, mm.y + ty * MM_SCALE, cs, cs);
    }
  }

  // Pass 2: swamps
  ctx.fillStyle = '#3a5a1a';
  for (const s of swamps) {
    ctx.fillRect(mm.x + s.x * MM_SCALE, mm.y + s.y * MM_SCALE, cs, cs);
  }

  // Pass 3: settlements (team-colored squares sized to footprint)
  for (const s of settlements) {
    ctx.fillStyle = TEAM_COLORS[s.t];
    const sz = Math.ceil(s.sz * MM_SCALE);
    ctx.fillRect(mm.x + s.ox * MM_SCALE, mm.y + s.oy * MM_SCALE, sz, sz);
  }

  // Pass 4: walkers (single bright pixels)
  for (const w of walkers) {
    ctx.fillStyle = TEAM_COLORS[w.team];
    ctx.fillRect(mm.x + Math.floor(w.x * MM_SCALE), mm.y + Math.floor(w.y * MM_SCALE), 1, 1);
  }

  // Pass 5: magnet flags (bright white dots)
  ctx.fillStyle = '#fff';
  for (let t = 0; t < 2; t++) {
    const mp = magnetPos[t];
    ctx.fillRect(mm.x + Math.floor(mp.x * MM_SCALE) - 1, mm.y + Math.floor(mp.y * MM_SCALE) - 1, 3, 3);
  }

  // Pass 6: viewport bounds (diamond in grid space)
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
    const px = mm.x + corners[i].gx * MM_SCALE;
    const py = mm.y + corners[i].gy * MM_SCALE;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.restore();

  // Border (drawn outside clip so it's crisp on all edges)
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.strokeRect(mm.x, mm.y, MM_SIZE, MM_SIZE);
}

// ── Power Bar ───────────────────────────────────────────────────────
function updatePowerBar() {
  const bar = document.getElementById('power-bar');
  if (!bar) return;
  const buttons = bar.querySelectorAll('.power-btn');
  buttons.forEach((btn, i) => {
    const power = POWERS[i];
    if (!power) return;
    const canAfford = myMana >= power.cost;
    const isActive = targetingPower === power.id;
    btn.classList.toggle('disabled', !canAfford || armageddon);
    btn.classList.toggle('active', isActive);
  });
}

function showPowerBar() {
  const bar = document.getElementById('power-bar');
  if (bar) bar.style.display = 'flex';
}

// ── Game Loop ───────────────────────────────────────────────────────
let lastFrame = 0;

function updateEdgePan(dt) {
  if (!gameStarted || panning) return;
  const w = canvas.width, h = canvas.height;
  let dx = 0, dy = 0;

  if (mouseX < EDGE_SIZE) dx = 1 - mouseX / EDGE_SIZE;
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
  render();
  requestAnimationFrame(gameLoop);
}

// ── Resize ──────────────────────────────────────────────────────────
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
