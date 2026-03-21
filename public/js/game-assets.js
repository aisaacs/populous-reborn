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

  const ci = tileColorIdx(t, r, b, l);
  if (ci <= 1) return terrainTextures.sand;
  if (ci <= 5) return terrainTextures.grass;
  if (ci <= 7) return terrainTextures.rock;
  return terrainTextures.snow;
}

// ── Settlement Sprites ──────────────────────────────────────────────
const SETT_LEVEL_NAMES = ['tent', 'hut', 'cottage', 'house', 'largehouse', 'manor', 'towerhouse', 'fortress', 'castle'];
const settlementSprites = {};
let settlementSpritesLoaded = false;

(function loadSettlementSprites() {
  let count = 0;
  const allTeams = ['blue', 'red', 'green', 'yellow', 'purple', 'orange'];
  const total = SETT_LEVEL_NAMES.length * allTeams.length;
  for (const name of SETT_LEVEL_NAMES) {
    for (const team of allTeams) {
      const key = name + '-' + team;
      const img = new Image();
      img.src = 'gfx/' + key + '.png';
      const done = () => {
        if (++count === total) settlementSpritesLoaded = true;
      };
      img.onload = done;
      img.onerror = done;
      settlementSprites[key] = img;
    }
  }
})();

// ── Walker Sprites ────────────────────────────────────────────────────
// Directions: se, nw (sprites), sw = mirror of se, ne = mirror of nw
// Frames: 0 (standing), 1 (walk)
const walkerSprites = {}; // key: "se-blue-0" etc
let walkerSpritesLoaded = false;

(function loadWalkerSprites() {
  let count = 0;
  const dirs = ['se', 'nw'];
  const allTeams = ['blue', 'red', 'green', 'yellow', 'purple', 'orange'];
  const total = dirs.length * allTeams.length * 2;
  for (const dir of dirs) {
    for (const team of allTeams) {
      for (let frame = 0; frame < 2; frame++) {
        const file = frame === 0
          ? 'walker-' + dir + '-' + team + '.png'
          : 'walker-' + dir + '-' + team + '-1.png';
        const key = dir + '-' + team + '-' + frame;
        const img = new Image();
        img.src = 'gfx/' + file;
        const done = () => {
          if (++count >= total) walkerSpritesLoaded = true;
        };
        img.onload = done;
        img.onerror = done;
        walkerSprites[key] = img;
      }
    }
  }
})();

// ── Boulder Sprites (height-based variants) ─────────────────────────
const boulderImgs = {};
const boulderLoadState = {};
for (const variant of ['default', 'sand', 'snow']) {
  boulderImgs[variant] = new Image();
  boulderLoadState[variant] = false;
  const src = variant === 'default' ? 'gfx/boulders.png' : 'gfx/boulders-' + variant + '.png';
  boulderImgs[variant].src = src;
  boulderImgs[variant].onload = () => { boulderLoadState[variant] = true; };
}
// ── Tree Sprites (height-based variants) ────────────────────────────
// Variant keys: palm (beach h1-2), oak (lowland h3-4), pine (highland h5-6), snowpine (mountain h7-8)
const treeImgs = {};
const treeLoadState = {};
for (const variant of ['palm', 'oak', 'pine', 'snowpine']) {
  treeImgs[variant] = new Image();
  treeLoadState[variant] = false;
  const src = variant === 'oak' ? 'gfx/tree.png' : 'gfx/' + variant + '.png';
  treeImgs[variant].src = src;
  treeImgs[variant].onload = () => { treeLoadState[variant] = true; };
}
// ── Pebbles Sprites (height-based variants) ─────────────────────────
const pebblesImgs = {};
const pebblesLoadState = {};
for (const variant of ['default', 'sand']) {
  pebblesImgs[variant] = new Image();
  pebblesLoadState[variant] = false;
  const src = variant === 'default' ? 'gfx/pebbles.png' : 'gfx/pebbles-' + variant + '.png';
  pebblesImgs[variant].src = src;
  pebblesImgs[variant].onload = () => { pebblesLoadState[variant] = true; };
}
// ── Sprite Config (live-reloadable via WebSocket) ────────────────────
let spriteConfig = null;
function loadSpriteConfig() {
  fetch('sprite-config.json?t=' + Date.now())
    .then(r => r.json())
    .then(cfg => {
      spriteConfig = cfg;
      if (typeof _terrainDirtyAll === 'function') _terrainDirtyAll();
      console.log('[sprite-config] loaded');
    })
    .catch(() => {});
}
loadSpriteConfig();
// Server sends 'sprite_config' message when file changes — handled in WS message handler

