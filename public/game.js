'use strict';

// ── Constants ────────────────────────────────────────────────────────
const MAP_W = 64;
const MAP_H = 64;
const TILE_HALF_W = 16;      // 32px wide tiles
const TILE_HALF_H = 8;       // 16px tall tiles (2:1 ratio)
const HEIGHT_STEP = 8;       // = TILE_HALF_H, one level = half tile height
const MAX_HEIGHT = 8;
const SEA_LEVEL = 0;

// 4 terrain colors + 1 water = 5 total
const WATER_COLOR = '#2244aa';
const TERRAIN_COLORS = {
  1: '#2a7a2a', 2: '#2a7a2a',   // low land — dark green
  3: '#44aa44', 4: '#44aa44',   // mid land — green
  5: '#66bb33', 6: '#66bb33',   // high land — yellow-green
  7: '#887755', 8: '#887755',   // peaks — brown
};
const SLOPE_DARKEN = 20;
const GRID_MODES = [null, 'rgba(0,0,0,0.15)', 'rgba(255,255,255,0.25)'];
let gridMode = 0;

// ── Teams & Modes ───────────────────────────────────────────────────
const TEAM_BLUE = 0;
const TEAM_RED = 1;
const TEAM_COLORS = ['#4488ff', '#ff4444'];
const TEAM_NAMES = ['Blue', 'Red'];

const MODE_SETTLE = 0;
const MODE_MAGNET = 1;
const MODE_FIGHT = 2;
const MODE_GATHER = 3;
const MODE_NAMES = ['Settle', 'Magnet', 'Fight', 'Gather'];

const WALKER_SPEED = 1.5; // tiles/sec
// Level = largest square side (1×1 tent … 5×5 castle)
const LEVEL_CAPACITY = [0, 4, 15, 40, 80, 150]; // indexed by level 0-5

// ── Game State ──────────────────────────────────────────────────────
let walkers = [];
let settlements = [];
const settlementMap = new Int32Array(MAP_W * MAP_H).fill(-1);
let walkerGrid = new Array(MAP_W * MAP_H);
const teamMode = [MODE_SETTLE, MODE_SETTLE];
const magnetPos = [{ x: 10, y: 10 }, { x: 50, y: 50 }];
const mana = [0, 0];

// Timers for periodic updates
let levelEvalTimer = 0;
let popGrowthTimer = 0;
let pruneTimer = 0;
let aiTimer = 0;
let lastTime = 0;

// ── Canvas ───────────────────────────────────────────────────────────
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let camX = 0, camY = 0;

function getOrigin() {
  return {
    x: Math.floor(canvas.width / 2) + camX,
    y: 80 + camY,
  };
}

// ── Height Map — (MAP_W+1) × (MAP_H+1) integer grid ─────────────────
const heights = [];

function initHeightMap() {
  for (let x = 0; x <= MAP_W; x++) {
    heights[x] = [];
    for (let y = 0; y <= MAP_H; y++) {
      heights[x][y] = 0;
    }
  }
  generateTerrain();
}

// ── Terrain Generation — Blob/Island Placement ──────────────────────
// Creates terraced plateaus: large flat areas at each height level,
// separated by narrow single-step slope bands.

function placeBlob(cx, cy, radius, level) {
  const r2 = radius * radius;
  for (let x = 0; x <= MAP_W; x++) {
    for (let y = 0; y <= MAP_H; y++) {
      const dx = x - cx, dy = y - cy;
      // Only raise points that are already at level-1 (builds on existing terrain)
      if (dx * dx + dy * dy < r2 && heights[x][y] >= level - 1) {
        heights[x][y] = level;
      }
    }
  }
}

function generateIsland(cx, cy, maxHeight, baseRadius) {
  for (let level = 1; level <= maxHeight; level++) {
    const shrink = 1 - (level - 1) / (maxHeight + 1);
    const radius = baseRadius * shrink * (0.7 + Math.random() * 0.5);
    // Slightly offset center each level for natural asymmetry
    const ox = cx + (Math.random() - 0.5) * baseRadius * 0.25;
    const oy = cy + (Math.random() - 0.5) * baseRadius * 0.25;
    placeBlob(ox, oy, radius, level);
  }
}

