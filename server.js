'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const C = require('./shared/constants');

// ── HTTP Static File Server ─────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.mp3':  'audio/mpeg',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let filePath;
  const url = req.url.split('?')[0];

  if (url.startsWith('/shared/')) {
    filePath = path.join(__dirname, url);
  } else {
    filePath = path.join(__dirname, 'public', url === '/' ? 'index.html' : url);
  }

  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Populous server running on http://localhost:${PORT}`);
});

// ── Room Management ─────────────────────────────────────────────────
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * 26)];
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = generateRoomCode();
  const room = { code, players: [null, null], state: null, tickInterval: null, started: false, ai: false, aiTimer: 0 };
  rooms.set(code, room);
  return room;
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.tickInterval) clearInterval(room.tickInterval);
  rooms.delete(code);
}

// ── Game State ──────────────────────────────────────────────────────
function createGameState() {
  const heights = [];
  for (let x = 0; x <= C.MAP_W; x++) {
    heights[x] = [];
    for (let y = 0; y <= C.MAP_H; y++) {
      heights[x][y] = 0;
    }
  }

  return {
    heights,
    walkers: [],
    settlements: [],
    settlementMap: new Int32Array(C.MAP_W * C.MAP_H).fill(-1),
    walkerGrid: new Array(C.MAP_W * C.MAP_H),
    teamMode: [C.MODE_SETTLE, C.MODE_SETTLE],
    magnetPos: [{ x: 10, y: 10 }, { x: 50, y: 50 }],
    mana: [C.START_MANA, C.START_MANA],
    swamps: [],
    swampSet: new Set(),
    rocks: new Set(),
    trees: new Set(),
    pebbles: new Set(),
    ruins: [],
    ruinSet: new Set(),
    crops: [],
    cropCounts: [],
    cropOwnerMap: new Int32Array(C.MAP_W * C.MAP_H).fill(-1),
    fires: [], // {x, y, age} — burning settlement ruins
    seaLevel: C.SEA_LEVEL,
    leaders: [-1, -1],
    magnetLocked: [false, false],
    armageddon: false,
    levelEvalTimer: 0,
    pruneTimer: 0,
    nextWalkerId: 1,
    gameOver: false,
    winner: -1,
  };
}

// ── Terrain Generation ──────────────────────────────────────────────
const TERRAIN_FLATNESS = 0.3; // 0 = very mountainous, 1 = very flat
const TERRAIN_ROCKS = 0.03;   // fraction of land tiles that get rocks (0-1)

// 2D value noise with smoothstep interpolation
function makeNoise2D() {
  const SIZE = 256;
  const perm = new Uint8Array(SIZE * 2);
  const grad = new Float64Array(SIZE);
  for (let i = 0; i < SIZE; i++) { perm[i] = i; grad[i] = Math.random() * 2 - 1; }
  for (let i = SIZE - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < SIZE; i++) perm[SIZE + i] = perm[i];

  function hash(ix, iy) { return grad[perm[perm[ix & 255] + (iy & 255)]]; }
  function smooth(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

  return function(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = hash(ix, iy), b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + fx * (b - a) + fy * (c - a) + fx * fy * (a - b - c + d);
  };
}

function enforceAdjacency(state) {
  for (let pass = 0; pass < 30; pass++) {
    let changed = false;
    for (let x = 0; x <= C.MAP_W; x++) {
      for (let y = 0; y <= C.MAP_H; y++) {
        const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of nb) {
          if (nx < 0 || nx > C.MAP_W || ny < 0 || ny > C.MAP_H) continue;
          if (state.heights[x][y] - state.heights[nx][ny] > 1) {
            state.heights[x][y] = state.heights[nx][ny] + 1;
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
}

// Check if a 5x5 flat area exists near a position
function hasSpawnFlat(state, cx, cy) {
  for (let r = 0; r < 15; r++) {
    for (let ox = cx - r; ox <= cx + r; ox++) {
      for (let oy = cy - r; oy <= cy + r; oy++) {
        if (Math.abs(ox - cx) !== r && Math.abs(oy - cy) !== r) continue;
        if (ox < 0 || ox + 5 > C.MAP_W || oy < 0 || oy + 5 > C.MAP_H) continue;
        let flat = true;
        const h = state.heights[ox][oy];
        if (h <= state.seaLevel) continue;
        for (let dx = 0; dx <= 5 && flat; dx++) {
          for (let dy = 0; dy <= 5 && flat; dy++) {
            if (state.heights[ox + dx][oy + dy] !== h) flat = false;
          }
        }
        if (flat) return true;
      }
    }
  }
  return false;
}

function generateTerrain(state) {
  const W = C.MAP_W, H = C.MAP_H;
  const spawns = [{ cx: 10, cy: 10 }, { cx: 50, cy: 50 }];

  for (let attempt = 0; attempt < 20; attempt++) {
    const noise = makeNoise2D();

    // Randomize parameters each game
    const freq = 0.03 + Math.random() * 0.05;
    const heightMul = (2.0 - TERRAIN_FLATNESS * 1.5) * (0.85 + Math.random() * 0.3);
    const numCenters = 2 + Math.floor(Math.random() * 4); // 2–5
    const centers = [];

    // Always include centers near spawn zones so both teams have land
    for (const sp of spawns) {
      centers.push({
        x: sp.cx + (Math.random() - 0.5) * 10,
        y: sp.cy + (Math.random() - 0.5) * 10,
        r: 0.4 + Math.random() * 0.25, // radius as fraction of map
      });
    }

    // Additional random centers, biased away from edges
    for (let i = centers.length; i < numCenters; i++) {
      centers.push({
        x: 8 + Math.random() * (W - 16),
        y: 8 + Math.random() * (H - 16),
        r: 0.2 + Math.random() * 0.35,
      });
    }

    // Generate height field
    for (let x = 0; x <= W; x++) {
      for (let y = 0; y <= H; y++) {
        // 3 octaves of noise
        const nx = x * freq, ny = y * freq;
        let v = noise(nx, ny) * 0.6 + noise(nx * 2.1, ny * 2.1) * 0.25 + noise(nx * 4.3, ny * 4.3) * 0.15;

        // Multi-center island mask — take max influence from all centers
        let mask = 0;
        for (const c of centers) {
          const dx = (x - c.x) / (W * c.r);
          const dy = (y - c.y) / (H * c.r);
          const d = Math.sqrt(dx * dx + dy * dy);
          mask = Math.max(mask, Math.max(0, 1 - d));
        }

        // Edge fade — ensure nothing spawns at map borders
        const ex = Math.min(x, W - x) / 5;
        const ey = Math.min(y, H - y) / 5;
        mask *= Math.min(1, ex, ey);

        v = (v * 0.7 + 0.5) * mask;
        state.heights[x][y] = Math.max(0, Math.min(C.MAX_HEIGHT, Math.round(v * C.MAX_HEIGHT * heightMul)));
      }
    }

    enforceAdjacency(state);

    // Scatter natural rocks on ~5-10% of land tiles (avoid spawn zones)
    state.rocks.clear();
    for (let x = 0; x < C.MAP_W; x++) {
      for (let y = 0; y < C.MAP_H; y++) {
        if (isTileWater(state, x, y)) continue;
        // Keep spawn zones clear (radius 8 around each spawn)
        const d0 = Math.abs(x - 10) + Math.abs(y - 10);
        const d1 = Math.abs(x - 50) + Math.abs(y - 50);
        if (d0 < 8 || d1 < 8) continue;
        if (Math.random() < TERRAIN_ROCKS) state.rocks.add(x + ',' + y);
      }
    }

    // Scatter trees on land tiles (avoid spawn zones)
    state.trees.clear();
    for (let x = 0; x < C.MAP_W; x++) {
      for (let y = 0; y < C.MAP_H; y++) {
        if (isTileWater(state, x, y)) continue;
        if (state.rocks.has(x + ',' + y)) continue;
        const d0 = Math.abs(x - 10) + Math.abs(y - 10);
        const d1 = Math.abs(x - 50) + Math.abs(y - 50);
        if (d0 < 8 || d1 < 8) continue;
        if (Math.random() < C.TERRAIN_TREES) state.trees.add(x + ',' + y);
      }
    }

    // Scatter pebbles on land tiles (avoid spawn zones, rocks, trees)
    state.pebbles.clear();
    for (let x = 0; x < C.MAP_W; x++) {
      for (let y = 0; y < C.MAP_H; y++) {
        if (isTileWater(state, x, y)) continue;
        const key = x + ',' + y;
        if (state.rocks.has(key)) continue;
        if (state.trees.has(key)) continue;
        const d0 = Math.abs(x - 10) + Math.abs(y - 10);
        const d1 = Math.abs(x - 50) + Math.abs(y - 50);
        if (d0 < 8 || d1 < 8) continue;
        if (Math.random() < C.TERRAIN_PEBBLES) state.pebbles.add(key);
      }
    }

    // Validate: both spawn zones must have a 5x5 flat area nearby
    if (hasSpawnFlat(state, 10, 10) && hasSpawnFlat(state, 50, 50)) return;

    // Reset heights for retry
    for (let x = 0; x <= W; x++) {
      for (let y = 0; y <= H; y++) state.heights[x][y] = 0;
    }
  }
  // Fallback: last attempt is kept even if validation fails
}

// ── Utility Functions ───────────────────────────────────────────────
function isTileWater(state, tx, ty) {
  if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) return true;
  return state.heights[tx][ty] <= state.seaLevel &&
         state.heights[tx + 1][ty] <= state.seaLevel &&
         state.heights[tx + 1][ty + 1] <= state.seaLevel &&
         state.heights[tx][ty + 1] <= state.seaLevel;
}

function isTileFlat(state, tx, ty) {
  if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) return false;
  const h = state.heights[tx][ty];
  if (h <= state.seaLevel) return false;
  const key = tx + ',' + ty;
  if (state.rocks.has(key)) return false;
  if (state.pebbles.has(key)) return false;
  return state.heights[tx + 1][ty] === h &&
         state.heights[tx + 1][ty + 1] === h &&
         state.heights[tx][ty + 1] === h;
}

function heightAt(state, fx, fy) {
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const cx = Math.max(0, Math.min(C.MAP_W, ix));
  const cy = Math.max(0, Math.min(C.MAP_H, iy));
  const cx1 = Math.min(C.MAP_W, cx + 1);
  const cy1 = Math.min(C.MAP_H, cy + 1);
  const fx2 = fx - ix, fy2 = fy - iy;
  const h00 = state.heights[cx][cy], h10 = state.heights[cx1][cy];
  const h01 = state.heights[cx][cy1], h11 = state.heights[cx1][cy1];
  return h00 * (1 - fx2) * (1 - fy2) + h10 * fx2 * (1 - fy2) +
         h01 * (1 - fx2) * fy2 + h11 * fx2 * fy2;
}

function getSettlement(state, tx, ty) {
  if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) return null;
  const idx = state.settlementMap[ty * C.MAP_W + tx];
  if (idx < 0) return null;
  const s = state.settlements[idx];
  return (s && !s.dead) ? s : null;
}

function setSettlement(state, tx, ty, s) {
  if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) return;
  state.settlementMap[ty * C.MAP_W + tx] = s ? state.settlements.indexOf(s) : -1;
}

function clearSettlementMap(state, tx, ty) {
  if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) return;
  state.settlementMap[ty * C.MAP_W + tx] = -1;
}

