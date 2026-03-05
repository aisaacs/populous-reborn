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

// ── Dynamic Map Dimensions ──────────────────────────────────────────
let localMapW = MAP_W;
let localMapH = MAP_H;
let numTeams = 2;

// ── Crop Overlay Colors (per team) ──────────────────────────────────
const CROP_OVERLAY_COLORS = [
  'rgba(100,180,60,0.35)',   // Blue
  'rgba(160,160,40,0.35)',   // Red
  'rgba(60,180,100,0.35)',   // Green
  'rgba(180,180,60,0.35)',   // Yellow
  'rgba(140,100,180,0.35)',  // Purple
  'rgba(180,140,60,0.35)',   // Orange
];

// ── Minimap Crop Colors (per team) ──────────────────────────────────
const MINIMAP_CROP_COLORS = [
  '#5a8a3a',  // Blue
  '#8a8a2a',  // Red
  '#3a8a5a',  // Green
  '#8a8a3a',  // Yellow
  '#6a4a8a',  // Purple
  '#8a6a2a',  // Orange
];

// ── Terrain Textures ────────────────────────────────────────────────
const TEX_NAMES = ['grass', 'rock', 'water', 'sand', 'snow', 'swamp'];
const terrainTextures = {};
let texturesLoaded = false;
let textureOpacity = 1.0;

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
  if (swampTiles[ty * localMapW + tx]) return terrainTextures.swamp;

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
const SETT_LEVEL_NAMES = ['tent', 'hut', 'cottage', 'house', 'largehouse', 'manor', 'towerhouse', 'fortress', 'castle'];
const settlementSprites = {};
let settlementSpritesLoaded = false;

// Team tint colors for generating sprites for teams 2-5
const TEAM_TINT_COLORS = {
  green:  [60, 200, 60],
  yellow: [220, 220, 40],
  purple: [170, 70, 255],
  orange: [255, 140, 30],
};

(function loadSettlementSprites() {
  let count = 0;
  const total = SETT_LEVEL_NAMES.length * 2;
  for (const name of SETT_LEVEL_NAMES) {
    for (const team of ['blue', 'red']) {
      const key = name + '-' + team;
      const img = new Image();
      img.src = 'gfx/' + key + '.png';
      img.onload = () => {
        if (++count === total) {
          settlementSpritesLoaded = true;
          // Generate tinted sprites for teams 2-5 based on blue sprites
          generateTintedSettlementSprites();
        }
      };
      settlementSprites[key] = img;
    }
  }
})();

function generateTintedSettlementSprites() {
  for (const name of SETT_LEVEL_NAMES) {
    const baseImg = settlementSprites[name + '-blue'];
    if (!baseImg || !baseImg.complete || baseImg.naturalWidth === 0) continue;
    for (const teamName of ['green', 'yellow', 'purple', 'orange']) {
      const key = name + '-' + teamName;
      const canvas = document.createElement('canvas');
      canvas.width = baseImg.width;
      canvas.height = baseImg.height;
      const tctx = canvas.getContext('2d');
      tctx.drawImage(baseImg, 0, 0);
      tctx.globalCompositeOperation = 'source-atop';
      const [cr, cg, cb] = TEAM_TINT_COLORS[teamName];
      tctx.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',0.6)';
      tctx.fillRect(0, 0, canvas.width, canvas.height);
      settlementSprites[key] = canvas;
    }
  }
}

// ── Walker Sprites ────────────────────────────────────────────────────
// Directions: se, nw (sprites), sw = mirror of se, ne = mirror of nw
// Frames: 0 (standing), 1 (walk)
const walkerSprites = {}; // key: "se-blue-0" etc
let walkerSpritesLoaded = false;

(function loadWalkerSprites() {
  let count = 0;
  const dirs = ['se', 'nw'];
  const teams = ['blue', 'red'];
  const total = dirs.length * teams.length * 2; // 2 dirs x 2 teams x 2 frames
  for (const dir of dirs) {
    for (const team of teams) {
      for (let frame = 0; frame < 2; frame++) {
        const file = frame === 0
          ? 'walker-' + dir + '-' + team + '.png'
          : 'walker-' + dir + '-' + team + '-1.png';
        const key = dir + '-' + team + '-' + frame;
        const img = new Image();
        img.src = 'gfx/' + file;
        const done = () => {
          if (++count >= total) {
            walkerSpritesLoaded = true;
            generateTintedWalkerSprites();
          }
        };
        img.onload = done;
        img.onerror = done;
        walkerSprites[key] = img;
      }
    }
  }
})();

function generateTintedWalkerSprites() {
  const dirs = ['se', 'nw'];
  for (const dir of dirs) {
    for (let frame = 0; frame < 2; frame++) {
      const baseKey = dir + '-blue-' + frame;
      const baseImg = walkerSprites[baseKey];
      if (!baseImg || !baseImg.complete || baseImg.naturalWidth === 0) continue;
      for (const teamName of ['green', 'yellow', 'purple', 'orange']) {
        const key = dir + '-' + teamName + '-' + frame;
        const canvas = document.createElement('canvas');
        canvas.width = baseImg.width;
        canvas.height = baseImg.height;
        const tctx = canvas.getContext('2d');
        tctx.drawImage(baseImg, 0, 0);
        tctx.globalCompositeOperation = 'source-atop';
        const [cr, cg, cb] = TEAM_TINT_COLORS[teamName];
        tctx.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',0.6)';
        tctx.fillRect(0, 0, canvas.width, canvas.height);
        walkerSprites[key] = canvas;
      }
    }
  }
}

// ── Boulder Sprite ──────────────────────────────────────────────────
const boulderImg = new Image();
let boulderLoaded = false;
boulderImg.src = 'gfx/boulders.png';
boulderImg.onload = () => { boulderLoaded = true; };

// ── Tree Sprite ─────────────────────────────────────────────────────
const treeImg = new Image();
let treeLoaded = false;
treeImg.src = 'gfx/tree.png';
treeImg.onload = () => { treeLoaded = true; };

// ── Pebbles Sprite ──────────────────────────────────────────────────
const pebblesImg = new Image();
let pebblesLoaded = false;
pebblesImg.src = 'gfx/pebbles.png';
pebblesImg.onload = () => { pebblesLoaded = true; };

// ── Ruins Sprite ────────────────────────────────────────────────────
const ruinsImg = new Image();
let ruinsLoaded = false;
ruinsImg.src = 'gfx/ruins.png';
ruinsImg.onload = () => { ruinsLoaded = true; };

// ── Pre-rendered Water Frames ───────────────────────────────────────
const WATER_FRAME_COUNT = 5;
const WATER_FRAME_INTERVAL = 0.3; // seconds between frame advances
let waterFrames = null;
let waterFrameCounter = 0;
let waterFrameTimer = 0;
let waterFramesHiRes = null; // track which settingHiRes setting was used

function buildWaterFrames() {
  if (!texturesLoaded) return false;
  const S = settingHiRes ? LAND_TILE_SCALE_HI : LAND_TILE_SCALE_LO;
  const w = TILE_HALF_W * 2 * S;
  const h = TILE_HALF_H * 2 * S;
  const thw = TILE_HALF_W * S;
  const thh = TILE_HALF_H * S;
  const top = { x: thw, y: 0 };
  const right = { x: w, y: thh };
  const bottom = { x: thw, y: h };
  const left = { x: 0, y: thh };

  // Sparkle definitions per frame (scaled)
  const sparkles = [
    [{ x: -5 * S, y: -1 * S, a: 0.8 }, { x: 4 * S, y: 2 * S, a: 0.6 }],
    [{ x: 3 * S, y: -2 * S, a: 0.5 }],
    [],
    [{ x: -3 * S, y: 1 * S, a: 0.7 }, { x: 6 * S, y: -1 * S, a: 0.4 }],
    [{ x: 1 * S, y: -3 * S, a: 0.6 }],
  ];

  const tex = terrainTextures.water;
  const iw = tex.width, ih = tex.height;
  waterFrames = [];
  waterFramesHiRes = settingHiRes;

  for (let f = 0; f < WATER_FRAME_COUNT; f++) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const oc = c.getContext('2d');

    // Diamond path + base color
    oc.beginPath();
    oc.moveTo(top.x, top.y);
    oc.lineTo(right.x, right.y);
    oc.lineTo(bottom.x, bottom.y);
    oc.lineTo(left.x, left.y);
    oc.closePath();
    oc.fillStyle = WATER_COLOR;
    oc.fill();

    // Texture triangle 1: Top -> Right -> Bottom
    oc.save();
    oc.beginPath();
    oc.moveTo(top.x, top.y);
    oc.lineTo(right.x, right.y);
    oc.lineTo(bottom.x, bottom.y);
    oc.closePath();
    oc.clip();
    oc.globalAlpha = textureOpacity;
    oc.setTransform(
      (right.x - top.x) / iw, (right.y - top.y) / iw,
      (bottom.x - right.x) / ih, (bottom.y - right.y) / ih,
      top.x, top.y
    );
    oc.drawImage(tex, 0, 0);
    oc.restore();

    // Texture triangle 2: Top -> Bottom -> Left
    oc.save();
    oc.beginPath();
    oc.moveTo(top.x, top.y);
    oc.lineTo(bottom.x, bottom.y);
    oc.lineTo(left.x, left.y);
    oc.closePath();
    oc.clip();
    oc.globalAlpha = textureOpacity;
    oc.setTransform(
      (bottom.x - left.x) / iw, (bottom.y - left.y) / iw,
      (left.x - top.x) / ih, (left.y - top.y) / ih,
      top.x, top.y
    );
    oc.drawImage(tex, 0, 0);
    oc.restore();

    // Sparkles
    for (const sp of sparkles[f]) {
      oc.fillStyle = `rgba(255, 255, 255, ${sp.a})`;
      const spSize = Math.max(1, S);
      oc.fillRect(thw + sp.x, thh + sp.y, spSize, spSize);
    }

    waterFrames.push(c);
  }
  return true;
}

// ── Pre-rendered Land Tile Frames ──────────────────────────────────
// Cache indexed: shapeKey * 18 + (colorIdx - 1) * 2 + swampFlag
// shapeKey = dt*27 + dr*9 + db*3 + dl (base-3 encoding of normalized corner heights)
// 19 valid shapes × 8 colors × 2 swamp = 304 canvases
// ── Settings (persisted to localStorage) ──────────────────────────
let settingHiRes = localStorage.getItem('settingHiRes') !== 'false';          // default true
let settingEffects = localStorage.getItem('settingEffects') !== 'false';      // default true
let settingMusic = localStorage.getItem('settingMusic') !== 'false';          // default true
let settingLowZoomSimplify = localStorage.getItem('settingLowZoomSimplify') === 'true'; // default false (OFF)
const LAND_TILE_SCALE_HI = 4;
const LAND_TILE_SCALE_LO = 2;
const LOW_ZOOM_THRESHOLD = 0.45;

let landTileCache = null;       // Array of offscreen canvases (or null entries for invalid shapes)
let landTileCacheTexOpacity = -1; // which textureOpacity was baked in
let landTileCacheHiRes = null;   // which settingHiRes setting was baked in

// ── Terrain Buffer Cache ────────────────────────────────────────────
// Full-map offscreen buffer: replaces N per-tile drawImage calls with 1 large blit
let terrainBuffer = null;
let terrainBufferCtx = null;
let terrainBufferW = 0;
let terrainBufferH = 0;
let terrainBufferDirty = null;      // Uint8Array(mapW*mapH), 1=needs redraw
let terrainBufferNeedsFull = true;  // triggers complete re-render
let terrainBufferInited = false;
// Previous frame overlay state for diffing
let prevCropTeamTiles = null;
let prevSwampTiles = null;
let prevRockTiles = null;
let prevTreeTiles = null;
let prevPebbleTiles = null;
let prevRuinTiles = null;
let prevSeaLevel = -1;
const TERRAIN_BUFFER_MAX_BYTES = 40 * 1024 * 1024; // 40 MB memory guard

// Precompute valid shape keys (adjacency constraint: |diff|≤1 between neighbors)
const VALID_SHAPE_KEYS = [];
(function() {
  for (let dt = 0; dt <= 2; dt++)
    for (let dr = 0; dr <= 2; dr++)
      for (let db = 0; db <= 2; db++)
        for (let dl = 0; dl <= 2; dl++) {
          if (Math.abs(dt - dr) > 1 || Math.abs(dr - db) > 1 ||
              Math.abs(db - dl) > 1 || Math.abs(dl - dt) > 1) continue;
          VALID_SHAPE_KEYS.push(dt * 27 + dr * 9 + db * 3 + dl);
        }
})();

// Land tile color fill colors — precomputed flat/slope variants
const LAND_FILL_COLORS = {};
(function() {
  for (let idx = 1; idx <= 8; idx++) {
    LAND_FILL_COLORS[idx] = {
      flat: TERRAIN_COLORS[idx],
      slope: darkenColor(TERRAIN_COLORS[idx], SLOPE_DARKEN),
    };
  }
})();

function buildLandTileFrames() {
  const cacheSize = 81 * 18; // max shapeKey(80) * 18 + 17 = 1475
  landTileCache = new Array(cacheSize);
  landTileCacheTexOpacity = textureOpacity;
  landTileCacheHiRes = settingHiRes;

  const S = settingHiRes ? LAND_TILE_SCALE_HI : LAND_TILE_SCALE_LO;
  const thw = TILE_HALF_W * S; // 16 * S
  const thh = TILE_HALF_H * S; // 8 * S
  const hs = HEIGHT_STEP * S;  // 8 * S

  for (const shapeKey of VALID_SHAPE_KEYS) {
    // Decode shape
    const dl = shapeKey % 3;
    const db = Math.floor(shapeKey / 3) % 3;
    const dr = Math.floor(shapeKey / 9) % 3;
    const dt = Math.floor(shapeKey / 27);

    const maxRel = Math.max(dt, dr, db, dl);

    // Canvas dimensions at scale
    const cw = thw * 2;
    const ch = thh * 2 + maxRel * hs;

    // Corner positions in scaled canvas coords
    const topX = thw;
    const topY = (maxRel - dt) * hs;
    const rightX = thw * 2;
    const rightY = thh + (maxRel - dr) * hs;
    const bottomX = thw;
    const bottomY = thh * 2 + (maxRel - db) * hs;
    const leftX = 0;
    const leftY = thh + (maxRel - dl) * hs;

    const isFlat = (dt === dr && dr === db && db === dl);

    for (let colorIdx = 1; colorIdx <= 8; colorIdx++) {
      for (let swampFlag = 0; swampFlag <= 1; swampFlag++) {
        const idx = shapeKey * 18 + (colorIdx - 1) * 2 + swampFlag;

        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const oc = c.getContext('2d');

        // Diamond path
        oc.beginPath();
        oc.moveTo(topX, topY);
        oc.lineTo(rightX, rightY);
        oc.lineTo(bottomX, bottomY);
        oc.lineTo(leftX, leftY);
        oc.closePath();

        // Fill base color
        const colors = LAND_FILL_COLORS[colorIdx];
        oc.fillStyle = isFlat ? colors.flat : colors.slope;
        oc.fill();

        // Texture overlay (same 2-triangle affine mapping as original)
        if (textureOpacity > 0) {
          let tex;
          if (swampFlag) {
            tex = terrainTextures.swamp;
          } else if (colorIdx <= 1) {
            tex = terrainTextures.sand;
          } else if (colorIdx <= 5) {
            tex = terrainTextures.grass;
          } else if (colorIdx <= 7) {
            tex = terrainTextures.rock;
          } else {
            tex = terrainTextures.snow;
          }

          if (tex) {
            const iw = tex.width, ih = tex.height;

            // Triangle 1: Top -> Right -> Bottom
            oc.save();
            oc.beginPath();
            oc.moveTo(topX, topY);
            oc.lineTo(rightX, rightY);
            oc.lineTo(bottomX, bottomY);
            oc.closePath();
            oc.clip();
            oc.globalAlpha = textureOpacity;
            oc.setTransform(
              (rightX - topX) / iw, (rightY - topY) / iw,
              (bottomX - rightX) / ih, (bottomY - rightY) / ih,
              topX, topY
            );
            oc.drawImage(tex, 0, 0);
            oc.restore();

            // Triangle 2: Top -> Bottom -> Left
            oc.save();
            oc.beginPath();
            oc.moveTo(topX, topY);
            oc.lineTo(bottomX, bottomY);
            oc.lineTo(leftX, leftY);
            oc.closePath();
            oc.clip();
            oc.globalAlpha = textureOpacity;
            oc.setTransform(
              (bottomX - leftX) / iw, (bottomY - leftY) / iw,
              (leftX - topX) / ih, (leftY - topY) / ih,
              topX, topY
            );
            oc.drawImage(tex, 0, 0);
            oc.restore();
          }
        }

        // Swamp color overlay (baked in)
        if (swampFlag) {
          oc.beginPath();
          oc.moveTo(topX, topY);
          oc.lineTo(rightX, rightY);
          oc.lineTo(bottomX, bottomY);
          oc.lineTo(leftX, leftY);
          oc.closePath();
          oc.fillStyle = 'rgba(80, 100, 30, 0.5)';
          oc.fill();
        }

        // Grid NOT baked — drawn at screen resolution in drawTile for crispness
        landTileCache[idx] = c;
      }
    }
  }
}