function enforceAdjacency() {
  for (let pass = 0; pass < 30; pass++) {
    let changed = false;
    for (let x = 0; x <= MAP_W; x++) {
      for (let y = 0; y <= MAP_H; y++) {
        const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of nb) {
          if (nx < 0 || nx > MAP_W || ny < 0 || ny > MAP_H) continue;
          if (heights[x][y] - heights[nx][ny] > 1) {
            heights[x][y] = heights[nx][ny] + 1;
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
}

function generateTerrain() {
  // Major island clusters — concentric blobs building up height levels
  generateIsland(16, 16, 5, 18);
  generateIsland(48, 20, 4, 16);
  generateIsland(32, 45, 6, 22);
  generateIsland(55, 52, 3, 13);
  generateIsland(10, 50, 4, 15);

  // Scatter a few smaller bumps
  for (let i = 0; i < 5; i++) {
    const x = 5 + Math.floor(Math.random() * (MAP_W - 10));
    const y = 5 + Math.floor(Math.random() * (MAP_H - 10));
    generateIsland(x, y, 2 + Math.floor(Math.random() * 2), 6 + Math.floor(Math.random() * 6));
  }

  enforceAdjacency();

  // Validation — log flat tile percentage
  let flat = 0, total = MAP_W * MAP_H;
  for (let tx = 0; tx < MAP_W; tx++) {
    for (let ty = 0; ty < MAP_H; ty++) {
      const h = heights[tx][ty];
      if (heights[tx + 1][ty] === h && heights[tx + 1][ty + 1] === h && heights[tx][ty + 1] === h) flat++;
    }
  }
  console.log(`Terrain: ${flat}/${total} tiles flat (${(100 * flat / total).toFixed(0)}%)`);
}

// ── Utility Functions ───────────────────────────────────────────────
function isTileWater(tx, ty) {
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return true;
  return heights[tx][ty] <= SEA_LEVEL &&
         heights[tx + 1][ty] <= SEA_LEVEL &&
         heights[tx + 1][ty + 1] <= SEA_LEVEL &&
         heights[tx][ty + 1] <= SEA_LEVEL;
}

function isTileFlat(tx, ty) {
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return false;
  const h = heights[tx][ty];
  if (h <= SEA_LEVEL) return false;
  return heights[tx + 1][ty] === h &&
         heights[tx + 1][ty + 1] === h &&
         heights[tx][ty + 1] === h;
}

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

function getSettlement(tx, ty) {
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return null;
  const idx = settlementMap[ty * MAP_W + tx];
  if (idx < 0) return null;
  const s = settlements[idx];
  return (s && !s.dead) ? s : null;
}

function setSettlement(tx, ty, s) {
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return;
  settlementMap[ty * MAP_W + tx] = s ? settlements.indexOf(s) : -1;
}

function clearSettlementMap(tx, ty) {
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return;
  settlementMap[ty * MAP_W + tx] = -1;
}

function isTileInSettlementFootprint(tx, ty, exclude) {
  for (const s of settlements) {
    if (s.dead || s === exclude) continue;
    if (tx >= s.sqOx && tx < s.sqOx + s.sqSize &&
        ty >= s.sqOy && ty < s.sqOy + s.sqSize) return true;
  }
  return false;
}

function squareOverlapsSettlement(ox, oy, size, exclude) {
  for (let dx = 0; dx < size; dx++) {
    for (let dy = 0; dy < size; dy++) {
      if (isTileInSettlementFootprint(ox + dx, oy + dy, exclude)) return true;
    }
  }
  return false;
}

function getSettlementDiamondColor(team, level) {
  const base = TEAM_COLORS[team];
  const brighten = level * 4;
  const r = Math.min(255, parseInt(base.slice(1, 3), 16) + brighten);
  const g = Math.min(255, parseInt(base.slice(3, 5), 16) + brighten);
  const b = Math.min(255, parseInt(base.slice(5, 7), 16) + brighten);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// ── Projection ───────────────────────────────────────────────────────
function project(px, py, h) {
  const o = getOrigin();
  return {
    x: o.x + (px - py) * TILE_HALF_W,
    y: o.y + (px + py) * TILE_HALF_H - h * HEIGHT_STEP,
  };
}

// ── Color ────────────────────────────────────────────────────────────
function darkenColor(hex, amt) {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amt);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amt);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amt);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function getTileColor(tx, ty) {
  const t = heights[tx][ty], r = heights[tx + 1][ty];
  const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];

  // Water: ALL corners at or below sea level
  if (t <= SEA_LEVEL && r <= SEA_LEVEL && b <= SEA_LEVEL && l <= SEA_LEVEL) {
    return WATER_COLOR;
  }

  const avg = (t + r + b + l) / 4;
  const idx = Math.max(1, Math.min(MAX_HEIGHT, Math.round(avg)));
  const base = TERRAIN_COLORS[idx];
  const isFlat = (t === r && r === b && b === l);
  return isFlat ? base : darkenColor(base, SLOPE_DARKEN);
}

// ── Drawing ──────────────────────────────────────────────────────────
function drawTile(tx, ty) {
  const t = heights[tx][ty], r = heights[tx + 1][ty];
  const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];

  const isWater = (t <= SEA_LEVEL && r <= SEA_LEVEL && b <= SEA_LEVEL && l <= SEA_LEVEL);

  // Water tiles: flat diamond at sea level. Terrain tiles: actual heights.
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
  if (GRID_MODES[gridMode]) {
    ctx.strokeStyle = GRID_MODES[gridMode];
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function rebuildWalkerGrid() {
  for (let i = 0; i < MAP_W * MAP_H; i++) walkerGrid[i] = null;
  for (let i = 0; i < walkers.length; i++) {
    const w = walkers[i];
    if (w.dead) continue;
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
  const radius = 2 + Math.min(3, Math.floor(w.strength / 50));
  ctx.beginPath();
  ctx.arc(p.x, p.y - 3, radius, 0, Math.PI * 2);
  ctx.fillStyle = TEAM_COLORS[w.team];
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

function drawSettlement(s) {
  const h = heights[s.tx][s.ty];
  // Single diamond covering 75% of the N×N square
  const cx = s.sqOx + s.sqSize * 0.5;
  const cy = s.sqOy + s.sqSize * 0.5;
  const he = s.sqSize * 0.5 * 0.75; // 75% of half-square

  const pTop    = project(cx - he, cy - he, h);
  const pRight  = project(cx + he, cy - he, h);
  const pBottom = project(cx + he, cy + he, h);
  const pLeft   = project(cx - he, cy + he, h);

  ctx.beginPath();
  ctx.moveTo(pTop.x, pTop.y);
  ctx.lineTo(pRight.x, pRight.y);
  ctx.lineTo(pBottom.x, pBottom.y);
  ctx.lineTo(pLeft.x, pLeft.y);
  ctx.closePath();

  ctx.fillStyle = getSettlementDiamondColor(s.team, s.level);
  ctx.fill();

  ctx.strokeStyle = darkenColor(TEAM_COLORS[s.team], 40);
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawMagnetFlag(team) {
  const mp = magnetPos[team];
  const h = heightAt(mp.x, mp.y);
  const p = project(mp.x, mp.y, h);
  // Pole
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x, p.y - 16);
  ctx.stroke();
  // Flag
  ctx.fillStyle = TEAM_COLORS[team];
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 16);
  ctx.lineTo(p.x + 8, p.y - 13);
  ctx.lineTo(p.x, p.y - 10);
  ctx.closePath();
  ctx.fill();
}

function drawUI() {
  const margin = 10;
  const barW = 120, barH = 10;
  ctx.font = '12px monospace';

  // Blue team stats — top left
  const blueStats = getTeamStats(TEAM_BLUE);
  ctx.fillStyle = TEAM_COLORS[TEAM_BLUE];
  ctx.fillText(`Blue: ${MODE_NAMES[teamMode[TEAM_BLUE]]}`, margin, canvas.height - 70);
  ctx.fillText(`Pop: ${blueStats.pop}  Set: ${blueStats.set}  Walk: ${blueStats.walk}`, margin, canvas.height - 55);
  // Blue mana bar
  ctx.fillStyle = '#333';
  ctx.fillRect(margin, canvas.height - 40, barW, barH);
  ctx.fillStyle = TEAM_COLORS[TEAM_BLUE];
  ctx.fillRect(margin, canvas.height - 40, barW * Math.min(1, mana[TEAM_BLUE] / 1000), barH);
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.strokeRect(margin, canvas.height - 40, barW, barH);
  ctx.fillStyle = '#ccc';
  ctx.fillText(`Mana: ${Math.floor(mana[TEAM_BLUE])}`, margin, canvas.height - 15);

  // Red team stats — top right
  const redStats = getTeamStats(TEAM_RED);
  const rx = canvas.width - margin - barW;
  ctx.fillStyle = TEAM_COLORS[TEAM_RED];
  ctx.fillText(`Red: ${MODE_NAMES[teamMode[TEAM_RED]]}`, rx, canvas.height - 70);
  ctx.fillText(`Pop: ${redStats.pop}  Set: ${redStats.set}  Walk: ${redStats.walk}`, rx, canvas.height - 55);
  // Red mana bar
  ctx.fillStyle = '#333';
  ctx.fillRect(rx, canvas.height - 40, barW, barH);
  ctx.fillStyle = TEAM_COLORS[TEAM_RED];
  ctx.fillRect(rx, canvas.height - 40, barW * Math.min(1, mana[TEAM_RED] / 1000), barH);
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.strokeRect(rx, canvas.height - 40, barW, barH);
  ctx.fillStyle = '#ccc';
  ctx.fillText(`Mana: ${Math.floor(mana[TEAM_RED])}`, rx, canvas.height - 15);
}

function getTeamStats(team) {
  let pop = 0, set = 0, walk = 0;
  for (const s of settlements) {
    if (s.dead || s.team !== team) continue;
    pop += s.population;
    set++;
  }
  for (const w of walkers) {
    if (w.dead || w.team !== team) continue;
    walk++;
    pop += w.strength;
  }
  return { pop, set, walk };
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  rebuildWalkerGrid();

  // Pass 1: terrain tiles back-to-front
  for (let row = 0; row < MAP_H; row++) {
    for (let col = 0; col < MAP_W; col++) {
      drawTile(col, row);
    }
  }

  // Pass 2: settlement diamonds back-to-front (sorted by depth = tx + ty)
  const sortedSettlements = [];
  for (const s of settlements) {
    if (!s.dead) sortedSettlements.push(s);
  }
  sortedSettlements.sort((a, b) => (a.tx + a.ty) - (b.tx + b.ty));
  for (const s of sortedSettlements) drawSettlement(s);

  // Pass 3: walkers back-to-front via walkerGrid
  for (let row = 0; row < MAP_H; row++) {
    for (let col = 0; col < MAP_W; col++) {
      const wlist = walkerGrid[row * MAP_W + col];
      if (wlist) {
        for (const w of wlist) drawWalker(w);
      }
    }
  }

  // Draw magnet flags
  drawMagnetFlag(TEAM_BLUE);
  drawMagnetFlag(TEAM_RED);

  // Draw HUD
  drawUI();
}

// ── Picking — Screen → Grid Point ────────────────────────────────────
function screenToGrid(sx, sy) {
  const o = getOrigin();
  const dx = sx - o.x, dy = sy - o.y;
  const fpx = (dx / TILE_HALF_W + dy / TILE_HALF_H) / 2;
  const fpy = (dy / TILE_HALF_H - dx / TILE_HALF_W) / 2;

  // Height shifts the estimate by up to MAX_HEIGHT/2 in each axis, so search wider
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

// ── Raise / Lower with adjacency propagation (BFS) ──────────────────
function raisePoint(px, py) {
  if (heights[px][py] >= MAX_HEIGHT) return;
  heights[px][py]++;
  const queue = [[px, py]];
  while (queue.length) {
    const [x, y] = queue.shift();
    const h = heights[x][y];
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || nx > MAP_W || ny < 0 || ny > MAP_H) continue;
      if (h - heights[nx][ny] > 1) {
        heights[nx][ny] = h - 1;
        queue.push([nx, ny]);
      }
    }
  }
}

function lowerPoint(px, py) {
  if (heights[px][py] <= 0) return;
  heights[px][py]--;
  const queue = [[px, py]];
  while (queue.length) {
    const [x, y] = queue.shift();
    const h = heights[x][y];
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || nx > MAP_W || ny < 0 || ny > MAP_H) continue;
      if (heights[nx][ny] - h > 1) {
        heights[nx][ny] = h + 1;
        queue.push([nx, ny]);
      }
    }
  }
}

function modifyHeight(sx, sy, delta) {
  const { px, py } = screenToGrid(sx, sy);
  if (px < 0 || px > MAP_W || py < 0 || py > MAP_H) return;
  if (delta > 0) raisePoint(px, py);
  else lowerPoint(px, py);
}

// ── Walker Spawning ─────────────────────────────────────────────────
function spawnWalker(team, strength, x, y) {
  const w = {
    team, strength: Math.min(255, strength),
    x, y,
    tx: x, ty: y,
    dead: false,
  };
  walkers.push(w);
  return w;
}

function spawnInitialWalkers() {
  const spawnZones = [
    { cx: 10, cy: 10 },  // Blue
    { cx: 50, cy: 50 },  // Red
  ];

  for (let team = 0; team < 2; team++) {
    const zone = spawnZones[team];
    let spawned = 0;
    // Search outward from zone center for flat land tiles
    for (let r = 0; r < 20 && spawned < 5; r++) {
      for (let dx = -r; dx <= r && spawned < 5; dx++) {
        for (let dy = -r; dy <= r && spawned < 5; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // perimeter only
          const tx = zone.cx + dx, ty = zone.cy + dy;
          if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) continue;
          if (!isTileWater(tx, ty) && heights[tx][ty] > SEA_LEVEL) {
            spawnWalker(team, 5, tx + 0.5, ty + 0.5);
            spawned++;
          }
        }
      }
    }
  }
}