function getSpriteParams(category, variant) {
  const defaults = { scale: 0.5, anchorX: 0.5, anchorY: 1.0, offsetY: 0 };
  if (!spriteConfig || !spriteConfig[category]) return defaults;
  return spriteConfig[category][variant] || spriteConfig[category]['default'] || defaults;
}

// ── Height-based variant selection ───────────────────────────────────
// Uses tileColorIdx thresholds: 1=sand, 2-5=grass, 6-7=rock, 8=peak
function tileColorGroup(tx, ty) {
  if (!heights[tx] || !heights[tx + 1]) return 1;
  const t = heights[tx][ty], r = heights[tx + 1][ty];
  const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];
  const ci = (t === r && r === b && b === l)
    ? Math.max(1, Math.min(MAX_HEIGHT, t))
    : Math.max(1, Math.min(MAX_HEIGHT, Math.ceil((t + r + b + l) / 4)));
  return ci;
}
function getTreeVariant(tx, ty) {
  const ci = tileColorGroup(tx, ty);
  if (ci <= 1) return 'palm';    // sand
  if (ci <= 5) return 'oak';     // grass
  if (ci <= 6) return 'pine';    // lower rock/highland
  return 'snowpine';             // peaks
}
function getBoulderVariant(tx, ty) {
  const ci = tileColorGroup(tx, ty);
  if (ci <= 1) return 'sand';    // sand
  if (ci <= 6) return 'default'; // grass + lower rock
  return 'snow';                 // peaks
}
function getPebblesVariant(tx, ty) {
  const ci = tileColorGroup(tx, ty);
  if (ci <= 1) return 'sand';    // sand
  return 'default';
}

// ── Ruins Sprite ────────────────────────────────────────────────────
const ruinsImg = new Image();
let ruinsLoaded = false;
ruinsImg.src = 'gfx/ruins.png';
ruinsImg.onload = () => { ruinsLoaded = true; };

// ── Meteor Sprite ───────────────────────────────────────────────────
const meteorImg = new Image();
let meteorLoaded = false;
meteorImg.src = 'gfx/meteor.png';
meteorImg.onload = () => { meteorLoaded = true; };

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
function _terrainDirtyAll() { terrainBufferNeedsFull = true; }
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

/// Precompute renderable shape keys (includes edge slopes + corner tiles for terrain gen compatibility)
const VALID_SHAPE_KEYS = [];
(function() {
  for (let dt = 0; dt <= 2; dt++)
    for (let dr = 0; dr <= 2; dr++)
      for (let db = 0; db <= 2; db++)
        for (let dl = 0; dl <= 2; dl++) {
          if (Math.abs(dt - dr) > 1 || Math.abs(dr - db) > 1 ||
              Math.abs(db - dl) > 1 || Math.abs(dl - dt) > 1 ||
              Math.abs(dt - db) > 1 || Math.abs(dr - dl) > 1) continue;
          VALID_SHAPE_KEYS.push(dt * 27 + dr * 9 + db * 3 + dl);
        }
})();