function clearSettlementFootprint(state, s) {
  for (let fx = 0; fx < s.sqSize; fx++) {
    for (let fy = 0; fy < s.sqSize; fy++) {
      const mx = s.sqOx + fx, my = s.sqOy + fy;
      if (mx >= 0 && mx < C.MAP_W && my >= 0 && my < C.MAP_H) {
        state.settlementMap[my * C.MAP_W + mx] = -1;
      }
    }
  }
}

function isNearSettlement(s, lx, ly) {
  return lx >= s.sqOx - 1 && lx < s.sqOx + s.sqSize + 1 &&
         ly >= s.sqOy - 1 && ly < s.sqOy + s.sqSize + 1;
}

function isTileInSettlementFootprint(state, tx, ty, exclude) {
  for (const s of state.settlements) {
    if (s.dead || s === exclude) continue;
    if (tx >= s.sqOx && tx < s.sqOx + s.sqSize &&
        ty >= s.sqOy && ty < s.sqOy + s.sqSize) return true;
  }
  return false;
}

// Physical footprint size per level: 1 tile for levels 1-8, 3×3 for castle (level 9)
const LEVEL_SQ_SIZE = [0, 1, 1, 1, 1, 1, 1, 1, 1, 5];

function getLevelFromCropCount(count) {
  for (let l = C.MAX_LEVEL; l >= 1; l--) {
    if (count >= C.CROP_LEVEL_THRESHOLDS[l]) return l;
  }
  return 1;
}

function updateSettlementFootprint(s) {
  s.sqSize = LEVEL_SQ_SIZE[s.level];
  s.sqOx = s.tx - Math.floor((s.sqSize - 1) / 2);
  s.sqOy = s.ty - Math.floor((s.sqSize - 1) / 2);
}

// Check that the 5×5 area centered on home tile is all flat and unoccupied
function isCastleAreaValid(state, s) {
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const cx = s.tx + dx, cy = s.ty + dy;
      if (!isTileFlat(state, cx, cy)) return false;
      // Check no other settlement's home tile is in this 5×5
      if (dx === 0 && dy === 0) continue;
      const idx = state.settlementMap[cy * C.MAP_W + cx];
      if (idx >= 0 && idx !== state.settlements.indexOf(s)) return false;
    }
  }
  return true;
}

// ── Terrain Modification ────────────────────────────────────────────
function raisePoint(state, px, py) {
  if (state.heights[px][py] >= C.MAX_HEIGHT) return;
  state.heights[px][py]++;
  const queue = [[px, py]];
  while (queue.length) {
    const [x, y] = queue.shift();
    const h = state.heights[x][y];
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || nx > C.MAP_W || ny < 0 || ny > C.MAP_H) continue;
      if (h - state.heights[nx][ny] > 1) {
        state.heights[nx][ny] = h - 1;
        queue.push([nx, ny]);
      }
    }
  }
  // Remove pebbles and ruins on tiles sharing this point
  for (const [dx, dy] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
    const tx = px + dx, ty = py + dy;
    if (tx >= 0 && tx < C.MAP_W && ty >= 0 && ty < C.MAP_H) {
      const key = tx + ',' + ty;
      state.pebbles.delete(key);
      if (state.ruinSet.has(key)) {
        state.ruins = state.ruins.filter(r => !(r.x === tx && r.y === ty));
        state.ruinSet.delete(key);
      }
    }
  }
}

function lowerPoint(state, px, py) {
  if (state.heights[px][py] <= 0) return;
  state.heights[px][py]--;
  const queue = [[px, py]];
  while (queue.length) {
    const [x, y] = queue.shift();
    const h = state.heights[x][y];
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || nx > C.MAP_W || ny < 0 || ny > C.MAP_H) continue;
      if (state.heights[nx][ny] - h > 1) {
        state.heights[nx][ny] = h + 1;
        queue.push([nx, ny]);
      }
    }
  }
  // Remove pebbles and ruins on tiles sharing this point
  for (const [dx, dy] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
    const tx = px + dx, ty = py + dy;
    if (tx >= 0 && tx < C.MAP_W && ty >= 0 && ty < C.MAP_H) {
      const key = tx + ',' + ty;
      state.pebbles.delete(key);
      if (state.ruinSet.has(key)) {
        state.ruins = state.ruins.filter(r => !(r.x === tx && r.y === ty));
        state.ruinSet.delete(key);
      }
    }
  }
}

// ── Swamp Helpers ──────────────────────────────────────────────────
function invalidateSwamps(state) {
  state.swamps = state.swamps.filter(s => {
    const tx = s.x, ty = s.y;
    if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) return false;
    if (isTileWater(state, tx, ty)) return false;
    if (!isTileFlat(state, tx, ty)) return false;
    return true;
  });
  // Rebuild swampSet
  state.swampSet.clear();
  for (const s of state.swamps) state.swampSet.add(s.x + ',' + s.y);
}

// Remove rocks on tiles that are now underwater
function invalidateRocks(state) {
  for (const key of state.rocks) {
    const [x, y] = key.split(',').map(Number);
    if (isTileWater(state, x, y)) state.rocks.delete(key);
  }
}

// Remove trees on tiles that are now underwater
function invalidateTrees(state) {
  for (const key of state.trees) {
    const [x, y] = key.split(',').map(Number);
    if (isTileWater(state, x, y)) state.trees.delete(key);
  }
}

// Remove ruins on tiles that are now underwater
function invalidateRuins(state) {
  state.ruins = state.ruins.filter(r => {
    if (isTileWater(state, r.x, r.y)) return false;
    return true;
  });
  state.ruinSet.clear();
  for (const r of state.ruins) state.ruinSet.add(r.x + ',' + r.y);
}

// Remove pebbles on tiles that are now underwater
function invalidatePebbles(state) {
  for (const key of state.pebbles) {
    const [x, y] = key.split(',').map(Number);
    if (isTileWater(state, x, y)) state.pebbles.delete(key);
  }
}

// Build proximity: can only terraform near own units
function canBuildAtPoint(state, team, px, py) {
  const r = C.BUILD_PROXIMITY_RADIUS;
  for (const w of state.walkers) {
    if (w.dead || w.team !== team) continue;
    if (Math.abs(w.x - px) <= r && Math.abs(w.y - py) <= r) return true;
  }
  for (const s of state.settlements) {
    if (s.dead || s.team !== team) continue;
    if (Math.abs(s.tx - px) <= r && Math.abs(s.ty - py) <= r) return true;
  }
  return false;
}


// ── Walker Alive Helper ────────────────────────────────────────────
function isWalkerAlive(state, id) {
  if (id < 0) return false;
  for (const w of state.walkers) {
    if (w.id === id && !w.dead) return true;
  }
  return false;
}

// ── Armageddon Targeting ───────────────────────────────────────────
function pickArmageddonTarget(state, w) {
  const cx = C.MAP_W / 2, cy = C.MAP_H / 2;
  const dx = cx - w.x, dy = cy - w.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 5) {
    pickFightTarget(state, w);
  } else {
    w.tx = cx + (Math.random() - 0.5) * 4;
    w.ty = cy + (Math.random() - 0.5) * 4;
  }
}

// ── Walker System ───────────────────────────────────────────────────
function spawnWalker(state, team, strength, x, y, tech) {
  const w = {
    id: state.nextWalkerId++,
    team, strength: Math.min(255, strength),
    x, y,
    tx: x, ty: y,
    dead: false,
    tech: tech || 0,
  };
  state.walkers.push(w);
  return w;
}

