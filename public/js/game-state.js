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
let lightningBolts = []; // client-side lightning effects
let meteorEffects = []; // client-side meteor streak effects
let earthquakeShakes = []; // client-side earthquake screen shake
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
const _textDecoder = new TextDecoder();

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
