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
    levelEvalTimer: 0,
    popGrowthTimer: 0,
    pruneTimer: 0,
    nextWalkerId: 1,
    gameOver: false,
    winner: -1,
  };
}

// ── Terrain Generation ──────────────────────────────────────────────
function placeBlob(state, cx, cy, radius, level) {
  const r2 = radius * radius;
  for (let x = 0; x <= C.MAP_W; x++) {
    for (let y = 0; y <= C.MAP_H; y++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < r2 && state.heights[x][y] >= level - 1) {
        state.heights[x][y] = level;
      }
    }
  }
}

function generateIsland(state, cx, cy, maxHeight, baseRadius) {
  for (let level = 1; level <= maxHeight; level++) {
    const shrink = 1 - (level - 1) / (maxHeight + 1);
    const radius = baseRadius * shrink * (0.7 + Math.random() * 0.5);
    const ox = cx + (Math.random() - 0.5) * baseRadius * 0.25;
    const oy = cy + (Math.random() - 0.5) * baseRadius * 0.25;
    placeBlob(state, ox, oy, radius, level);
  }
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

function generateTerrain(state) {
  generateIsland(state, 16, 16, 5, 18);
  generateIsland(state, 48, 20, 4, 16);
  generateIsland(state, 32, 45, 6, 22);
  generateIsland(state, 55, 52, 3, 13);
  generateIsland(state, 10, 50, 4, 15);

  for (let i = 0; i < 5; i++) {
    const x = 5 + Math.floor(Math.random() * (C.MAP_W - 10));
    const y = 5 + Math.floor(Math.random() * (C.MAP_H - 10));
    generateIsland(state, x, y, 2 + Math.floor(Math.random() * 2), 6 + Math.floor(Math.random() * 6));
  }

  enforceAdjacency(state);
}

// ── Utility Functions ───────────────────────────────────────────────
function isTileWater(state, tx, ty) {
  if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) return true;
  return state.heights[tx][ty] <= C.SEA_LEVEL &&
         state.heights[tx + 1][ty] <= C.SEA_LEVEL &&
         state.heights[tx + 1][ty + 1] <= C.SEA_LEVEL &&
         state.heights[tx][ty + 1] <= C.SEA_LEVEL;
}

function isTileFlat(state, tx, ty) {
  if (tx < 0 || tx >= C.MAP_W || ty < 0 || ty >= C.MAP_H) return false;
  const h = state.heights[tx][ty];
  if (h <= C.SEA_LEVEL) return false;
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
          if (!isTileWater(state, tx, ty) && state.heights[tx][ty] > C.SEA_LEVEL) {
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

    const dx = w.tx - w.x, dy = w.ty - w.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.1) {
      pickWalkerTarget(state, w);
    } else {
      const step = C.WALKER_SPEED * dt;
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
        w.x -= (dx / dist) * step;
        w.y -= (dy / dist) * step;
        w.x = Math.max(0.1, Math.min(C.MAP_W - 0.1, w.x));
        w.y = Math.max(0.1, Math.min(C.MAP_H - 0.1, w.y));
        pickRandomTarget(state, w);
      }
    }
  }
}

// ── Settlement System ───────────────────────────────────────────────
function settleWalker(state, w, tx, ty) {
  if (isTileInSettlementFootprint(state, tx, ty)) return;
  w.dead = true;
  const sq = findLargestFlatSquare(state, tx, ty, null);
  const s = {
    team: w.team,
    level: sq.size,
    population: w.strength,
    tx, ty,
    sqOx: sq.ox, sqOy: sq.oy, sqSize: sq.size,
    dead: false,
  };
  state.settlements.push(s);
  setSettlement(state, tx, ty, s);
}