function spawnInitialWalkers(state) {
  const spawnZones = [
    { cx: 10, cy: 10 },
    { cx: 50, cy: 50 },
  ];

  for (let team = 0; team < 2; team++) {
    const zone = spawnZones[team];
    let spawned = 0;
    for (let r = 0; r < 20 && spawned < C.START_WALKERS; r++) {
      for (let dx = -r; dx <= r && spawned < C.START_WALKERS; dx++) {
        for (let dy = -r; dy <= r && spawned < C.START_WALKERS; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const tx = zone.cx + dx, ty = zone.cy + dy;
          if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) continue;
          if (!isTileWater(state, tx, ty) && state.heights[tx][ty] > state.seaLevel) {
            spawnWalker(state, team, C.START_STRENGTH, tx + 0.5, ty + 0.5);
            spawned++;
          }
        }
      }
    }
  }
}

// ── Walker Targeting ────────────────────────────────────────────────
function pickRandomTarget(state, w) {
  const angle = Math.random() * Math.PI * 2;
  const dist = 1 + Math.random() * 2;
  const nx = w.x + Math.cos(angle) * dist;
  const ny = w.y + Math.sin(angle) * dist;
  const tx = Math.floor(nx), ty = Math.floor(ny);
  if (tx >= 0 && tx < C.MAP_W && ty >= 0 && ty < C.MAP_H && !isTileWater(state, tx, ty)) {
    w.tx = nx;
    w.ty = ny;
  } else {
    w.tx = w.x - Math.cos(angle) * dist;
    w.ty = w.y - Math.sin(angle) * dist;
  }
}

function isTileSettleable(state, tx, ty) {
  if (!isTileFlat(state, tx, ty)) return false;
  if (isTileInSettlementFootprint(state, tx, ty)) return false;
  if (state.cropOwnerMap[ty * C.MAP_W + tx] !== -1) return false; // blocks owned (>=0) and contested (-2)
  // Ruins block settlement placement
  if (state.ruinSet.has(tx + ',' + ty)) return false;
  // Hard rocks in orthogonal neighbors block settlement placement
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nx = tx + dx, ny = ty + dy;
    if (state.rocks.has(nx + ',' + ny)) return false;
  }
  return true;
}

function pickSettleTarget(state, w) {
  const cx = Math.floor(w.x), cy = Math.floor(w.y);

  if (isTileSettleable(state, cx, cy)) {
    settleWalker(state, w, cx, cy);
    return;
  }

  let bestDist = Infinity, bestTx = -1, bestTy = -1;
  const searchR = 8;
  for (let dx = -searchR; dx <= searchR; dx++) {
    for (let dy = -searchR; dy <= searchR; dy++) {
      const tx = cx + dx, ty = cy + dy;
      if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) continue;
      if (isTileSettleable(state, tx, ty)) {
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; bestTx = tx; bestTy = ty; }
      }
    }
  }

  if (bestTx >= 0) {
    w.tx = bestTx + 0.5;
    w.ty = bestTy + 0.5;
  } else {
    pickRandomTarget(state, w);
  }
}

function pickMagnetTarget(state, w) {
  const mp = state.magnetPos[w.team];
  const dx = mp.x - w.x, dy = mp.y - w.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 2) {
    pickRandomTarget(state, w);
  } else {
    w.tx = mp.x + (Math.random() - 0.5) * 2;
    w.ty = mp.y + (Math.random() - 0.5) * 2;
  }
}

function pickFightTarget(state, w) {
  let bestDist = Infinity, bestX = -1, bestY = -1;

  for (const ew of state.walkers) {
    if (ew.dead || ew.team === w.team) continue;
    const dx = ew.x - w.x, dy = ew.y - w.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; bestX = ew.x; bestY = ew.y; }
  }

  for (const es of state.settlements) {
    if (es.dead || es.team === w.team) continue;
    const dx = (es.tx + 0.5) - w.x, dy = (es.ty + 0.5) - w.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; bestX = es.tx + 0.5; bestY = es.ty + 0.5; }
  }

  if (bestX >= 0) {
    w.tx = bestX;
    w.ty = bestY;
  } else {
    pickRandomTarget(state, w);
  }
}

function pickGatherTarget(state, w) {
  pickMagnetTarget(state, w);
}

function pickWalkerTarget(state, w) {
  switch (state.teamMode[w.team]) {
    case C.MODE_SETTLE:  pickSettleTarget(state, w); break;
    case C.MODE_MAGNET:  pickMagnetTarget(state, w); break;
    case C.MODE_FIGHT:   pickFightTarget(state, w); break;
    case C.MODE_GATHER:  pickGatherTarget(state, w); break;
    default:             pickRandomTarget(state, w); break;
  }
}

function rebuildWalkerGrid(state) {
  for (let i = 0; i < C.MAP_W * C.MAP_H; i++) state.walkerGrid[i] = null;
  for (let i = 0; i < state.walkers.length; i++) {
    const w = state.walkers[i];
    if (w.dead) continue;
    const tx = Math.floor(w.x), ty = Math.floor(w.y);
    if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) continue;
    const key = ty * C.MAP_W + tx;
    if (!state.walkerGrid[key]) state.walkerGrid[key] = [];
    state.walkerGrid[key].push(w);
  }
}

function updateWalkers(state, dt) {
  for (const w of state.walkers) {
    if (w.dead) continue;

    const ctx2 = Math.floor(w.x), cty = Math.floor(w.y);
    if (ctx2 < 0 || ctx2 >= C.MAP_W || cty < 0 || cty >= C.MAP_H || isTileWater(state, ctx2, cty)) {
      w.dead = true;
      continue;
    }

    // Swamp death check (knights avoid swamps, so they skip this)
    if (!w.isKnight) {
      const swKey = ctx2 + ',' + cty;
      if (state.swampSet.has(swKey)) {
        const sw = state.swamps.find(s => s.x === ctx2 && s.y === cty);
        if (sw && sw.team !== w.team) {
          w.dead = true;
        }
      }
    }
    if (w.dead) continue;

    // Leader assignment: walker near own magnet and no leader exists
    if (!w.isLeader && !w.isKnight && state.leaders[w.team] < 0) {
      const mp = state.magnetPos[w.team];
      const ldx = mp.x - w.x, ldy = mp.y - w.y;
      if (ldx * ldx + ldy * ldy < 4) { // radius 2
        w.isLeader = true;
        state.leaders[w.team] = w.id;
        state.magnetLocked[w.team] = false;
      }
    }

    const dx = w.tx - w.x, dy = w.ty - w.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.1) {
      // Choose target based on state
      if (state.armageddon) {
        pickArmageddonTarget(state, w);
      } else if (w.isKnight) {
        pickFightTarget(state, w);
      } else {
        pickWalkerTarget(state, w);
      }
    } else {
      const speed = w.isKnight ? C.WALKER_SPEED * C.KNIGHT_SPEED_MULT : C.WALKER_SPEED;
      const step = speed * dt;

      // Knight swamp avoidance: check if next tile is an enemy swamp
      if (w.isKnight && step < dist) {
        const nextX = w.x + (dx / dist) * step;
        const nextY = w.y + (dy / dist) * step;
        const nextTx = Math.floor(nextX), nextTy = Math.floor(nextY);
        const nextKey = nextTx + ',' + nextTy;
        if (state.swampSet.has(nextKey)) {
          const sw = state.swamps.find(s => s.x === nextTx && s.y === nextTy);
          if (sw && sw.team !== w.team) {
            // Try perpendicular directions
            const perpX1 = -dy / dist, perpY1 = dx / dist;
            const perpX2 = dy / dist, perpY2 = -dx / dist;
            let moved = false;
            for (const [px, py] of [[perpX1, perpY1], [perpX2, perpY2]]) {
              const altX = w.x + px * step;
              const altY = w.y + py * step;
              const altTx = Math.floor(altX), altTy = Math.floor(altY);
              if (altTx >= 0 && altTx < C.MAP_W && altTy >= 0 && altTy < C.MAP_H &&
                  !isTileWater(state, altTx, altTy)) {
                const altKey = altTx + ',' + altTy;
                const altSw = state.swampSet.has(altKey) &&
                  state.swamps.find(s => s.x === altTx && s.y === altTy && s.team !== w.team);
                if (!altSw) {
                  w.x = Math.max(0.1, Math.min(C.MAP_W - 0.1, altX));
                  w.y = Math.max(0.1, Math.min(C.MAP_H - 0.1, altY));
                  moved = true;
                  break;
                }
              }
            }
            if (!moved) { /* wait — don't move */ }
            continue; // skip normal movement for this walker
          }
        }
      }

      if (step >= dist) {
        w.x = w.tx;
        w.y = w.ty;
      } else {
        w.x += (dx / dist) * step;
        w.y += (dy / dist) * step;
      }

      w.x = Math.max(0.1, Math.min(C.MAP_W - 0.1, w.x));
      w.y = Math.max(0.1, Math.min(C.MAP_H - 0.1, w.y));

      const ntx = Math.floor(w.x), nty = Math.floor(w.y);
      if (ntx >= 0 && ntx < C.MAP_W && nty >= 0 && nty < C.MAP_H && isTileWater(state, ntx, nty)) {
        // Armageddon: auto-raise terrain instead of bouncing
        if (state.armageddon) {
          raisePoint(state, ntx, nty);
          raisePoint(state, ntx + 1, nty);
          raisePoint(state, ntx, nty + 1);
          raisePoint(state, ntx + 1, nty + 1);
        } else {
          w.x -= (dx / dist) * step;
          w.y -= (dy / dist) * step;
          w.x = Math.max(0.1, Math.min(C.MAP_W - 0.1, w.x));
          w.y = Math.max(0.1, Math.min(C.MAP_H - 0.1, w.y));
          pickRandomTarget(state, w);
        }
      }
    }
  }

  // Walker attrition — walkers gradually lose strength over time
  for (const w of state.walkers) {
    if (w.dead) continue;
    w.attritionFrac = (w.attritionFrac || 0) + C.WALKER_ATTRITION_PER_SEC * dt;
    if (w.attritionFrac >= 1) {
      const loss = Math.floor(w.attritionFrac);
      w.attritionFrac -= loss;
      w.strength -= loss;
      if (w.strength <= 0) w.dead = true;
    }
  }
}