// ── Music System ───────────────────────────────────────────────────
const MUSIC_TRACKS = ['music/001.mp3', 'music/002.mp3', 'music/003.mp3', 'music/004.mp3'];
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
  if (musicStarted || !settingMusic) return;
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


// Init UI from saved prefs
syncMusicUI();

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
    hue: Math.random() < 0.7 ? 0 : (Math.random() < 0.5 ? 220 : 30),
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
    hue: 200 + Math.random() * 40,
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

  // Dark background with subtle gradient
  const bg = lobbyCtx.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.4, Math.max(W, H) * 0.7);
  bg.addColorStop(0, '#0c0c24');
  bg.addColorStop(1, '#040410');
  lobbyCtx.fillStyle = bg;
  lobbyCtx.fillRect(0, 0, W, H);

  // Nebula clouds
  const nebulae = [
    { x: 0.25, y: 0.3, r: 0.3, color: [30, 20, 80] },
    { x: 0.75, y: 0.6, r: 0.35, color: [15, 30, 70] },
    { x: 0.5, y: 0.15, r: 0.2, color: [20, 40, 60] },
    { x: 0.6, y: 0.8, r: 0.25, color: [40, 15, 50] },
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
      const r = star.hue === 220 ? 180 : 255;
      const g = star.hue === 220 ? 200 : 240;
      const b = star.hue === 220 ? 255 : 200;
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
    lobbyCtx.fillStyle = `rgba(${Math.floor(m.hue - 60)}, ${Math.floor(m.hue - 20)}, 255, ${a.toFixed(2)})`;
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

// ── Game State (received from server) ───────────────────────────────
let heights = [];
let walkers = [];
let settlements = [];
let magnetPos = [{ x: 10, y: 10 }, { x: 50, y: 50 }];
let teamMode = [MODE_SETTLE, MODE_SETTLE];
let myMana = 0;
let myTeam = -1;
let walkerGrid = new Array(localMapW * localMapH);
let homePos = null;

// Power system state
let swamps = [];
// Typed arrays for O(1) tile lookups (indexed by ty * localMapW + tx)
let swampTiles = new Uint8Array(localMapW * localMapH);
let rockTiles = new Uint8Array(localMapW * localMapH);
let treeTiles = new Uint8Array(localMapW * localMapH);
let pebbleTiles = new Uint8Array(localMapW * localMapH);
let ruinTiles = new Uint8Array(localMapW * localMapH); // stores team + 1 (0 = no ruin)
let cropTeamTiles = new Uint8Array(localMapW * localMapH); // stores team + 1 (0 = no crop)
let fallenTiles = new Uint8Array(localMapW * localMapH);
// Flat coordinate arrays for minimap iteration
let treeCoords = [];   // [x1,y1,x2,y2,...]
let pebbleCoords = []; // [x1,y1,x2,y2,...]
let ruins = []; // {x, y, team}
let seaLevel = SEA_LEVEL;
let leaders = [];
let armageddon = false;
let magnetLocked = [];
let teamPop = [];
let fires = []; // {x, y, a (age in seconds)}
let fireParticles = []; // client-side particles for rendering
let targetingPower = null;
let inspectMode = false;
let inspectData = null; // {type:'settlement'|'walker', screenX, screenY, ...data}
let magnetMode = false;

// Reallocate typed arrays when map dimensions change
function reinitTypedArrays() {
  const sz = localMapW * localMapH;
  swampTiles = new Uint8Array(sz);
  rockTiles = new Uint8Array(sz);
  treeTiles = new Uint8Array(sz);
  pebbleTiles = new Uint8Array(sz);
  ruinTiles = new Uint8Array(sz);
  cropTeamTiles = new Uint8Array(sz);
  fallenTiles = new Uint8Array(sz);
  treeCoords = [];
  pebbleCoords = [];
  landTileCache = null; // invalidate on map dimension change
  resetTerrainBuffer();
}

function resetTerrainBuffer() {
  terrainBuffer = null;
  terrainBufferCtx = null;
  terrainBufferW = 0;
  terrainBufferH = 0;
  terrainBufferDirty = null;
  terrainBufferNeedsFull = true;
  terrainBufferInited = false;
  prevCropTeamTiles = null;
  prevSwampTiles = null;
  prevRockTiles = null;
  prevTreeTiles = null;
  prevPebbleTiles = null;
  prevRuinTiles = null;
  prevSeaLevel = -1;
}

function initTerrainBuffer() {
  const w = (localMapW + localMapH) * TILE_HALF_W;   // (mapW+mapH)*16
  const h = (localMapW + localMapH) * TILE_HALF_H + MAX_HEIGHT * HEIGHT_STEP + 64; // extra for height + margin
  const bytes = w * h * 4;
  if (bytes > TERRAIN_BUFFER_MAX_BYTES) {
    console.warn('Terrain buffer too large (' + (bytes / 1024 / 1024).toFixed(1) + ' MB), disabled');
    terrainBufferInited = false;
    return;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  terrainBuffer = c;
  terrainBufferCtx = c.getContext('2d');
  terrainBufferW = w;
  terrainBufferH = h;
  const sz = localMapW * localMapH;
  terrainBufferDirty = new Uint8Array(sz);
  terrainBufferNeedsFull = true;
  terrainBufferInited = true;
  // Init prev overlay arrays for diffing
  prevCropTeamTiles = new Uint8Array(sz);
  prevSwampTiles = new Uint8Array(sz);
  prevRockTiles = new Uint8Array(sz);
  prevTreeTiles = new Uint8Array(sz);
  prevPebbleTiles = new Uint8Array(sz);
  prevRuinTiles = new Uint8Array(sz);
  prevSeaLevel = seaLevel;
}

// Initialize dynamic arrays
function initTeamArrays(n) {
  leaders = [];
  magnetLocked = [];
  teamPop = [];
  for (let i = 0; i < n; i++) {
    leaders.push(-1);
    magnetLocked.push(false);
    teamPop.push(0);
  }
}
initTeamArrays(2);

// ── Space Background ────────────────────────────────────────────────
const STAR_COUNT = 300;
const stars = [];
for (let i = 0; i < STAR_COUNT; i++) {
  const bright = 0.3 + Math.random() * 0.7;
  stars.push({
    x: Math.random(), y: Math.random(),
    size: Math.random() < 0.85 ? 1 : 2,
    brightness: bright,
    twinkleSpeed: 0.5 + Math.random() * 2.0,
    spikeLen: 8 + Math.random() * 16,
  });
}

let nebulaCanvas = null;
function buildNebulaCanvas(w, h) {
  nebulaCanvas = document.createElement('canvas');
  nebulaCanvas.width = w;
  nebulaCanvas.height = h;
  const nctx = nebulaCanvas.getContext('2d');
  const nebulae = [
    { x: 0.2, y: 0.3, r: 0.25, color: '40, 20, 80' },
    { x: 0.7, y: 0.6, r: 0.3,  color: '20, 40, 60' },
    { x: 0.5, y: 0.15, r: 0.2, color: '20, 30, 50' },
  ];
  for (const n of nebulae) {
    const gx = n.x * w, gy = n.y * h;
    const gr = n.r * Math.max(w, h);
    const grad = nctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    grad.addColorStop(0, `rgba(${n.color}, 0.08)`);
    grad.addColorStop(1, `rgba(${n.color}, 0)`);
    nctx.fillStyle = grad;
    nctx.fillRect(0, 0, w, h);
  }
}

// ── Waterfall Particles ─────────────────────────────────────────────
const WATERFALL_MAX = 3000;
const waterfallParticles = [];
for (let i = 0; i < WATERFALL_MAX; i++) {
  waterfallParticles.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 2, active: false });
}

// ── Delta State Maps ────────────────────────────────────────────────
let walkerMap = new Map();      // id → walker data object
let settlementMap = new Map();  // "tx,ty" → settlement data object

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
        tx: w.tx, ty: w.ty,
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
        tx: w.tx, ty: w.ty,
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

// Hoisted origin — recomputed once per frame at top of render()
let _originX = 0;
let _originY = 0;

// Viewport — usable area excluding sidebar. Recomputed per frame.
const SIDEBAR_WIDTH = 160;
let _vpLeft = 0;   // left edge of usable viewport (sidebar width when visible)
let _vpW = 0;      // usable viewport width
let _vpCX = 0;     // viewport center X
let _vpCY = 0;     // viewport center Y

function updateViewport() {
  const sb = document.getElementById('sidebar');
  _vpLeft = (sb && sb.classList.contains('visible')) ? SIDEBAR_WIDTH : 0;
  _vpW = canvas.width - _vpLeft;
  _vpCX = _vpLeft + _vpW / 2;
  _vpCY = canvas.height / 2;
}

function getOrigin() {
  return {
    x: Math.floor(_vpCX) + camX,
    y: 80 + camY,
  };
}

