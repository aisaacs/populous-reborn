'use strict';

const C = require('./shared/constants');

// ── Spawn Zone Computation ──────────────────────────────────────────
function computeSpawnZones(mapW, mapH, numTeams) {
  const zones = [];
  const cx = mapW / 2, cy = mapH / 2;
  const radius = Math.min(mapW, mapH) * 0.35;
  for (let i = 0; i < numTeams; i++) {
    const angle = (2 * Math.PI * i / numTeams) - Math.PI / 2;
    zones.push({
      cx: Math.round(cx + Math.cos(angle) * radius),
      cy: Math.round(cy + Math.sin(angle) * radius),
    });
  }
  return zones;
}

// ── Game State ──────────────────────────────────────────────────────
function createGameState(mapW, mapH, numTeams, terrainType) {
  mapW = mapW || C.MAP_W;
  mapH = mapH || C.MAP_H;
  numTeams = numTeams || 2;

  const heights = [];
  for (let x = 0; x <= mapW; x++) {
    heights[x] = [];
    for (let y = 0; y <= mapH; y++) {
      heights[x][y] = 0;
    }
  }

  const teamMode = [];
  const mana = [];
  const magnetPos = [];
  const leaders = [];
  const magnetLocked = [];
  const eliminated = [];
  const spawnZones = computeSpawnZones(mapW, mapH, numTeams);

  for (let t = 0; t < numTeams; t++) {
    teamMode.push(C.MODE_SETTLE);
    mana.push(C.START_MANA);
    magnetPos.push({ x: spawnZones[t].cx, y: spawnZones[t].cy });
    leaders.push(-1);
    magnetLocked.push(false);
    eliminated.push(false);
  }

  return {
    heights,
    mapW,
    mapH,
    numTeams,
    terrainType: terrainType || 'continental',
    walkers: [],
    settlements: [],
    settlementMap: new Int32Array(mapW * mapH).fill(-1),
    walkerGrid: new Array(mapW * mapH),
    teamMode,
    magnetPos,
    mana,
    swamps: [],
    swampSet: new Set(),
    rocks: new Set(),
    trees: new Set(),
    pebbles: new Set(),
    ruins: [],
    ruinSet: new Set(),
    crops: [],
    cropCounts: [],
    cropOwnerMap: new Int32Array(mapW * mapH).fill(-1),
    fires: [],
    sfxQueue: [],
    seaLevel: C.SEA_LEVEL,
    leaders,
    magnetLocked,
    eliminated,
    spawnZones,
    teamHadSettlement: new Array(numTeams).fill(false),
    armageddon: false,
    levelEvalTimer: 0,
    pruneTimer: 0,
    nextWalkerId: 1,
    gameOver: false,
    winner: -1,
    _tickCount: 0,
    prevHeights: null, // for delta compression
    // Delta serialization tracking
    _prevWalkerMap: new Map(),      // id → {t,s,x,y,tx,ty,l,k}
    _prevSettlements: [],           // prev serialized settlement array
    _prevCropStr: '',               // joined crop triplets for fast compare
    _prevRocksSize: 0,
    _prevTreesSize: 0,
    _prevPebblesSize: 0,
    _prevRuinsLen: 0,
    _prevSwampsLen: 0,
    _prevSwampsStr: '',
    _prevMagnetPosStr: '',
    _prevMagnetLockedStr: '',
    _prevTeamModeStr: '',
    _prevSeaLevel: 0,
    _prevLeadersStr: '',
    _prevArmageddon: false,
    _prevFiresStr: '',
    _fullSnapshotCounter: 0,
    _prevRocksStr: '',
    _prevTreesStr: '',
    _prevPebblesStr: '',
    _prevRuinsStr: '',
  };
}

// ── Terrain Generation ──────────────────────────────────────────────

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

// Offset constants for height constraint propagation
const NB8_OFFSETS = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
const TILE_OFFSETS = [[0,0],[-1,0],[-1,-1],[0,-1]]; // 4 tiles sharing a height point

function isSaddleTile(state, tx, ty) {
  const t = state.heights[tx][ty], r = state.heights[tx + 1][ty];
  const b = state.heights[tx + 1][ty + 1], l = state.heights[tx][ty + 1];
  return t === b && r === l && t !== r;
}

function fixSaddleRaise(state, tx, ty, queue) {
  const t = state.heights[tx][ty], r = state.heights[tx + 1][ty];
  const high = Math.max(t, r);
  if (t < high) {
    if (state.heights[tx][ty] < C.MAX_HEIGHT) { state.heights[tx][ty] = high; queue.push([tx, ty]); }
    if (state.heights[tx + 1][ty + 1] < C.MAX_HEIGHT) { state.heights[tx + 1][ty + 1] = high; queue.push([tx + 1, ty + 1]); }
  } else {
    if (state.heights[tx + 1][ty] < C.MAX_HEIGHT) { state.heights[tx + 1][ty] = high; queue.push([tx + 1, ty]); }
    if (state.heights[tx][ty + 1] < C.MAX_HEIGHT) { state.heights[tx][ty + 1] = high; queue.push([tx, ty + 1]); }
  }
}

function fixSaddleLower(state, tx, ty, queue) {
  const t = state.heights[tx][ty], r = state.heights[tx + 1][ty];
  const low = Math.min(t, r);
  if (t > low) {
    if (state.heights[tx][ty] > 0) { state.heights[tx][ty] = low; queue.push([tx, ty]); }
    if (state.heights[tx + 1][ty + 1] > 0) { state.heights[tx + 1][ty + 1] = low; queue.push([tx + 1, ty + 1]); }
  } else {
    if (state.heights[tx + 1][ty] > 0) { state.heights[tx + 1][ty] = low; queue.push([tx + 1, ty]); }
    if (state.heights[tx][ty + 1] > 0) { state.heights[tx][ty + 1] = low; queue.push([tx, ty + 1]); }
  }
}

