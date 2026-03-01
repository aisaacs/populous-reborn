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

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Back-to-front painter's algorithm
  for (let row = 0; row < MAP_H; row++) {
    for (let col = 0; col < MAP_W; col++) {
      drawTile(col, row);
    }
  }
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
  render();
}

// ── Input ────────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) modifyHeight(e.clientX, e.clientY, 1);
  if (e.button === 2) modifyHeight(e.clientX, e.clientY, -1);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Toggle grid — G key
window.addEventListener('keydown', (e) => {
  if (e.key === 'g' || e.key === 'G') { gridMode = (gridMode + 1) % GRID_MODES.length; render(); }
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
  render();
});
window.addEventListener('mouseup', (e) => { if (e.button === 1) panning = false; });

// ── Resize & Boot ────────────────────────────────────────────────────
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  render();
}
window.addEventListener('resize', resize);

initHeightMap();
resize();