// Clamp camera so viewport edges never scroll past the map edges.
function clampCamera() {
  updateViewport();
  const hvw = (_vpW / 2) / zoom;  // half viewport width in world space
  const hvh = _vpCY / zoom;       // half viewport height in world space

  const pad = 48; // pixels of slack around the map
  const mapL = -localMapH * TILE_HALF_W - pad;
  const mapR =  localMapW * TILE_HALF_W + pad;
  const mapT = -MAX_HEIGHT * HEIGHT_STEP - pad;
  const mapB = (localMapW + localMapH) * TILE_HALF_H + pad;

  const minCamX = hvw - mapR;
  const maxCamX = -mapL - hvw;
  const minCamY = _vpCY + hvh - 80 - mapB;
  const maxCamY = _vpCY - hvh - 80 - mapT;

  if (minCamX <= maxCamX) {
    camX = Math.max(minCamX, Math.min(maxCamX, camX));
  } else {
    camX = (minCamX + maxCamX) / 2;
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
  const cx = Math.max(0, Math.min(localMapW, ix));
  const cy = Math.max(0, Math.min(localMapH, iy));
  const cx1 = Math.min(localMapW, cx + 1);
  const cy1 = Math.min(localMapH, cy + 1);
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

  // Fast path: blit pre-rendered water frame
  if (isWater && waterFrames) {
    const pTopX = _originX + (tx - ty) * TILE_HALF_W;
    const pTopY = _originY + (tx + ty) * TILE_HALF_H;
    const fi = (waterFrameCounter + tx + ty) % WATER_FRAME_COUNT;
    const wf = waterFrames[fi];
    ctx.drawImage(wf, 0, 0, wf.width, wf.height,
      pTopX - TILE_HALF_W, pTopY, TILE_HALF_W * 2, TILE_HALF_H * 2);
    if (GRID_MODES[gridMode]) {
      ctx.strokeStyle = GRID_MODES[gridMode];
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pTopX, pTopY);
      ctx.lineTo(pTopX + TILE_HALF_W, pTopY + TILE_HALF_H);
      ctx.lineTo(pTopX, pTopY + 2 * TILE_HALF_H);
      ctx.lineTo(pTopX - TILE_HALF_W, pTopY + TILE_HALF_H);
      ctx.closePath();
      ctx.stroke();
    }
    return;
  }

  const tileIdx = ty * localMapW + tx;

  // ── LOW ZOOM SIMPLIFY: color-fill only when enabled and zoomed out ──
  if (settingLowZoomSimplify && zoom < LOW_ZOOM_THRESHOLD) {
    const pTopX = _originX + (tx - ty) * TILE_HALF_W;
    const pTopY = _originY + (tx + ty) * TILE_HALF_H - t * HEIGHT_STEP;
    const pRightX = pTopX + TILE_HALF_W;
    const pRightY = pTopY + TILE_HALF_H - (r - t) * HEIGHT_STEP;
    const pBottomX = pTopX;
    const pBottomY = pTopY + 2 * TILE_HALF_H - (b - t) * HEIGHT_STEP;
    const pLeftX = pTopX - TILE_HALF_W;
    const pLeftY = pTopY + TILE_HALF_H - (l - t) * HEIGHT_STEP;

    ctx.beginPath();
    ctx.moveTo(pTopX, pTopY);
    ctx.lineTo(pRightX, pRightY);
    ctx.lineTo(pBottomX, pBottomY);
    ctx.lineTo(pLeftX, pLeftY);
    ctx.closePath();

    const avg = (t + r + b + l) / 4;
    const colorIdx = Math.max(1, Math.min(MAX_HEIGHT, Math.round(avg)));
    const isFlat = (t === r && r === b && b === l);
    const colors = LAND_FILL_COLORS[colorIdx];
    ctx.fillStyle = isFlat ? colors.flat : colors.slope;
    ctx.fill();

    if (GRID_MODES[gridMode]) {
      ctx.strokeStyle = GRID_MODES[gridMode];
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const cropTeam = cropTeamTiles[tileIdx];
    if (cropTeam) {
      ctx.fillStyle = CROP_OVERLAY_COLORS[cropTeam - 1] || CROP_OVERLAY_COLORS[0];
      ctx.fill();
    }
    if (swampTiles[tileIdx]) {
      ctx.fillStyle = 'rgba(80, 100, 30, 0.5)';
      ctx.fill();
    }
    return;
  }

  // ── Pre-rendered blit path ──
  if (landTileCache) {
    const minH = Math.min(t, r, b, l);
    const dt = t - minH, dr = r - minH, db = b - minH, dl = l - minH;
    const shapeKey = dt * 27 + dr * 9 + db * 3 + dl;
    const avg = (t + r + b + l) / 4;
    const colorIdx = Math.max(1, Math.min(MAX_HEIGHT, Math.round(avg)));
    const swampFlag = swampTiles[tileIdx] ? 1 : 0;
    const cacheIdx = shapeKey * 18 + (colorIdx - 1) * 2 + swampFlag;
    const frame = landTileCache[cacheIdx];

    if (frame) {
      // Inline project pTop only
      const pTopX = _originX + (tx - ty) * TILE_HALF_W;
      const pTopY = _originY + (tx + ty) * TILE_HALF_H - t * HEIGHT_STEP;
      const maxRel = Math.max(dt, dr, db, dl);
      const blitX = pTopX - TILE_HALF_W;
      const blitY = pTopY - (maxRel - dt) * HEIGHT_STEP;
      // Blit scaled frame into world-space dimensions
      const dstW = TILE_HALF_W * 2;
      const dstH = TILE_HALF_H * 2 + maxRel * HEIGHT_STEP;
      ctx.drawImage(frame, 0, 0, frame.width, frame.height, blitX, blitY, dstW, dstH);

      // Grid at screen resolution (crisp at any zoom)
      if (GRID_MODES[gridMode]) {
        ctx.beginPath();
        ctx.moveTo(pTopX, pTopY);
        ctx.lineTo(pTopX + TILE_HALF_W, pTopY + TILE_HALF_H - (dr - dt) * HEIGHT_STEP);
        ctx.lineTo(pTopX, pTopY + 2 * TILE_HALF_H - (db - dt) * HEIGHT_STEP);
        ctx.lineTo(pTopX - TILE_HALF_W, pTopY + TILE_HALF_H - (dl - dt) * HEIGHT_STEP);
        ctx.closePath();
        ctx.strokeStyle = GRID_MODES[gridMode];
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Overlay-only path: only compute 4 corners if needed
      const cropTeam = cropTeamTiles[tileIdx];
      const needOverlay = cropTeam || rockTiles[tileIdx] || treeTiles[tileIdx] ||
                          pebbleTiles[tileIdx] || ruinTiles[tileIdx];
      if (!needOverlay) return;

      // Compute 4 corners for overlays
      const pRightX = _originX + (tx + 1 - ty) * TILE_HALF_W;
      const pRightY = _originY + (tx + 1 + ty) * TILE_HALF_H - r * HEIGHT_STEP;
      const pBottomX = _originX + (tx + 1 - ty - 1) * TILE_HALF_W;
      const pBottomY = _originY + (tx + 1 + ty + 1) * TILE_HALF_H - b * HEIGHT_STEP;
      const pLeftX = _originX + (tx - ty - 1) * TILE_HALF_W;
      const pLeftY = _originY + (tx + ty + 1) * TILE_HALF_H - l * HEIGHT_STEP;

      // Crop overlay
      if (cropTeam) {
        ctx.beginPath();
        ctx.moveTo(pTopX, pTopY);
        ctx.lineTo(pRightX, pRightY);
        ctx.lineTo(pBottomX, pBottomY);
        ctx.lineTo(pLeftX, pLeftY);
        ctx.closePath();
        ctx.fillStyle = CROP_OVERLAY_COLORS[cropTeam - 1] || CROP_OVERLAY_COLORS[0];
        ctx.fill();
      }

      // Sprite overlays
      drawTileSprites(tileIdx, pTopX, pTopY, pRightX, pRightY, pBottomX, pBottomY, pLeftX, pLeftY);
      return;
    }
  }

  // ── FALLBACK: original full rendering (before textures load) ──
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
  ctx.fillStyle = getTileColor(tx, ty);
  ctx.fill();

  // Texture overlay — split into 2 triangles for correct projection on slopes
  if (texturesLoaded && textureOpacity > 0) {
    const tex = getTileTexture(tx, ty);
    const iw = tex.width, ih = tex.height;
    const hcx = canvas.width / 2;
    const hcy = canvas.height / 2;
    const zox = hcx * (1 - zoom), zoy = hcy * (1 - zoom);

    // Triangle 1: Top -> Right -> Bottom
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

    // Triangle 2: Top -> Bottom -> Left
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

  // Crop overlay — single typed array lookup
  const cropTeam = cropTeamTiles[tileIdx];
  if (cropTeam) {
    ctx.fillStyle = CROP_OVERLAY_COLORS[cropTeam - 1] || CROP_OVERLAY_COLORS[0];
    ctx.fill();
  }

  // Swamp overlay
  if (swampTiles[tileIdx]) {
    ctx.fillStyle = 'rgba(80, 100, 30, 0.5)';
    ctx.fill();
  }

  if (GRID_MODES[gridMode]) {
    ctx.strokeStyle = GRID_MODES[gridMode];
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawTileSprites(tileIdx, pTop.x, pTop.y, pRight.x, pRight.y, pBottom.x, pBottom.y, pLeft.x, pLeft.y);
}

// Extracted sprite overlays (boulders, trees, pebbles, ruins)
function drawTileSprites(tileIdx, pTopX, pTopY, pRightX, pRightY, pBottomX, pBottomY, pLeftX, pLeftY) {
  // Boulder sprite on rock tiles
  if (rockTiles[tileIdx] && boulderLoaded) {
    const midX = (pTopX + pBottomX) / 2;
    const midY = (pTopY + pBottomY) / 2;
    const tileW = (pRightX - pLeftX);
    const scale = tileW * 0.7 / boulderImg.width;
    const sw = boulderImg.width * scale;
    const sh = boulderImg.height * scale;
    ctx.drawImage(boulderImg, midX - sw / 2, midY - sh * 0.75, sw, sh);
  }

  // Tree sprite on tree tiles
  if (treeTiles[tileIdx] && treeLoaded) {
    const midX = (pTopX + pBottomX) / 2;
    const midY = (pTopY + pBottomY) / 2;
    const tileW = (pRightX - pLeftX);
    const scale = tileW * 0.7 / treeImg.width;
    const sw = treeImg.width * scale;
    const sh = treeImg.height * scale;
    ctx.drawImage(treeImg, midX - sw / 2, midY - sh * 0.75, sw, sh);
  }

  // Pebble sprite on pebble tiles
  if (pebbleTiles[tileIdx]) {
    const midX = (pTopX + pBottomX) / 2;
    const midY = (pTopY + pBottomY) / 2;
    const tileW = (pRightX - pLeftX);
    if (pebblesLoaded) {
      const scale = tileW * 0.5 / pebblesImg.width;
      const sw = pebblesImg.width * scale;
      const sh = pebblesImg.height * scale;
      ctx.drawImage(pebblesImg, midX - sw / 2, midY - sh * 0.5, sw, sh);
    } else {
      ctx.fillStyle = '#8a7a6a';
      for (let i = 0; i < 4; i++) {
        const ox = (i % 2 - 0.5) * tileW * 0.2;
        const oy = (Math.floor(i / 2) - 0.5) * tileW * 0.1;
        ctx.beginPath();
        ctx.arc(midX + ox, midY + oy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Ruins sprite on ruin tiles
  const ruinTeam = ruinTiles[tileIdx];
  if (ruinTeam) {
    const midX = (pTopX + pBottomX) / 2;
    const midY = (pTopY + pBottomY) / 2;
    const tileW = (pRightX - pLeftX);
    const ruinTeamIdx = ruinTeam - 1;
    if (ruinsLoaded) {
      const scale = tileW * 0.6 / ruinsImg.width;
      const sw = ruinsImg.width * scale;
      const sh = ruinsImg.height * scale;
      ctx.drawImage(ruinsImg, midX - sw / 2, midY - sh * 0.6, sw, sh);
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = TEAM_COLORS[ruinTeamIdx];
      ctx.fillRect(midX - sw / 2, midY - sh * 0.6, sw, sh);
      ctx.restore();
    } else {
      ctx.fillStyle = ruinTeamIdx === TEAM_BLUE ? '#4a5a6a' : '#6a4a4a';
      const offsets = [[-0.15, -0.06], [0.1, 0.04], [-0.05, 0.08], [0.12, -0.04], [0.0, 0.0]];
      for (const [fx, fy] of offsets) {
        ctx.fillRect(midX + fx * tileW - 1, midY + fy * tileW - 1, 3, 2);
      }
    }
  }
}

// ── Draw single tile to terrain buffer (buffer-local coords) ────────
function drawTileToBuffer(tx, ty) {
  const bCtx = terrainBufferCtx;
  const t = heights[tx][ty], r = heights[tx + 1][ty];
  const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];
  const tileIdx = ty * localMapW + tx;

  // Buffer-local origin: top-left corner maps to buffer pixel coords
  const bOriginX = localMapH * TILE_HALF_W;
  const bOriginY = MAX_HEIGHT * HEIGHT_STEP + 32; // margin for tallest tiles

  const isWater = (t <= seaLevel && r <= seaLevel && b <= seaLevel && l <= seaLevel);

  if (isWater && waterFrames) {
    // Static water frame (spatial variation only, no temporal animation)
    const pTopX = bOriginX + (tx - ty) * TILE_HALF_W;
    const pTopY = bOriginY + (tx + ty) * TILE_HALF_H;
    const fi = (tx + ty) % WATER_FRAME_COUNT; // static spatial variation
    const wf = waterFrames[fi];
    bCtx.drawImage(wf, 0, 0, wf.width, wf.height,
      pTopX - TILE_HALF_W, pTopY, TILE_HALF_W * 2, TILE_HALF_H * 2);
    return;
  }

  // Land tile via pre-rendered cache
  if (landTileCache) {
    const minH = Math.min(t, r, b, l);
    const dt = t - minH, dr = r - minH, db = b - minH, dl = l - minH;
    const shapeKey = dt * 27 + dr * 9 + db * 3 + dl;
    const avg = (t + r + b + l) / 4;
    const colorIdx = Math.max(1, Math.min(MAX_HEIGHT, Math.round(avg)));
    const swampFlag = swampTiles[tileIdx] ? 1 : 0;
    const cacheIdx = shapeKey * 18 + (colorIdx - 1) * 2 + swampFlag;
    const frame = landTileCache[cacheIdx];

    if (frame) {
      const pTopX = bOriginX + (tx - ty) * TILE_HALF_W;
      const pTopY = bOriginY + (tx + ty) * TILE_HALF_H - t * HEIGHT_STEP;
      const maxRel = Math.max(dt, dr, db, dl);
      const blitX = pTopX - TILE_HALF_W;
      const blitY = pTopY - (maxRel - dt) * HEIGHT_STEP;
      const dstW = TILE_HALF_W * 2;
      const dstH = TILE_HALF_H * 2 + maxRel * HEIGHT_STEP;
      bCtx.drawImage(frame, 0, 0, frame.width, frame.height, blitX, blitY, dstW, dstH);

      // Crop overlay
      const cropTeam = cropTeamTiles[tileIdx];
      if (cropTeam) {
        const pRightX = bOriginX + (tx + 1 - ty) * TILE_HALF_W;
        const pRightY = bOriginY + (tx + 1 + ty) * TILE_HALF_H - r * HEIGHT_STEP;
        const pBottomX = bOriginX + (tx + 1 - ty - 1) * TILE_HALF_W;
        const pBottomY = bOriginY + (tx + 1 + ty + 1) * TILE_HALF_H - b * HEIGHT_STEP;
        const pLeftX = bOriginX + (tx - ty - 1) * TILE_HALF_W;
        const pLeftY = bOriginY + (tx + ty + 1) * TILE_HALF_H - l * HEIGHT_STEP;
        bCtx.beginPath();
        bCtx.moveTo(pTopX, pTopY);
        bCtx.lineTo(pRightX, pRightY);
        bCtx.lineTo(pBottomX, pBottomY);
        bCtx.lineTo(pLeftX, pLeftY);
        bCtx.closePath();
        bCtx.fillStyle = CROP_OVERLAY_COLORS[cropTeam - 1] || CROP_OVERLAY_COLORS[0];
        bCtx.fill();
      }

      // Sprite overlays (rocks, trees, pebbles, ruins) — use buffer context
      const needSprites = rockTiles[tileIdx] || treeTiles[tileIdx] ||
                          pebbleTiles[tileIdx] || ruinTiles[tileIdx];
      if (needSprites) {
        const pRightX = bOriginX + (tx + 1 - ty) * TILE_HALF_W;
        const pRightY = bOriginY + (tx + 1 + ty) * TILE_HALF_H - r * HEIGHT_STEP;
        const pBottomX = bOriginX + (tx + 1 - ty - 1) * TILE_HALF_W;
        const pBottomY = bOriginY + (tx + 1 + ty + 1) * TILE_HALF_H - b * HEIGHT_STEP;
        const pLeftX = bOriginX + (tx - ty - 1) * TILE_HALF_W;
        const pLeftY = bOriginY + (tx + ty + 1) * TILE_HALF_H - l * HEIGHT_STEP;
        drawTileSpritesToCtx(bCtx, tileIdx, pTopX, pTopY, pRightX, pRightY, pBottomX, pBottomY, pLeftX, pLeftY);
      }
      return;
    }
  }

  // Fallback: color-fill path for buffer (before textures load)
  const pTopX = bOriginX + (tx - ty) * TILE_HALF_W;
  const pTopY = bOriginY + (tx + ty) * TILE_HALF_H - t * HEIGHT_STEP;
  const pRightX = bOriginX + (tx + 1 - ty) * TILE_HALF_W;
  const pRightY = bOriginY + (tx + 1 + ty) * TILE_HALF_H - r * HEIGHT_STEP;
  const pBottomX = bOriginX + (tx + 1 - ty - 1) * TILE_HALF_W;
  const pBottomY = bOriginY + (tx + 1 + ty + 1) * TILE_HALF_H - b * HEIGHT_STEP;
  const pLeftX = bOriginX + (tx - ty - 1) * TILE_HALF_W;
  const pLeftY = bOriginY + (tx + ty + 1) * TILE_HALF_H - l * HEIGHT_STEP;

  bCtx.beginPath();
  bCtx.moveTo(pTopX, pTopY);
  bCtx.lineTo(pRightX, pRightY);
  bCtx.lineTo(pBottomX, pBottomY);
  bCtx.lineTo(pLeftX, pLeftY);
  bCtx.closePath();
  const avg = (t + r + b + l) / 4;
  const colorIdx = Math.max(1, Math.min(MAX_HEIGHT, Math.round(avg)));
  const isFlat = (t === r && r === b && b === l);
  const colors = LAND_FILL_COLORS[colorIdx];
  bCtx.fillStyle = isFlat ? colors.flat : colors.slope;
  bCtx.fill();
}

// Sprite overlays that can render to any context (buffer or screen)
function drawTileSpritesToCtx(targetCtx, tileIdx, pTopX, pTopY, pRightX, pRightY, pBottomX, pBottomY, pLeftX, pLeftY) {
  if (rockTiles[tileIdx] && boulderLoaded) {
    const midX = (pTopX + pBottomX) / 2;
    const midY = (pTopY + pBottomY) / 2;
    const tileW = (pRightX - pLeftX);
    const scale = tileW * 0.7 / boulderImg.width;
    const sw = boulderImg.width * scale;
    const sh = boulderImg.height * scale;
    targetCtx.drawImage(boulderImg, midX - sw / 2, midY - sh * 0.75, sw, sh);
  }
  if (treeTiles[tileIdx] && treeLoaded) {
    const midX = (pTopX + pBottomX) / 2;
    const midY = (pTopY + pBottomY) / 2;
    const tileW = (pRightX - pLeftX);
    const scale = tileW * 0.7 / treeImg.width;
    const sw = treeImg.width * scale;
    const sh = treeImg.height * scale;
    targetCtx.drawImage(treeImg, midX - sw / 2, midY - sh * 0.75, sw, sh);
  }
  if (pebbleTiles[tileIdx]) {
    const midX = (pTopX + pBottomX) / 2;
    const midY = (pTopY + pBottomY) / 2;
    const tileW = (pRightX - pLeftX);
    if (pebblesLoaded) {
      const scale = tileW * 0.5 / pebblesImg.width;
      const sw = pebblesImg.width * scale;
      const sh = pebblesImg.height * scale;
      targetCtx.drawImage(pebblesImg, midX - sw / 2, midY - sh * 0.5, sw, sh);
    }
  }
  const ruinTeam = ruinTiles[tileIdx];
  if (ruinTeam && ruinsLoaded) {
    const midX = (pTopX + pBottomX) / 2;
    const midY = (pTopY + pBottomY) / 2;
    const tileW = (pRightX - pLeftX);
    const ruinTeamIdx = ruinTeam - 1;
    const scale = tileW * 0.6 / ruinsImg.width;
    const sw = ruinsImg.width * scale;
    const sh = ruinsImg.height * scale;
    targetCtx.drawImage(ruinsImg, midX - sw / 2, midY - sh * 0.6, sw, sh);
    targetCtx.save();
    targetCtx.globalAlpha = 0.2;
    targetCtx.fillStyle = TEAM_COLORS[ruinTeamIdx];
    targetCtx.fillRect(midX - sw / 2, midY - sh * 0.6, sw, sh);
    targetCtx.restore();
  }
}

// ── Terrain Buffer Update ────────────────────────────────────────────
// Always does a full redraw when anything is dirty. A full pass over a
// 64×64 map is ~4096 canvas-to-canvas blits on the offscreen buffer —
// well under 1 ms — and avoids all partial-clear artifacts from
// isometric tile overlap.
function updateTerrainBuffer() {
  if (!terrainBufferInited || !terrainBuffer) return;

  if (terrainBufferNeedsFull) {
    terrainBufferCtx.clearRect(0, 0, terrainBufferW, terrainBufferH);
    for (let ty = 0; ty < localMapH; ty++) {
      for (let tx = 0; tx < localMapW; tx++) {
        drawTileToBuffer(tx, ty);
      }
    }
    terrainBufferDirty.fill(0);
    terrainBufferNeedsFull = false;
    return;
  }

  // Any dirty tiles at all → full redraw
  let hasDirty = false;
  for (let i = 0; i < localMapW * localMapH; i++) {
    if (terrainBufferDirty[i]) { hasDirty = true; break; }
  }
  if (!hasDirty) return;

  terrainBufferCtx.clearRect(0, 0, terrainBufferW, terrainBufferH);
  for (let ty = 0; ty < localMapH; ty++) {
    for (let tx = 0; tx < localMapW; tx++) {
      drawTileToBuffer(tx, ty);
    }
  }
  terrainBufferDirty.fill(0);
}

function rebuildWalkerGrid() {
  for (let i = 0; i < localMapW * localMapH; i++) walkerGrid[i] = null;
  for (let i = 0; i < walkers.length; i++) {
    const w = walkers[i];
    const tx = Math.floor(w.x), ty = Math.floor(w.y);
    if (tx < 0 || tx >= localMapW || ty < 0 || ty >= localMapH) continue;
    const key = ty * localMapW + tx;
    if (!walkerGrid[key]) walkerGrid[key] = [];
    walkerGrid[key].push(w);
  }
}

function getWalkerDirection(w) {
  if (w.tx == null || w.ty == null) return 'se';
  // Movement vector in grid space
  const dx = w.tx - w.x;
  const dy = w.ty - w.y;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return 'se'; // stationary
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'se' : 'nw';
  } else {
    return dy >= 0 ? 'sw' : 'ne';
  }
}

function drawWalker(w) {
  const h = heightAt(w.x, w.y);
  const p = project(w.x, w.y, h);
  const isKnight = w.isKnight;
  const isLeader = w.isLeader;
  const team = TEAM_SPRITE_NAMES[w.team] || 'blue';

  // Determine direction and animation frame
  const dir = getWalkerDirection(w);
  const animFrame = Math.floor(performance.now() / 250) % 2;

  // Map direction to sprite key + mirror flag
  let spriteDir, mirror;
  if (dir === 'se') { spriteDir = 'se'; mirror = false; }
  else if (dir === 'nw') { spriteDir = 'nw'; mirror = false; }
  else if (dir === 'sw') { spriteDir = 'se'; mirror = true; }
  else { spriteDir = 'nw'; mirror = true; } // ne

  const key = spriteDir + '-' + team + '-' + animFrame;
  const img = walkerSprites[key];
  const spriteH = isKnight ? 18 : 14;
  const spriteReady = walkerSpritesLoaded && img && (img instanceof HTMLCanvasElement || (img.complete && img.naturalWidth > 0));

  if (spriteReady) {
    const scale = spriteH / (img.height || img.naturalHeight || 14);
    const spriteW = (img.width || img.naturalWidth || 14) * scale;
    const drawX = p.x - spriteW / 2;
    const drawY = p.y - spriteH + 2;

    ctx.save();
    if (mirror) {
      ctx.translate(p.x, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, -spriteW / 2, drawY, spriteW, spriteH);
    } else {
      ctx.drawImage(img, drawX, drawY, spriteW, spriteH);
    }
    ctx.restore();
  } else {
    // Fallback: colored circle
    const radius = isKnight ? 4 + Math.min(3, Math.floor(w.strength / 50)) : 2 + Math.min(3, Math.floor(w.strength / 50));
    ctx.beginPath();
    ctx.arc(p.x, p.y - 3, radius, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLORS[w.team];
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // Leader: gold crown above sprite
  if (isLeader) {
    const crownY = spriteReady ? p.y - spriteH - 2 : p.y - 8;
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.moveTo(p.x - 4, crownY + 4);
    ctx.lineTo(p.x - 3, crownY);
    ctx.lineTo(p.x - 1, crownY + 3);
    ctx.lineTo(p.x, crownY - 1);
    ctx.lineTo(p.x + 1, crownY + 3);
    ctx.lineTo(p.x + 3, crownY);
    ctx.lineTo(p.x + 4, crownY + 4);
    ctx.closePath();
    ctx.fill();
  }

  // Knight: white cross above sprite
  if (isKnight) {
    const crossY = spriteReady ? p.y - spriteH - 4 : p.y - 10;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, crossY);
    ctx.lineTo(p.x, crossY - 5);
    ctx.moveTo(p.x - 2.5, crossY - 3);
    ctx.lineTo(p.x + 2.5, crossY - 3);
    ctx.stroke();
  }
}

function drawSettlement(s) {
  const h = heights[s.tx][s.ty];

  // Diamond footprint: 1 tile for levels 1-8, 3x3 for castle (level 9)
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

  // Sprite: center at top corner of diamond, bottom-center at bottom corner
  if (settlementSpritesLoaded && s.l >= 1 && s.l <= SETT_LEVEL_NAMES.length) {
    const team = TEAM_SPRITE_NAMES[s.t] || 'blue';
    const key = SETT_LEVEL_NAMES[s.l - 1] + '-' + team;
    const img = settlementSprites[key];
    if (img && (img instanceof HTMLCanvasElement || (img.complete && img.naturalWidth > 0))) {
      const imgW = img.width || img.naturalWidth;
      const imgH = img.height || img.naturalHeight;
      const tileH = pBottom.y - pTop.y;
      const fillPct = s.sz >= 5 ? 0.55 : s.l === 1 ? 0.55 : s.l <= 2 ? 0.75 : s.l <= 6 ? 0.85 : 0.95;
      const centerY = s.sz >= 5 ? pTop.y + tileH * 0.45 : s.l === 1 ? pTop.y + tileH * 0.35 : pTop.y + tileH * 0.25;
      const dh = tileH * fillPct / 0.75;
      const scale = dh / imgH;
      const dw = imgW * scale;
      ctx.drawImage(img, pTop.x - dw / 2, centerY - dh / 2, dw, dh);
    }
  }

  // Draw leader crown on settlement containing leader
  if (s.hl) {
    const crownX = pTop.x;
    const crownY = pTop.y - 6;
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.moveTo(crownX - 5, crownY);
    ctx.lineTo(crownX - 3, crownY - 5);
    ctx.lineTo(crownX, crownY - 2);
    ctx.lineTo(crownX + 3, crownY - 5);
    ctx.lineTo(crownX + 5, crownY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#b8960f';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

// ── Papal Magnet — Beacon ────────────────────────────────────────────
const BEACON_COLORS = [
  { core: '130,180,255', glow: '60,120,255', base: '100,160,255' },   // TEAM_BLUE
  { core: '255,160,130', glow: '255,60,40',  base: '255,100,80' },    // TEAM_RED
  { core: '130,255,130', glow: '40,200,40',  base: '80,220,80' },     // TEAM_GREEN
  { core: '255,255,130', glow: '200,200,40', base: '220,220,80' },    // TEAM_YELLOW
  { core: '200,130,255', glow: '140,40,255', base: '170,80,255' },    // TEAM_PURPLE
  { core: '255,180,100', glow: '255,120,30', base: '255,150,60' },    // TEAM_ORANGE
];

function drawMagnetFlag(team) {
  if (team >= magnetPos.length) return;
  const mp = magnetPos[team];
  if (!mp) return;
  const h = heightAt(mp.x, mp.y);
  const p = project(mp.x, mp.y, h);
  const sx = p.x, sy = p.y;
  const time = performance.now() / 1000;
  const isLocked = magnetLocked[team] || false;
  const colors = BEACON_COLORS[team] || BEACON_COLORS[0];

  // Pulse (gentle 0.85-1.0) or locked flicker (stuttery)
  const pulse = 0.85 + 0.15 * Math.sin(time * 2.5);
  const flicker = isLocked
    ? (Math.sin(time * 17) > 0.3 ? 0.4 : 0.15)
    : pulse;
  const alpha = flicker;

  const beamHeight = 220;
  const beamTopW = 1;
  const beamBotW = 6;
  const topY = sy - beamHeight;

  // Core beam (bright trapezoid)
  ctx.save();
  ctx.globalAlpha = alpha * 0.9;
  ctx.beginPath();
  ctx.moveTo(sx - beamTopW, topY);
  ctx.lineTo(sx + beamTopW, topY);
  ctx.lineTo(sx + beamBotW, sy);
  ctx.lineTo(sx - beamBotW, sy);
  ctx.closePath();
  const beamGrad = ctx.createLinearGradient(sx, topY, sx, sy);
  beamGrad.addColorStop(0, `rgba(${colors.core},0)`);
  beamGrad.addColorStop(0.1, `rgba(${colors.core},0.3)`);
  beamGrad.addColorStop(0.5, `rgba(${colors.core},0.7)`);
  beamGrad.addColorStop(1, `rgba(${colors.core},1)`);
  ctx.fillStyle = beamGrad;
  ctx.fill();
  ctx.restore();

  // Outer glow beam (wider, softer)
  ctx.save();
  ctx.globalAlpha = alpha * 0.3;
  const glowW = beamBotW * 3;
  ctx.beginPath();
  ctx.moveTo(sx - beamTopW * 2, topY);
  ctx.lineTo(sx + beamTopW * 2, topY);
  ctx.lineTo(sx + glowW, sy);
  ctx.lineTo(sx - glowW, sy);
  ctx.closePath();
  const glowGrad = ctx.createLinearGradient(sx, topY, sx, sy);
  glowGrad.addColorStop(0, `rgba(${colors.glow},0)`);
  glowGrad.addColorStop(0.3, `rgba(${colors.glow},0.1)`);
  glowGrad.addColorStop(1, `rgba(${colors.glow},0.3)`);
  ctx.fillStyle = glowGrad;
  ctx.fill();
  ctx.restore();

  // Base glow (radial)
  ctx.save();
  ctx.globalAlpha = alpha * 0.6;
  const baseR = 20;
  const baseGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, baseR);
  baseGrad.addColorStop(0, `rgba(${colors.base},0.8)`);
  baseGrad.addColorStop(0.5, `rgba(${colors.base},0.2)`);
  baseGrad.addColorStop(1, `rgba(${colors.base},0)`);
  ctx.fillStyle = baseGrad;
  ctx.fillRect(sx - baseR, sy - baseR / 2, baseR * 2, baseR);
  ctx.restore();

  // Base diamond
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = `rgb(${colors.core})`;
  ctx.beginPath();
  ctx.moveTo(sx, sy - 4);
  ctx.lineTo(sx + 5, sy);
  ctx.lineTo(sx, sy + 3);
  ctx.lineTo(sx - 5, sy);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${alpha * 0.8})`;
  ctx.fillRect(sx - 1, sy - 1, 2, 2);
  ctx.restore();

  // Rising particles (deterministic, no pool needed)
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,0.8)`;
  for (let i = 0; i < 8; i++) {
    const phase = (time * 40 + i * 31.7) % beamHeight;
    const py = sy - phase;
    const px = sx + Math.sin(time * 3 + i * 2.1) * 3;
    const pAlpha = Math.sin((phase / beamHeight) * Math.PI);
    ctx.globalAlpha = alpha * 0.6 * pAlpha;
    ctx.fillRect(Math.floor(px), Math.floor(py), 1, 1);
  }
  ctx.restore();
}

// ── Fire Particle System ─────────────────────────────────────────────
function updateFireParticles(dt) {
  // Spawn particles for active fires
  for (const f of fires) {
    const intensity = Math.max(0, 1 - f.a / 5);
    const spawnCount = Math.floor(intensity * 3 * dt * 60);
    for (let i = 0; i < spawnCount; i++) {
      fireParticles.push({
        x: f.x + 0.3 + Math.random() * 0.4,
        y: f.y + 0.3 + Math.random() * 0.4,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -0.5 - Math.random() * 0.8,
        life: 0.4 + Math.random() * 0.6,
        maxLife: 0.4 + Math.random() * 0.6,
        size: 1.5 + Math.random() * 2.5,
      });
    }
  }
  // Update existing particles
  for (let i = fireParticles.length - 1; i >= 0; i--) {
    const p = fireParticles[i];
    p.life -= dt;
    if (p.life <= 0) {
      fireParticles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.vy -= 0.5 * dt;
    p.size *= (1 - 0.5 * dt);
  }
}

function drawSingleFire(f) {
  const h = heightAt(f.x + 0.5, f.y + 0.5);
  const p = project(f.x + 0.5, f.y + 0.5, h);
  const intensity = Math.max(0, 1 - f.a / 5);

  // Glow at base
  const glowR = 8 + intensity * 6;
  const grd = ctx.createRadialGradient(p.x, p.y - 4, 0, p.x, p.y - 4, glowR);
  grd.addColorStop(0, `rgba(255,120,20,${0.4 * intensity})`);
  grd.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(p.x - glowR, p.y - 4 - glowR, glowR * 2, glowR * 2);
}

function drawFireParticles() {
  for (const fp of fireParticles) {
    const h = heightAt(fp.x, fp.y);
    const base = project(fp.x, fp.y, h);
    const sx = base.x;
    const sy = base.y + fp.vy * (fp.maxLife - fp.life) * 12;
    const t = 1 - fp.life / fp.maxLife;
    const r = Math.floor(255 - t * 80);
    const g = Math.floor(180 - t * 160);
    const b = Math.floor(30 - t * 30);
    const a = fp.life / fp.maxLife;
    ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, fp.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Armageddon Sky Effects ──────────────────────────────────────────
let armageddonStartTime = 0;
let armageddonShake = { x: 0, y: 0 };
const armageddonEmbers = [];
const EMBER_MAX = 200;

// Supernova targets — a subset of stars that will explode
let supernovaStars = [];

// Falling tiles — edge tiles that break off and tumble into the void
const fallingTiles = [];
const FALLING_TILE_MAX = 80;
let fallingTileTimer = 0;
// Track which tiles have already fallen so we don't repeat (uses fallenTiles Uint8Array declared above)
// Frontier: tiles eligible to fall next (adjacent to already-fallen or on edge)
let fallingFrontier = [];

function onArmageddonStart() {
  armageddonStartTime = performance.now() / 1000;
  fallingTiles.length = 0;
  fallenTiles.fill(0);
  fallingTileTimer = 0;
  fallingFrontier = [];
  // Seed frontier with all map edge tiles
  for (let x = 0; x < localMapW; x++) { fallingFrontier.push([x, 0]); fallingFrontier.push([x, localMapH - 1]); }
  for (let y = 1; y < localMapH - 1; y++) { fallingFrontier.push([0, y]); fallingFrontier.push([localMapW - 1, y]); }

  // Pick ~15 bright stars to go supernova at staggered times
  supernovaStars = [];
  const candidates = stars.filter(s => s.brightness > 0.4);
  for (let i = 0; i < Math.min(15, candidates.length); i++) {
    const idx = Math.floor(Math.random() * candidates.length);
    const s = candidates.splice(idx, 1)[0];
    supernovaStars.push({
      star: s,
      delay: Math.random() * 4,
      ringRadius: 0,
      ringAlpha: 1,
      exploded: false,
    });
  }
}

function updateArmageddonEffects(dt) {
  if (!armageddon) return;
  const elapsed = performance.now() / 1000 - armageddonStartTime;

  // Screen shake
  const shakeIntensity = elapsed < 2 ? 8 * (1 - elapsed / 2)
    : elapsed < 8 ? (1.5 + Math.sin(elapsed * 7) * 0.5) * (1 - (elapsed - 2) / 6)
    : 0;
  armageddonShake.x = (Math.random() - 0.5) * shakeIntensity * 2;
  armageddonShake.y = (Math.random() - 0.5) * shakeIntensity * 2;

  // Spawn embers
  if (armageddonEmbers.length < EMBER_MAX && Math.random() < 0.4) {
    armageddonEmbers.push({
      x: Math.random() * canvas.width,
      y: -10,
      vx: (Math.random() - 0.5) * 40,
      vy: 60 + Math.random() * 120,
      size: 1.5 + Math.random() * 3,
      life: 3 + Math.random() * 4,
      maxLife: 3 + Math.random() * 4,
      bright: 0.5 + Math.random() * 0.5,
    });
  }

  // Update embers
  for (let i = armageddonEmbers.length - 1; i >= 0; i--) {
    const e = armageddonEmbers[i];
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.vy += 15 * dt;
    e.life -= dt;
    if (e.life <= 0 || e.y > canvas.height + 20) {
      armageddonEmbers.splice(i, 1);
    }
  }

  // Update supernova rings
  for (const sn of supernovaStars) {
    if (elapsed < sn.delay) continue;
    if (!sn.exploded) {
      sn.exploded = true;
      sn.ringRadius = 0;
      sn.ringAlpha = 1;
    }
    const snElapsed = elapsed - sn.delay;
    sn.ringRadius = snElapsed * 120;
    sn.ringAlpha = Math.max(0, 1 - snElapsed / 3);
  }

  // Falling tiles — erode edges progressively from map edges inward
  if (elapsed > 3 && heights.length > 0) {
    fallingTileTimer += dt;
    const spawnInterval = Math.max(0.05, 0.3 - elapsed * 0.003);
    while (fallingTileTimer >= spawnInterval && fallingTiles.length < FALLING_TILE_MAX) {
      fallingTileTimer -= spawnInterval;

      // Remove already-fallen entries from frontier
      while (fallingFrontier.length > 0) {
        const last = fallingFrontier[fallingFrontier.length - 1];
        if (fallenTiles[last[1] * localMapW + last[0]]) fallingFrontier.pop();
        else break;
      }
      if (fallingFrontier.length === 0) break;

      // Pick a random frontier tile
      const idx = Math.floor(Math.random() * fallingFrontier.length);
      const [tx, ty] = fallingFrontier[idx];
      fallingFrontier[idx] = fallingFrontier[fallingFrontier.length - 1];
      fallingFrontier.pop();

      const fallenIdx = ty * localMapW + tx;
      if (fallenTiles[fallenIdx]) continue;
      fallenTiles[fallenIdx] = 1;

      // Add neighbors to frontier
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = tx + dx, ny = ty + dy;
        if (nx >= 0 && nx < localMapW && ny >= 0 && ny < localMapH && !fallenTiles[ny * localMapW + nx]) {
          fallingFrontier.push([nx, ny]);
        }
      }

      // Capture current tile appearance
      const t = heights[tx][ty], r = heights[tx + 1][ty];
      const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];
      const color = getTileColor(tx, ty);

      fallingTiles.push({
        tx, ty, t, r, b, l, color,
        offsetY: 0,
        vy: 5 + Math.random() * 20,
        rotAngle: 0,
        rotSpeed: (Math.random() - 0.5) * 3,
        driftX: (Math.random() - 0.5) * 30,
        alpha: 1,
        fallen: true,
      });
    }
  }

  // Update falling tiles
  for (let i = fallingTiles.length - 1; i >= 0; i--) {
    const ft = fallingTiles[i];
    ft.vy += 180 * dt;
    ft.offsetY += ft.vy * dt;
    ft.rotAngle += ft.rotSpeed * dt;
    ft.alpha = Math.max(0, 1 - ft.offsetY / 600);
    if (ft.alpha <= 0) {
      fallingTiles.splice(i, 1);
    }
  }
}

// ── Space Background ────────────────────────────────────────────────
function drawSpaceBackground(time) {
  const elapsed = armageddon ? time - armageddonStartTime : 0;

  // Sky color shifts red during armageddon
  if (armageddon) {
    const redShift = Math.min(1, elapsed / 8);
    const r = Math.floor(5 + redShift * 25);
    const g = Math.floor(8 - redShift * 4);
    const b = Math.floor(15 - redShift * 10);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
  } else {
    ctx.fillStyle = '#05080f';
  }
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Nebula (cached)
  if (!nebulaCanvas || nebulaCanvas.width !== canvas.width || nebulaCanvas.height !== canvas.height) {
    buildNebulaCanvas(canvas.width, canvas.height);
  }
  ctx.drawImage(nebulaCanvas, 0, 0);

  if (armageddon) {
    const redIntensity = Math.min(0.15, elapsed * 0.02);
    const rGrad = ctx.createRadialGradient(canvas.width * 0.5, canvas.height * 0.4, 0,
      canvas.width * 0.5, canvas.height * 0.4, canvas.width * 0.6);
    rGrad.addColorStop(0, `rgba(120, 20, 0, ${redIntensity})`);
    rGrad.addColorStop(1, `rgba(60, 0, 0, ${redIntensity * 0.5})`);
    ctx.fillStyle = rGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Stars
  for (const star of stars) {
    const twinkle = 0.5 + 0.5 * Math.sin(time * star.twinkleSpeed + star.x * 100);
    let alpha = star.brightness * twinkle;
    let size = star.size;
    let r = 255, g = 255, b = 255;

    if (armageddon) {
      const boost = Math.min(1, elapsed / 5);
      alpha = Math.min(1, alpha * (1 + boost * 1.5));
      size = star.size * (1 + boost * 0.8);
      g = Math.floor(255 - boost * 80);
      b = Math.floor(255 - boost * 160);
    }

    const sx = Math.floor(star.x * canvas.width);
    const sy = Math.floor(star.y * canvas.height);
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
    if (size <= 1.5) {
      ctx.fillRect(sx, sy, size, size);
    } else {
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Normal spikes (when not armageddon)
    if (!armageddon && star.brightness > 0.6 && twinkle > 0.8) {
      const spikeHash = Math.sin(Math.floor(time * star.twinkleSpeed * 0.1) * 9999 + star.x * 7777 + star.y * 3333) * 0.5 + 0.5;
      if (spikeHash < 0.002) {
        const intensity = (twinkle - 0.8) / 0.2;
        const len = star.spikeLen * intensity;
        const scx = sx + star.size * 0.5;
        const scy = sy + star.size * 0.5;
        ctx.beginPath();
        ctx.moveTo(scx - len, scy); ctx.lineTo(scx + len, scy);
        ctx.moveTo(scx, scy - len); ctx.lineTo(scx, scy + len);
        ctx.strokeStyle = `rgba(200,220,255,${(alpha * intensity * 0.6).toFixed(2)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(scx - len * 0.6, scy); ctx.lineTo(scx + len * 0.6, scy);
        ctx.moveTo(scx, scy - len * 0.6); ctx.lineTo(scx, scy + len * 0.6);
        ctx.strokeStyle = `rgba(180,200,255,${(alpha * intensity * 0.25).toFixed(2)})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  }

  // Supernova explosions
  if (armageddon) {
    for (const sn of supernovaStars) {
      if (!sn.exploded || sn.ringAlpha <= 0) continue;
      const sx = Math.floor(sn.star.x * canvas.width);
      const sy = Math.floor(sn.star.y * canvas.height);

      const flashAlpha = Math.min(1, sn.ringAlpha * 2);
      if (flashAlpha > 0.05) {
        const flashR = 4 + (1 - sn.ringAlpha) * 12;
        const flashGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, flashR);
        flashGrad.addColorStop(0, `rgba(255, 240, 200, ${flashAlpha.toFixed(2)})`);
        flashGrad.addColorStop(0.4, `rgba(255, 160, 60, ${(flashAlpha * 0.6).toFixed(2)})`);
        flashGrad.addColorStop(1, 'rgba(255, 80, 0, 0)');
        ctx.fillStyle = flashGrad;
        ctx.fillRect(sx - flashR, sy - flashR, flashR * 2, flashR * 2);
      }

      if (sn.ringRadius > 5) {
        ctx.beginPath();
        ctx.arc(sx, sy, sn.ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, ${Math.floor(100 + sn.ringAlpha * 100)}, ${Math.floor(sn.ringAlpha * 60)}, ${(sn.ringAlpha * 0.5).toFixed(2)})`;
        ctx.lineWidth = 2 + sn.ringAlpha * 3;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(sx, sy, sn.ringRadius * 0.85, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 200, 120, ${(sn.ringAlpha * 0.15).toFixed(2)})`;
        ctx.lineWidth = sn.ringRadius * 0.15;
        ctx.stroke();
      }

      if (sn.ringAlpha > 0.5) {
        const spikeLen = 20 + (1 - sn.ringAlpha) * 60;
        const spikeA = (sn.ringAlpha - 0.5) * 2;
        ctx.beginPath();
        ctx.moveTo(sx - spikeLen, sy); ctx.lineTo(sx + spikeLen, sy);
        ctx.moveTo(sx, sy - spikeLen); ctx.lineTo(sx, sy + spikeLen);
        ctx.strokeStyle = `rgba(255, 220, 160, ${(spikeA * 0.7).toFixed(2)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

  }
}

// Draw embers in screen space (on top of map)
function drawArmageddonEmbers() {
  if (!armageddon || armageddonEmbers.length === 0) return;
  for (const e of armageddonEmbers) {
    const t = 1 - e.life / e.maxLife;
    const r = 255;
    const g = Math.floor(200 - t * 150);
    const b = Math.floor(60 - t * 60);
    const a = (e.life / e.maxLife) * e.bright;
    ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.size * (0.5 + 0.5 * (e.life / e.maxLife)), 0, Math.PI * 2);
    ctx.fill();

    // Tiny trail
    ctx.fillStyle = `rgba(${r},${g},${b},${(a * 0.3).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(e.x - e.vx * 0.03, e.y - e.vy * 0.03, e.size * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Draw falling tiles in world space
function drawFallingTiles() {
  if (!armageddon || fallingTiles.length === 0) return;
  for (const ft of fallingTiles) {
    const pTop    = project(ft.tx,     ft.ty,     ft.t);
    const pRight  = project(ft.tx + 1, ft.ty,     ft.r);
    const pBottom = project(ft.tx + 1, ft.ty + 1, ft.b);
    const pLeft   = project(ft.tx,     ft.ty + 1, ft.l);

    const cx = (pTop.x + pRight.x + pBottom.x + pLeft.x) / 4;
    const cy = (pTop.y + pRight.y + pBottom.y + pLeft.y) / 4;

    ctx.save();
    ctx.globalAlpha = ft.alpha;
    ctx.translate(cx + ft.driftX * (ft.offsetY / 200), cy + ft.offsetY);
    ctx.rotate(ft.rotAngle);

    ctx.beginPath();
    ctx.moveTo(pTop.x - cx, pTop.y - cy);
    ctx.lineTo(pRight.x - cx, pRight.y - cy);
    ctx.lineTo(pBottom.x - cx, pBottom.y - cy);
    ctx.lineTo(pLeft.x - cx, pLeft.y - cy);
    ctx.closePath();
    ctx.fillStyle = ft.color;
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    ctx.restore();
  }
}

// ── Waterfall System ────────────────────────────────────────────────
function clientIsTileWater(tx, ty) {
  if (tx < 0 || tx >= localMapW || ty < 0 || ty >= localMapH) return true;
  return heights[tx][ty] <= seaLevel &&
         heights[tx + 1][ty] <= seaLevel &&
         heights[tx + 1][ty + 1] <= seaLevel &&
         heights[tx][ty + 1] <= seaLevel;
}

function spawnWaterfallParticles(dt) {
  if (heights.length === 0) return;
  const rate = 3;
  for (let x = 0; x < localMapW; x++) {
    if (clientIsTileWater(x, localMapH - 1)) spawnAtEdge(x, localMapH - 1, dt, rate);
  }
  for (let y = 0; y < localMapH - 1; y++) {
    if (clientIsTileWater(localMapW - 1, y)) spawnAtEdge(localMapW - 1, y, dt, rate);
  }
}

let wfNextIdx = 0;
function spawnAtEdge(tx, ty, dt, rate) {
  if (Math.random() > rate * dt) return;

  let wp = null;
  for (let i = 0; i < 20; i++) {
    const candidate = waterfallParticles[wfNextIdx];
    wfNextIdx = (wfNextIdx + 1) % WATERFALL_MAX;
    if (!candidate.active) { wp = candidate; break; }
  }
  if (!wp) return;

  const t = Math.random();
  let gx, gy, dvx = 0, dvy = 0;

  if (tx === localMapW - 1 && ty === localMapH - 1) {
    if (Math.random() < 0.5) {
      gx = tx + 1; gy = ty + t;
      dvx = 6; dvy = 3;
    } else {
      gx = tx + t; gy = ty + 1;
      dvx = -3; dvy = 6;
    }
  } else if (tx === localMapW - 1) {
    gx = tx + 1; gy = ty + t;
    dvx = 6; dvy = 3;
  } else {
    gx = tx + t; gy = ty + 1;
    dvx = -3; dvy = 6;
  }

  wp.gx = gx;
  wp.gy = gy;
  wp.ox = 0;
  wp.oy = 0;
  wp.vx = dvx + (Math.random() - 0.5) * 4;
  wp.vy = 15 + Math.random() * 25;
  wp.life = 2.5 + Math.random() * 2.0;
  wp.maxLife = wp.life;
  wp.size = 1 + Math.random() * 1.5;
  wp.active = true;
}

function updateWaterfallParticles(dt) {
  for (const p of waterfallParticles) {
    if (!p.active) continue;
    p.ox += p.vx * dt;
    p.oy += p.vy * dt;
    p.vy += 25 * dt;
    p.life -= dt;
    if (p.life <= 0) p.active = false;
  }
}

function drawWaterfallParticles() {
  for (const p of waterfallParticles) {
    if (!p.active) continue;
    const proj = project(p.gx, p.gy, 0);
    const sx = proj.x + p.ox;
    const sy = proj.y + p.oy;
    const alpha = Math.min(1, p.life / p.maxLife) * 0.6;
    ctx.fillStyle = `rgba(150,200,255,${alpha.toFixed(2)})`;
    ctx.fillRect(Math.floor(sx), Math.floor(sy), p.size, p.size);
  }
}

function drawEdgeMist() {
  for (let x = 0; x < localMapW; x++) {
    if (clientIsTileWater(x, localMapH - 1)) drawMistAt(project(x + 0.5, localMapH - 0.5, 0));
  }
  for (let y = 0; y < localMapH - 1; y++) {
    if (clientIsTileWater(localMapW - 1, y)) drawMistAt(project(localMapW - 0.5, y + 0.5, 0));
  }
}

function drawMistAt(p) {
  const sx = p.x * zoom + _vpCX * (1 - zoom);
  const sy = p.y * zoom + _vpCY * (1 - zoom);
  if (sx < -60 || sx > canvas.width + 60 || sy < -60 || sy > canvas.height + 200) return;

  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#c8dcff';
  const w = TILE_HALF_W * 2;
  const h = TILE_HALF_H * 2;
  ctx.fillRect(p.x - TILE_HALF_W, p.y, w, h);
  ctx.restore();
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

// ── Dynamic Population Bars ─────────────────────────────────────────
function buildPopBars(n) {
  const container = document.getElementById('pop-bars');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const color = TEAM_COLORS[i] || '#888';
    const name = (teamPlayerNames[i] || TEAM_NAMES[i] || '?');
    const label = name.length > 10 ? name.slice(0, 9) + '\u2026' : name;
    const row = document.createElement('div');
    row.className = 'pop-row';
    row.innerHTML =
      '<span class="pop-label" style="color:' + color + ';min-width:60px;font-size:10px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + name + '">' + label + '</span>' +
      '<div class="pop-bar-bg"><div class="pop-bar-fill" id="pop-bar-' + i + '" style="width:0;background:' + color + '"></div></div>' +
      '<span class="pop-val" id="pop-val-' + i + '">0</span>';
    container.appendChild(row);
  }
}

function updateSidebar() {
  const maxPop = 800;

  // Update pop bars for all teams
  for (let i = 0; i < numTeams; i++) {
    const pct = Math.min(100, ((teamPop[i] || 0) / maxPop) * 100);
    const popBar = document.getElementById('pop-bar-' + i);
    const popVal = document.getElementById('pop-val-' + i);
    if (popBar) popBar.style.width = pct + '%';
    if (popVal) popVal.textContent = teamPop[i] || 0;
  }

  // Mana
  const manaPct = Math.min(100, (myMana / MANA_MAX) * 100);
  const manaFill = document.getElementById('mana-bar-fill');
  const manaText = document.getElementById('mana-text');
  if (manaFill) manaFill.style.width = manaPct + '%';
  if (manaText) manaText.textContent = Math.floor(myMana) + ' / ' + MANA_MAX;

  // Mode buttons
  const modeBtns = document.querySelectorAll('.mode-btn');
  modeBtns.forEach(btn => {
    const m = parseInt(btn.dataset.mode);
    btn.classList.toggle('active', teamMode[myTeam] === m);
  });

  // Tool buttons
  const inspBtn = document.getElementById('btn-inspect');
  if (inspBtn) inspBtn.classList.toggle('active', inspectMode);
  const magBtn = document.getElementById('btn-magnet');
  if (magBtn) magBtn.classList.toggle('active', magnetMode);

  // Stats
  const myStats = getTeamStats(myTeam);
  const el = id => document.getElementById(id);
  const s = (id, v) => { const e = el(id); if (e) e.textContent = v; };
  s('stat-my-set', myStats.set);
  s('stat-my-walk', myStats.walk);

  // Opponent stats — show all non-own teams
  const oppDiv = document.getElementById('opp-stats');
  if (oppDiv) {
    let html = '';
    for (let t = 0; t < numTeams; t++) {
      if (t === myTeam) continue;
      const oppStats = getTeamStats(t);
      const color = TEAM_COLORS[t] || '#888';
      const name = teamPlayerNames[t] || TEAM_NAMES[t] || 'Team ' + t;
      html += '<div class="stat-line" style="color:' + color + '">' + name + ': <span class="stat-val">' + oppStats.set + 's / ' + oppStats.walk + 'w</span></div>';
    }
    oppDiv.innerHTML = html;
  }
}

function showSidebar() {
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.add('visible');
}

function centerOnHome() {
  let home;
  if (homePos) {
    home = homePos;
  } else {
    // Fallback: center of map
    home = { x: localMapW / 2, y: localMapH / 2 };
  }
  const h = 3; // approximate land height
  camX = -(home.x - home.y) * TILE_HALF_W;
  updateViewport();
  camY = _vpCY - 80 - (home.x + home.y) * TILE_HALF_H + h * HEIGHT_STEP;
  clampCamera();
}

// ── Profiling ──────────────────────────────────────────────────────
let _profiling = false;
let _profSamples = [];
let _profSections = ['interpolate', 'space', 'walkerGrid', 'culling', 'terrain', 'entities', 'fire', 'mist', 'targeting', 'magnets', 'waterfall', 'hud', 'minimap', 'overlays'];

function startTiming() {
  _profiling = true;
  _profSamples = [];
  console.log('%c[Profiler] Started — collecting frame samples...', 'color: #0af');
}

function stopTimingWithResults() {
  _profiling = false;
  if (_profSamples.length === 0) { console.log('No samples collected.'); return; }
  const n = _profSamples.length;
  const avg = {};
  const max = {};
  for (const key of _profSections.concat(['total', 'tileCount', 'waterCount', 'landCount'])) {
    avg[key] = 0;
    max[key] = 0;
  }
  for (const s of _profSamples) {
    for (const key in s) {
      avg[key] = (avg[key] || 0) + s[key];
      max[key] = Math.max(max[key] || 0, s[key]);
    }
  }
  for (const key in avg) avg[key] /= n;

  console.log(`%c[Profiler] Results over ${n} frames:`, 'color: #0af; font-weight: bold');
  console.log(`  Total:       avg ${avg.total.toFixed(2)}ms   max ${max.total.toFixed(2)}ms`);
  console.log('  ─── Breakdown ───');
  for (const key of _profSections) {
    if (avg[key] !== undefined) {
      const pct = (avg[key] / avg.total * 100).toFixed(0);
      console.log(`  ${key.padEnd(14)} avg ${avg[key].toFixed(2).padStart(7)}ms   max ${max[key].toFixed(2).padStart(7)}ms   ${pct.padStart(3)}%`);
    }
  }
  console.log('  ─── Tile Stats ───');
  console.log(`  Tiles drawn: avg ${Math.round(avg.tileCount)}  (water: ${Math.round(avg.waterCount)}, land: ${Math.round(avg.landCount)})`);
  console.log(`  Visible range: ${_endCol_dbg - _startCol_dbg} cols × ${_endRow_dbg - _startRow_dbg} rows`);
  console.log(`  Zoom: ${zoom.toFixed(3)}`);
  return { avg, max, n };
}

// Expose to console
window.startTiming = startTiming;
window.stopTimingWithResults = stopTimingWithResults;

let _startCol_dbg = 0, _endCol_dbg = 0, _startRow_dbg = 0, _endRow_dbg = 0;

function render() {
  if (heights.length === 0) return;
  const _p = _profiling;
  let _t0, _tStart, _sample;
  if (_p) { _t0 = _tStart = performance.now(); _sample = {}; }

  // Update viewport dimensions and hoist origin
  updateViewport();
  _originX = Math.floor(_vpCX) + camX;
  _originY = 80 + camY;

  // Rebuild land tile cache if invalidated
  if (texturesLoaded) {
    if (landTileCache === null ||
        landTileCacheTexOpacity !== textureOpacity ||
        landTileCacheHiRes !== settingHiRes) {
      buildLandTileFrames();
      // Terrain buffer depends on land tile cache, needs full redraw
      terrainBufferNeedsFull = true;
    }
  }

  // Get interpolated walkers for smooth rendering
  walkers = getInterpolatedWalkers();
  if (_p) { const _t = performance.now(); _sample.interpolate = _t - _t0; _t0 = _t; }

  // Space background (screen space, before zoom)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (settingEffects) {
    drawSpaceBackground(performance.now() / 1000);
  } else {
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (_p) { const _t = performance.now(); _sample.space = _t - _t0; _t0 = _t; }

  // Apply zoom around viewport center (with armageddon screen shake)
  const shx = armageddon ? armageddonShake.x : 0;
  const shy = armageddon ? armageddonShake.y : 0;
  ctx.setTransform(zoom, 0, 0, zoom, _vpCX * (1 - zoom) + shx, _vpCY * (1 - zoom) + shy);

  rebuildWalkerGrid();
  if (_p) { const _t = performance.now(); _sample.walkerGrid = _t - _t0; _t0 = _t; }

  // Falling tiles (behind the map, tumbling into the void during armageddon)
  drawFallingTiles();

  // Compute visible tile range from screen corners (viewport culling)
  const _c0 = screenToGridFlat(0, 0);
  const _c1 = screenToGridFlat(canvas.width, 0);
  const _c2 = screenToGridFlat(0, canvas.height);
  const _c3 = screenToGridFlat(canvas.width, canvas.height);
  const _margin = MAX_HEIGHT;
  const _startCol = Math.max(0, Math.floor(Math.min(_c0.gx, _c1.gx, _c2.gx, _c3.gx)) - _margin);
  const _endCol = Math.min(localMapW, Math.ceil(Math.max(_c0.gx, _c1.gx, _c2.gx, _c3.gx)) + _margin);
  const _startRow = Math.max(0, Math.floor(Math.min(_c0.gy, _c1.gy, _c2.gy, _c3.gy)) - _margin);
  const _endRow = Math.min(localMapH, Math.ceil(Math.max(_c0.gy, _c1.gy, _c2.gy, _c3.gy)) + _margin);
  _startCol_dbg = _startCol; _endCol_dbg = _endCol; _startRow_dbg = _startRow; _endRow_dbg = _endRow;
  if (_p) { const _t = performance.now(); _sample.culling = _t - _t0; _t0 = _t; }

  // Pass 1: terrain
  let _waterCount = 0, _landCount = 0;

  // Init terrain buffer on first frame with state data
  if (!terrainBufferInited && heights.length > 0 && landTileCache) {
    initTerrainBuffer();
  }

  // Use terrain buffer when zoomed out (at high zoom, per-tile rendering is sharper).
  // Buffer is at 1:1 world-space resolution; zoom > 1.5 would visibly blur.
  const useTerrainBuffer = terrainBufferInited && terrainBuffer && !armageddon && zoom <= 1.5;

  if (useTerrainBuffer) {
    // ── Buffer path: single blit + water animation overlay + grid lines ──
    updateTerrainBuffer();

    // Buffer-local origin matches drawTileToBuffer
    const bOriginX = localMapH * TILE_HALF_W;
    const bOriginY = MAX_HEIGHT * HEIGHT_STEP + 32;

    // Buffer pixel (bx, by) corresponds to world pixel (bx - bOriginX + _originX, by - bOriginY + _originY).
    // Buffer's top-left corner sits at world position:
    const bufWorldX = _originX - bOriginX;
    const bufWorldY = _originY - bOriginY;

    // Compute visible world-space bounds and clip to buffer for efficient blit
    const invZ = 1 / zoom;
    const zOffX = _vpCX * (1 - zoom);
    const zOffY = _vpCY * (1 - zoom);
    const wLeft  = (0            - zOffX) * invZ;
    const wTop   = (0            - zOffY) * invZ;
    const wRight = (canvas.width - zOffX) * invZ;
    const wBot   = (canvas.height- zOffY) * invZ;

    // Map visible world bounds to buffer coords
    let srcX = Math.max(0, Math.floor(wLeft - bufWorldX));
    let srcY = Math.max(0, Math.floor(wTop  - bufWorldY));
    let srcR = Math.min(terrainBufferW, Math.ceil(wRight  - bufWorldX));
    let srcB = Math.min(terrainBufferH, Math.ceil(wBot    - bufWorldY));
    let srcW = srcR - srcX;
    let srcH = srcB - srcY;

    if (srcW > 0 && srcH > 0) {
      ctx.drawImage(terrainBuffer, srcX, srcY, srcW, srcH,
        bufWorldX + srcX, bufWorldY + srcY, srcW, srcH);
    }

    // Water animation overlay: iterate visible tiles, draw only water with animated frame
    for (let row = _startRow; row < _endRow; row++) {
      for (let col = _startCol; col < _endCol; col++) {
        const t = heights[col][row], r = heights[col + 1][row];
        const b = heights[col + 1][row + 1], l = heights[col][row + 1];
        const isWater = (t <= seaLevel && r <= seaLevel && b <= seaLevel && l <= seaLevel);
        if (!isWater || !waterFrames) continue;
        if (_p) _waterCount++;
        const pTopX = _originX + (col - row) * TILE_HALF_W;
        const pTopY = _originY + (col + row) * TILE_HALF_H;
        const fi = (waterFrameCounter + col + row) % WATER_FRAME_COUNT;
        const wf = waterFrames[fi];
        ctx.drawImage(wf, 0, 0, wf.width, wf.height,
          pTopX - TILE_HALF_W, pTopY, TILE_HALF_W * 2, TILE_HALF_H * 2);
      }
    }

    // Grid lines overlay: iterate visible tiles, stroke at screen resolution
    if (GRID_MODES[gridMode]) {
      ctx.strokeStyle = GRID_MODES[gridMode];
      ctx.lineWidth = 1;
      for (let row = _startRow; row < _endRow; row++) {
        for (let col = _startCol; col < _endCol; col++) {
          if (fallenTiles[row * localMapW + col]) continue;
          const t = heights[col][row], r = heights[col + 1][row];
          const b = heights[col + 1][row + 1], l = heights[col][row + 1];
          const pTopX = _originX + (col - row) * TILE_HALF_W;
          const pTopY = _originY + (col + row) * TILE_HALF_H - t * HEIGHT_STEP;
          ctx.beginPath();
          ctx.moveTo(pTopX, pTopY);
          ctx.lineTo(pTopX + TILE_HALF_W, pTopY + TILE_HALF_H - (r - t) * HEIGHT_STEP);
          ctx.lineTo(pTopX, pTopY + 2 * TILE_HALF_H - (b - t) * HEIGHT_STEP);
          ctx.lineTo(pTopX - TILE_HALF_W, pTopY + TILE_HALF_H - (l - t) * HEIGHT_STEP);
          ctx.closePath();
          ctx.stroke();
        }
      }
    }

    if (_p) _landCount = localMapW * localMapH - _waterCount;
  } else {
    // ── Fallback path: per-tile rendering (armageddon or buffer disabled) ──
    for (let row = _startRow; row < _endRow; row++) {
      for (let col = _startCol; col < _endCol; col++) {
        if (fallenTiles[row * localMapW + col]) continue;
        if (_p) {
          const t = heights[col][row], r = heights[col + 1][row];
          const b = heights[col + 1][row + 1], l = heights[col][row + 1];
          if (t <= seaLevel && r <= seaLevel && b <= seaLevel && l <= seaLevel) _waterCount++;
          else _landCount++;
        }
        drawTile(col, row);
      }
    }
  }

  if (_p) { const _t = performance.now(); _sample.terrain = _t - _t0; _sample.tileCount = _waterCount + _landCount; _sample.waterCount = _waterCount; _sample.landCount = _landCount; _t0 = _t; }

  // Pass 2: settlements, walkers, and fires sorted together by depth (x+y)
  const drawList = [];
  for (const s of settlements) {
    drawList.push({ depth: s.ox + s.oy + s.sz, type: 's', obj: s });
  }
  for (const w of walkers) {
    drawList.push({ depth: w.x + w.y, type: 'w', obj: w });
  }
  for (const f of fires) {
    drawList.push({ depth: f.x + f.y + 0.5, type: 'f', obj: f });
  }
  drawList.sort((a, b) => a.depth - b.depth);
  for (const item of drawList) {
    if (item.type === 's') drawSettlement(item.obj);
    else if (item.type === 'w') drawWalker(item.obj);
    else drawSingleFire(item.obj);
  }
  if (_p) { const _t = performance.now(); _sample.entities = _t - _t0; _t0 = _t; }

  // Fire particles (on top of everything in world space)
  drawFireParticles();
  if (_p) { const _t = performance.now(); _sample.fire = _t - _t0; _t0 = _t; }

  // Edge mist (world space, tied to tiles)
  if (settingEffects) drawEdgeMist();
  if (_p) { const _t = performance.now(); _sample.mist = _t - _t0; _t0 = _t; }

  // Targeting overlay
  if (targetingPower) {
    const powerDef = POWERS.find(p => p.id === targetingPower);
    if (powerDef) {
      const { px, py } = screenToGrid(mouseX, mouseY);
      let radius = 0;
      if (targetingPower === 'earthquake') radius = EARTHQUAKE_RADIUS;
      else if (targetingPower === 'volcano') radius = VOLCANO_RADIUS;

      if (radius > 0) {
        for (let tx = Math.max(0, px - radius); tx < Math.min(localMapW, px + radius); tx++) {
          for (let ty = Math.max(0, py - radius); ty < Math.min(localMapH, py + radius); ty++) {
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
        const tx = Math.floor(px), ty = Math.floor(py);
        if (tx >= 0 && tx < localMapW && ty >= 0 && ty < localMapH) {
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

  if (_p) { const _t = performance.now(); _sample.targeting = _t - _t0; _t0 = _t; }

  // Magnet flags — draw for all teams
  for (let t = 0; t < numTeams; t++) {
    drawMagnetFlag(t);
  }
  if (_p) { const _t = performance.now(); _sample.magnets = _t - _t0; _t0 = _t; }

  // Waterfall particles (front edges, falling into the void)
  if (settingEffects) drawWaterfallParticles();
  if (_p) { const _t = performance.now(); _sample.waterfall = _t - _t0; _t0 = _t; }

  // Reset transform for HUD (drawn in screen space)
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Armageddon embers (screen space, in front of everything)
  if (settingEffects) drawArmageddonEmbers();

  // Power bar needs responsive updates (targeting feedback)
  updatePowerBar();
  // Sidebar — throttle DOM updates to ~4/sec
  const _now = performance.now();
  if (!updateSidebar._last || _now - updateSidebar._last > 250) {
    updateSidebar._last = _now;
    updateSidebar();
  }
  if (_p) { const _t = performance.now(); _sample.hud = _t - _t0; _t0 = _t; }

  // Minimap (drawn on top of HUD, in screen space)
  drawMinimap();
  if (_p) { const _t = performance.now(); _sample.minimap = _t - _t0; _t0 = _t; }

  // Inspect tooltip
  if (inspectData) drawInspectTooltip();

  // Armageddon overlay
  if (armageddon && !gameOver) {
    const t = performance.now() / 1000;
    const cx = canvas.width / 2;

    // Screen-edge red vignette
    const vigGrad = ctx.createRadialGradient(cx, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.3,
      cx, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.7);
    vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vigGrad.addColorStop(1, `rgba(80, 0, 0, ${(0.3 + 0.1 * Math.sin(t * 2)).toFixed(2)})`);
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Title text with glow
    const pulse = 0.7 + 0.3 * Math.sin(t * 3);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.shadowColor = `rgba(255, 40, 0, ${(pulse * 0.8).toFixed(2)})`;
    ctx.shadowBlur = 30 + pulse * 20;
    ctx.font = "bold 52px 'Cinzel Decorative', 'Cinzel', serif";
    ctx.fillStyle = `rgba(255, ${Math.floor(60 + pulse * 40)}, 0, 0.95)`;
    ctx.fillText('ARMAGEDDON', cx, 55);

    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(255, ${Math.floor(180 + pulse * 75)}, ${Math.floor(80 + pulse * 60)}, 1)`;
    ctx.fillText('ARMAGEDDON', cx, 55);

    ctx.restore();
  }

  // Game over overlay
  if (gameOver) {
    const t = performance.now() / 1000;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const won = gameWinner === myTeam;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const hlColor = won ? 'rgba(40, 80, 200, 0.12)' : 'rgba(200, 40, 40, 0.08)';
    const hlGrad = ctx.createRadialGradient(cx, cy - 40, 0, cx, cy - 40, 300);
    hlGrad.addColorStop(0, hlColor);
    hlGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hlGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const resultText = won ? 'VICTORY' : 'DEFEAT';
    const resultColor = won ? '#6aafff' : '#ff5544';
    const glowColor = won ? 'rgba(80, 140, 255, 0.6)' : 'rgba(255, 60, 40, 0.5)';
    const pulse = 0.8 + 0.2 * Math.sin(t * 2);

    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 25 * pulse;
    ctx.font = "900 64px 'Cinzel Decorative', 'Cinzel', serif";
    ctx.fillStyle = resultColor;
    ctx.fillText(resultText, cx, cy - 50);

    ctx.shadowBlur = 0;
    ctx.fillText(resultText, cx, cy - 50);

    ctx.font = "300 18px 'Raleway', sans-serif";
    ctx.letterSpacing = '4px';
    ctx.fillStyle = 'rgba(200, 210, 230, 0.7)';
    const subText = won
      ? `${teamPlayerNames[myTeam] || 'You'}, the ${TEAM_NAMES[myTeam]} God`
      : `${gameWinnerName}, the ${TEAM_NAMES[gameWinner]} God has prevailed`;
    ctx.fillText(subText, cx, cy + 10);

    const lineW = 160;
    const lineGrad = ctx.createLinearGradient(cx - lineW, 0, cx + lineW, 0);
    lineGrad.addColorStop(0, 'rgba(255,255,255,0)');
    lineGrad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    lineGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lineGrad;
    ctx.fillRect(cx - lineW, cy + 35, lineW * 2, 1);

    // Buttons
    ctx.font = "600 14px 'Raleway', sans-serif";
    const btnY = cy + 70;
    const btn1X = cx - 90, btn2X = cx + 90;
    const btnW = 140, btnH = 40;

    const b1hover = gameOverHover === 'again';
    ctx.fillStyle = b1hover ? 'rgba(40, 65, 130, 0.9)' : 'rgba(25, 40, 80, 0.8)';
    ctx.strokeStyle = b1hover ? 'rgba(100, 160, 255, 0.6)' : 'rgba(80, 120, 200, 0.3)';
    ctx.lineWidth = 1;
    roundRect(ctx, btn1X - btnW/2, btnY - btnH/2, btnW, btnH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = b1hover ? '#fff' : 'rgba(180, 210, 255, 0.9)';
    ctx.fillText('PLAY AGAIN', btn1X, btnY);

    const b2hover = gameOverHover === 'lobby';
    ctx.fillStyle = b2hover ? 'rgba(50, 50, 60, 0.9)' : 'rgba(30, 30, 40, 0.8)';
    ctx.strokeStyle = b2hover ? 'rgba(160, 160, 180, 0.5)' : 'rgba(100, 100, 120, 0.3)';
    roundRect(ctx, btn2X - btnW/2, btnY - btnH/2, btnW, btnH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = b2hover ? '#fff' : 'rgba(180, 180, 200, 0.8)';
    ctx.fillText('LOBBY', btn2X, btnY);

    gameOverBtns.again = { x: btn1X - btnW/2, y: btnY - btnH/2, w: btnW, h: btnH };
    gameOverBtns.lobby = { x: btn2X - btnW/2, y: btnY - btnH/2, w: btnW, h: btnH };

    ctx.restore();
  }

  if (_p) { const _t = performance.now(); _sample.overlays = _t - _t0; _sample.total = _t - _tStart; _profSamples.push(_sample); }
}

// Rounded rect helper
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

// Game over button state
let gameOverHover = null;
const gameOverBtns = { again: null, lobby: null };

// Track hover over game over buttons
window.addEventListener('mousemove', (e) => {
  if (!gameOver) { gameOverHover = null; return; }
  const mx = e.clientX, my = e.clientY;
  gameOverHover = null;
  for (const key of ['again', 'lobby']) {
    const b = gameOverBtns[key];
    if (b && mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
      gameOverHover = key;
      break;
    }
  }
  canvas.style.cursor = gameOverHover ? 'pointer' : (gameOver ? 'default' : 'crosshair');
});

function returnToLobby() {
  // Close existing connection
  if (ws) { ws.close(); ws = null; }

  // Reset game state
  gameStarted = false;
  gameOver = false;
  gameWinner = -1;
  gameWinnerName = '';
  teamPlayerNames = [];
  gameOverHover = null;
  gameOverBtns.again = null;
  gameOverBtns.lobby = null;
  armageddon = false;
  fallingTiles.length = 0;
  fallenTiles.fill(0);
  fallingFrontier = [];
  armageddonEmbers.length = 0;
  supernovaStars = [];
  heights = [];
  walkers = [];
  settlements = [];
  myTeam = -1;
  myMana = 0;
  targetingPower = null;
  inspectMode = false;
  inspectData = null;
  magnetMode = false;
  homePos = null;

  // Reset dynamic dimensions
  localMapW = MAP_W;
  localMapH = MAP_H;
  numTeams = 2;
  initTeamArrays(2);
  walkerGrid = new Array(localMapW * localMapH);
  reinitTypedArrays();

  // Show lobby, hide game
  document.getElementById('game').style.display = 'none';
  document.getElementById('sidebar').classList.remove('visible');
  document.getElementById('settings-popup').classList.remove('visible');
  document.getElementById('lobby').style.display = 'flex';
  document.getElementById('lobby-bg').style.display = 'block';
  const lobbyVol = document.getElementById('lobby-vol');
  if (lobbyVol) lobbyVol.style.display = 'flex';
  document.getElementById('create-join-section').style.display = '';
  document.getElementById('waiting-section').style.display = 'none';
  document.getElementById('error-text').textContent = '';
  document.getElementById('room-chat-messages').innerHTML = '';
  document.getElementById('lobby-chat-messages').innerHTML = '';
  document.getElementById('start-game-row').style.display = 'none';
  isCreator = false;
  canvas.style.cursor = 'crosshair';

  // Restart lobby background
  lobbyActive = true;
  resizeLobbyBg();
  requestAnimationFrame(renderLobby);

  // Reconnect fresh for lobby browsing
  connectToServer();
}

// ── Picking ─────────────────────────────────────────────────────────
function screenToGrid(sx, sy) {
  // Reverse zoom transform to get world-space screen coords
  sx = (sx - _vpCX * (1 - zoom)) / zoom;
  sy = (sy - _vpCY * (1 - zoom)) / zoom;

  const o = getOrigin();
  const dx = sx - o.x, dy = sy - o.y;
  const fpx = (dx / TILE_HALF_W + dy / TILE_HALF_H) / 2;
  const fpy = (dy / TILE_HALF_H - dx / TILE_HALF_W) / 2;

  let bestDist = Infinity, bestPx = Math.round(fpx), bestPy = Math.round(fpy);
  const bx = Math.floor(fpx), by = Math.floor(fpy);
  const R = Math.ceil(MAX_HEIGHT / 2) + 1;

  for (let ix = bx - R; ix <= bx + R; ix++) {
    for (let iy = by - R; iy <= by + R; iy++) {
      if (ix < 0 || ix > localMapW || iy < 0 || iy > localMapH) continue;
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
let gameWinnerName = '';
let teamPlayerNames = [];
let room_wasAI = false;
let room_lastMaxPlayers = 2;
let room_lastMapSize = 'small';
let isCreator = false;
let lobbyReconnectTimer = null;

// Player name persistence
function getPlayerName() {
  const input = document.getElementById('player-name');
  let name = (input ? input.value.trim() : '') || 'Player';
  name = name.replace(/[<>&"']/g, '').slice(0, 16) || 'Player';
  localStorage.setItem('playerName', name);
  return name;
}

function loadPlayerName() {
  const saved = localStorage.getItem('playerName');
  const input = document.getElementById('player-name');
  if (saved && input) input.value = saved;
}

// Escape HTML for chat
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Append chat message to a container
function appendChatMessage(containerId, name, text) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = '<span class="chat-msg-name">' + escapeHtml(name) + ':</span> <span class="chat-msg-text">' + escapeHtml(text) + '</span>';
  container.appendChild(div);
  // Cap at 100 messages
  while (container.children.length > 100) container.removeChild(container.firstChild);
  container.scrollTop = container.scrollHeight;
}

// Render game browser
function renderGameBrowser(games) {
  const browser = document.getElementById('game-browser');
  if (!browser) return;
  // Update tab badge
  const browseTab = document.querySelector('.lobby-tab[data-tab="browse"]');
  if (browseTab) {
    browseTab.textContent = games && games.length > 0 ? 'Browser (' + games.length + ')' : 'Game Browser';
  }
  if (!games || games.length === 0) {
    browser.innerHTML = '<div class="game-browser-empty">No public games available</div>';
    return;
  }
  browser.innerHTML = '';
  for (const g of games) {
    const item = document.createElement('div');
    item.className = 'game-browser-item';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'gb-name';
    nameSpan.textContent = g.name || g.creatorName + "'s game";
    const infoSpan = document.createElement('span');
    infoSpan.className = 'gb-info';
    infoSpan.textContent = g.players + '/' + g.maxPlayers + ' · ' + g.mapSize;
    const joinBtn = document.createElement('button');
    joinBtn.className = 'gb-join';
    joinBtn.textContent = 'Join';
    joinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendMessage({ type: 'join', code: g.code, playerName: getPlayerName() });
    });
    item.appendChild(nameSpan);
    item.appendChild(infoSpan);
    item.appendChild(joinBtn);
    browser.appendChild(item);
  }
}

// Render waiting room players
function renderWaitingPlayers(names, aiCount, maxPlayers) {
  const list = document.getElementById('waiting-player-list');
  if (!list) return;
  list.innerHTML = '';
  const totalHumans = names ? names.length : 0;
  for (let i = 0; i < totalHumans; i++) {
    const tag = document.createElement('span');
    tag.className = 'waiting-player-tag';
    tag.textContent = names[i] || 'Player';
    list.appendChild(tag);
  }
  for (let i = 0; i < (aiCount || 0); i++) {
    const tag = document.createElement('span');
    tag.className = 'waiting-player-tag ai-tag';
    tag.textContent = 'AI';
    list.appendChild(tag);
  }
  const emptySlots = maxPlayers - totalHumans - (aiCount || 0);
  for (let i = 0; i < emptySlots; i++) {
    const tag = document.createElement('span');
    tag.className = 'waiting-player-tag empty-tag';
    tag.textContent = '...';
    list.appendChild(tag);
  }
}

function connectToServer() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return; // Already connected/connecting
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(protocol + '//' + location.host);

  ws.onopen = () => {
    console.log('Connected to server');
    let name = getPlayerName();
    if (name === 'Player') {
      // Show name prompt modal
      const overlay = document.getElementById('name-prompt-overlay');
      const input = document.getElementById('name-prompt-input');
      const btn = document.getElementById('name-prompt-btn');
      overlay.classList.add('visible');
      input.value = '';
      input.focus();
      const submitName = () => {
        const val = (input.value || '').replace(/[<>&"']/g, '').trim().slice(0, 16);
        if (val) {
          name = val;
          const nameField = document.getElementById('player-name');
          if (nameField) nameField.value = name;
          localStorage.setItem('playerName', name);
        }
        overlay.classList.remove('visible');
        ws.send(JSON.stringify({ type: 'set_name', name }));
        const queued = pendingMessages.splice(0);
        for (const m of queued) ws.send(JSON.stringify(m));
        btn.removeEventListener('click', submitName);
        input.removeEventListener('keydown', onKey);
      };
      const onKey = (e) => { if (e.key === 'Enter') submitName(); };
      btn.addEventListener('click', submitName);
      input.addEventListener('keydown', onKey);
    } else {
      // Send player name immediately
      ws.send(JSON.stringify({ type: 'set_name', name }));
      // Flush any pending messages
      const queued = pendingMessages.splice(0);
      for (const m of queued) ws.send(JSON.stringify(m));
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleServerMessage(msg);
  };

  ws.onclose = () => {
    console.log('Disconnected from server');
    // Auto-reconnect if still in lobby
    if (!gameStarted) {
      if (lobbyReconnectTimer) clearTimeout(lobbyReconnectTimer);
      lobbyReconnectTimer = setTimeout(() => {
        if (!gameStarted) connectToServer();
      }, 2000);
    }
  };
}

// Connect immediately on page load
loadPlayerName();
connectToServer();

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'game_list':
      renderGameBrowser(msg.games);
      break;

    case 'lobby_chat':
      appendChatMessage('lobby-chat-messages', msg.name, msg.text);
      break;

    case 'lobby_system': {
      const container = document.getElementById('lobby-chat-messages');
      if (!container) break;
      const div = document.createElement('div');
      div.className = 'chat-msg chat-msg-system';
      div.textContent = msg.text;
      container.appendChild(div);
      while (container.children.length > 100) container.removeChild(container.firstChild);
      container.scrollTop = container.scrollHeight;
      break;
    }

    case 'lobby_count': {
      const el = document.getElementById('lobby-count');
      if (el) el.textContent = msg.count + ' online';
      break;
    }

    case 'room_chat':
      appendChatMessage('room-chat-messages', msg.name, msg.text);
      break;

    case 'created':
      myTeam = msg.team;
      isCreator = true;
      document.getElementById('room-code').textContent = msg.code;
      document.getElementById('create-join-section').style.display = 'none';
      document.getElementById('waiting-section').style.display = 'block';
      document.getElementById('waiting-game-name').textContent = msg.gameName || '';
      document.getElementById('waiting-ai-btns').style.display = 'flex';
      document.getElementById('start-game-row').style.display = 'block';
      document.getElementById('btn-start-game').disabled = true;
      document.getElementById('room-chat-messages').innerHTML = '';
      break;

    case 'joined':
      myTeam = msg.team;
      isCreator = false;
      document.getElementById('create-join-section').style.display = 'none';
      document.getElementById('waiting-section').style.display = 'block';
      document.getElementById('waiting-game-name').textContent = msg.gameName || '';
      document.getElementById('waiting-ai-btns').style.display = 'none';
      document.getElementById('start-game-row').style.display = 'none';
      document.getElementById('room-code').textContent = msg.code;
      // Load chat history
      document.getElementById('room-chat-messages').innerHTML = '';
      if (msg.chatLog) {
        for (const entry of msg.chatLog) {
          appendChatMessage('room-chat-messages', entry.name, entry.text);
        }
      }
      break;

    case 'waiting_update':
      document.getElementById('waiting-text').textContent =
        'Waiting for players... (' + msg.connectedPlayers + ' of ' + msg.maxPlayers + ')';
      renderWaitingPlayers(msg.playerNames, msg.aiCount, msg.maxPlayers);
      if (isCreator) {
        document.getElementById('btn-start-game').disabled = msg.connectedPlayers < 2;
      }
      break;

    case 'start': {
      if (myTeam < 0) myTeam = 0; // AI game — default to blue

      // Extract map dimensions and team count from start message
      const startNumTeams = msg.numTeams || 2;
      const startMapW = msg.mapW || MAP_W;
      const startMapH = msg.mapH || MAP_H;
      const startSpawnZones = msg.spawnZones || [];

      // Set dynamic dimensions
      localMapW = startMapW;
      localMapH = startMapH;
      numTeams = startNumTeams;

      // Reinitialize walker grid and typed arrays for new dimensions
      walkerGrid = new Array(localMapW * localMapH);
      reinitTypedArrays();

      // Initialize team arrays
      initTeamArrays(numTeams);

      // Set home position from spawn zones
      if (startSpawnZones.length > myTeam) {
        homePos = { x: startSpawnZones[myTeam].cx, y: startSpawnZones[myTeam].cy };
      } else {
        homePos = { x: localMapW / 2, y: localMapH / 2 };
      }

      // Store player names
      teamPlayerNames = msg.playerNames || TEAM_NAMES.slice(0, numTeams);

      // Build population bars for N teams
      buildPopBars(numTeams);

      gameStarted = true;
      lobbyActive = false;
      document.getElementById('lobby').style.display = 'none';
      document.getElementById('lobby-bg').style.display = 'none';
      const lobbyVol = document.getElementById('lobby-vol');
      if (lobbyVol) lobbyVol.style.display = 'none';
      document.getElementById('game').style.display = 'block';
      showSidebar();
      showPowerBar();
      startMusic();
      resize();
      centerOnHome();
      lastFrame = performance.now();
      requestAnimationFrame(gameLoop);
      break;
    }

    case 'state':
      applyStateSnapshot(msg);
      break;

    case 'gameover':
      gameOver = true;
      gameWinner = msg.winner;
      gameWinnerName = msg.winnerName || TEAM_NAMES[msg.winner];
      break;

    case 'error':
      document.getElementById('error-text').textContent = msg.message;
      break;
  }
}

function applyStateSnapshot(msg) {
  if (msg.full) {
    applyFullSnapshot(msg);
  } else {
    applyDeltaSnapshot(msg);
  }
}

// ── Tile Overlay Helpers ───────────────────────────────────────────
function applySwamps(data) {
  swamps = data || [];
  swampTiles.fill(0);
  for (const s of swamps) swampTiles[s.y * localMapW + s.x] = 1;
}

function applyRocks(data) {
  rockTiles.fill(0);
  if (data) {
    for (let i = 0; i < data.length; i += 2)
      rockTiles[data[i + 1] * localMapW + data[i]] = 1;
  }
}

function applyTrees(data) {
  treeTiles.fill(0);
  treeCoords = data || [];
  if (data) {
    for (let i = 0; i < data.length; i += 2)
      treeTiles[data[i + 1] * localMapW + data[i]] = 1;
  }
}

function applyPebbles(data) {
  pebbleTiles.fill(0);
  pebbleCoords = data || [];
  if (data) {
    for (let i = 0; i < data.length; i += 2)
      pebbleTiles[data[i + 1] * localMapW + data[i]] = 1;
  }
}

function applyRuins(data) {
  ruins = [];
  ruinTiles.fill(0);
  if (data) {
    for (let i = 0; i < data.length; i += 3) {
      ruins.push({ x: data[i], y: data[i + 1], team: data[i + 2] });
      ruinTiles[data[i + 1] * localMapW + data[i]] = data[i + 2] + 1;
    }
  }
}

function applyCrops(data) {
  cropTeamTiles.fill(0);
  if (data) {
    for (let i = 0; i < data.length; i += 3) {
      const team = data[i + 2];
      if (team >= 0 && team < numTeams)
        cropTeamTiles[data[i + 1] * localMapW + data[i]] = team + 1;
    }
  }
}

function applyHeights(heightsPayload) {
  if (!heightsPayload) return;
  if (heightsPayload.full) {
    const flat = heightsPayload.full;
    if (heights.length === 0) {
      for (let x = 0; x <= localMapW; x++) {
        heights[x] = [];
        for (let y = 0; y <= localMapH; y++) {
          heights[x][y] = 0;
        }
      }
    }
    let idx = 0;
    for (let y = 0; y <= localMapH; y++) {
      for (let x = 0; x <= localMapW; x++) {
        heights[x][y] = flat[idx++];
      }
    }
  } else if (heightsPayload.delta) {
    const delta = heightsPayload.delta;
    for (let i = 0; i < delta.length; i += 3) {
      const x = delta[i], y = delta[i + 1], h = delta[i + 2];
      if (heights[x]) heights[x][y] = h;
    }
  }
}

function applyFullSnapshot(msg) {
  if (msg.mapW) localMapW = msg.mapW;
  if (msg.mapH) localMapH = msg.mapH;
  if (msg.numTeams) numTeams = msg.numTeams;

  applyHeights(msg.heights);

  // Shift walker snapshots for interpolation
  prevWalkers = currWalkers;
  currWalkers = msg.walkers;
  lastTickTime = performance.now();

  // Rebuild walkerMap from full walker list
  walkerMap = new Map();
  for (const w of currWalkers) walkerMap.set(w.id, w);

  // Unpack settlements
  settlements = msg.settlements;

  // Rebuild settlementMap
  settlementMap = new Map();
  for (const s of settlements) settlementMap.set(s.tx + ',' + s.ty, s);

  // Other state
  magnetPos = msg.magnetPos;
  teamMode = msg.teamMode;
  myMana = msg.mana;

  applySwamps(msg.swamps);
  applyRocks(msg.rocks);
  applyTrees(msg.trees);
  applyPebbles(msg.pebbles);
  applyRuins(msg.ruins);
  applyCrops(msg.crops);

  seaLevel = msg.seaLevel !== undefined ? msg.seaLevel : SEA_LEVEL;
  leaders = msg.leaders || [];
  const wasArmageddon = armageddon;
  armageddon = msg.armageddon || false;
  if (armageddon && !wasArmageddon) onArmageddonStart();
  magnetLocked = msg.magnetLocked || [];
  teamPop = msg.teamPop || [];
  fires = msg.fires || [];
  minimapDirty = true;

  detectTerrainDirty(msg);
}

function applyDeltaSnapshot(msg) {
  if (msg.mapW) localMapW = msg.mapW;
  if (msg.mapH) localMapH = msg.mapH;
  if (msg.numTeams) numTeams = msg.numTeams;

  // Heights (already supports delta)
  if (msg.heights) applyHeights(msg.heights);

  // Walker delta
  prevWalkers = currWalkers;

  // Apply position-only moves
  if (msg.wMov) {
    for (let i = 0; i < msg.wMov.length; i += 3) {
      const id = msg.wMov[i], x = msg.wMov[i + 1], y = msg.wMov[i + 2];
      const w = walkerMap.get(id);
      if (w) { w.x = x; w.y = y; }
    }
  }

  // Apply full updates (new or changed walkers)
  if (msg.wUpd) {
    for (const w of msg.wUpd) {
      walkerMap.set(w.id, w);
    }
  }

  // Remove dead walkers
  if (msg.wRem) {
    for (const id of msg.wRem) walkerMap.delete(id);
  }

  // Rebuild currWalkers array from map
  currWalkers = Array.from(walkerMap.values());
  lastTickTime = performance.now();

  // Settlement delta
  if (msg.sUpd) {
    for (const s of msg.sUpd) {
      settlementMap.set(s.tx + ',' + s.ty, s);
    }
  }
  if (msg.sRem) {
    for (let i = 0; i < msg.sRem.length; i += 2) {
      settlementMap.delete(msg.sRem[i] + ',' + msg.sRem[i + 1]);
    }
  }
  if (msg.sUpd || msg.sRem) {
    settlements = Array.from(settlementMap.values());
  }

  // Always-present fields
  if (msg.mana !== undefined) myMana = msg.mana;
  if (msg.teamPop) teamPop = msg.teamPop;
  if (msg.fires) fires = msg.fires;

  // Conditional fields — only update if present
  if (msg.swamps !== undefined) applySwamps(msg.swamps);
  if (msg.rocks !== undefined) applyRocks(msg.rocks);
  if (msg.trees !== undefined) applyTrees(msg.trees);
  if (msg.pebbles !== undefined) applyPebbles(msg.pebbles);
  if (msg.ruins !== undefined) applyRuins(msg.ruins);
  if (msg.crops !== undefined) applyCrops(msg.crops);

  if (msg.magnetPos !== undefined) magnetPos = msg.magnetPos;
  if (msg.teamMode !== undefined) teamMode = msg.teamMode;
  if (msg.seaLevel !== undefined) seaLevel = msg.seaLevel;
  if (msg.leaders !== undefined) leaders = msg.leaders;
  if (msg.magnetLocked !== undefined) magnetLocked = msg.magnetLocked;

  if (msg.armageddon !== undefined) {
    const wasArmageddon = armageddon;
    armageddon = msg.armageddon;
    if (armageddon && !wasArmageddon) onArmageddonStart();
  }

  minimapDirty = true;
  detectTerrainDirty(msg);
}

// ── Terrain Buffer Dirty Detection ──────────────────────────────────
function markTileDirty(tx, ty) {
  if (!terrainBufferDirty) return;
  // Mark tile and all 8 neighbors (tiles overlap due to height and isometric projection)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const nx = tx + dx, ny = ty + dy;
      if (nx >= 0 && nx < localMapW && ny >= 0 && ny < localMapH) {
        terrainBufferDirty[ny * localMapW + nx] = 1;
      }
    }
  }
}

function detectTerrainDirty(msg) {
  if (!terrainBufferInited) return;

  const sz = localMapW * localMapH;
  let dirtyCount = 0;

  // 1. Height deltas — each [x,y,h] triplet marks surrounding tiles dirty
  const hp = msg.heights;
  if (hp) {
    if (hp.full) {
      // Full height update — need full redraw
      terrainBufferNeedsFull = true;
      // Copy overlay state for next diff
      if (prevCropTeamTiles) prevCropTeamTiles.set(cropTeamTiles);
      if (prevSwampTiles) prevSwampTiles.set(swampTiles);
      if (prevRockTiles) prevRockTiles.set(rockTiles);
      if (prevTreeTiles) prevTreeTiles.set(treeTiles);
      if (prevPebbleTiles) prevPebbleTiles.set(pebbleTiles);
      if (prevRuinTiles) prevRuinTiles.set(ruinTiles);
      prevSeaLevel = seaLevel;
      return;
    }
    if (hp.delta) {
      const delta = hp.delta;
      for (let i = 0; i < delta.length; i += 3) {
        const px = delta[i], py = delta[i + 1];
        // Height point (px,py) affects tiles (px-1,py-1), (px,py-1), (px-1,py), (px,py)
        for (let dx = -1; dx <= 0; dx++) {
          for (let dy = -1; dy <= 0; dy++) {
            const tx = px + dx, ty = py + dy;
            if (tx >= 0 && tx < localMapW && ty >= 0 && ty < localMapH) {
              markTileDirty(tx, ty);
              dirtyCount++;
            }
          }
        }
      }
    }
  }

  // 2. Sea level change
  if (seaLevel !== prevSeaLevel) {
    terrainBufferNeedsFull = true;
    if (prevCropTeamTiles) prevCropTeamTiles.set(cropTeamTiles);
    if (prevSwampTiles) prevSwampTiles.set(swampTiles);
    if (prevRockTiles) prevRockTiles.set(rockTiles);
    if (prevTreeTiles) prevTreeTiles.set(treeTiles);
    if (prevPebbleTiles) prevPebbleTiles.set(pebbleTiles);
    if (prevRuinTiles) prevRuinTiles.set(ruinTiles);
    prevSeaLevel = seaLevel;
    return;
  }

  // 3. Overlay diffs — compare typed arrays against prev copies
  if (prevCropTeamTiles) {
    for (let i = 0; i < sz; i++) {
      if (cropTeamTiles[i] !== prevCropTeamTiles[i]) {
        const tx = i % localMapW, ty = (i / localMapW) | 0;
        markTileDirty(tx, ty);
        dirtyCount++;
      }
    }
    prevCropTeamTiles.set(cropTeamTiles);
  }
  if (prevSwampTiles) {
    for (let i = 0; i < sz; i++) {
      if (swampTiles[i] !== prevSwampTiles[i]) {
        const tx = i % localMapW, ty = (i / localMapW) | 0;
        markTileDirty(tx, ty);
        dirtyCount++;
      }
    }
    prevSwampTiles.set(swampTiles);
  }
  if (prevRockTiles) {
    for (let i = 0; i < sz; i++) {
      if (rockTiles[i] !== prevRockTiles[i]) {
        const tx = i % localMapW, ty = (i / localMapW) | 0;
        markTileDirty(tx, ty);
        dirtyCount++;
      }
    }
    prevRockTiles.set(rockTiles);
  }
  if (prevTreeTiles) {
    for (let i = 0; i < sz; i++) {
      if (treeTiles[i] !== prevTreeTiles[i]) {
        const tx = i % localMapW, ty = (i / localMapW) | 0;
        markTileDirty(tx, ty);
        dirtyCount++;
      }
    }
    prevTreeTiles.set(treeTiles);
  }
  if (prevPebbleTiles) {
    for (let i = 0; i < sz; i++) {
      if (pebbleTiles[i] !== prevPebbleTiles[i]) {
        const tx = i % localMapW, ty = (i / localMapW) | 0;
        markTileDirty(tx, ty);
        dirtyCount++;
      }
    }
    prevPebbleTiles.set(pebbleTiles);
  }
  if (prevRuinTiles) {
    for (let i = 0; i < sz; i++) {
      if (ruinTiles[i] !== prevRuinTiles[i]) {
        const tx = i % localMapW, ty = (i / localMapW) | 0;
        markTileDirty(tx, ty);
        dirtyCount++;
      }
    }
    prevRuinTiles.set(ruinTiles);
  }

  prevSeaLevel = seaLevel;

  // If >25% tiles dirty, just do a full redraw
  if (dirtyCount > sz * 0.25) {
    terrainBufferNeedsFull = true;
  }
}

let pendingMessages = [];

function sendMessage(msg) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  } else {
    pendingMessages.push(msg);
  }
}

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
  magnetMode = false;
  inspectMode = false;
  inspectData = null;
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
    inspectMode = false;
    inspectData = null;
    magnetMode = false;
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
    return;
  }
  if (e.key === 'i' || e.key === 'I') {
    inspectMode = !inspectMode;
    if (inspectMode) { magnetMode = false; targetingPower = null; }
    if (!inspectMode) inspectData = null;
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
  const maxPlayers = selPlayers ? parseInt(selPlayers.value) || 2 : 2;
  const mapSize = selMapsize ? selMapsize.value : 'small';
  const isPublic = selVis ? selVis.value === 'public' : true;
  const gameName = (document.getElementById('game-name').value || '').trim();
  room_lastMaxPlayers = maxPlayers;
  room_lastMapSize = mapSize;
  sendMessage({ type: 'create', maxPlayers, mapSize, playerName: getPlayerName(), gameName, isPublic });
});

document.getElementById('btn-ai').addEventListener('click', () => {
  room_wasAI = true;
  const selPlayers = document.getElementById('sel-players');
  const selMapsize = document.getElementById('sel-mapsize');
  const maxPlayers = selPlayers ? parseInt(selPlayers.value) || 2 : 2;
  const mapSize = selMapsize ? selMapsize.value : 'small';
  room_lastMaxPlayers = maxPlayers;
  room_lastMapSize = mapSize;
  sendMessage({ type: 'create_ai', maxPlayers, mapSize, playerName: getPlayerName() });
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
});
document.getElementById('btn-inspect').addEventListener('click', () => {
  if (!gameStarted) return;
  inspectMode = !inspectMode;
  if (inspectMode) { magnetMode = false; targetingPower = null; }
  if (!inspectMode) inspectData = null;
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
    lowZoomSimplify: settingLowZoomSimplify,
  };
  for (const btn of btns) {
    const key = btn.dataset.setting;
    if (key in vals) btn.classList.toggle('on', vals[key]);
  }
  // Show/hide volume slider based on music setting
  const volRow = document.getElementById('music-vol-row');
  if (volRow) volRow.style.display = settingMusic ? 'flex' : 'none';
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

  // Check settlements first
  for (const s of settlements) {
    if (Math.abs(s.tx - px) <= 1 && Math.abs(s.ty - py) <= 1) {
      const levelDef = SETTLEMENT_LEVELS ? SETTLEMENT_LEVELS[s.l] : null;
      inspectData = {
        type: 'settlement', screenX: sx, screenY: sy,
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
    const cx = canvas.width / 2, cy = canvas.height / 2;
    anchorX = p.x * zoom + cx * (1 - zoom);
    anchorY = p.y * zoom + cy * (1 - zoom);
  } else {
    anchorX = d.screenX;
    anchorY = d.screenY;
  }

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
  let tx = anchorX + 12;
  let ty = anchorY - th / 2;
  if (tx + tw > canvas.width) tx = anchorX - tw - 12;
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

function showPowerBar() {
  // Powers are now in the sidebar, shown when sidebar becomes visible
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