// ── Walker Movement ─────────────────────────────────────────────────
function pickRandomTarget(w) {
  const angle = Math.random() * Math.PI * 2;
  const dist = 1 + Math.random() * 2;
  const nx = w.x + Math.cos(angle) * dist;
  const ny = w.y + Math.sin(angle) * dist;
  const tx = Math.floor(nx), ty = Math.floor(ny);
  if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H && !isTileWater(tx, ty)) {
    w.tx = nx;
    w.ty = ny;
  } else {
    // Try opposite direction
    w.tx = w.x - Math.cos(angle) * dist;
    w.ty = w.y - Math.sin(angle) * dist;
  }
}

function pickSettleTarget(w) {
  const cx = Math.floor(w.x), cy = Math.floor(w.y);

  // If standing on a flat tile outside any settlement footprint — settle
  if (isTileFlat(cx, cy) && !isTileInSettlementFootprint(cx, cy)) {
    settleWalker(w, cx, cy);
    return;
  }

  // Search nearby for flat tiles outside all settlement footprints
  let bestDist = Infinity, bestTx = -1, bestTy = -1;
  const searchR = 8;
  for (let dx = -searchR; dx <= searchR; dx++) {
    for (let dy = -searchR; dy <= searchR; dy++) {
      const tx = cx + dx, ty = cy + dy;
      if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) continue;
      if (isTileFlat(tx, ty) && !isTileInSettlementFootprint(tx, ty)) {
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; bestTx = tx; bestTy = ty; }
      }
    }
  }

  if (bestTx >= 0) {
    w.tx = bestTx + 0.5;
    w.ty = bestTy + 0.5;
  } else {
    pickRandomTarget(w);
  }
}