// ── Settlement System ───────────────────────────────────────────────
function settleWalker(state, w, tx, ty) {
  if (!isTileSettleable(state, tx, ty)) return;
  const s = {
    team: w.team,
    level: 1,
    population: 0,
    tx, ty,
    sqOx: tx, sqOy: ty, sqSize: 1,
    dead: false,
    atCapTime: 0,
    popFrac: 0,
    hasLeader: false,
  };
  state.settlements.push(s);
  setSettlement(state, tx, ty, s);

  // Auto-clear tree on home tile
  state.trees.delete(tx + ',' + ty);

  // Immediately evaluate level from surrounding crop fields
  const cropCount = countSettlementCrops(state, s);
  let level = getLevelFromCropCount(cropCount);
  if (level >= C.MAX_LEVEL && !isCastleAreaValid(state, s)) level = C.MAX_LEVEL - 1;
  s.level = level;
  updateSettlementFootprint(s);
  // Update settlementMap for new footprint (may be larger than 1x1 if enough crops)
  const newSi = state.settlements.indexOf(s);
  for (let fx = 0; fx < s.sqSize; fx++) {
    for (let fy = 0; fy < s.sqSize; fy++) {
      const mx = s.sqOx + fx, my = s.sqOy + fy;
      if (mx >= 0 && mx < C.MAP_W && my >= 0 && my < C.MAP_H) {
        state.settlementMap[my * C.MAP_W + mx] = newSi;
      }
    }
  }

  // Deposit population: cap at capacity, walker keeps remainder (chain-settling)
  const cap = C.LEVEL_CAPACITY[s.level];
  if (w.strength <= cap) {
    s.population = w.strength;
    // Leader enters the settlement
    if (w.isLeader) {
      s.hasLeader = true;
      w.isLeader = false;
      // leaders[team] stays set — leader is "inside" the settlement
    }
    w.dead = true;
  } else {
    s.population = cap;
    w.strength -= cap;
    // Push walker out so it walks on to find more land
    const angle = Math.random() * Math.PI * 2;
    w.x = tx + 0.5 + Math.cos(angle) * 1.5;
    w.y = ty + 0.5 + Math.sin(angle) * 1.5;
    w.x = Math.max(0.1, Math.min(C.MAP_W - 0.1, w.x));
    w.y = Math.max(0.1, Math.min(C.MAP_H - 0.1, w.y));
    // Leader keeps walking — don't transfer to settlement
    pickRandomTarget(state, w);
  }

  // Recompute crops so new settlement's claims are immediately visible
  computeCrops(state);
}

// Count crop fields for a settlement (for instant evaluation at settle time).
// Uses computeCrops result if available, otherwise quick local count.
function countSettlementCrops(state, s) {
  // After settling, computeCrops() is called, but for the initial level
  // we do a quick local scan. Enemy crops block (check cropOwnerMap from
  // last tick's computeCrops — close enough for initial placement).
  let count = 0;
  const r = C.CROP_ZONE_RADIUS;
  // Extend crop scan from footprint edges for multi-tile settlements
  const halfFp = Math.floor(s.sqSize / 2);
  const scanR = halfFp + r;
  for (let dx = -scanR; dx <= scanR; dx++) {
    for (let dy = -scanR; dy <= scanR; dy++) {
      const cx = s.tx + dx, cy = s.ty + dy;
      if (cx < 0 || cx >= C.MAP_W || cy < 0 || cy >= C.MAP_H) continue;
      // Skip home tile
      if (cx === s.tx && cy === s.ty) continue;
      if (!isTileFlat(state, cx, cy)) continue;
      // Skip tiles in OTHER settlements' footprints
      const smIdx = state.settlementMap[cy * C.MAP_W + cx];
      if (smIdx >= 0 && smIdx !== state.settlements.indexOf(s)) continue;
      const key = cx + ',' + cy;
      if (state.swampSet.has(key)) continue;
      if (state.pebbles.has(key)) continue;
      if (state.ruinSet.has(key)) continue;
      // Enemy or contested crops from previous tick block this tile
      const ownerIdx = state.cropOwnerMap[cy * C.MAP_W + cx];
      if (ownerIdx === -2) continue; // contested tile
      if (ownerIdx >= 0) {
        const owner = state.settlements[ownerIdx];
        if (owner && !owner.dead && owner.team !== s.team) continue;
      }
      if (state.trees.has(key)) state.trees.delete(key);
      count++;
    }
  }
  return count;
}

function evaluateSettlementLevels(state) {
  for (let si = 0; si < state.settlements.length; si++) {
    const s = state.settlements[si];
    if (s.dead) continue;

    // Home tile must still be flat (covers water, rock, non-flat terrain)
    if (!isTileFlat(state, s.tx, s.ty)) {
      s.dead = true;
      clearSettlementFootprint(state, s);
      if (s.population > 0) {
        const angle = Math.random() * Math.PI * 2;
        const sTech = C.SETTLEMENT_LEVELS[s.level] ? C.SETTLEMENT_LEVELS[s.level].tech : 0;
        const w = spawnWalker(state, s.team, s.population,
          s.tx + 0.5 + Math.cos(angle) * 1.2,
          s.ty + 0.5 + Math.sin(angle) * 1.2, sTech);
        if (s.hasLeader) {
          w.isLeader = true;
          state.leaders[s.team] = w.id;
          s.hasLeader = false;
        }
      } else if (s.hasLeader) {
        state.magnetPos[s.team] = { x: s.tx + 0.5, y: s.ty + 0.5 };
        state.magnetLocked[s.team] = true;
        state.leaders[s.team] = -1;
        s.hasLeader = false;
      }
      continue;
    }

    // Level from crop count (computed by computeCrops each tick)
    const cropCount = state.cropCounts ? (state.cropCounts[si] || 0) : 0;
    let newLevel = getLevelFromCropCount(cropCount);

    // Castle (max level) requires a valid 5×5 flat area around home tile
    if (newLevel >= C.MAX_LEVEL && !isCastleAreaValid(state, s)) {
      newLevel = C.MAX_LEVEL - 1;
    }

    if (newLevel !== s.level) {
      // Clear old footprint from settlementMap before changing size
      clearSettlementFootprint(state, s);
      s.level = newLevel;
      updateSettlementFootprint(s);
      // Register new footprint in settlementMap
      for (let fx = 0; fx < s.sqSize; fx++) {
        for (let fy = 0; fy < s.sqSize; fy++) {
          const mx = s.sqOx + fx, my = s.sqOy + fy;
          if (mx >= 0 && mx < C.MAP_W && my >= 0 && my < C.MAP_H) {
            state.settlementMap[my * C.MAP_W + mx] = si;
          }
        }
      }
    }

    // Eject if over capacity
    const cap = C.LEVEL_CAPACITY[s.level];
    if (s.population > cap) {
      const excess = s.population - Math.floor(cap / 2);
      s.population = Math.floor(cap / 2);
      const angle = Math.random() * Math.PI * 2;
      const sTech = C.SETTLEMENT_LEVELS[s.level] ? C.SETTLEMENT_LEVELS[s.level].tech : 0;
      const ew = spawnWalker(state, s.team, excess,
        s.tx + 0.5 + Math.cos(angle) * 1.2,
        s.ty + 0.5 + Math.sin(angle) * 1.2, sTech);
      // If settlement contains leader, ejected walker becomes leader
      if (s.hasLeader) {
        ew.isLeader = true;
        state.leaders[s.team] = ew.id;
        s.hasLeader = false;
      }
    }
  }
}