// (Directional shading computed per-surface in buildLandTileFrames via triShade/shadeColor)

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

    const relVals = [dt, dr, db, dl];

    // Detect 3+1 tiles (3 corners at one height, 1 corner different)
    let oddCorner = -1;
    if (!isFlat) {
      const cnts = {};
      for (const v of relVals) cnts[v] = (cnts[v] || 0) + 1;
      if (Object.values(cnts).includes(3)) {
        for (const [val, cnt] of Object.entries(cnts)) {
          if (cnt === 1) { oddCorner = relVals.indexOf(+val); break; }
        }
      }
    }
    const is31 = oddCorner >= 0;

    // Split diagonal for 3+1: from the odd corner to its opposite
    //   T or B odd → split T↔B (odd corner to opposite)
    //   R or L odd → split R↔L (odd corner to opposite)
    // For 2+2 and flat: default T↔B split
    let tri1, tri2, tri1Idx, tri2Idx;
    if (is31 && (oddCorner === 1 || oddCorner === 3)) {
      // R↔L split (R or L is odd)
      tri1 = [[topX, topY], [rightX, rightY], [leftX, leftY]];       tri1Idx = [0, 1, 3];
      tri2 = [[rightX, rightY], [bottomX, bottomY], [leftX, leftY]]; tri2Idx = [1, 2, 3];
    } else {
      // T↔B split (default, and T or B odd)
      tri1 = [[topX, topY], [rightX, rightY], [bottomX, bottomY]];   tri1Idx = [0, 1, 2];
      tri2 = [[topX, topY], [bottomX, bottomY], [leftX, leftY]];     tri2Idx = [0, 2, 3];
    }

    // Compute directional shade per triangle
    const h = relVals; // [dt, dr, db, dl]
    const shade1 = isFlat ? 0 : triShade(tri1Idx[0], tri1Idx[1], tri1Idx[2], h);
    const shade2 = isFlat ? 0 : triShade(tri2Idx[0], tri2Idx[1], tri2Idx[2], h);
    const needsSplit = is31 || (!isFlat && shade1 !== shade2);

    for (let colorIdx = 1; colorIdx <= 8; colorIdx++) {
      for (let swampFlag = 0; swampFlag <= 1; swampFlag++) {
        const idx = shapeKey * 18 + (colorIdx - 1) * 2 + swampFlag;

        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const oc = c.getContext('2d');

        const baseColor = TERRAIN_COLORS[colorIdx];

        // Always fill full diamond with uniform base color (shade applied as overlay after texture)
        oc.beginPath();
        oc.moveTo(topX, topY);
        oc.lineTo(rightX, rightY);
        oc.lineTo(bottomX, bottomY);
        oc.lineTo(leftX, leftY);
        oc.closePath();
        oc.fillStyle = baseColor;
        oc.fill();

        // Texture overlay
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

            // Texture triangle 1
            oc.save();
            oc.beginPath();
            oc.moveTo(tri1[0][0], tri1[0][1]);
            oc.lineTo(tri1[1][0], tri1[1][1]);
            oc.lineTo(tri1[2][0], tri1[2][1]);
            oc.closePath();
            oc.clip();
            oc.globalAlpha = textureOpacity;
            oc.setTransform(
              (tri1[1][0] - tri1[0][0]) / iw, (tri1[1][1] - tri1[0][1]) / iw,
              (tri1[2][0] - tri1[0][0]) / ih, (tri1[2][1] - tri1[0][1]) / ih,
              tri1[0][0], tri1[0][1]
            );
            oc.drawImage(tex, 0, 0);
            oc.restore();

            // Texture triangle 2
            oc.save();
            oc.beginPath();
            oc.moveTo(tri2[0][0], tri2[0][1]);
            oc.lineTo(tri2[1][0], tri2[1][1]);
            oc.lineTo(tri2[2][0], tri2[2][1]);
            oc.closePath();
            oc.clip();
            oc.globalAlpha = textureOpacity;
            oc.setTransform(
              (tri2[1][0] - tri2[0][0]) / iw, (tri2[1][1] - tri2[0][1]) / iw,
              (tri2[2][0] - tri2[0][0]) / ih, (tri2[2][1] - tri2[0][1]) / ih,
              tri2[0][0], tri2[0][1]
            );
            oc.drawImage(tex, 0, 0);
            oc.restore();
          }
        }

        // Directional shade overlay (applied on top of texture)
        if (needsSplit) {
          // Shade each triangle separately
          if (shade1 !== 0) {
            oc.beginPath();
            oc.moveTo(tri1[0][0], tri1[0][1]);
            oc.lineTo(tri1[1][0], tri1[1][1]);
            oc.lineTo(tri1[2][0], tri1[2][1]);
            oc.closePath();
            const a1 = Math.min(0.35, Math.abs(shade1) * 0.12);
            oc.fillStyle = shade1 > 0 ? 'rgba(255,255,255,' + a1 + ')' : 'rgba(0,0,0,' + a1 + ')';
            oc.fill();
          }
          if (shade2 !== 0) {
            oc.beginPath();
            oc.moveTo(tri2[0][0], tri2[0][1]);
            oc.lineTo(tri2[1][0], tri2[1][1]);
            oc.lineTo(tri2[2][0], tri2[2][1]);
            oc.closePath();
            const a2 = Math.min(0.35, Math.abs(shade2) * 0.12);
            oc.fillStyle = shade2 > 0 ? 'rgba(255,255,255,' + a2 + ')' : 'rgba(0,0,0,' + a2 + ')';
            oc.fill();
          }
        } else if (!isFlat && shade1 !== 0) {
          // Shade entire diamond for uniform slopes
          oc.beginPath();
          oc.moveTo(topX, topY);
          oc.lineTo(rightX, rightY);
          oc.lineTo(bottomX, bottomY);
          oc.lineTo(leftX, leftY);
          oc.closePath();
          const a = Math.min(0.35, Math.abs(shade1) * 0.12);
          oc.fillStyle = shade1 > 0 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a + ')';
          oc.fill();
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