function pickMagnetTarget(w) {
  const mp = magnetPos[w.team];
  const dx = mp.x - w.x, dy = mp.y - w.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 2) {
    // Mill around near magnet
    pickRandomTarget(w);
  } else {
    w.tx = mp.x + (Math.random() - 0.5) * 2;
    w.ty = mp.y + (Math.random() - 0.5) * 2;
  }
}

function pickFightTarget(w) {
  let bestDist = Infinity, bestX = -1, bestY = -1;

  // Find nearest enemy walker
  for (const ew of walkers) {
    if (ew.dead || ew.team === w.team) continue;
    const dx = ew.x - w.x, dy = ew.y - w.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; bestX = ew.x; bestY = ew.y; }
  }

  // Find nearest enemy settlement
  for (const es of settlements) {
    if (es.dead || es.team === w.team) continue;
    const dx = (es.tx + 0.5) - w.x, dy = (es.ty + 0.5) - w.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; bestX = es.tx + 0.5; bestY = es.ty + 0.5; }
  }

  if (bestX >= 0) {
    w.tx = bestX;
    w.ty = bestY;
  } else {
    pickRandomTarget(w);
  }
}

function pickGatherTarget(w) {
  // Move toward magnet, walkers merge when they arrive
  pickMagnetTarget(w);
}