// ── Crop Computation ────────────────────────────────────────────────
// Populous-faithful rules:
// - Same-team settlements SHARE cropland (both count the tile)
// - Enemy cropland blocks yours (contested tiles hamper both sides)
// - Swamps, rocks, settlement footprints block crops
// - Trees auto-cleared by crop zones
function computeCrops(state) {
  state.cropOwnerMap.fill(-1);

  const r = C.CROP_ZONE_RADIUS;

  // Phase 1: Each settlement claims flat tiles in radius. Track per-team claims.
  // settlementClaims[si] = Set of "x,y" keys
  const settlementClaims = new Array(state.settlements.length);
  const teamTiles = [new Set(), new Set()]; // team → Set of "x,y"

  for (let si = 0; si < state.settlements.length; si++) {
    const claims = new Set();
    settlementClaims[si] = claims;
    const s = state.settlements[si];
    if (s.dead) continue;
    // Extend crop scan from footprint edges, not just home tile
    const halfFp = Math.floor(s.sqSize / 2);
    const scanR = halfFp + r;
    for (let dx = -scanR; dx <= scanR; dx++) {
      for (let dy = -scanR; dy <= scanR; dy++) {
        const cx = s.tx + dx, cy = s.ty + dy;
        if (cx < 0 || cx >= C.MAP_W || cy < 0 || cy >= C.MAP_H) continue;
        // Skip home tile
        if (cx === s.tx && cy === s.ty) continue;
        if (!isTileFlat(state, cx, cy)) continue;
        // Skip tiles in OTHER settlements' footprints (own footprint tiles count as crops)
        const smIdx = state.settlementMap[cy * C.MAP_W + cx];
        if (smIdx >= 0 && smIdx !== si) continue;
        const key = cx + ',' + cy;
        if (state.swampSet.has(key)) continue;
        if (state.pebbles.has(key)) continue;
        if (state.ruinSet.has(key)) continue;
        if (state.trees.has(key)) state.trees.delete(key);
        claims.add(key);
        teamTiles[s.team].add(key);
      }
    }
  }

  // Phase 2: Contested tiles — claimed by both teams — block both
  const contested = new Set();
  for (const key of teamTiles[0]) {
    if (teamTiles[1].has(key)) contested.add(key);
  }

  // Mark contested tiles in cropOwnerMap so they block settlement placement
  // Value -2 = contested (distinct from -1 = unclaimed and >= 0 = owned)
  for (const key of contested) {
    const [x, y] = key.split(',').map(Number);
    state.cropOwnerMap[y * C.MAP_W + x] = -2;
  }

  // Phase 3: Count crops per settlement. Same-team sharing: all same-team
  // settlements in range count the tile. Contested tiles excluded.
  const cropCounts = new Array(state.settlements.length).fill(0);
  const cropList = [];
  const addedCrops = new Set();

  for (let si = 0; si < state.settlements.length; si++) {
    const s = state.settlements[si];
    if (s.dead) continue;
    for (const key of settlementClaims[si]) {
      if (contested.has(key)) continue;
      cropCounts[si]++;
      if (!addedCrops.has(key)) {
        addedCrops.add(key);
        const [x, y] = key.split(',').map(Number);
        cropList.push({ x, y, t: s.team });
        state.cropOwnerMap[y * C.MAP_W + x] = si;
      }
    }
  }

  state.crops = cropList;
  state.cropCounts = cropCounts;
}

// ── Population Growth & Ejection ────────────────────────────────────
// Growth: continuous per-second based on crop count
// Ejection: dwell at cap then eject, only in Settle mode

function updatePopulationGrowth(state, dt) {
  for (let si = 0; si < state.settlements.length; si++) {
    const s = state.settlements[si];
    if (s.dead) continue;
    const cap = C.LEVEL_CAPACITY[s.level];
    const cropCount = state.cropCounts ? (state.cropCounts[si] || 0) : 0;

    if (s.population < cap && cropCount > 0) {
      // Grow: n crops × GROWTH_PER_CROP_PER_SEC per second
      s.popFrac = (s.popFrac || 0) + cropCount * C.GROWTH_PER_CROP_PER_SEC * dt;
      const whole = Math.floor(s.popFrac);
      if (whole > 0) {
        s.popFrac -= whole;
        s.population = Math.min(cap, s.population + whole);
      }
      s.atCapTime = 0;
    } else if (s.population >= cap && cap > 0) {
      // Only eject in Settle mode
      if (state.teamMode[s.team] !== C.MODE_SETTLE) {
        s.atCapTime = 0;
        continue;
      }
      // Dwell at cap before ejecting
      s.atCapTime = (s.atCapTime || 0) + dt;
      if (s.atCapTime >= C.EJECT_DWELL_TIME) {
        s.atCapTime = 0;
        const ejectStrength = Math.max(C.EJECT_MIN_STRENGTH,
          Math.floor(s.population * C.EJECT_FRACTION));
        s.population -= ejectStrength;
        const angle = Math.random() * Math.PI * 2;
        const sx = s.tx + 0.5 + Math.cos(angle) * 1.2;
        const sy = s.ty + 0.5 + Math.sin(angle) * 1.2;
        const w = spawnWalker(state, s.team, ejectStrength, sx, sy);
        // Ejected walkers inherit tech from settlement
        w.tech = C.SETTLEMENT_LEVELS[s.level] ? C.SETTLEMENT_LEVELS[s.level].tech : 0;
        // If settlement contains leader, ejected walker becomes the leader
        if (s.hasLeader) {
          w.isLeader = true;
          state.leaders[s.team] = w.id;
          s.hasLeader = false;
        }
      }
    } else {
      s.atCapTime = 0;
    }
  }
}

// ── Walker Merging & Combat ─────────────────────────────────────────
function handleWalkerCollisions(state) {
  rebuildWalkerGrid(state);

  for (let i = 0; i < state.walkers.length; i++) {
    const w = state.walkers[i];
    if (w.dead) continue;

    const cx = Math.floor(w.x), cy = Math.floor(w.y);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const tx = cx + dx, ty = cy + dy;
        if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) continue;
        const wlist = state.walkerGrid[ty * C.MAP_W + tx];
        if (!wlist) continue;
        for (const other of wlist) {
          if (other === w || other.dead) continue;
          const ddx = other.x - w.x, ddy = other.y - w.y;
          const dist = ddx * ddx + ddy * ddy;
          if (dist > 0.5 * 0.5) continue;

          if (other.team === w.team) {
            // Knights don't merge with friendlies
            if (w.isKnight || other.isKnight) continue;
            w.strength = Math.min(255, w.strength + other.strength);
            w.tech = Math.max(w.tech || 0, other.tech || 0);
            // Preserve leadership: if absorbed walker was leader, survivor inherits
            if (other.isLeader) {
              w.isLeader = true;
              state.leaders[w.team] = w.id;
              other.isLeader = false;
            }
            other.dead = true;
          } else {
            // Tech-based combat: higher tech deals more effective damage
            const wTech = w.tech || 0, oTech = other.tech || 0;
            const wMult = Math.pow(C.TECH_ADVANTAGE_MULT, Math.max(0, wTech - oTech));
            const oMult = Math.pow(C.TECH_ADVANTAGE_MULT, Math.max(0, oTech - wTech));
            const wEff = w.strength * wMult;
            const oEff = other.strength * oMult;
            if (wEff > oEff) {
              // w wins: time for other to die, then subtract damage taken
              const t = other.strength / wMult; // time units
              w.strength = Math.max(1, Math.round(w.strength - oMult * t));
              other.dead = true;
            } else if (oEff > wEff) {
              const t = w.strength / oMult;
              other.strength = Math.max(1, Math.round(other.strength - wMult * t));
              w.dead = true;
            } else {
              w.dead = true;
              other.dead = true;
            }
          }
        }
      }
    }

    if (w.dead) continue;

    const stx = Math.floor(w.x), sty = Math.floor(w.y);
    const es = getSettlement(state, stx, sty);

    // Walker reinforcement: deposit strength into friendly settlement
    if (es && es.team === w.team && !w.isKnight && !w.isLeader) {
      const cap = C.LEVEL_CAPACITY[es.level] || 0;
      if (es.population < cap) {
        const space = cap - es.population;
        const deposit = Math.min(w.strength, space);
        es.population += deposit;
        w.strength -= deposit;
        if (w.strength <= 0) w.dead = true;
        continue;
      }
    }

    if (es && es.team !== w.team) {
      // Track this walker as an attacker of this settlement
      if (!es._attackers) es._attackers = [];
      es._attackers.push(w);
    }
  }

  // Process settlement assaults — retaliation is split among all attackers
  for (const es of state.settlements) {
    if (es.dead || !es._attackers || es._attackers.length === 0) continue;
    const attackers = es._attackers;
    delete es._attackers;

    const dt = 1 / C.TICK_RATE;
    const sTech = C.SETTLEMENT_LEVELS[es.level] ? C.SETTLEMENT_LEVELS[es.level].tech : 0;

    // Total damage dealt to settlement by all attackers this tick
    let totalDmgToSett = 0;
    for (const w of attackers) {
      const wTech = w.tech || 0;
      const techDiff = wTech - sTech;
      const wMult = techDiff > 0 ? Math.pow(C.TECH_ADVANTAGE_MULT, techDiff) : 1;
      const atkMult = w.isKnight ? C.KNIGHT_STRENGTH_MULT : 1;
      // Stronger walkers deal more damage (scaled by strength)
      const strMult = Math.max(1, w.strength / 5);
      totalDmgToSett += C.ASSAULT_DMG_PER_SEC * dt * wMult * atkMult * strMult;
    }

    // Apply damage to settlement
    es.assaultFrac = (es.assaultFrac || 0) + totalDmgToSett;
    if (es.assaultFrac >= 1) {
      const loss = Math.floor(es.assaultFrac);
      es.assaultFrac -= loss;
      es.population -= loss;
    }

    // Settlement retaliates — fixed firepower divided among attackers
    // Scales with settlement population (weaker settlement = weaker retaliation)
    const popScale = Math.max(0.2, es.population / 20);
    const totalRetal = C.ASSAULT_DMG_PER_SEC * dt * C.ASSAULT_RETALIATE_FRAC * popScale;
    const retalPerWalker = totalRetal / attackers.length;

    for (const w of attackers) {
      const wTech = w.tech || 0;
      const techDiff = wTech - sTech;
      const sMult = techDiff < 0 ? Math.pow(C.TECH_ADVANTAGE_MULT, -techDiff) : 1;
      const retalMult = w.isKnight ? 0.2 : 1;
      w.assaultFrac = (w.assaultFrac || 0) + retalPerWalker * sMult * retalMult;
      if (w.assaultFrac >= 1) {
        const loss = Math.floor(w.assaultFrac);
        w.assaultFrac -= loss;
        w.strength -= loss;
      }
      if (w.strength <= 0) w.dead = true;
    }

    // Settlement falls
    if (es.population <= 0) {
      if (es.hasLeader) {
        state.magnetPos[es.team] = { x: es.tx + 0.5, y: es.ty + 0.5 };
        state.magnetLocked[es.team] = true;
        state.leaders[es.team] = -1;
        es.hasLeader = false;
      }
      // Find strongest surviving attacker for conquest
      let best = null;
      for (const w of attackers) {
        if (!w.dead && (!best || w.strength > best.strength)) best = w;
      }
      if (best && best.isKnight) {
        // Create ruins at all tiles in the settlement footprint
        for (let rdx = 0; rdx < es.sqSize; rdx++) {
          for (let rdy = 0; rdy < es.sqSize; rdy++) {
            const rx = es.sqOx + rdx, ry = es.sqOy + rdy;
            if (rx >= 0 && rx < C.MAP_W && ry >= 0 && ry < C.MAP_H) {
              const rkey = rx + ',' + ry;
              if (!state.ruinSet.has(rkey)) {
                state.ruins.push({ x: rx, y: ry, team: es.team });
                state.ruinSet.add(rkey);
              }
            }
          }
        }
        es.dead = true;
        clearSettlementFootprint(state, es);
        state.fires.push({ x: es.tx, y: es.ty, age: 0 });
        pickFightTarget(state, best);
      } else if (best) {
        // Conquer
        es.team = best.team;
        es.population = Math.max(1, best.strength);
        es.popFrac = 0;
        es.atCapTime = 0;
        es.assaultFrac = 0;
        best.dead = true;
      } else {
        // All attackers died but settlement fell too — just destroy it
        es.dead = true;
        clearSettlementFootprint(state, es);
      }
    }
  }

  // Clean up _attackers on any settlements that weren't processed
  for (const es of state.settlements) {
    delete es._attackers;
  }
}

