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
    mana: [0, 0],
    swamps: [],
    rocks: new Set(),
    seaLevel: C.SEA_LEVEL,
    leaders: [-1, -1],
    armageddon: false,
    levelEvalTimer: 0,
    popGrowthTimer: 0,
    pruneTimer: 0,
    nextWalkerId: 1,
    gameOver: false,
    winner: -1,
  };
}

// ── Terrain Generation ──────────────────────────────────────────────
const TERRAIN_FLATNESS = 0.3; // 0 = very mountainous, 1 = very flat

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
  if (state.rocks.has(tx + ',' + ty)) return false;
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

function isTileInSettlementFootprint(state, tx, ty, exclude) {
  for (const s of state.settlements) {
    if (s.dead || s === exclude) continue;
    if (tx >= s.sqOx && tx < s.sqOx + s.sqSize &&
        ty >= s.sqOy && ty < s.sqOy + s.sqSize) return true;
  }
  return false;
}

function squareOverlapsSettlement(state, ox, oy, size, exclude) {
  for (let dx = 0; dx < size; dx++) {
    for (let dy = 0; dy < size; dy++) {
      if (isTileInSettlementFootprint(state, ox + dx, oy + dy, exclude)) return true;
    }
  }
  return false;
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
function spawnWalker(state, team, strength, x, y) {
  const w = {
    id: state.nextWalkerId++,
    team, strength: Math.min(255, strength),
    x, y,
    tx: x, ty: y,
    dead: false,
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
    for (let r = 0; r < 20 && spawned < 5; r++) {
      for (let dx = -r; dx <= r && spawned < 5; dx++) {
        for (let dy = -r; dy <= r && spawned < 5; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const tx = zone.cx + dx, ty = zone.cy + dy;
          if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) continue;
          if (!isTileWater(state, tx, ty) && state.heights[tx][ty] > state.seaLevel) {
            spawnWalker(state, team, 5, tx + 0.5, ty + 0.5);
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

function pickSettleTarget(state, w) {
  const cx = Math.floor(w.x), cy = Math.floor(w.y);

  if (isTileFlat(state, cx, cy) && !isTileInSettlementFootprint(state, cx, cy)) {
    settleWalker(state, w, cx, cy);
    return;
  }

  let bestDist = Infinity, bestTx = -1, bestTy = -1;
  const searchR = 8;
  for (let dx = -searchR; dx <= searchR; dx++) {
    for (let dy = -searchR; dy <= searchR; dy++) {
      const tx = cx + dx, ty = cy + dy;
      if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) continue;
      if (isTileFlat(state, tx, ty) && !isTileInSettlementFootprint(state, tx, ty)) {
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

    // Swamp death check
    for (const sw of state.swamps) {
      if (Math.floor(w.x) === sw.x && Math.floor(w.y) === sw.y && sw.team !== w.team) {
        w.dead = true;
        break;
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
}

// ── Settlement System ───────────────────────────────────────────────
function settleWalker(state, w, tx, ty) {
  if (isTileInSettlementFootprint(state, tx, ty)) return;
  w.dead = true;
  const s = {
    team: w.team,
    level: 1,
    population: w.strength,
    tx, ty,
    sqOx: tx, sqOy: ty, sqSize: 1,
    dead: false,
    atCapTicks: 0,
  };
  state.settlements.push(s);
  setSettlement(state, tx, ty, s);
}

// Find a flat square of exactly the given size containing (tx,ty)
function findFlatSquareOfSize(state, tx, ty, size, exclude) {
  const h = state.heights[tx][ty];
  if (h <= state.seaLevel || !isTileFlat(state, tx, ty)) return null;
  if (size === 1) {
    if (!squareOverlapsSettlement(state, tx, ty, 1, exclude)) return { ox: tx, oy: ty };
    return null;
  }
  const oxMin = Math.max(0, tx - size + 1);
  const oxMax = Math.min(C.MAP_W - size, tx);
  const oyMin = Math.max(0, ty - size + 1);
  const oyMax = Math.min(C.MAP_H - size, ty);
  for (let ox = oxMin; ox <= oxMax; ox++) {
    for (let oy = oyMin; oy <= oyMax; oy++) {
      let allFlat = true;
      for (let dx = 0; dx < size && allFlat; dx++) {
        for (let dy = 0; dy < size && allFlat; dy++) {
          if (!isTileFlat(state, ox + dx, oy + dy) || state.heights[ox + dx][oy + dy] !== h) allFlat = false;
        }
      }
      if (allFlat && !squareOverlapsSettlement(state, ox, oy, size, exclude)) {
        return { ox, oy };
      }
    }
  }
  return null;
}

function findLargestFlatSquare(state, tx, ty, exclude) {
  const h = state.heights[tx][ty];
  if (h <= state.seaLevel || !isTileFlat(state, tx, ty)) return { ox: tx, oy: ty, size: 0 };

  for (let n = 5; n >= 2; n--) {
    const oxMin = Math.max(0, tx - n + 1);
    const oxMax = Math.min(C.MAP_W - n, tx);
    const oyMin = Math.max(0, ty - n + 1);
    const oyMax = Math.min(C.MAP_H - n, ty);

    for (let ox = oxMin; ox <= oxMax; ox++) {
      for (let oy = oyMin; oy <= oyMax; oy++) {
        let allFlat = true;
        for (let dx = 0; dx < n && allFlat; dx++) {
          for (let dy = 0; dy < n && allFlat; dy++) {
            const cx = ox + dx, cy = oy + dy;
            if (!isTileFlat(state, cx, cy) || state.heights[cx][cy] !== h) allFlat = false;
          }
        }
        if (allFlat && !squareOverlapsSettlement(state, ox, oy, n, exclude)) {
          return { ox, oy, size: n };
        }
      }
    }
  }

  return { ox: tx, oy: ty, size: 1 };
}

function tryMergeSettlements(state) {
  for (const s of state.settlements) {
    if (s.dead) continue;
    // Only merge when settlement is at capacity and ready to grow
    const cap = C.LEVEL_CAPACITY[s.level];
    if (s.population < cap || s.level >= 5) continue;

    const nextLevel = s.level + 1;

    // Find a square of nextLevel size containing s's home tile
    const sq = findFlatSquareOfSize(state, s.tx, s.ty, nextLevel, s);
    if (!sq) continue;

    // Check which same-team settlements would be covered by the new footprint
    const absorbed = [];
    let conflict = false;
    for (const other of state.settlements) {
      if (other.dead || other === s) continue;
      const homeCovered = other.tx >= sq.ox && other.tx < sq.ox + nextLevel &&
                          other.ty >= sq.oy && other.ty < sq.oy + nextLevel;
      if (homeCovered && other.team === s.team) {
        absorbed.push(other);
      } else if (homeCovered) {
        conflict = true; // enemy settlement in the way
        break;
      }
    }
    if (conflict || absorbed.length === 0) continue;

    // Absorb covered settlements and upgrade
    let totalPop = s.population;
    for (const a of absorbed) {
      totalPop += a.population;
      a.dead = true;
      clearSettlementMap(state, a.tx, a.ty);
    }

    s.population = totalPop;
    s.level = nextLevel;
    s.sqOx = sq.ox;
    s.sqOy = sq.oy;
    s.sqSize = nextLevel;
    setSettlement(state, s.tx, s.ty, s);
  }
}

function isSquareStillValid(state, s) {
  const h = state.heights[s.tx][s.ty];
  if (h <= state.seaLevel || !isTileFlat(state, s.tx, s.ty)) return false;
  for (let dx = 0; dx < s.sqSize; dx++) {
    for (let dy = 0; dy < s.sqSize; dy++) {
      const cx = s.sqOx + dx, cy = s.sqOy + dy;
      if (!isTileFlat(state, cx, cy) || state.heights[cx][cy] !== h) return false;
    }
  }
  if (squareOverlapsSettlement(state, s.sqOx, s.sqOy, s.sqSize, s)) return false;
  return true;
}

function evaluateSettlementLevels(state) {
  for (const s of state.settlements) {
    if (s.dead) continue;

    if (!isSquareStillValid(state, s)) {
      // Current square is no longer valid — downgrade until we find a valid level
      let newLevel = s.level;
      let sq = null;
      while (newLevel > 0) {
        sq = findFlatSquareOfSize(state, s.tx, s.ty, newLevel, s);
        if (sq) break;
        newLevel--;
      }

      if (newLevel === 0 || !sq) {
        // Can't even hold a level 1 — destroy
        s.dead = true;
        clearSettlementMap(state, s.tx, s.ty);
        if (s.population > 0) {
          const angle = Math.random() * Math.PI * 2;
          spawnWalker(state, s.team, s.population,
            s.tx + 0.5 + Math.cos(angle) * 1.2,
            s.ty + 0.5 + Math.sin(angle) * 1.2);
        }
        continue;
      }

      s.level = newLevel;
      s.sqOx = sq.ox;
      s.sqOy = sq.oy;
      s.sqSize = newLevel;
    }

    const cap = C.LEVEL_CAPACITY[s.level];
    if (s.population > cap) {
      const excess = s.population - Math.floor(cap / 2);
      s.population = Math.floor(cap / 2);
      const angle = Math.random() * Math.PI * 2;
      spawnWalker(state, s.team, excess,
        s.tx + 0.5 + Math.cos(angle) * 1.2,
        s.ty + 0.5 + Math.sin(angle) * 1.2);
    }
  }
}

// ── Population Growth ───────────────────────────────────────────────
// Eject delay: bigger settlements take more growth ticks at cap before spawning
const EJECT_DELAY = [0, 1, 2, 3, 4, 5]; // indexed by level

function updatePopulationGrowth(state) {
  for (const s of state.settlements) {
    if (s.dead) continue;
    const cap = C.LEVEL_CAPACITY[s.level];
    if (s.population < cap) {
      s.population += 1; // slow, flat growth
      if (!s.atCapTicks) s.atCapTicks = 0;
      s.atCapTicks = 0; // reset eject counter while growing
    } else if (cap > 0) {
      // At capacity — try to upgrade level if terrain supports it
      if (!s.atCapTicks) s.atCapTicks = 0;
      s.atCapTicks++;
      const delay = EJECT_DELAY[s.level] || 1;
      if (s.atCapTicks >= delay) {
        s.atCapTicks = 0;

        // Check if flat terrain supports next level
        const nextLevel = s.level + 1;
        if (nextLevel <= 5) {
          const sq = findFlatSquareOfSize(state, s.tx, s.ty, nextLevel, s);
          if (sq) {
            // Upgrade one level, keep half population as base
            s.level = nextLevel;
            s.population = Math.floor(cap / 2);
            s.sqOx = sq.ox;
            s.sqOy = sq.oy;
            s.sqSize = nextLevel;
            continue;
          }
        }

        // Can't upgrade — eject walkers
        const ejectStrength = Math.max(1, Math.floor(s.population / 3));
        s.population -= ejectStrength;
        const angle = Math.random() * Math.PI * 2;
        const sx = s.tx + 0.5 + Math.cos(angle) * 1.2;
        const sy = s.ty + 0.5 + Math.sin(angle) * 1.2;
        spawnWalker(state, s.team, ejectStrength, sx, sy);
      }
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
            w.strength = Math.min(255, w.strength + other.strength);
            other.dead = true;
          } else {
            if (w.strength > other.strength) {
              w.strength -= other.strength;
              other.dead = true;
            } else if (other.strength > w.strength) {
              other.strength -= w.strength;
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
    if (es && es.team !== w.team) {
      if (w.strength >= es.population) {
        w.strength -= es.population;
        es.dead = true;
        clearSettlementMap(state, es.tx, es.ty);
        // Knight: lower terrain around destroyed settlement
        if (w.isKnight) {
          for (let ddx = -2; ddx <= 2; ddx++) {
            for (let ddy = -2; ddy <= 2; ddy++) {
              const lpx = es.tx + ddx, lpy = es.ty + ddy;
              if (lpx >= 0 && lpx <= C.MAP_W && lpy >= 0 && lpy <= C.MAP_H) {
                lowerPoint(state, lpx, lpy);
              }
            }
          }
        }
        if (w.strength <= 0) w.dead = true;
      } else {
        es.population -= w.strength;
        w.dead = true;
      }
    }
  }
}

// ── Entity Pruning ──────────────────────────────────────────────────
function pruneDeadEntities(state) {
  // Clear leaders if their walker is dead
  for (let t = 0; t < 2; t++) {
    if (state.leaders[t] >= 0 && !isWalkerAlive(state, state.leaders[t])) {
      state.leaders[t] = -1;
    }
  }
  state.walkers = state.walkers.filter(w => !w.dead);

  const alive = state.settlements.filter(s => !s.dead);
  state.settlementMap.fill(-1);
  state.settlements = alive;
  for (let i = 0; i < state.settlements.length; i++) {
    const s = state.settlements[i];
    state.settlementMap[s.ty * C.MAP_W + s.tx] = i;
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
    state.mana[team] += totalPop * dt * 0.1;
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
    };
    if (w.isLeader) wd.l = 1;
    if (w.isKnight) wd.k = 1;
    walkerData.push(wd);
  }

  // Settlements: living only, minimal fields
  const settlementData = [];
  for (const s of state.settlements) {
    if (s.dead) continue;
    settlementData.push({
      t: s.team,
      l: s.level,
      p: s.population,
      tx: s.tx, ty: s.ty,
      ox: s.sqOx, oy: s.sqOy, sz: s.sqSize,
    });
  }

  // Swamps: array of {x, y}
  const swampData = state.swamps.map(s => ({ x: s.x, y: s.y, t: s.team }));

  // Rocks: flat array [x1,y1,x2,y2,...]
  const rockData = [];
  for (const key of state.rocks) {
    const parts = key.split(',');
    rockData.push(+parts[0], +parts[1]);
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
    seaLevel: state.seaLevel,
    leaders: state.leaders,
    armageddon: state.armageddon,
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
        const times = Math.floor(Math.random() * 3); // 0-2
        for (let i = 0; i < times; i++) lowerPoint(state, x, y);
      }
    }
  }
  invalidateSwamps(state);
}

function executePowerSwamp(state, team, tx, ty) {
  if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) return false;
  if (!isTileFlat(state, tx, ty)) return false;
  if (isTileWater(state, tx, ty)) return false;
  for (const s of state.swamps) {
    if (s.x === tx && s.y === ty) return false;
  }
  state.swamps.push({ x: tx, y: ty, team });
  return true;
}

function executePowerKnight(state, team) {
  const leaderId = state.leaders[team];
  if (leaderId < 0) return false;
  let leader = null;
  for (const w of state.walkers) {
    if (w.id === leaderId && !w.dead) { leader = w; break; }
  }
  if (!leader || leader.isKnight) return false;
  leader.isKnight = true;
  leader.strength = Math.min(255, leader.strength * C.KNIGHT_STRENGTH_MULT);
  leader.isLeader = false;
  state.leaders[team] = -1;
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
      s.dead = true;
      clearSettlementMap(state, s.tx, s.ty);
    }
  }
  invalidateSwamps(state);
}

function executePowerFlood(state, team) {
  state.seaLevel += 1;
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
      s.dead = true;
      clearSettlementMap(state, s.tx, s.ty);
    }
  }
  invalidateSwamps(state);
}

function executePowerArmageddon(state, team) {
  state.armageddon = true;
  // Destroy all settlements, eject population as walkers
  for (const s of state.settlements) {
    if (s.dead) continue;
    if (s.population > 0) {
      const angle = Math.random() * Math.PI * 2;
      spawnWalker(state, s.team, s.population,
        s.tx + 0.5 + Math.cos(angle) * 1.2,
        s.ty + 0.5 + Math.sin(angle) * 1.2);
    }
    s.dead = true;
    clearSettlementMap(state, s.tx, s.ty);
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
        if (state.heights[px][py] < th && state.mana[team] >= 10) {
          state.mana[team] -= 10;
          raisePoint(state, px, py);
          return;
        } else if (state.heights[px][py] > th && state.mana[team] >= 10) {
          state.mana[team] -= 10;
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

    if (!state.armageddon) {
      state.levelEvalTimer += dt;
      if (state.levelEvalTimer >= 1.0) {
        state.levelEvalTimer = 0;
        tryMergeSettlements(state);
        evaluateSettlementLevels(state);
      }

      state.popGrowthTimer += dt;
      if (state.popGrowthTimer >= 10.0) {
        state.popGrowthTimer = 0;
        updatePopulationGrowth(state);
      }
    }

    state.pruneTimer += dt;
    if (state.pruneTimer >= 3.0) {
      state.pruneTimer = 0;
      pruneDeadEntities(state);
    }

    // Check win condition (after initial grace period of 30 seconds)
    const elapsed = state.levelEvalTimer + state.popGrowthTimer + state.pruneTimer;
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
        if (state.mana[playerTeam] < 10) return;
        state.mana[playerTeam] -= 10;
        raisePoint(state, px, py);
        invalidateSwamps(state);
        break;
      }

      case 'lower': {
        if (!playerRoom || !playerRoom.started || playerRoom.state.gameOver) return;
        if (playerRoom.state.armageddon) return;
        const state = playerRoom.state;
        const { px, py } = msg;
        if (typeof px !== 'number' || typeof py !== 'number') return;
        if (px < 0 || px > C.MAP_W || py < 0 || py > C.MAP_H) return;
        if (state.mana[playerTeam] < 10) return;
        state.mana[playerTeam] -= 10;
        lowerPoint(state, px, py);
        invalidateSwamps(state);
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
          state.mana[playerTeam] -= powerDef.cost;
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
        const { x, y } = msg;
        if (typeof x !== 'number' || typeof y !== 'number') return;
        playerRoom.state.magnetPos[playerTeam] = { x, y };
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