function pickWalkerTarget(w) {
  switch (teamMode[w.team]) {
    case MODE_SETTLE:  pickSettleTarget(w); break;
    case MODE_MAGNET:  pickMagnetTarget(w); break;
    case MODE_FIGHT:   pickFightTarget(w); break;
    case MODE_GATHER:  pickGatherTarget(w); break;
    default:           pickRandomTarget(w); break;
  }
}

function updateWalkers(dt) {
  for (const w of walkers) {
    if (w.dead) continue;

    // Check drowning
    const ctx2 = Math.floor(w.x), cty = Math.floor(w.y);
    if (ctx2 < 0 || ctx2 >= MAP_W || cty < 0 || cty >= MAP_H || isTileWater(ctx2, cty)) {
      w.dead = true;
      continue;
    }

    // Move toward target
    const dx = w.tx - w.x, dy = w.ty - w.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.1) {
      pickWalkerTarget(w);
    } else {
      const step = WALKER_SPEED * dt;
      if (step >= dist) {
        w.x = w.tx;
        w.y = w.ty;
      } else {
        w.x += (dx / dist) * step;
        w.y += (dy / dist) * step;
      }

      // Clamp to map bounds
      w.x = Math.max(0.1, Math.min(MAP_W - 0.1, w.x));
      w.y = Math.max(0.1, Math.min(MAP_H - 0.1, w.y));

      // Check if new tile is water — redirect
      const ntx = Math.floor(w.x), nty = Math.floor(w.y);
      if (ntx >= 0 && ntx < MAP_W && nty >= 0 && nty < MAP_H && isTileWater(ntx, nty)) {
        // Revert and pick new target
        w.x -= (dx / dist) * step;
        w.y -= (dy / dist) * step;
        w.x = Math.max(0.1, Math.min(MAP_W - 0.1, w.x));
        w.y = Math.max(0.1, Math.min(MAP_H - 0.1, w.y));
        pickRandomTarget(w);
      }
    }
  }
}