function findLargestFlatSquare(state, tx, ty, exclude) {
  const h = state.heights[tx][ty];
  if (h <= C.SEA_LEVEL || !isTileFlat(state, tx, ty)) return { ox: tx, oy: ty, size: 0 };

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
    const h = state.heights[s.tx][s.ty];
    if (h <= C.SEA_LEVEL || !isTileFlat(state, s.tx, s.ty)) continue;

    let bestSq = null;
    for (let n = 5; n > s.sqSize; n--) {
      const oxMin = Math.max(0, s.tx - n + 1);
      const oxMax = Math.min(C.MAP_W - n, s.tx);
      const oyMin = Math.max(0, s.ty - n + 1);
      const oyMax = Math.min(C.MAP_H - n, s.ty);

      for (let ox = oxMin; ox <= oxMax && !bestSq; ox++) {
        for (let oy = oyMin; oy <= oyMax && !bestSq; oy++) {
          let allFlat = true;
          for (let dx = 0; dx < n && allFlat; dx++) {
            for (let dy = 0; dy < n && allFlat; dy++) {
              if (!isTileFlat(state, ox + dx, oy + dy) || state.heights[ox + dx][oy + dy] !== h)
                allFlat = false;
            }
          }
          if (!allFlat) continue;

          const absorbed = [];
          let conflict = false;
          for (const other of state.settlements) {
            if (other.dead || other === s) continue;
            const homeinside = other.tx >= ox && other.tx < ox + n &&
                               other.ty >= oy && other.ty < oy + n;
            const sqOverlap = ox < other.sqOx + other.sqSize && ox + n > other.sqOx &&
                              oy < other.sqOy + other.sqSize && oy + n > other.sqOy;
            if (homeinside && other.team === s.team) {
              absorbed.push(other);
            } else if (sqOverlap) {
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

    for (const other of state.settlements) {
      if (other.dead || other === s || other.team !== s.team) continue;
      if (other.tx >= bestSq.ox && other.tx < bestSq.ox + bestSq.size &&
          other.ty >= bestSq.oy && other.ty < bestSq.oy + bestSq.size) {
        s.population += other.population;
        other.dead = true;
        clearSettlementMap(state, other.tx, other.ty);
      }
    }

    s.level = bestSq.size;
    s.sqOx = bestSq.ox;
    s.sqOy = bestSq.oy;
    s.sqSize = bestSq.size;
  }
}

function isSquareStillValid(state, s) {
  const h = state.heights[s.tx][s.ty];
  if (h <= C.SEA_LEVEL || !isTileFlat(state, s.tx, s.ty)) return false;
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

    if (isSquareStillValid(state, s)) {
      const sq = findLargestFlatSquare(state, s.tx, s.ty, s);
      if (sq.size > s.sqSize) {
        s.level = sq.size;
        s.sqOx = sq.ox;
        s.sqOy = sq.oy;
        s.sqSize = sq.size;
      }
    } else {
      const sq = findLargestFlatSquare(state, s.tx, s.ty, s);

      if (sq.size === 0) {
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

      s.level = sq.size;
      s.sqOx = sq.ox;
      s.sqOy = sq.oy;
      s.sqSize = sq.size;
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
      // At capacity — count ticks before ejecting
      if (!s.atCapTicks) s.atCapTicks = 0;
      s.atCapTicks++;
      const delay = EJECT_DELAY[s.level] || 1;
      if (s.atCapTicks >= delay) {
        s.atCapTicks = 0;
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
    walkerData.push({
      id: w.id,
      t: w.team,
      s: w.strength,
      x: Math.round(w.x * 100) / 100,
      y: Math.round(w.y * 100) / 100,
    });
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

  return {
    type: 'state',
    heights: flatHeights,
    walkers: walkerData,
    settlements: settlementData,
    magnetPos: state.magnetPos,
    teamMode: state.teamMode,
    mana: Math.floor(state.mana[team]),
    team,
  };
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
        const state = playerRoom.state;
        const { px, py } = msg;
        if (typeof px !== 'number' || typeof py !== 'number') return;
        if (px < 0 || px > C.MAP_W || py < 0 || py > C.MAP_H) return;
        if (state.mana[playerTeam] < 10) return;
        state.mana[playerTeam] -= 10;
        raisePoint(state, px, py);
        break;
      }

      case 'lower': {
        if (!playerRoom || !playerRoom.started || playerRoom.state.gameOver) return;
        const state = playerRoom.state;
        const { px, py } = msg;
        if (typeof px !== 'number' || typeof py !== 'number') return;
        if (px < 0 || px > C.MAP_W || py < 0 || py > C.MAP_H) return;
        if (state.mana[playerTeam] < 10) return;
        state.mana[playerTeam] -= 10;
        lowerPoint(state, px, py);
        break;
      }

      case 'mode': {
        if (!playerRoom || !playerRoom.started || playerRoom.state.gameOver) return;
        const mode = msg.mode;
        if (typeof mode !== 'number' || mode < 0 || mode > 3) return;
        playerRoom.state.teamMode[playerTeam] = mode;
        break;
      }

      case 'magnet': {
        if (!playerRoom || !playerRoom.started || playerRoom.state.gameOver) return;
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