// ── Entity Pruning ──────────────────────────────────────────────────
function pruneDeadEntities(state) {
  // Clear leaders if their walker is dead — but not if leader is inside a settlement
  for (let t = 0; t < 2; t++) {
    if (state.leaders[t] >= 0) {
      const leaderW = state.walkers.find(w => w.id === state.leaders[t]);
      if (!leaderW || leaderW.dead) {
        // Check if leader entered a settlement (hasLeader flag)
        const leaderInSettlement = state.settlements.some(
          s => !s.dead && s.team === t && s.hasLeader
        );
        if (!leaderInSettlement) {
          // Leader truly dead — drop magnet
          if (leaderW) {
            state.magnetPos[t] = { x: leaderW.x, y: leaderW.y };
          }
          state.magnetLocked[t] = true;
          state.leaders[t] = -1;
        }
      }
    }
  }

  // Handle dead settlements that had leaders — drop magnet at settlement location
  for (const s of state.settlements) {
    if (s.dead && s.hasLeader) {
      const t = s.team;
      state.magnetPos[t] = { x: s.tx + 0.5, y: s.ty + 0.5 };
      state.magnetLocked[t] = true;
      state.leaders[t] = -1;
      s.hasLeader = false;
    }
  }

  state.walkers = state.walkers.filter(w => !w.dead);

  const alive = state.settlements.filter(s => !s.dead);
  state.settlementMap.fill(-1);
  state.settlements = alive;
  for (let i = 0; i < state.settlements.length; i++) {
    const s = state.settlements[i];
    // Rebuild full footprint (1x1 for most, 5x5 for castles)
    for (let fx = 0; fx < s.sqSize; fx++) {
      for (let fy = 0; fy < s.sqSize; fy++) {
        const mx = s.sqOx + fx, my = s.sqOy + fy;
        if (mx >= 0 && mx < C.MAP_W && my >= 0 && my < C.MAP_H) {
          state.settlementMap[my * C.MAP_W + mx] = i;
        }
      }
    }
  }
}

// ── Mana ────────────────────────────────────────────────────────────
function updateMana(state, dt) {
  for (let team = 0; team < 2; team++) {
    let totalPop = 0;
    for (const s of state.settlements) {
      if (s.dead || s.team !== team) continue;
      totalPop += s.population;
    }
    state.mana[team] = Math.min(C.MANA_MAX,
      state.mana[team] + totalPop * C.MANA_PER_POP_PER_SEC * dt);
  }
}

// ── Team Stats ──────────────────────────────────────────────────────
function getTeamStats(state, team) {
  let pop = 0, set = 0, walk = 0;
  for (const s of state.settlements) {
    if (s.dead || s.team !== team) continue;
    pop += s.population;
    set++;
  }
  for (const w of state.walkers) {
    if (w.dead || w.team !== team) continue;
    walk++;
    pop += w.strength;
  }
  return { pop, set, walk };
}

// ── State Serialization ─────────────────────────────────────────────
function serializeState(state, team) {
  // Heights: flat array iterating x then y
  const flatHeights = [];
  for (let y = 0; y <= C.MAP_H; y++) {
    for (let x = 0; x <= C.MAP_W; x++) {
      flatHeights.push(state.heights[x][y]);
    }
  }

  // Walkers: living only, minimal fields
  const walkerData = [];
  for (const w of state.walkers) {
    if (w.dead) continue;
    const wd = {
      id: w.id,
      t: w.team,
      s: w.strength,
      x: Math.round(w.x * 100) / 100,
      y: Math.round(w.y * 100) / 100,
      tx: Math.round(w.tx * 100) / 100,
      ty: Math.round(w.ty * 100) / 100,
    };
    if (w.isLeader) wd.l = 1;
    if (w.isKnight) wd.k = 1;
    walkerData.push(wd);
  }

  // Settlements: living only, minimal fields
  const settlementData = [];
  for (const s of state.settlements) {
    if (s.dead) continue;
    const sd = {
      t: s.team,
      l: s.level,
      p: s.population,
      tx: s.tx, ty: s.ty,
      ox: s.sqOx, oy: s.sqOy, sz: s.sqSize,
    };
    if (s.hasLeader) sd.hl = 1;
    settlementData.push(sd);
  }

  // Swamps: array of {x, y}
  const swampData = state.swamps.map(s => ({ x: s.x, y: s.y, t: s.team }));

  // Rocks: flat array [x1,y1,x2,y2,...]
  const rockData = [];
  for (const key of state.rocks) {
    const parts = key.split(',');
    rockData.push(+parts[0], +parts[1]);
  }

  // Trees: flat array [x1,y1,x2,y2,...]
  const treeData = [];
  for (const key of state.trees) {
    const parts = key.split(',');
    treeData.push(+parts[0], +parts[1]);
  }

  // Pebbles: flat array [x1,y1,x2,y2,...]
  const pebbleData = [];
  for (const key of state.pebbles) {
    const parts = key.split(',');
    pebbleData.push(+parts[0], +parts[1]);
  }

  // Ruins: flat array [x1,y1,t1,x2,y2,t2,...] (x, y, team triplets)
  const ruinData = [];
  for (const r of state.ruins) {
    ruinData.push(r.x, r.y, r.team);
  }

  // Crops: flat array [x1,y1,t1,x2,y2,t2,...] (x, y, team triplets)
  const cropData = [];
  if (state.crops) {
    for (const c of state.crops) {
      cropData.push(c.x, c.y, c.t);
    }
  }

  return {
    type: 'state',
    heights: flatHeights,
    walkers: walkerData,
    settlements: settlementData,
    magnetPos: state.magnetPos,
    teamMode: state.teamMode,
    mana: Math.floor(state.mana[team]),
    team,
    swamps: swampData,
    rocks: rockData,
    trees: treeData,
    pebbles: pebbleData,
    ruins: ruinData,
    crops: cropData,
    fires: state.fires.map(f => ({ x: f.x, y: f.y, a: Math.round(f.age * 10) / 10 })),
    seaLevel: state.seaLevel,
    leaders: state.leaders,
    armageddon: state.armageddon,
    magnetLocked: [state.magnetLocked[0], state.magnetLocked[1]],
    teamPop: [getTeamStats(state, C.TEAM_BLUE).pop, getTeamStats(state, C.TEAM_RED).pop],
  };
}

// ── Divine Powers ───────────────────────────────────────────────────
function executePowerEarthquake(state, team, px, py) {
  const r = C.EARTHQUAKE_RADIUS;
  const r2 = r * r;
  for (let x = Math.max(0, px - r); x <= Math.min(C.MAP_W, px + r); x++) {
    for (let y = Math.max(0, py - r); y <= Math.min(C.MAP_H, py + r); y++) {
      const dx = x - px, dy = y - py;
      if (dx * dx + dy * dy < r2) {
        const action = Math.random() < 0.5 ? 'raise' : 'lower';
        const times = Math.floor(Math.random() * 3); // 0-2
        for (let i = 0; i < times; i++) {
          if (action === 'raise') raisePoint(state, x, y);
          else lowerPoint(state, x, y);
        }
      }
    }
  }
  invalidateSwamps(state);
  invalidateRocks(state);
  invalidateTrees(state);
  invalidateRuins(state);
  evaluateSettlementLevels(state);
}