// ── Settlement System ───────────────────────────────────────────────
function settleWalker(w, tx, ty) {
  if (isTileInSettlementFootprint(tx, ty)) return; // Within existing footprint
  w.dead = true;
  const sq = findLargestFlatSquare(tx, ty, null);
  const s = {
    team: w.team,
    level: sq.size,
    population: w.strength,
    tx, ty,
    sqOx: sq.ox, sqOy: sq.oy, sqSize: sq.size,
    dead: false,
  };
  settlements.push(s);
  setSettlement(tx, ty, s);
}

function findLargestFlatSquare(tx, ty, exclude) {
  const h = heights[tx][ty];
  if (h <= SEA_LEVEL || !isTileFlat(tx, ty)) return { ox: tx, oy: ty, size: 0 };

  // Try square sizes 5 down to 2, checking all positions that contain (tx,ty)
  for (let n = 5; n >= 2; n--) {
    const oxMin = Math.max(0, tx - n + 1);
    const oxMax = Math.min(MAP_W - n, tx);
    const oyMin = Math.max(0, ty - n + 1);
    const oyMax = Math.min(MAP_H - n, ty);

    for (let ox = oxMin; ox <= oxMax; ox++) {
      for (let oy = oyMin; oy <= oyMax; oy++) {
        let allFlat = true;
        for (let dx = 0; dx < n && allFlat; dx++) {
          for (let dy = 0; dy < n && allFlat; dy++) {
            const cx = ox + dx, cy = oy + dy;
            if (!isTileFlat(cx, cy) || heights[cx][cy] !== h) allFlat = false;
          }
        }
        if (allFlat && !squareOverlapsSettlement(ox, oy, n, exclude)) {
          return { ox, oy, size: n };
        }
      }
    }
  }

  return { ox: tx, oy: ty, size: 1 };
}

function tryMergeSettlements() {
  for (const s of settlements) {
    if (s.dead) continue;
    const h = heights[s.tx][s.ty];
    if (h <= SEA_LEVEL || !isTileFlat(s.tx, s.ty)) continue;

    // Try to find a square larger than current that may overlap same-team settlements
    let bestSq = null;
    for (let n = 5; n > s.sqSize; n--) {
      const oxMin = Math.max(0, s.tx - n + 1);
      const oxMax = Math.min(MAP_W - n, s.tx);
      const oyMin = Math.max(0, s.ty - n + 1);
      const oyMax = Math.min(MAP_H - n, s.ty);

      for (let ox = oxMin; ox <= oxMax && !bestSq; ox++) {
        for (let oy = oyMin; oy <= oyMax && !bestSq; oy++) {
          let allFlat = true;
          for (let dx = 0; dx < n && allFlat; dx++) {
            for (let dy = 0; dy < n && allFlat; dy++) {
              if (!isTileFlat(ox + dx, oy + dy) || heights[ox + dx][oy + dy] !== h)
                allFlat = false;
            }
          }
          if (!allFlat) continue;

          // Collect same-team settlements whose home tile is inside (would be absorbed)
          const absorbed = [];
          let conflict = false;
          for (const other of settlements) {
            if (other.dead || other === s) continue;
            const homeinside = other.tx >= ox && other.tx < ox + n &&
                               other.ty >= oy && other.ty < oy + n;
            const sqOverlap = ox < other.sqOx + other.sqSize && ox + n > other.sqOx &&
                              oy < other.sqOy + other.sqSize && oy + n > other.sqOy;
            if (homeinside && other.team === s.team) {
              absorbed.push(other);
            } else if (sqOverlap) {
              // Overlaps a settlement that won't be absorbed — reject
              conflict = true;
              break;
            }
          }
          if (!conflict && absorbed.length > 0) bestSq = { ox, oy, size: n };
        }
      }
      if (bestSq) break;
    }

    if (!bestSq) continue;

    // Absorb same-team settlements whose home tile is within the new square
    for (const other of settlements) {
      if (other.dead || other === s || other.team !== s.team) continue;
      if (other.tx >= bestSq.ox && other.tx < bestSq.ox + bestSq.size &&
          other.ty >= bestSq.oy && other.ty < bestSq.oy + bestSq.size) {
        s.population += other.population;
        other.dead = true;
        clearSettlementMap(other.tx, other.ty);
      }
    }

    s.level = bestSq.size;
    s.sqOx = bestSq.ox;
    s.sqOy = bestSq.oy;
    s.sqSize = bestSq.size;
  }
}

function isSquareStillValid(s) {
  const h = heights[s.tx][s.ty];
  if (h <= SEA_LEVEL || !isTileFlat(s.tx, s.ty)) return false;
  for (let dx = 0; dx < s.sqSize; dx++) {
    for (let dy = 0; dy < s.sqSize; dy++) {
      const cx = s.sqOx + dx, cy = s.sqOy + dy;
      if (!isTileFlat(cx, cy) || heights[cx][cy] !== h) return false;
    }
  }
  // Check no other settlement's footprint now overlaps ours
  if (squareOverlapsSettlement(s.sqOx, s.sqOy, s.sqSize, s)) return false;
  return true;
}