function enforceAdjacency(state) {
  const W = state.mapW, H = state.mapH;
  for (let pass = 0; pass < 30; pass++) {
    let changed = false;
    for (let x = 0; x <= W; x++) {
      for (let y = 0; y <= H; y++) {
        for (const [dx, dy] of NB8_OFFSETS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx > W || ny < 0 || ny > H) continue;
          if (state.heights[x][y] - state.heights[nx][ny] > 1) {
            state.heights[x][y] = state.heights[nx][ny] + 1;
            changed = true;
          }
        }
      }
    }
    // Fix saddle tiles (opposite corners equal, adjacent corners equal, but different)
    for (let tx = 0; tx < W; tx++) {
      for (let ty = 0; ty < H; ty++) {
        if (!isSaddleTile(state, tx, ty)) continue;
        const t = state.heights[tx][ty], r = state.heights[tx + 1][ty];
        if (t > r) {
          if (state.heights[tx][ty] > 0) state.heights[tx][ty]--;
          if (state.heights[tx + 1][ty + 1] > 0) state.heights[tx + 1][ty + 1]--;
        } else {
          if (state.heights[tx + 1][ty] > 0) state.heights[tx + 1][ty]--;
          if (state.heights[tx][ty + 1] > 0) state.heights[tx][ty + 1]--;
        }
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function hasSpawnFlat(state, cx, cy) {
  const W = state.mapW, H = state.mapH;
  for (let r = 0; r < 15; r++) {
    for (let ox = cx - r; ox <= cx + r; ox++) {
      for (let oy = cy - r; oy <= cy + r; oy++) {
        if (Math.abs(ox - cx) !== r && Math.abs(oy - cy) !== r) continue;
        if (ox < 0 || ox + 5 > W || oy < 0 || oy + 5 > H) continue;
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
  const W = state.mapW, H = state.mapH;
  const spawns = state.spawnZones;
  const tp = C.TERRAIN_TYPE_PRESETS[state.terrainType] || C.TERRAIN_TYPE_PRESETS.continental;

  for (let attempt = 0; attempt < 20; attempt++) {
    const noise = makeNoise2D();

    const freq = tp.freqBase + Math.random() * tp.freqRange;
    const heightMul = tp.heightMul * (0.85 + Math.random() * 0.3);
    const numCenters = Math.max(spawns.length, 2 + Math.floor(Math.random() * tp.extraCentersMax));
    const centers = [];

    // Always include centers near spawn zones
    for (const sp of spawns) {
      centers.push({
        x: sp.cx + (Math.random() - 0.5) * 10,
        y: sp.cy + (Math.random() - 0.5) * 10,
        r: tp.spawnRBase + Math.random() * tp.spawnRRange,
      });
    }

    // Additional random centers
    for (let i = centers.length; i < numCenters; i++) {
      centers.push({
        x: 8 + Math.random() * (W - 16),
        y: 8 + Math.random() * (H - 16),
        r: tp.extraRBase + Math.random() * tp.extraRRange,
      });
    }

    for (let x = 0; x <= W; x++) {
      for (let y = 0; y <= H; y++) {
        const nx = x * freq, ny = y * freq;
        let v = noise(nx, ny) * 0.6 + noise(nx * 2.1, ny * 2.1) * 0.25 + noise(nx * 4.3, ny * 4.3) * 0.15;

        let mask = 0;
        for (const c of centers) {
          const dx = (x - c.x) / (W * c.r);
          const dy = (y - c.y) / (H * c.r);
          const d = Math.sqrt(dx * dx + dy * dy);
          mask = Math.max(mask, Math.max(0, 1 - d));
        }

        // Apply maskPower: lower values compress mask toward 1, filling interior
        if (tp.maskPower && tp.maskPower !== 1) mask = Math.pow(mask, tp.maskPower);

        const ex = Math.min(x, W - x) / 5;
        const ey = Math.min(y, H - y) / 5;
        mask *= Math.min(1, ex, ey);

        v = (v * tp.noiseScale + tp.noiseBias) * mask;
        const h = Math.round(v * C.MAX_HEIGHT * heightMul) - (tp.seaLevel || 0);
        state.heights[x][y] = Math.max(0, Math.min(C.MAX_HEIGHT, h));
      }
    }

    enforceAdjacency(state);

    // Force-flatten spawn areas (critical for noisy terrain types like archipelago)
    for (const sp of spawns) {
      // Find the most common non-zero height in spawn area, or use 1
      const hCounts = new Array(C.MAX_HEIGHT + 1).fill(0);
      for (let dx = -2; dx <= 7; dx++) {
        for (let dy = -2; dy <= 7; dy++) {
          const px = sp.cx + dx, py = sp.cy + dy;
          if (px >= 0 && px <= W && py >= 0 && py <= H) {
            hCounts[state.heights[px][py]]++;
          }
        }
      }
      let spawnH = 1;
      let bestCount = 0;
      for (let h = 1; h <= C.MAX_HEIGHT; h++) {
        if (hCounts[h] > bestCount) { bestCount = hCounts[h]; spawnH = h; }
      }
      // Flatten 6×6 point grid (covers 5×5 tiles) at spawn center
      for (let dx = 0; dx <= 5; dx++) {
        for (let dy = 0; dy <= 5; dy++) {
          const px = sp.cx + dx, py = sp.cy + dy;
          if (px >= 0 && px <= W && py >= 0 && py <= H) {
            state.heights[px][py] = spawnH;
          }
        }
      }
    }
    enforceAdjacency(state);

    // Scatter rocks
    state.rocks.clear();
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (isTileWater(state, x, y)) continue;
        let nearSpawn = false;
        for (const sp of spawns) {
          if (Math.abs(x - sp.cx) + Math.abs(y - sp.cy) < 8) { nearSpawn = true; break; }
        }
        if (nearSpawn) continue;
        if (Math.random() < tp.rockRate) state.rocks.add(x + ',' + y);
      }
    }

    // Scatter trees
    state.trees.clear();
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (isTileWater(state, x, y)) continue;
        if (state.rocks.has(x + ',' + y)) continue;
        let nearSpawn = false;
        for (const sp of spawns) {
          if (Math.abs(x - sp.cx) + Math.abs(y - sp.cy) < 8) { nearSpawn = true; break; }
        }
        if (nearSpawn) continue;
        if (Math.random() < tp.treeRate) state.trees.add(x + ',' + y);
      }
    }

    // Scatter pebbles
    state.pebbles.clear();
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (isTileWater(state, x, y)) continue;
        const key = x + ',' + y;
        if (state.rocks.has(key)) continue;
        if (state.trees.has(key)) continue;
        let nearSpawn = false;
        for (const sp of spawns) {
          if (Math.abs(x - sp.cx) + Math.abs(y - sp.cy) < 8) { nearSpawn = true; break; }
        }
        if (nearSpawn) continue;
        if (Math.random() < tp.pebbleRate) state.pebbles.add(key);
      }
    }

    // Validate: all spawn zones must have a 5x5 flat area nearby
    let allValid = true;
    for (const sp of spawns) {
      if (!hasSpawnFlat(state, sp.cx, sp.cy)) { allValid = false; break; }
    }
    if (allValid) return;

    // Reset heights for retry
    for (let x = 0; x <= W; x++) {
      for (let y = 0; y <= H; y++) state.heights[x][y] = 0;
    }
  }
}

// ── Utility Functions ───────────────────────────────────────────────
function isTileWater(state, tx, ty) {
  if (tx < 0 || tx >= state.mapW || ty < 0 || ty >= state.mapH) return true;
  return state.heights[tx][ty] <= state.seaLevel &&
         state.heights[tx + 1][ty] <= state.seaLevel &&
         state.heights[tx + 1][ty + 1] <= state.seaLevel &&
         state.heights[tx][ty + 1] <= state.seaLevel;
}

function isTileFlat(state, tx, ty) {
  if (tx < 0 || tx >= state.mapW || ty < 0 || ty >= state.mapH) return false;
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
  const cx = Math.max(0, Math.min(state.mapW, ix));
  const cy = Math.max(0, Math.min(state.mapH, iy));
  const cx1 = Math.min(state.mapW, cx + 1);
  const cy1 = Math.min(state.mapH, cy + 1);
  const fx2 = fx - ix, fy2 = fy - iy;
  const h00 = state.heights[cx][cy], h10 = state.heights[cx1][cy];
  const h01 = state.heights[cx][cy1], h11 = state.heights[cx1][cy1];
  return h00 * (1 - fx2) * (1 - fy2) + h10 * fx2 * (1 - fy2) +
         h01 * (1 - fx2) * fy2 + h11 * fx2 * fy2;
}

function getSettlement(state, tx, ty) {
  if (tx < 0 || tx >= state.mapW || ty < 0 || ty >= state.mapH) return null;
  const idx = state.settlementMap[ty * state.mapW + tx];
  if (idx < 0) return null;
  const s = state.settlements[idx];
  return (s && !s.dead) ? s : null;
}

function setSettlement(state, tx, ty, s) {
  if (tx < 0 || tx >= state.mapW || ty < 0 || ty >= state.mapH) return;
  state.settlementMap[ty * state.mapW + tx] = s ? state.settlements.indexOf(s) : -1;
}

function clearSettlementMap(state, tx, ty) {
  if (tx < 0 || tx >= state.mapW || ty < 0 || ty >= state.mapH) return;
  state.settlementMap[ty * state.mapW + tx] = -1;
}