function executePowerSwamp(state, team, tx, ty) {
  const placed = [];
  const attempts = 20;
  const targetCount = 3 + Math.floor(Math.random() * 3); // 3-5
  for (let i = 0; i < attempts && placed.length < targetCount; i++) {
    const dx = i === 0 ? 0 : Math.floor(Math.random() * 7) - 3;
    const dy = i === 0 ? 0 : Math.floor(Math.random() * 7) - 3;
    const sx = tx + dx, sy = ty + dy;
    if (sx < 0 || sx >= C.MAP_W || sy < 0 || sy >= C.MAP_H) continue;
    const key = sx + ',' + sy;
    if (state.swampSet.has(key)) continue;
    if (!isTileFlat(state, sx, sy)) continue;
    state.swamps.push({ x: sx, y: sy, team });
    state.swampSet.add(key);
    placed.push(key);
  }
  return placed.length > 0;
}

function executePowerKnight(state, team) {
  const leaderId = state.leaders[team];
  if (leaderId < 0) return false;

  // Check if leader is inside a settlement (hasLeader flag)
  let hostSettlement = null;
  for (const s of state.settlements) {
    if (s.dead || s.team !== team) continue;
    if (s.hasLeader) {
      hostSettlement = s;
      break;
    }
  }

  if (hostSettlement) {
    // Leader is inside the settlement — extract as knight
    const sx = hostSettlement.tx + 0.5;
    const sy = hostSettlement.ty + 0.5;
    const knightStrength = Math.min(255, hostSettlement.population * C.KNIGHT_STRENGTH_MULT);
    const sTech = C.SETTLEMENT_LEVELS[hostSettlement.level] ? C.SETTLEMENT_LEVELS[hostSettlement.level].tech : 0;

    // Spawn knight walker from settlement
    const knight = spawnWalker(state, team, knightStrength, sx, sy, sTech);
    knight.isKnight = true;

    // Destroy host settlement
    hostSettlement.dead = true;
    hostSettlement.hasLeader = false;
    clearSettlementFootprint(state, hostSettlement);

    // Magnet drops at destroyed settlement
    state.magnetPos[team] = { x: hostSettlement.tx, y: hostSettlement.ty };
    state.magnetLocked[team] = true;
    state.leaders[team] = -1;

    // Set building on fire
    state.fires.push({ x: hostSettlement.tx, y: hostSettlement.ty, age: 0 });

    pickFightTarget(state, knight);
    return true;
  }

  // Leader is a walker — check if standing near a friendly settlement
  let leader = null;
  for (const w of state.walkers) {
    if (w.id === leaderId && !w.dead) { leader = w; break; }
  }
  if (!leader || leader.isKnight) return false;

  const lx = Math.floor(leader.x), ly = Math.floor(leader.y);
  for (const s of state.settlements) {
    if (s.dead || s.team !== team) continue;
    if (isNearSettlement(s, lx, ly)) {
      hostSettlement = s;
      break;
    }
  }
  if (!hostSettlement) return false;

  // Promote to knight
  leader.isKnight = true;
  leader.strength = Math.min(255, leader.strength * C.KNIGHT_STRENGTH_MULT);
  leader.isLeader = false;
  state.leaders[team] = -1;

  // Destroy host settlement
  hostSettlement.dead = true;
  hostSettlement.hasLeader = false;
  clearSettlementFootprint(state, hostSettlement);

  // Magnet drops at destroyed settlement
  state.magnetPos[team] = { x: hostSettlement.tx, y: hostSettlement.ty };
  state.magnetLocked[team] = true;

  // Set building on fire
  state.fires.push({ x: hostSettlement.tx, y: hostSettlement.ty, age: 0 });

  pickFightTarget(state, leader);
  return true;
}

function executePowerVolcano(state, team, px, py) {
  const r = C.VOLCANO_RADIUS;
  const r2 = r * r;
  // Raise terrain
  for (let x = Math.max(0, px - r); x <= Math.min(C.MAP_W, px + r); x++) {
    for (let y = Math.max(0, py - r); y <= Math.min(C.MAP_H, py + r); y++) {
      const dx = x - px, dy = y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        const dist = Math.sqrt(d2);
        const target = C.MAX_HEIGHT - Math.floor(dist);
        while (state.heights[x][y] < target && state.heights[x][y] < C.MAX_HEIGHT) {
          raisePoint(state, x, y);
        }
      }
    }
  }
  // Add rock tiles in inner radius
  const innerR = Math.floor(r / 2);
  const innerR2 = innerR * innerR;
  for (let tx = Math.max(0, px - innerR); tx < Math.min(C.MAP_W, px + innerR); tx++) {
    for (let ty = Math.max(0, py - innerR); ty < Math.min(C.MAP_H, py + innerR); ty++) {
      const dx = tx + 0.5 - px, dy = ty + 0.5 - py;
      if (dx * dx + dy * dy < innerR2) {
        state.rocks.add(tx + ',' + ty);
      }
    }
  }
  // Kill walkers and destroy settlements within radius
  for (const w of state.walkers) {
    if (w.dead) continue;
    const dx = w.x - px, dy = w.y - py;
    if (dx * dx + dy * dy < r2) w.dead = true;
  }
  for (const s of state.settlements) {
    if (s.dead) continue;
    const dx = (s.tx + 0.5) - px, dy = (s.ty + 0.5) - py;
    if (dx * dx + dy * dy < r2) {
      if (s.hasLeader) {
        state.magnetPos[s.team] = { x: s.tx + 0.5, y: s.ty + 0.5 };
        state.magnetLocked[s.team] = true;
        state.leaders[s.team] = -1;
        s.hasLeader = false;
      }
      s.dead = true;
      clearSettlementFootprint(state, s);
    }
  }
  invalidateSwamps(state);
  invalidateRocks(state);
  invalidateTrees(state);
  invalidatePebbles(state);
  invalidateRuins(state);
  evaluateSettlementLevels(state);
}

function executePowerFlood(state, team) {
  // Lower all terrain by 1 instead of raising sea level — preserves natural slopes
  for (let x = 0; x <= C.MAP_W; x++) {
    for (let y = 0; y <= C.MAP_H; y++) {
      state.heights[x][y] = Math.max(0, state.heights[x][y] - 1);
    }
  }
  // Kill walkers on newly submerged tiles
  for (const w of state.walkers) {
    if (w.dead) continue;
    const tx = Math.floor(w.x), ty = Math.floor(w.y);
    if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) continue;
    if (isTileWater(state, tx, ty)) w.dead = true;
  }
  // Destroy settlements on newly submerged tiles
  for (const s of state.settlements) {
    if (s.dead) continue;
    if (isTileWater(state, s.tx, s.ty)) {
      if (s.hasLeader) {
        state.magnetPos[s.team] = { x: s.tx + 0.5, y: s.ty + 0.5 };
        state.magnetLocked[s.team] = true;
        state.leaders[s.team] = -1;
        s.hasLeader = false;
      }
      s.dead = true;
      clearSettlementFootprint(state, s);
    }
  }
  invalidateSwamps(state);
  invalidateRocks(state);
  invalidateTrees(state);
  invalidatePebbles(state);
  invalidateRuins(state);
  evaluateSettlementLevels(state);
}

function executePowerArmageddon(state, team) {
  state.armageddon = true;
  // Destroy all settlements, eject population as walkers
  for (const s of state.settlements) {
    if (s.dead) continue;
    if (s.population > 0) {
      const angle = Math.random() * Math.PI * 2;
      const sTech = C.SETTLEMENT_LEVELS[s.level] ? C.SETTLEMENT_LEVELS[s.level].tech : 0;
      const w = spawnWalker(state, s.team, s.population,
        s.tx + 0.5 + Math.cos(angle) * 1.2,
        s.ty + 0.5 + Math.sin(angle) * 1.2, sTech);
      // If settlement had a leader, ejected walker becomes leader
      if (s.hasLeader) {
        w.isLeader = true;
        state.leaders[s.team] = w.id;
        s.hasLeader = false;
      }
    } else if (s.hasLeader) {
      // Empty settlement with leader — leader dies
      state.magnetPos[s.team] = { x: s.tx + 0.5, y: s.ty + 0.5 };
      state.magnetLocked[s.team] = true;
      state.leaders[s.team] = -1;
      s.hasLeader = false;
    }
    s.dead = true;
    clearSettlementFootprint(state, s);
  }
}

// ── Basic AI ────────────────────────────────────────────────────────
function updateAI(state, room, dt) {
  room.aiTimer += dt;
  if (room.aiTimer < 3.0) return;
  room.aiTimer = 0;

  const team = C.TEAM_RED;
  const redStats = getTeamStats(state, team);
  const blueStats = getTeamStats(state, C.TEAM_BLUE);

  // Simple mode selection
  if (redStats.set < 2 || redStats.walk > redStats.set * 3) {
    state.teamMode[team] = C.MODE_SETTLE;
  } else if (redStats.pop > blueStats.pop * 1.5 && redStats.walk >= 3) {
    state.teamMode[team] = C.MODE_FIGHT;
  } else {
    state.teamMode[team] = C.MODE_SETTLE;
  }

  // Flatten terrain near a settlement
  let target = null;
  for (const s of state.settlements) {
    if (s.dead || s.team !== team) continue;
    target = s;
    break;
  }
  if (!target) return;

  const th = state.heights[target.tx][target.ty];
  const cx = target.tx, cy = target.ty;

  for (let ddx = -3; ddx <= 3; ddx++) {
    for (let ddy = -3; ddy <= 3; ddy++) {
      const tx = cx + ddx, ty = cy + ddy;
      if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) continue;
      if (isTileFlat(state, tx, ty) && state.heights[tx][ty] === th) continue;
      for (const [px, py] of [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]]) {
        if (px < 0 || px > C.MAP_W || py < 0 || py > C.MAP_H) continue;
        if (state.heights[px][py] < th && state.mana[team] >= C.TERRAIN_RAISE_COST) {
          state.mana[team] -= C.TERRAIN_RAISE_COST;
          raisePoint(state, px, py);
          return;
        } else if (state.heights[px][py] > th && state.mana[team] >= C.TERRAIN_LOWER_COST) {
          state.mana[team] -= C.TERRAIN_LOWER_COST;
          lowerPoint(state, px, py);
          return;
        }
      }
    }
  }
}