function evaluateSettlementLevels() {
  for (const s of settlements) {
    if (s.dead) continue;

    if (isSquareStillValid(s)) {
      // Current square intact — only check for possible growth
      const sq = findLargestFlatSquare(s.tx, s.ty, s);
      if (sq.size > s.sqSize) {
        s.level = sq.size;
        s.sqOx = sq.ox;
        s.sqOy = sq.oy;
        s.sqSize = sq.size;
      }
    } else {
      // Square broke — re-evaluate
      const sq = findLargestFlatSquare(s.tx, s.ty, s);

      if (sq.size === 0) {
        // Home tile gone — destroy, eject population as walker
        s.dead = true;
        clearSettlementMap(s.tx, s.ty);
        if (s.population > 0) {
          const angle = Math.random() * Math.PI * 2;
          spawnWalker(s.team, s.population,
            s.tx + 0.5 + Math.cos(angle) * 1.2,
            s.ty + 0.5 + Math.sin(angle) * 1.2);
        }
        continue;
      }

      s.level = sq.size;
      s.sqOx = sq.ox;
      s.sqOy = sq.oy;
      s.sqSize = sq.size;
    }

    // If population exceeds capacity, eject excess as walker (sprogging)
    const cap = LEVEL_CAPACITY[s.level];
    if (s.population > cap) {
      const excess = s.population - Math.floor(cap / 2);
      s.population = Math.floor(cap / 2);
      const angle = Math.random() * Math.PI * 2;
      spawnWalker(s.team, excess,
        s.tx + 0.5 + Math.cos(angle) * 1.2,
        s.ty + 0.5 + Math.sin(angle) * 1.2);
    }
  }
}

// ── Population Growth & Ejection ────────────────────────────────────
function updatePopulationGrowth() {
  for (const s of settlements) {
    if (s.dead) continue;
    const cap = LEVEL_CAPACITY[s.level];
    if (s.population < cap) {
      s.population = Math.min(cap, s.population + s.level);
    } else if (s.population >= cap && cap > 0) {
      // At capacity — eject walker
      const ejectStrength = Math.max(1, Math.floor(cap / 2));
      s.population = Math.max(1, s.population - ejectStrength);
      const angle = Math.random() * Math.PI * 2;
      const sx = s.tx + 0.5 + Math.cos(angle) * 1.2;
      const sy = s.ty + 0.5 + Math.sin(angle) * 1.2;
      spawnWalker(s.team, ejectStrength, sx, sy);
    }
  }
}

// ── Walker Merging & Combat ─────────────────────────────────────────
function handleWalkerCollisions() {
  rebuildWalkerGrid();

  for (let i = 0; i < walkers.length; i++) {
    const w = walkers[i];
    if (w.dead) continue;

    const cx = Math.floor(w.x), cy = Math.floor(w.y);

    // Check walker-vs-walker in same + adjacent tiles
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const tx = cx + dx, ty = cy + dy;
        if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) continue;
        const wlist = walkerGrid[ty * MAP_W + tx];
        if (!wlist) continue;
        for (const other of wlist) {
          if (other === w || other.dead) continue;
          const ddx = other.x - w.x, ddy = other.y - w.y;
          const dist = ddx * ddx + ddy * ddy;
          if (dist > 0.5 * 0.5) continue; // collision radius 0.5 tiles

          if (other.team === w.team) {
            // Friendly merge
            w.strength = Math.min(255, w.strength + other.strength);
            other.dead = true;
          } else {
            // Combat
            if (w.strength > other.strength) {
              w.strength -= other.strength;
              other.dead = true;
            } else if (other.strength > w.strength) {
              other.strength -= w.strength;
              w.dead = true;
            } else {
              // Equal — both die
              w.dead = true;
              other.dead = true;
            }
          }
        }
      }
    }

    if (w.dead) continue;

    // Check walker-vs-enemy-settlement
    const stx = Math.floor(w.x), sty = Math.floor(w.y);
    const es = getSettlement(stx, sty);
    if (es && es.team !== w.team) {
      if (w.strength >= es.population) {
        w.strength -= es.population;
        es.dead = true;
        clearSettlementMap(es.tx, es.ty);
        if (w.strength <= 0) w.dead = true;
      } else {
        es.population -= w.strength;
        w.dead = true;
      }
    }
  }
}