function clearSettlementFootprint(state, s) {
  for (let fx = 0; fx < s.sqSize; fx++) {
    for (let fy = 0; fy < s.sqSize; fy++) {
      const mx = s.sqOx + fx, my = s.sqOy + fy;
      if (mx >= 0 && mx < state.mapW && my >= 0 && my < state.mapH) {
        state.settlementMap[my * state.mapW + mx] = -1;
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

function isCastleAreaValid(state, s) {
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const cx = s.tx + dx, cy = s.ty + dy;
      if (!isTileFlat(state, cx, cy)) return false;
      if (dx === 0 && dy === 0) continue;
      const idx = state.settlementMap[cy * state.mapW + cx];
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
  const W = state.mapW, H = state.mapH;
  while (queue.length) {
    const [x, y] = queue.shift();
    const h = state.heights[x][y];
    for (const [dx, dy] of NB8_OFFSETS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx > W || ny < 0 || ny > H) continue;
      if (h - state.heights[nx][ny] > 1) {
        state.heights[nx][ny] = h - 1;
        queue.push([nx, ny]);
      }
    }
    for (const [dx, dy] of TILE_OFFSETS) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
      if (isSaddleTile(state, tx, ty)) fixSaddleRaise(state, tx, ty, queue);
    }
  }
  for (const [dx, dy] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
    const tx = px + dx, ty = py + dy;
    if (tx >= 0 && tx < state.mapW && ty >= 0 && ty < state.mapH) {
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
  const W = state.mapW, H = state.mapH;
  while (queue.length) {
    const [x, y] = queue.shift();
    const h = state.heights[x][y];
    for (const [dx, dy] of NB8_OFFSETS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx > W || ny < 0 || ny > H) continue;
      if (state.heights[nx][ny] - h > 1) {
        state.heights[nx][ny] = h + 1;
        queue.push([nx, ny]);
      }
    }
    for (const [dx, dy] of TILE_OFFSETS) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
      if (isSaddleTile(state, tx, ty)) fixSaddleLower(state, tx, ty, queue);
    }
  }
  for (const [dx, dy] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
    const tx = px + dx, ty = py + dy;
    if (tx >= 0 && tx < state.mapW && ty >= 0 && ty < state.mapH) {
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
    if (tx < 0 || tx >= state.mapW || ty < 0 || ty >= state.mapH) return false;
    if (isTileWater(state, tx, ty)) return false;
    if (!isTileFlat(state, tx, ty)) return false;
    return true;
  });
  state.swampSet.clear();
  for (const s of state.swamps) state.swampSet.add(s.x + ',' + s.y);
}

function invalidateRocks(state) {
  for (const key of state.rocks) {
    const [x, y] = key.split(',').map(Number);
    if (isTileWater(state, x, y)) state.rocks.delete(key);
  }
}

function invalidateTrees(state) {
  for (const key of state.trees) {
    const [x, y] = key.split(',').map(Number);
    if (isTileWater(state, x, y)) state.trees.delete(key);
  }
}

function invalidateRuins(state) {
  state.ruins = state.ruins.filter(r => {
    if (isTileWater(state, r.x, r.y)) return false;
    return true;
  });
  state.ruinSet.clear();
  for (const r of state.ruins) state.ruinSet.add(r.x + ',' + r.y);
}

function invalidatePebbles(state) {
  for (const key of state.pebbles) {
    const [x, y] = key.split(',').map(Number);
    if (isTileWater(state, x, y)) state.pebbles.delete(key);
  }
}

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

function isWalkerAlive(state, id) {
  if (id < 0) return false;
  for (const w of state.walkers) {
    if (w.id === id && !w.dead) return true;
  }
  return false;
}

// ── Armageddon Targeting ───────────────────────────────────────────
function pickArmageddonTarget(state, w) {
  const cx = state.mapW / 2, cy = state.mapH / 2;
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
    team, strength: Math.min(255, Math.round(strength)),
    x, y,
    tx: x, ty: y,
    dead: false,
    tech: tech || 0,
  };
  state.walkers.push(w);
  return w;
}

function spawnInitialWalkers(state) {
  for (let team = 0; team < state.numTeams; team++) {
    const zone = state.spawnZones[team];
    let spawned = 0;
    for (let r = 0; r < 20 && spawned < C.START_WALKERS; r++) {
      for (let dx = -r; dx <= r && spawned < C.START_WALKERS; dx++) {
        for (let dy = -r; dy <= r && spawned < C.START_WALKERS; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const tx = zone.cx + dx, ty = zone.cy + dy;
          if (tx < 0 || tx >= state.mapW || ty < 0 || ty >= state.mapH) continue;
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
  if (tx >= 0 && tx < state.mapW && ty >= 0 && ty < state.mapH && !isTileWater(state, tx, ty)) {
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
  if (state.cropOwnerMap[ty * state.mapW + tx] !== -1) return false;
  if (state.ruinSet.has(tx + ',' + ty)) return false;
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
      if (tx < 0 || tx >= state.mapW || ty < 0 || ty >= state.mapH) continue;
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
  for (let i = 0; i < state.mapW * state.mapH; i++) state.walkerGrid[i] = null;
  for (let i = 0; i < state.walkers.length; i++) {
    const w = state.walkers[i];
    if (w.dead) continue;
    const tx = Math.floor(w.x), ty = Math.floor(w.y);
    if (tx < 0 || tx >= state.mapW || ty < 0 || ty >= state.mapH) continue;
    const key = ty * state.mapW + tx;
    if (!state.walkerGrid[key]) state.walkerGrid[key] = [];
    state.walkerGrid[key].push(w);
  }
}

function updateWalkers(state, dt) {
  for (const w of state.walkers) {
    if (w.dead) continue;

    const ctx2 = Math.floor(w.x), cty = Math.floor(w.y);
    if (ctx2 < 0 || ctx2 >= state.mapW || cty < 0 || cty >= state.mapH || isTileWater(state, ctx2, cty)) {
      w.dead = true;
      continue;
    }

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

    if (!w.isLeader && !w.isKnight && state.leaders[w.team] < 0) {
      const mp = state.magnetPos[w.team];
      const ldx = mp.x - w.x, ldy = mp.y - w.y;
      if (ldx * ldx + ldy * ldy < 4) {
        w.isLeader = true;
        state.leaders[w.team] = w.id;
        state.magnetLocked[w.team] = false;
      }
    }

    const dx = w.tx - w.x, dy = w.ty - w.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.1) {
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

      // Knight swamp avoidance
      if (w.isKnight && step < dist) {
        const nextX = w.x + (dx / dist) * step;
        const nextY = w.y + (dy / dist) * step;
        const nextTx = Math.floor(nextX), nextTy = Math.floor(nextY);
        const nextKey = nextTx + ',' + nextTy;
        if (state.swampSet.has(nextKey)) {
          const sw = state.swamps.find(s => s.x === nextTx && s.y === nextTy);
          if (sw && sw.team !== w.team) {
            const perpX1 = -dy / dist, perpY1 = dx / dist;
            const perpX2 = dy / dist, perpY2 = -dx / dist;
            let moved = false;
            for (const [px, py] of [[perpX1, perpY1], [perpX2, perpY2]]) {
              const altX = w.x + px * step;
              const altY = w.y + py * step;
              const altTx = Math.floor(altX), altTy = Math.floor(altY);
              if (altTx >= 0 && altTx < state.mapW && altTy >= 0 && altTy < state.mapH &&
                  !isTileWater(state, altTx, altTy)) {
                const altKey = altTx + ',' + altTy;
                const altSw = state.swampSet.has(altKey) &&
                  state.swamps.find(s => s.x === altTx && s.y === altTy && s.team !== w.team);
                if (!altSw) {
                  w.x = Math.max(0.1, Math.min(state.mapW - 0.1, altX));
                  w.y = Math.max(0.1, Math.min(state.mapH - 0.1, altY));
                  moved = true;
                  break;
                }
              }
            }
            if (!moved) { /* wait */ }
            continue;
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

      w.x = Math.max(0.1, Math.min(state.mapW - 0.1, w.x));
      w.y = Math.max(0.1, Math.min(state.mapH - 0.1, w.y));

      const ntx = Math.floor(w.x), nty = Math.floor(w.y);
      if (ntx >= 0 && ntx < state.mapW && nty >= 0 && nty < state.mapH && isTileWater(state, ntx, nty)) {
        if (state.armageddon) {
          raisePoint(state, ntx, nty);
          raisePoint(state, ntx + 1, nty);
          raisePoint(state, ntx, nty + 1);
          raisePoint(state, ntx + 1, nty + 1);
        } else {
          w.x -= (dx / dist) * step;
          w.y -= (dy / dist) * step;
          w.x = Math.max(0.1, Math.min(state.mapW - 0.1, w.x));
          w.y = Math.max(0.1, Math.min(state.mapH - 0.1, w.y));
          pickRandomTarget(state, w);
        }
      }
    }
  }

  // Walker attrition
  // Cache which teams have settlements for homeless attrition
  const teamHasSettlement = new Array(state.numTeams).fill(false);
  for (const s of state.settlements) {
    if (!s.dead) teamHasSettlement[s.team] = true;
  }
  for (const w of state.walkers) {
    if (w.dead) continue;
    let attrRate = C.WALKER_ATTRITION_PER_SEC;
    if (w.isKnight) {
      attrRate = C.KNIGHT_ATTRITION_PER_SEC;
    } else if (state.teamHadSettlement[w.team] && !teamHasSettlement[w.team]) {
      attrRate = C.HOMELESS_ATTRITION_PER_SEC;
    }
    w.attritionFrac = (w.attritionFrac || 0) + attrRate * dt;
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
  state.teamHadSettlement[w.team] = true;
  queueSfx(state, 'settle', w.team, tx, ty);

  state.trees.delete(tx + ',' + ty);

  const cropCount = countSettlementCrops(state, s);
  let level = getLevelFromCropCount(cropCount);
  if (level >= C.MAX_LEVEL && !isCastleAreaValid(state, s)) level = C.MAX_LEVEL - 1;
  s.level = level;
  updateSettlementFootprint(s);
  const newSi = state.settlements.indexOf(s);
  for (let fx = 0; fx < s.sqSize; fx++) {
    for (let fy = 0; fy < s.sqSize; fy++) {
      const mx = s.sqOx + fx, my = s.sqOy + fy;
      if (mx >= 0 && mx < state.mapW && my >= 0 && my < state.mapH) {
        state.settlementMap[my * state.mapW + mx] = newSi;
      }
    }
  }

  const cap = C.LEVEL_CAPACITY[s.level];
  if (w.strength <= cap) {
    s.population = w.strength;
    if (w.isLeader) {
      s.hasLeader = true;
      w.isLeader = false;
    }
    w.dead = true;
  } else {
    s.population = cap;
    w.strength -= cap;
    pickSettleTarget(state, w);
  }

  computeCrops(state);
}

function countSettlementCrops(state, s) {
  let count = 0;
  const r = C.CROP_ZONE_RADIUS;
  const halfFp = Math.floor(s.sqSize / 2);
  const scanR = halfFp + r;
  for (let dx = -scanR; dx <= scanR; dx++) {
    for (let dy = -scanR; dy <= scanR; dy++) {
      const cx = s.tx + dx, cy = s.ty + dy;
      if (cx < 0 || cx >= state.mapW || cy < 0 || cy >= state.mapH) continue;
      if (cx === s.tx && cy === s.ty) continue;
      if (!isTileFlat(state, cx, cy)) continue;
      const smIdx = state.settlementMap[cy * state.mapW + cx];
      if (smIdx >= 0 && smIdx !== state.settlements.indexOf(s)) continue;
      const key = cx + ',' + cy;
      if (state.swampSet.has(key)) continue;
      if (state.pebbles.has(key)) continue;
      if (state.ruinSet.has(key)) continue;
      const ownerIdx = state.cropOwnerMap[cy * state.mapW + cx];
      if (ownerIdx === -2) continue;
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
  let levelUpSfxCount = 0;
  for (let si = 0; si < state.settlements.length; si++) {
    const s = state.settlements[si];
    if (s.dead) continue;

    if (!isTileFlat(state, s.tx, s.ty)) {
      s.dead = true;
      clearSettlementFootprint(state, s);
      queueSfx(state, 'destroy', s.team, s.tx, s.ty);
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

    const cropCount = state.cropCounts ? (state.cropCounts[si] || 0) : 0;
    let newLevel = getLevelFromCropCount(cropCount);

    if (newLevel >= C.MAX_LEVEL && !isCastleAreaValid(state, s)) {
      newLevel = C.MAX_LEVEL - 1;
    }

    if (newLevel !== s.level) {
      if (newLevel > s.level && levelUpSfxCount < 3) {
        queueSfx(state, 'levelup', s.team, s.tx, s.ty);
        levelUpSfxCount++;
      }
      clearSettlementFootprint(state, s);
      s.level = newLevel;
      updateSettlementFootprint(s);
      for (let fx = 0; fx < s.sqSize; fx++) {
        for (let fy = 0; fy < s.sqSize; fy++) {
          const mx = s.sqOx + fx, my = s.sqOy + fy;
          if (mx >= 0 && mx < state.mapW && my >= 0 && my < state.mapH) {
            state.settlementMap[my * state.mapW + mx] = si;
          }
        }
      }
    }

    const cap = C.LEVEL_CAPACITY[s.level];
    if (s.population > cap) {
      const excess = s.population - Math.floor(cap / 2);
      s.population = Math.floor(cap / 2);
      const angle = Math.random() * Math.PI * 2;
      const sTech = C.SETTLEMENT_LEVELS[s.level] ? C.SETTLEMENT_LEVELS[s.level].tech : 0;
      const ew = spawnWalker(state, s.team, excess,
        s.tx + 0.5 + Math.cos(angle) * 1.2,
        s.ty + 0.5 + Math.sin(angle) * 1.2, sTech);
      if (s.hasLeader) {
        ew.isLeader = true;
        state.leaders[s.team] = ew.id;
        s.hasLeader = false;
      }
    }
  }
}

// ── Crop Computation ────────────────────────────────────────────────
function computeCrops(state) {
  state.cropOwnerMap.fill(-1);

  const r = C.CROP_ZONE_RADIUS;

  // Phase 1: Each settlement claims flat tiles. Track per-team claims (N-way).
  const settlementClaims = new Array(state.settlements.length);
  const teamTiles = [];
  for (let t = 0; t < state.numTeams; t++) teamTiles.push(new Set());

  for (let si = 0; si < state.settlements.length; si++) {
    const claims = new Set();
    settlementClaims[si] = claims;
    const s = state.settlements[si];
    if (s.dead) continue;
    const halfFp = Math.floor(s.sqSize / 2);
    const scanR = halfFp + r;
    for (let dx = -scanR; dx <= scanR; dx++) {
      for (let dy = -scanR; dy <= scanR; dy++) {
        const cx = s.tx + dx, cy = s.ty + dy;
        if (cx < 0 || cx >= state.mapW || cy < 0 || cy >= state.mapH) continue;
        if (cx === s.tx && cy === s.ty) continue;
        if (!isTileFlat(state, cx, cy)) continue;
        const smIdx = state.settlementMap[cy * state.mapW + cx];
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

  // Phase 2: N-way contested tiles — claimed by 2+ different teams
  const contested = new Set();
  // Build a map: tile key -> set of teams claiming it
  const tileTeamCount = new Map();
  for (let t = 0; t < state.numTeams; t++) {
    for (const key of teamTiles[t]) {
      if (!tileTeamCount.has(key)) tileTeamCount.set(key, new Set());
      tileTeamCount.get(key).add(t);
    }
  }
  for (const [key, teams] of tileTeamCount) {
    if (teams.size > 1) contested.add(key);
  }

  for (const key of contested) {
    const [x, y] = key.split(',').map(Number);
    state.cropOwnerMap[y * state.mapW + x] = -2;
  }

  // Phase 3: Count crops per settlement
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
        state.cropOwnerMap[y * state.mapW + x] = si;
      }
    }
  }

  state.crops = cropList;
  state.cropCounts = cropCounts;
}

// ── Population Growth & Ejection ────────────────────────────────────
function updatePopulationGrowth(state, dt) {
  for (let si = 0; si < state.settlements.length; si++) {
    const s = state.settlements[si];
    if (s.dead) continue;
    const cap = C.LEVEL_CAPACITY[s.level];
    const cropCount = state.cropCounts ? (state.cropCounts[si] || 0) : 0;

    if (s.population < cap && cropCount > 0) {
      s.popFrac = (s.popFrac || 0) + cropCount * C.GROWTH_PER_CROP_PER_SEC * dt;
      const whole = Math.floor(s.popFrac);
      if (whole > 0) {
        s.popFrac -= whole;
        s.population = Math.min(cap, s.population + whole);
      }
      s.atCapTime = 0;
    } else if (s.population >= cap && cap > 0) {
      if (state.teamMode[s.team] !== C.MODE_SETTLE) {
        s.atCapTime = 0;
        continue;
      }
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
        w.tech = C.SETTLEMENT_LEVELS[s.level] ? C.SETTLEMENT_LEVELS[s.level].tech : 0;
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

  let combatDeathCount = 0, combatSumX = 0, combatSumY = 0;

  for (let i = 0; i < state.walkers.length; i++) {
    const w = state.walkers[i];
    if (w.dead) continue;

    const cx = Math.floor(w.x), cy = Math.floor(w.y);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const tx = cx + dx, ty = cy + dy;
        if (tx < 0 || tx >= state.mapW || ty < 0 || ty >= state.mapH) continue;
        const wlist = state.walkerGrid[ty * state.mapW + tx];
        if (!wlist) continue;
        for (const other of wlist) {
          if (other === w || other.dead) continue;
          const ddx = other.x - w.x, ddy = other.y - w.y;
          const dist = ddx * ddx + ddy * ddy;
          if (dist > 0.5 * 0.5) continue;

          if (other.team === w.team) {
            if (w.isKnight || other.isKnight) continue;
            w.strength = Math.min(255, w.strength + other.strength);
            w.tech = Math.max(w.tech || 0, other.tech || 0);
            if (other.isLeader) {
              w.isLeader = true;
              state.leaders[w.team] = w.id;
              other.isLeader = false;
            }
            other.dead = true;
          } else {
            const wTech = w.tech || 0, oTech = other.tech || 0;
            const wMult = Math.pow(C.TECH_ADVANTAGE_MULT, Math.max(0, wTech - oTech));
            const oMult = Math.pow(C.TECH_ADVANTAGE_MULT, Math.max(0, oTech - wTech));
            const wEff = w.strength * wMult;
            const oEff = other.strength * oMult;
            if (wEff > oEff) {
              const t = other.strength / wMult;
              w.strength = Math.max(1, Math.round(w.strength - oMult * t));
              other.dead = true;
              combatDeathCount++; combatSumX += other.x; combatSumY += other.y;
            } else if (oEff > wEff) {
              const t = w.strength / oMult;
              other.strength = Math.max(1, Math.round(other.strength - wMult * t));
              w.dead = true;
              combatDeathCount++; combatSumX += w.x; combatSumY += w.y;
            } else {
              w.dead = true;
              other.dead = true;
              combatDeathCount += 2; combatSumX += w.x + other.x; combatSumY += w.y + other.y;
            }
          }
        }
      }
    }

    if (w.dead) continue;

    const stx = Math.floor(w.x), sty = Math.floor(w.y);
    const es = getSettlement(state, stx, sty);

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
      if (!es._attackers) es._attackers = [];
      es._attackers.push(w);
    }
  }

  // Process settlement assaults
  for (const es of state.settlements) {
    if (es.dead || !es._attackers || es._attackers.length === 0) continue;
    const attackers = es._attackers;
    delete es._attackers;

    const dt = 1 / C.TICK_RATE;
    const sTech = C.SETTLEMENT_LEVELS[es.level] ? C.SETTLEMENT_LEVELS[es.level].tech : 0;

    let totalDmgToSett = 0;
    for (const w of attackers) {
      const wTech = w.tech || 0;
      const techDiff = wTech - sTech;
      const wMult = techDiff > 0 ? Math.pow(C.TECH_ADVANTAGE_MULT, techDiff) : 1;
      const strMult = w.isKnight ? C.KNIGHT_ASSAULT_MULT : Math.max(1, w.strength / 5);
      totalDmgToSett += C.ASSAULT_DMG_PER_SEC * dt * wMult * strMult;
    }

    es.assaultFrac = (es.assaultFrac || 0) + totalDmgToSett;
    if (es.assaultFrac >= 1) {
      const loss = Math.floor(es.assaultFrac);
      es.assaultFrac -= loss;
      es.population -= loss;
      queueSfx(state, 'combat', -1, es.tx, es.ty);
    }

    const popScale = Math.max(0.2, es.population / 20);
    const totalRetal = C.ASSAULT_DMG_PER_SEC * dt * C.ASSAULT_RETALIATE_FRAC * popScale;
    const retalPerWalker = totalRetal / attackers.length;

    for (const w of attackers) {
      const wTech = w.tech || 0;
      const techDiff = wTech - sTech;
      const sMult = techDiff < 0 ? Math.pow(C.TECH_ADVANTAGE_MULT, -techDiff) : 1;
      const retalMult = w.isKnight ? C.KNIGHT_RETAL_MULT : 1;
      w.assaultFrac = (w.assaultFrac || 0) + retalPerWalker * sMult * retalMult;
      if (w.assaultFrac >= 1) {
        const loss = Math.floor(w.assaultFrac);
        w.assaultFrac -= loss;
        w.strength -= loss;
      }
      if (w.strength <= 0) w.dead = true;
    }

    if (es.population <= 0) {
      if (es.hasLeader) {
        state.magnetPos[es.team] = { x: es.tx + 0.5, y: es.ty + 0.5 };
        state.magnetLocked[es.team] = true;
        state.leaders[es.team] = -1;
        es.hasLeader = false;
      }
      let best = null;
      for (const w of attackers) {
        if (!w.dead && (!best || w.strength > best.strength)) best = w;
      }
      if (best && best.isKnight) {
        for (let rdx = 0; rdx < es.sqSize; rdx++) {
          for (let rdy = 0; rdy < es.sqSize; rdy++) {
            const rx = es.sqOx + rdx, ry = es.sqOy + rdy;
            if (rx >= 0 && rx < state.mapW && ry >= 0 && ry < state.mapH) {
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
        queueSfx(state, 'destroy', es.team, es.tx, es.ty);
        pickFightTarget(state, best);
      } else if (best) {
        queueSfx(state, 'settle', best.team, es.tx, es.ty);
        es.team = best.team;
        es.population = Math.max(1, best.strength);
        es.popFrac = 0;
        es.atCapTime = 0;
        es.assaultFrac = 0;
        best.dead = true;
      } else {
        es.dead = true;
        clearSettlementFootprint(state, es);
        queueSfx(state, 'destroy', es.team, es.tx, es.ty);
      }
    }
  }

  for (const es of state.settlements) {
    delete es._attackers;
  }

  if (combatDeathCount > 0) {
    queueSfx(state, 'combat', -1, combatSumX / combatDeathCount, combatSumY / combatDeathCount);
  }
}

// ── Entity Pruning ──────────────────────────────────────────────────
function pruneDeadEntities(state) {
  for (let t = 0; t < state.numTeams; t++) {
    if (state.leaders[t] >= 0) {
      const leaderW = state.walkers.find(w => w.id === state.leaders[t]);
      if (!leaderW || leaderW.dead) {
        const leaderInSettlement = state.settlements.some(
          s => !s.dead && s.team === t && s.hasLeader
        );
        if (!leaderInSettlement) {
          if (leaderW) {
            state.magnetPos[t] = { x: leaderW.x, y: leaderW.y };
          }
          state.magnetLocked[t] = true;
          state.leaders[t] = -1;
        }
      }
    }
  }

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
    for (let fx = 0; fx < s.sqSize; fx++) {
      for (let fy = 0; fy < s.sqSize; fy++) {
        const mx = s.sqOx + fx, my = s.sqOy + fy;
        if (mx >= 0 && mx < state.mapW && my >= 0 && my < state.mapH) {
          state.settlementMap[my * state.mapW + mx] = i;
        }
      }
    }
  }
}

// ── Mana ────────────────────────────────────────────────────────────
function updateMana(state, dt) {
  for (let team = 0; team < state.numTeams; team++) {
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

// Compute heights payload once per tick (shared across all players)
function computeHeightsPayload(state) {
  const W = state.mapW, H = state.mapH;
  let heightsPayload;
  if (!state.prevHeights) {
    const flatHeights = [];
    for (let y = 0; y <= H; y++) {
      for (let x = 0; x <= W; x++) {
        flatHeights.push(state.heights[x][y]);
      }
    }
    heightsPayload = { full: flatHeights };
    state.prevHeights = [];
    for (let x = 0; x <= W; x++) {
      state.prevHeights[x] = state.heights[x].slice();
    }
  } else {
    const delta = [];
    for (let x = 0; x <= W; x++) {
      for (let y = 0; y <= H; y++) {
        if (state.heights[x][y] !== state.prevHeights[x][y]) {
          delta.push(x, y, state.heights[x][y]);
          state.prevHeights[x][y] = state.heights[x][y];
        }
      }
    }
    if (delta.length > (W + 1) * (H + 1) * 0.5) {
      const flatHeights = [];
      for (let y = 0; y <= H; y++) {
        for (let x = 0; x <= W; x++) {
          flatHeights.push(state.heights[x][y]);
        }
      }
      heightsPayload = { full: flatHeights };
    } else {
      heightsPayload = { delta };
    }
  }
  return heightsPayload;
}

function serializeState(state, team, heightsPayload) {

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

  const swampData = state.swamps.map(s => ({ x: s.x, y: s.y, t: s.team }));

  const rockData = [];
  for (const key of state.rocks) {
    const parts = key.split(',');
    rockData.push(+parts[0], +parts[1]);
  }

  const treeData = [];
  for (const key of state.trees) {
    const parts = key.split(',');
    treeData.push(+parts[0], +parts[1]);
  }

  const pebbleData = [];
  for (const key of state.pebbles) {
    const parts = key.split(',');
    pebbleData.push(+parts[0], +parts[1]);
  }

  const ruinData = [];
  for (const r of state.ruins) {
    ruinData.push(r.x, r.y, r.team);
  }

  const cropData = [];
  if (state.crops) {
    for (const c of state.crops) {
      cropData.push(c.x, c.y, c.t);
    }
  }

  // Build teamPop for all teams
  const teamPop = [];
  for (let t = 0; t < state.numTeams; t++) {
    teamPop.push(getTeamStats(state, t).pop);
  }

  return {
    type: 'state',
    heights: heightsPayload,
    walkers: walkerData,
    settlements: settlementData,
    magnetPos: state.magnetPos,
    teamMode: state.teamMode,
    mana: Math.floor(state.mana[team]),
    team,
    numTeams: state.numTeams,
    mapW: state.mapW,
    mapH: state.mapH,
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
    magnetLocked: state.magnetLocked.slice(),
    teamPop,
    sfx: state.sfxQueue.length > 0 ? state.sfxQueue : undefined,
  };
}

// ── Replay Snapshot ─────────────────────────────────────────────────
function serializeReplaySnapshot(state, heightsPayload) {
  const walkerData = [];
  for (const w of state.walkers) {
    if (w.dead) continue;
    const wd = {
      id: w.id, t: w.team, s: w.strength,
      x: Math.round(w.x * 100) / 100,
      y: Math.round(w.y * 100) / 100,
      tx: Math.round(w.tx * 100) / 100,
      ty: Math.round(w.ty * 100) / 100,
    };
    if (w.isLeader) wd.l = 1;
    if (w.isKnight) wd.k = 1;
    walkerData.push(wd);
  }

  const settlementData = [];
  for (const s of state.settlements) {
    if (s.dead) continue;
    const sd = {
      t: s.team, l: s.level, p: s.population,
      tx: s.tx, ty: s.ty,
      ox: s.sqOx, oy: s.sqOy, sz: s.sqSize,
    };
    if (s.hasLeader) sd.hl = 1;
    settlementData.push(sd);
  }

  const teamPop = [];
  const mana = [];
  for (let t = 0; t < state.numTeams; t++) {
    teamPop.push(getTeamStats(state, t).pop);
    mana.push(Math.floor(state.mana[t]));
  }

  return {
    tick: state._tickCount,
    full: true,
    heights: heightsPayload,
    walkers: walkerData,
    settlements: settlementData,
    magnetPos: state.magnetPos,
    magnetLocked: state.magnetLocked.slice(),
    teamMode: state.teamMode,
    mana,
    numTeams: state.numTeams,
    mapW: state.mapW,
    mapH: state.mapH,
    swamps: state.swamps.map(s => ({ x: s.x, y: s.y, t: s.team })),
    rocks: Array.from(state.rocks).flatMap(k => { const p = k.split(','); return [+p[0], +p[1]]; }),
    trees: Array.from(state.trees).flatMap(k => { const p = k.split(','); return [+p[0], +p[1]]; }),
    pebbles: Array.from(state.pebbles).flatMap(k => { const p = k.split(','); return [+p[0], +p[1]]; }),
    ruins: state.ruins.flatMap(r => [r.x, r.y, r.team]),
    crops: state.crops ? state.crops.flatMap(c => [c.x, c.y, c.t]) : [],
    fires: state.fires.map(f => ({ x: f.x, y: f.y, a: Math.round(f.age * 10) / 10 })),
    seaLevel: state.seaLevel,
    leaders: state.leaders,
    armageddon: state.armageddon,
    teamPop,
  };
}

// ── Delta Serialization ─────────────────────────────────────────────

function computeWalkerDelta(state) {
  const prevMap = state._prevWalkerMap;
  const wMov = [];   // flat triplets: id, x, y (position-only changes)
  const wUpd = [];   // full objects for new/changed walkers
  const wRem = [];   // removed walker IDs
  const newMap = new Map();

  for (const w of state.walkers) {
    if (w.dead) continue;
    const x = Math.round(w.x * 100) / 100;
    const y = Math.round(w.y * 100) / 100;
    const tx = Math.round(w.tx * 100) / 100;
    const ty = Math.round(w.ty * 100) / 100;
    const l = w.isLeader ? 1 : 0;
    const k = w.isKnight ? 1 : 0;

    const prev = prevMap.get(w.id);
    if (!prev) {
      // New walker
      const wd = { id: w.id, t: w.team, s: w.strength, x, y, tx, ty };
      if (l) wd.l = 1;
      if (k) wd.k = 1;
      wUpd.push(wd);
    } else if (prev.s !== w.strength || prev.tx !== tx || prev.ty !== ty ||
               prev.l !== l || prev.k !== k || prev.t !== w.team) {
      // Changed strength, target, flags, or team
      const wd = { id: w.id, t: w.team, s: w.strength, x, y, tx, ty };
      if (l) wd.l = 1;
      if (k) wd.k = 1;
      wUpd.push(wd);
    } else if (prev.x !== x || prev.y !== y) {
      // Position-only change
      wMov.push(w.id, x, y);
    }
    // else: unchanged, skip

    newMap.set(w.id, { t: w.team, s: w.strength, x, y, tx, ty, l, k });
  }

  // Find removed walkers
  for (const id of prevMap.keys()) {
    if (!newMap.has(id)) wRem.push(id);
  }

  state._prevWalkerMap = newMap;
  return { wMov, wUpd, wRem };
}

function computeSettlementDelta(state) {
  const prev = state._prevSettlements;
  const sUpd = [];
  const sRem = [];
  const currMap = new Map();

  for (const s of state.settlements) {
    if (s.dead) continue;
    const key = s.tx + ',' + s.ty;
    const sd = {
      t: s.team, l: s.level, p: s.population,
      tx: s.tx, ty: s.ty,
      ox: s.sqOx, oy: s.sqOy, sz: s.sqSize,
    };
    if (s.hasLeader) sd.hl = 1;
    currMap.set(key, sd);
  }

  // Build prev map
  const prevMap = new Map();
  for (const sd of prev) {
    prevMap.set(sd.tx + ',' + sd.ty, sd);
  }

  // Find new/changed
  for (const [key, sd] of currMap) {
    const p = prevMap.get(key);
    if (!p || p.t !== sd.t || p.l !== sd.l || p.p !== sd.p ||
        p.ox !== sd.ox || p.oy !== sd.oy || p.sz !== sd.sz ||
        (p.hl || 0) !== (sd.hl || 0)) {
      sUpd.push(sd);
    }
  }

  // Find removed
  for (const key of prevMap.keys()) {
    if (!currMap.has(key)) {
      const [tx, ty] = key.split(',').map(Number);
      sRem.push(tx, ty);
    }
  }

  state._prevSettlements = Array.from(currMap.values());
  return { sUpd, sRem };
}

function serializeSetData(set) {
  const arr = [];
  for (const key of set) {
    const parts = key.split(',');
    arr.push(+parts[0], +parts[1]);
  }
  return arr;
}

function computeDelta(state, heightsPayload) {
  const delta = {
    type: 'state',
  };

  // Heights (already delta-encoded by computeHeightsPayload)
  if (heightsPayload) {
    if (heightsPayload.full || (heightsPayload.delta && heightsPayload.delta.length > 0)) {
      delta.heights = heightsPayload;
    }
  }

  // Walker delta
  const wd = computeWalkerDelta(state);
  if (wd.wMov.length > 0) delta.wMov = wd.wMov;
  if (wd.wUpd.length > 0) delta.wUpd = wd.wUpd;
  if (wd.wRem.length > 0) delta.wRem = wd.wRem;

  // Settlement delta
  const sd = computeSettlementDelta(state);
  if (sd.sUpd.length > 0) delta.sUpd = sd.sUpd;
  if (sd.sRem.length > 0) delta.sRem = sd.sRem;

  // Fires — always sent (small, changes every tick due to age)
  delta.fires = state.fires.map(f => ({ x: f.x, y: f.y, a: Math.round(f.age * 10) / 10 }));

  // teamPop — always sent (small)
  const teamPop = [];
  for (let t = 0; t < state.numTeams; t++) {
    teamPop.push(getTeamStats(state, t).pop);
  }
  delta.teamPop = teamPop;

  // Crops — string compare
  let cropStr = '';
  if (state.crops) {
    for (const c of state.crops) {
      cropStr += c.x + ',' + c.y + ',' + c.t + ';';
    }
  }
  if (cropStr !== state._prevCropStr) {
    const cropData = [];
    if (state.crops) {
      for (const c of state.crops) cropData.push(c.x, c.y, c.t);
    }
    delta.crops = cropData;
    state._prevCropStr = cropStr;
  }

  // Rocks
  const rocksStr = Array.from(state.rocks).join(';');
  if (rocksStr !== state._prevRocksStr) {
    delta.rocks = serializeSetData(state.rocks);
    state._prevRocksStr = rocksStr;
  }

  // Trees
  const treesStr = Array.from(state.trees).join(';');
  if (treesStr !== state._prevTreesStr) {
    delta.trees = serializeSetData(state.trees);
    state._prevTreesStr = treesStr;
  }

  // Pebbles
  const pebblesStr = Array.from(state.pebbles).join(';');
  if (pebblesStr !== state._prevPebblesStr) {
    delta.pebbles = serializeSetData(state.pebbles);
    state._prevPebblesStr = pebblesStr;
  }

  // Ruins
  const ruinsStr = state.ruins.map(r => r.x + ',' + r.y + ',' + r.team).join(';');
  if (ruinsStr !== state._prevRuinsStr) {
    const ruinData = [];
    for (const r of state.ruins) ruinData.push(r.x, r.y, r.team);
    delta.ruins = ruinData;
    state._prevRuinsStr = ruinsStr;
  }

  // Swamps
  const swampsStr = state.swamps.map(s => s.x + ',' + s.y + ',' + s.team).join(';');
  if (swampsStr !== state._prevSwampsStr) {
    delta.swamps = state.swamps.map(s => ({ x: s.x, y: s.y, t: s.team }));
    state._prevSwampsStr = swampsStr;
  }

  // Scalar fields — only if changed
  const magnetPosStr = JSON.stringify(state.magnetPos);
  if (magnetPosStr !== state._prevMagnetPosStr) {
    delta.magnetPos = state.magnetPos;
    state._prevMagnetPosStr = magnetPosStr;
  }

  const magnetLockedStr = JSON.stringify(state.magnetLocked);
  if (magnetLockedStr !== state._prevMagnetLockedStr) {
    delta.magnetLocked = state.magnetLocked.slice();
    state._prevMagnetLockedStr = magnetLockedStr;
  }

  const teamModeStr = JSON.stringify(state.teamMode);
  if (teamModeStr !== state._prevTeamModeStr) {
    delta.teamMode = state.teamMode;
    state._prevTeamModeStr = teamModeStr;
  }

  if (state.seaLevel !== state._prevSeaLevel) {
    delta.seaLevel = state.seaLevel;
    state._prevSeaLevel = state.seaLevel;
  }

  const leadersStr = JSON.stringify(state.leaders);
  if (leadersStr !== state._prevLeadersStr) {
    delta.leaders = state.leaders;
    state._prevLeadersStr = leadersStr;
  }

  if (state.armageddon !== state._prevArmageddon) {
    delta.armageddon = state.armageddon;
    state._prevArmageddon = state.armageddon;
  }

  if (state.sfxQueue.length > 0) delta.sfx = state.sfxQueue;

  return delta;
}

function serializeFullState(state, team, heightsPayload) {
  const msg = serializeState(state, team, heightsPayload);
  msg.full = true;

  // Update all prev tracking to match current state
  // Walkers
  state._prevWalkerMap = new Map();
  for (const w of state.walkers) {
    if (w.dead) continue;
    state._prevWalkerMap.set(w.id, {
      t: w.team,
      s: w.strength,
      x: Math.round(w.x * 100) / 100,
      y: Math.round(w.y * 100) / 100,
      tx: Math.round(w.tx * 100) / 100,
      ty: Math.round(w.ty * 100) / 100,
      l: w.isLeader ? 1 : 0,
      k: w.isKnight ? 1 : 0,
    });
  }

  // Settlements
  state._prevSettlements = [];
  for (const s of state.settlements) {
    if (s.dead) continue;
    const sd = {
      t: s.team, l: s.level, p: s.population,
      tx: s.tx, ty: s.ty,
      ox: s.sqOx, oy: s.sqOy, sz: s.sqSize,
    };
    if (s.hasLeader) sd.hl = 1;
    state._prevSettlements.push(sd);
  }

  // Crops
  let cropStr = '';
  if (state.crops) {
    for (const c of state.crops) cropStr += c.x + ',' + c.y + ',' + c.t + ';';
  }
  state._prevCropStr = cropStr;

  // Collections
  state._prevRocksStr = Array.from(state.rocks).join(';');
  state._prevTreesStr = Array.from(state.trees).join(';');
  state._prevPebblesStr = Array.from(state.pebbles).join(';');
  state._prevRuinsStr = state.ruins.map(r => r.x + ',' + r.y + ',' + r.team).join(';');
  state._prevSwampsStr = state.swamps.map(s => s.x + ',' + s.y + ',' + s.team).join(';');

  // Scalars
  state._prevMagnetPosStr = JSON.stringify(state.magnetPos);
  state._prevMagnetLockedStr = JSON.stringify(state.magnetLocked);
  state._prevTeamModeStr = JSON.stringify(state.teamMode);
  state._prevSeaLevel = state.seaLevel;
  state._prevLeadersStr = JSON.stringify(state.leaders);
  state._prevArmageddon = state.armageddon;

  return msg;
}

// ── SFX Queue ──────────────────────────────────────────────────────
function queueSfx(state, name, team, x, y) {
  const evt = { n: name, t: team };
  if (x !== undefined && y !== undefined) {
    evt.x = Math.round(x * 10) / 10;
    evt.y = Math.round(y * 10) / 10;
  }
  state.sfxQueue.push(evt);
}

// ── Divine Powers ───────────────────────────────────────────────────
function executePowerEarthquake(state, team, px, py) {
  const r = C.EARTHQUAKE_RADIUS;
  const r2 = r * r;
  for (let x = Math.max(0, px - r); x <= Math.min(state.mapW, px + r); x++) {
    for (let y = Math.max(0, py - r); y <= Math.min(state.mapH, py + r); y++) {
      const dx = x - px, dy = y - py;
      if (dx * dx + dy * dy < r2) {
        const action = Math.random() < 0.5 ? 'raise' : 'lower';
        const times = Math.floor(Math.random() * 3);
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
  queueSfx(state, 'earthquake', team, px, py);
}

function executePowerSwamp(state, team, tx, ty) {
  const placed = [];
  const attempts = 20;
  const targetCount = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < attempts && placed.length < targetCount; i++) {
    const dx = i === 0 ? 0 : Math.floor(Math.random() * 7) - 3;
    const dy = i === 0 ? 0 : Math.floor(Math.random() * 7) - 3;
    const sx = tx + dx, sy = ty + dy;
    if (sx < 0 || sx >= state.mapW || sy < 0 || sy >= state.mapH) continue;
    const key = sx + ',' + sy;
    if (state.swampSet.has(key)) continue;
    if (!isTileFlat(state, sx, sy)) continue;
    if (state.settlementMap[sy * state.mapW + sx] >= 0) continue;
    state.swamps.push({ x: sx, y: sy, team });
    state.swampSet.add(key);
    placed.push(key);
  }
  if (placed.length > 0) queueSfx(state, 'swamp', team, tx, ty);
  return placed.length > 0;
}

function executePowerKnight(state, team) {
  const leaderId = state.leaders[team];
  if (leaderId < 0) return false;

  let hostSettlement = null;
  for (const s of state.settlements) {
    if (s.dead || s.team !== team) continue;
    if (s.hasLeader) {
      hostSettlement = s;
      break;
    }
  }

  if (hostSettlement) {
    const sx = hostSettlement.tx + 0.5;
    const sy = hostSettlement.ty + 0.5;
    const knightStrength = Math.min(255, Math.round(hostSettlement.population * C.KNIGHT_STRENGTH_MULT));
    const sTech = C.SETTLEMENT_LEVELS[hostSettlement.level] ? C.SETTLEMENT_LEVELS[hostSettlement.level].tech : 0;

    const knight = spawnWalker(state, team, knightStrength, sx, sy, sTech);
    knight.isKnight = true;

    hostSettlement.dead = true;
    hostSettlement.hasLeader = false;
    clearSettlementFootprint(state, hostSettlement);

    state.magnetPos[team] = { x: hostSettlement.tx, y: hostSettlement.ty };
    state.magnetLocked[team] = true;
    state.leaders[team] = -1;

    state.fires.push({ x: hostSettlement.tx, y: hostSettlement.ty, age: 0 });

    pickFightTarget(state, knight);
    queueSfx(state, 'knight', team, hostSettlement.tx, hostSettlement.ty);
    return true;
  }

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

  leader.isKnight = true;
  leader.strength = Math.min(255, Math.round(leader.strength * C.KNIGHT_STRENGTH_MULT));
  leader.isLeader = false;
  state.leaders[team] = -1;

  hostSettlement.dead = true;
  hostSettlement.hasLeader = false;
  clearSettlementFootprint(state, hostSettlement);

  state.magnetPos[team] = { x: hostSettlement.tx, y: hostSettlement.ty };
  state.magnetLocked[team] = true;

  state.fires.push({ x: hostSettlement.tx, y: hostSettlement.ty, age: 0 });

  pickFightTarget(state, leader);
  queueSfx(state, 'knight', team, hostSettlement.tx, hostSettlement.ty);
  return true;
}

function executePowerVolcano(state, team, px, py) {
  const r = C.VOLCANO_RADIUS;
  const r2 = r * r;
  for (let x = Math.max(0, px - r); x <= Math.min(state.mapW, px + r); x++) {
    for (let y = Math.max(0, py - r); y <= Math.min(state.mapH, py + r); y++) {
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
  const innerR = Math.floor(r / 2);
  const innerR2 = innerR * innerR;
  for (let tx = Math.max(0, px - innerR); tx < Math.min(state.mapW, px + innerR); tx++) {
    for (let ty = Math.max(0, py - innerR); ty < Math.min(state.mapH, py + innerR); ty++) {
      const dx = tx + 0.5 - px, dy = ty + 0.5 - py;
      if (dx * dx + dy * dy < innerR2) {
        state.rocks.add(tx + ',' + ty);
      }
    }
  }
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
  queueSfx(state, 'volcano', team, px, py);
}

function executePowerFlood(state, team) {
  for (let x = 0; x <= state.mapW; x++) {
    for (let y = 0; y <= state.mapH; y++) {
      state.heights[x][y] = Math.max(0, state.heights[x][y] - 1);
    }
  }
  for (const w of state.walkers) {
    if (w.dead) continue;
    const tx = Math.floor(w.x), ty = Math.floor(w.y);
    if (tx < 0 || tx >= state.mapW || ty < 0 || ty >= state.mapH) continue;
    if (isTileWater(state, tx, ty)) w.dead = true;
  }
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
  queueSfx(state, 'flood', team);
}

function executePowerArmageddon(state, team) {
  state.armageddon = true;
  for (const s of state.settlements) {
    if (s.dead) continue;
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
    s.dead = true;
    clearSettlementFootprint(state, s);
  }
  queueSfx(state, 'armageddon', team);
}

// ── Basic AI ────────────────────────────────────────────────────────
function updateAI(state, room, dt) {
  room.aiTimer += dt;
  if (room.aiTimer < 1.5) return;
  room.aiTimer = 0;

  // Run AI for each AI-controlled team
  for (let team = 0; team < room.maxPlayers; team++) {
    // Skip human players (slot 0) and eliminated teams
    if (room.players[team] !== null) continue;
    if (state.eliminated[team]) continue;

    const mana = state.mana[team];
    const myStats = getTeamStats(state, team);

    // Find strongest enemy
    let bestEnemyPop = 0;
    for (let t = 0; t < state.numTeams; t++) {
      if (t === team || state.eliminated[t]) continue;
      const ep = getTeamStats(state, t).pop;
      if (ep > bestEnemyPop) bestEnemyPop = ep;
    }

    // Mode selection
    if (myStats.set < 3 || myStats.walk > myStats.set * 3) {
      state.teamMode[team] = C.MODE_SETTLE;
    } else if (myStats.pop > bestEnemyPop * 1.3 && myStats.walk >= 4) {
      state.teamMode[team] = C.MODE_FIGHT;
    } else if (myStats.set >= 5 && myStats.walk < 2) {
      state.teamMode[team] = C.MODE_GATHER;
    } else {
      state.teamMode[team] = C.MODE_SETTLE;
    }

    // Powers
    if (!state.armageddon) {
      if (myStats.pop > bestEnemyPop * 2.5 && myStats.pop > 200 && mana >= 6000) {
        executePowerArmageddon(state, team);
        return;
      }

      if (mana >= 200 && state.leaders[team] >= 0) {
        const success = executePowerKnight(state, team);
        if (success) { state.mana[team] -= 200; continue; }
      }

      if (mana >= 60) {
        let enemySett = null;
        for (const s of state.settlements) {
          if (s.dead || s.team === team) continue;
          enemySett = s;
          break;
        }
        if (enemySett && Math.random() < 0.1) {
          const sx = enemySett.tx + Math.floor(Math.random() * 7) - 3;
          const sy = enemySett.ty + Math.floor(Math.random() * 7) - 3;
          if (sx >= 0 && sx < state.mapW && sy >= 0 && sy < state.mapH && isTileFlat(state, sx, sy)) {
            const ok = executePowerSwamp(state, team, sx, sy);
            if (ok) { state.mana[team] -= 60; continue; }
          }
        }
      }

      if (mana >= 1500 && Math.random() < 0.4) {
        let enemySett = null;
        for (const s of state.settlements) {
          if (s.dead || s.team === team) continue;
          if (!enemySett || s.population > enemySett.population) enemySett = s;
        }
        if (enemySett) {
          state.mana[team] -= 1500;
          executePowerEarthquake(state, team, enemySett.tx, enemySett.ty);
          continue;
        }
      }

      if (mana >= 500 && Math.random() < 0.25) {
        let lowEnemy = 0;
        for (const s of state.settlements) {
          if (s.dead || s.team === team) continue;
          if (state.heights[s.tx][s.ty] <= state.seaLevel + 1) lowEnemy++;
        }
        if (lowEnemy >= 2) {
          state.mana[team] -= 500;
          executePowerFlood(state, team);
          continue;
        }
      }

      if (mana >= 5000 && Math.random() < 0.3) {
        let bestEnemy = null;
        for (const s of state.settlements) {
          if (s.dead || s.team === team) continue;
          if (!bestEnemy || s.level > bestEnemy.level) bestEnemy = s;
        }
        if (bestEnemy && bestEnemy.level >= 5) {
          state.mana[team] -= 5000;
          executePowerVolcano(state, team, bestEnemy.tx, bestEnemy.ty);
          continue;
        }
      }
    }

    // Terrain flattening
    const ownSettlements = state.settlements.filter(s => !s.dead && s.team === team);
    if (ownSettlements.length === 0) {
      // No settlements: flatten near strongest walker to help it settle
      let bestWalker = null;
      for (const w of state.walkers) {
        if (w.dead || w.team !== team || w.isKnight) continue;
        if (!bestWalker || w.strength > bestWalker.strength) bestWalker = w;
      }
      if (!bestWalker) continue;
      const wx = Math.floor(bestWalker.x), wy = Math.floor(bestWalker.y);
      const wh = (state.heights[wx] && state.heights[wx][wy] != null) ? state.heights[wx][wy] : 1;
      aiTryFlatten(state, team, wx, wy, wh);
    } else {
      const target = ownSettlements[Math.floor(Math.random() * ownSettlements.length)];
      aiTryFlatten(state, team, target.tx, target.ty, state.heights[target.tx][target.ty]);
    }
  }
}

function aiTryFlatten(state, team, cx, cy, th) {
  const flatR = 4;
  const offsets = [];
  for (let ddx = -flatR; ddx <= flatR; ddx++) {
    for (let ddy = -flatR; ddy <= flatR; ddy++) {
      offsets.push([ddx, ddy]);
    }
  }
  for (let i = offsets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
  }

  let modsLeft = 3;
  for (const [ddx, ddy] of offsets) {
    if (modsLeft <= 0) break;
    const tx = cx + ddx, ty = cy + ddy;
    if (tx < 0 || tx >= state.mapW || ty < 0 || ty >= state.mapH) continue;
    if (isTileFlat(state, tx, ty) && state.heights[tx][ty] === th) continue;
    for (const [px, py] of [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]]) {
      if (px < 0 || px > state.mapW || py < 0 || py > state.mapH) continue;
      if (state.heights[px][py] < th && state.mana[team] >= C.TERRAIN_RAISE_COST) {
        state.mana[team] -= C.TERRAIN_RAISE_COST;
        raisePoint(state, px, py);
        modsLeft--;
        break;
      } else if (state.heights[px][py] > th && state.mana[team] >= C.TERRAIN_LOWER_COST) {
        state.mana[team] -= C.TERRAIN_LOWER_COST;
        lowerPoint(state, px, py);
        modsLeft--;
        break;
      }
    }
  }
}

// ── Module Exports ──────────────────────────────────────────────────
module.exports = {
  // State creation
  computeSpawnZones,
  createGameState,
  generateTerrain,
  spawnInitialWalkers,

  // Terrain
  raisePoint,
  lowerPoint,
  isTileWater,
  isTileFlat,
  canBuildAtPoint,
  invalidateSwamps,
  invalidateRocks,
  invalidateTrees,
  invalidatePebbles,
  invalidateRuins,

  // Walkers
  spawnWalker,
  updateWalkers,
  handleWalkerCollisions,
  pickWalkerTarget,

  // Settlements
  evaluateSettlementLevels,
  settleWalker,
  computeCrops,

  // Population & Mana
  updatePopulationGrowth,
  updateMana,

  // Stats
  getTeamStats,

  // Powers
  executePowerEarthquake,
  executePowerSwamp,
  executePowerKnight,
  executePowerVolcano,
  executePowerFlood,
  executePowerArmageddon,

  // AI
  updateAI,

  // Serialization
  computeHeightsPayload,
  serializeState,
  computeDelta,
  serializeFullState,
  serializeReplaySnapshot,

  // Entity management
  pruneDeadEntities,
  queueSfx,
};