// ── Tick Loop ───────────────────────────────────────────────────────
function startGame(room) {
  const state = createGameState();
  generateTerrain(state);
  spawnInitialWalkers(state);
  room.state = state;
  room.started = true;

  const dt = 1 / C.TICK_RATE;

  room.tickInterval = setInterval(() => {
    if (state.gameOver) return;

    // Run simulation
    updateWalkers(state, dt);
    handleWalkerCollisions(state);
    updateMana(state, dt);

    // AI update (if vs AI room)
    if (room.ai) updateAI(state, room, dt);

    // Compute crops every tick for rendering + growth
    computeCrops(state);

    if (!state.armageddon) {
      state.levelEvalTimer += dt;
      if (state.levelEvalTimer >= 1.0) {
        state.levelEvalTimer = 0;
        evaluateSettlementLevels(state);
      }

      updatePopulationGrowth(state, dt);
    }

    // Age and prune fires
    for (const f of state.fires) f.age += dt;
    state.fires = state.fires.filter(f => f.age < 5.0);

    state.pruneTimer += dt;
    if (state.pruneTimer >= 3.0) {
      state.pruneTimer = 0;
      pruneDeadEntities(state);
    }

    // Check win condition (after initial grace period of 30 seconds)
    const elapsed = state.levelEvalTimer + state.pruneTimer;
    if (!state.gameOver) {
      const blueStats = getTeamStats(state, C.TEAM_BLUE);
      const redStats = getTeamStats(state, C.TEAM_RED);

      // Only check after both teams have had time to establish
      const tickCount = (state._tickCount || 0) + 1;
      state._tickCount = tickCount;

      if (tickCount > C.TICK_RATE * 30) { // 30 second grace period
        if (blueStats.pop <= 0 && redStats.pop > 0) {
          state.gameOver = true;
          state.winner = C.TEAM_RED;
        } else if (redStats.pop <= 0 && blueStats.pop > 0) {
          state.gameOver = true;
          state.winner = C.TEAM_BLUE;
        }
      }
    }

    // Send state to each player
    for (let i = 0; i < 2; i++) {
      const ws = room.players[i];
      if (ws && ws.readyState === 1) {
        const msg = serializeState(state, i);
        ws.send(JSON.stringify(msg));
      }
    }

    // Send game over
    if (state.gameOver) {
      const goMsg = JSON.stringify({ type: 'gameover', winner: state.winner });
      for (let i = 0; i < 2; i++) {
        const ws = room.players[i];
        if (ws && ws.readyState === 1) ws.send(goMsg);
      }
      clearInterval(room.tickInterval);
      room.tickInterval = null;
    }
  }, C.TICK_INTERVAL);
}

// ── WebSocket Handler ───────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let playerRoom = null;
  let playerTeam = -1;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'create': {
        const room = createRoom();
        room.players[0] = ws;
        playerRoom = room;
        playerTeam = 0;
        ws.send(JSON.stringify({ type: 'created', code: room.code, team: 0 }));
        console.log(`Room ${room.code} created`);
        break;
      }

      case 'create_ai': {
        const room = createRoom();
        room.players[0] = ws;
        room.ai = true;
        playerRoom = room;
        playerTeam = 0;
        ws.send(JSON.stringify({ type: 'start' }));
        startGame(room);
        console.log(`Room ${room.code} created (vs AI)`);
        break;
      }

      case 'join': {
        const code = (msg.code || '').toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        if (room.players[1]) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
          return;
        }
        if (room.started) {
          ws.send(JSON.stringify({ type: 'error', message: 'Game already started' }));
          return;
        }
        room.players[1] = ws;
        playerRoom = room;
        playerTeam = 1;
        ws.send(JSON.stringify({ type: 'joined', code: room.code, team: 1 }));
        console.log(`Player joined room ${room.code}`);

        // Notify both players and start
        for (let i = 0; i < 2; i++) {
          if (room.players[i] && room.players[i].readyState === 1) {
            room.players[i].send(JSON.stringify({ type: 'start' }));
          }
        }
        startGame(room);
        break;
      }

      case 'raise': {
        if (!playerRoom || !playerRoom.started || playerRoom.state.gameOver) return;
        if (playerRoom.state.armageddon) return;
        const state = playerRoom.state;
        const { px, py } = msg;
        if (typeof px !== 'number' || typeof py !== 'number') return;
        if (px < 0 || px > C.MAP_W || py < 0 || py > C.MAP_H) return;
        if (!canBuildAtPoint(state, playerTeam, px, py)) return;
        if (state.mana[playerTeam] < C.TERRAIN_RAISE_COST) return;
        state.mana[playerTeam] -= C.TERRAIN_RAISE_COST;
        raisePoint(state, px, py);
        invalidateSwamps(state);
        invalidateRocks(state);
        invalidateTrees(state);
        invalidatePebbles(state);
        invalidateRuins(state);
        evaluateSettlementLevels(state);
        break;
      }

      case 'lower': {
        if (!playerRoom || !playerRoom.started || playerRoom.state.gameOver) return;
        if (playerRoom.state.armageddon) return;
        const state = playerRoom.state;
        const { px, py } = msg;
        if (typeof px !== 'number' || typeof py !== 'number') return;
        if (px < 0 || px > C.MAP_W || py < 0 || py > C.MAP_H) return;
        if (!canBuildAtPoint(state, playerTeam, px, py)) return;
        if (state.mana[playerTeam] < C.TERRAIN_LOWER_COST) return;
        state.mana[playerTeam] -= C.TERRAIN_LOWER_COST;
        lowerPoint(state, px, py);
        invalidateSwamps(state);
        invalidateRocks(state);
        invalidateTrees(state);
        invalidatePebbles(state);
        invalidateRuins(state);
        evaluateSettlementLevels(state);
        break;
      }

      case 'power': {
        if (!playerRoom || !playerRoom.started || playerRoom.state.gameOver) return;
        if (playerRoom.state.armageddon) return;
        const state = playerRoom.state;
        const powerDef = C.POWERS.find(p => p.id === msg.power);
        if (!powerDef) return;
        if (state.mana[playerTeam] < powerDef.cost) return;
        if (powerDef.targeted) {
          const { x, y } = msg;
          if (typeof x !== 'number' || typeof y !== 'number') return;
          if (x < 0 || x > C.MAP_W || y < 0 || y > C.MAP_H) return;
        }
        let success = true;
        switch (powerDef.id) {
          case 'earthquake':
            executePowerEarthquake(state, playerTeam, msg.x, msg.y);
            break;
          case 'swamp':
            success = executePowerSwamp(state, playerTeam, Math.floor(msg.x), Math.floor(msg.y));
            break;
          case 'knight':
            success = executePowerKnight(state, playerTeam);
            break;
          case 'volcano':
            executePowerVolcano(state, playerTeam, msg.x, msg.y);
            break;
          case 'flood':
            executePowerFlood(state, playerTeam);
            break;
          case 'armageddon':
            executePowerArmageddon(state, playerTeam);
            break;
        }
        if (success !== false) {
          if (powerDef.id === 'armageddon') {
            state.mana[playerTeam] = 0; // costs all mana
          } else {
            state.mana[playerTeam] -= powerDef.cost;
          }
        }
        break;
      }

      case 'mode': {
        if (!playerRoom || !playerRoom.started || playerRoom.state.gameOver) return;
        if (playerRoom.state.armageddon) return;
        const mode = msg.mode;
        if (typeof mode !== 'number' || mode < 0 || mode > 3) return;
        playerRoom.state.teamMode[playerTeam] = mode;
        break;
      }

      case 'godmode': {
        if (!playerRoom || !playerRoom.started) return;
        const state = playerRoom.state;
        state.mana[playerTeam] = 999999;
        break;
      }

      case 'magnet': {
        if (!playerRoom || !playerRoom.started || playerRoom.state.gameOver) return;
        if (playerRoom.state.armageddon) return;
        if (playerRoom.state.magnetLocked[playerTeam]) return;
        const { x, y } = msg;
        if (typeof x !== 'number' || typeof y !== 'number') return;
        playerRoom.state.magnetPos[playerTeam] = { x, y };
        // Magnet placement removes swamps at that position
        const mx = Math.floor(x), my = Math.floor(y);
        const mkey = mx + ',' + my;
        if (playerRoom.state.swampSet.has(mkey)) {
          playerRoom.state.swamps = playerRoom.state.swamps.filter(sw => !(sw.x === mx && sw.y === my));
          playerRoom.state.swampSet.delete(mkey);
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!playerRoom) return;
    const room = playerRoom;

    // If game is in progress and not AI room, other player wins
    if (room.started && !room.state.gameOver && !room.ai) {
      room.state.gameOver = true;
      room.state.winner = playerTeam === 0 ? 1 : 0;
      const goMsg = JSON.stringify({ type: 'gameover', winner: room.state.winner });
      for (let i = 0; i < 2; i++) {
        const ws2 = room.players[i];
        if (ws2 && ws2 !== ws && ws2.readyState === 1) ws2.send(goMsg);
      }
    }

    cleanupRoom(room.code);
    console.log(`Room ${room.code} cleaned up`);
  });
});