// ── Entity Pruning ──────────────────────────────────────────────────
function pruneDeadEntities() {
  walkers = walkers.filter(w => !w.dead);

  // Rebuild settlement map
  const alive = settlements.filter(s => !s.dead);
  settlementMap.fill(-1);
  settlements = alive;
  for (let i = 0; i < settlements.length; i++) {
    const s = settlements[i];
    settlementMap[s.ty * MAP_W + s.tx] = i;
  }
}

// ── Mana ────────────────────────────────────────────────────────────
function updateMana(dt) {
  for (let team = 0; team < 2; team++) {
    let totalPop = 0;
    for (const s of settlements) {
      if (s.dead || s.team !== team) continue;
      totalPop += s.population;
    }
    mana[team] += totalPop * dt * 0.1;
  }
}

// ── Basic AI (Red Team) ─────────────────────────────────────────────
function updateAI() {
  const redStats = getTeamStats(TEAM_RED);
  const blueStats = getTeamStats(TEAM_BLUE);

  if (redStats.set < 2 || redStats.walk > redStats.set * 3) {
    // Few settlements or many idle walkers — settle
    teamMode[TEAM_RED] = MODE_SETTLE;
  } else if (redStats.pop > blueStats.pop * 1.5 && redStats.walk >= 3) {
    // Population advantage — fight
    teamMode[TEAM_RED] = MODE_FIGHT;
  } else {
    // Default — keep settling
    teamMode[TEAM_RED] = MODE_SETTLE;
  }

  // AI terrain flattening — pick a settlement, flatten one tile nearby
  aiTerrain(TEAM_RED);
}

function aiTerrain(team) {
  // Find a settlement belonging to this team
  let target = null;
  for (const s of settlements) {
    if (s.dead || s.team !== team) continue;
    target = s;
    break;
  }
  if (!target) return;

  const th = heights[target.tx][target.ty];
  const cx = target.tx, cy = target.ty;

  // Find a non-flat neighboring tile within 3 tiles and adjust one corner
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      const tx = cx + dx, ty = cy + dy;
      if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) continue;
      if (isTileFlat(tx, ty) && heights[tx][ty] === th) continue;
      // Try to flatten one corner toward target height
      for (const [px, py] of [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]]) {
        if (px < 0 || px > MAP_W || py < 0 || py > MAP_H) continue;
        if (heights[px][py] < th) {
          raisePoint(px, py);
          return;
        } else if (heights[px][py] > th) {
          lowerPoint(px, py);
          return;
        }
      }
    }
  }
}

// ── Input ────────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', (e) => {
  if (e.shiftKey && e.button === 0) {
    // Place papal magnet for blue team
    const { px, py } = screenToGrid(e.clientX, e.clientY);
    magnetPos[TEAM_BLUE].x = px;
    magnetPos[TEAM_BLUE].y = py;
    return;
  }
  if (e.button === 0) modifyHeight(e.clientX, e.clientY, 1);
  if (e.button === 2) modifyHeight(e.clientX, e.clientY, -1);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Mode keys + grid toggle
window.addEventListener('keydown', (e) => {
  if (e.key === 'g' || e.key === 'G') {
    gridMode = (gridMode + 1) % GRID_MODES.length;
  }
  if (e.key === '1') teamMode[TEAM_BLUE] = MODE_SETTLE;
  if (e.key === '2') teamMode[TEAM_BLUE] = MODE_MAGNET;
  if (e.key === '3') teamMode[TEAM_BLUE] = MODE_FIGHT;
  if (e.key === '4') teamMode[TEAM_BLUE] = MODE_GATHER;
});

// Pan — middle mouse
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
});
window.addEventListener('mouseup', (e) => { if (e.button === 1) panning = false; });

// ── Game Loop ───────────────────────────────────────────────────────
function update(dt) {
  updateWalkers(dt);
  handleWalkerCollisions();
  updateMana(dt);

  levelEvalTimer += dt;
  if (levelEvalTimer >= 1.0) {
    levelEvalTimer = 0;
    tryMergeSettlements();
    evaluateSettlementLevels();
  }

  popGrowthTimer += dt;
  if (popGrowthTimer >= 2.0) {
    popGrowthTimer = 0;
    updatePopulationGrowth();
  }

  pruneTimer += dt;
  if (pruneTimer >= 3.0) {
    pruneTimer = 0;
    pruneDeadEntities();
  }

  aiTimer += dt;
  if (aiTimer >= 3.0) {
    aiTimer = 0;
    updateAI();
  }
}

function gameLoop(now) {
  const dt = Math.min(0.1, (now - lastTime) / 1000); // cap dt at 100ms
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(gameLoop);
}

// ── Resize & Boot ────────────────────────────────────────────────────
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);

initHeightMap();
spawnInitialWalkers();
resize();
lastTime = performance.now();
requestAnimationFrame(gameLoop);
