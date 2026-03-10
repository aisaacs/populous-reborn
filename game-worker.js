'use strict';

const { parentPort } = require('worker_threads');
const { performance } = require('perf_hooks');
const C = require('./shared/constants');
const G = require('./game-simulation');

// Active game rooms managed by this worker
const rooms = new Map(); // roomCode → { state, interval, aiCount, aiTimer, players, needsFullSnapshot, replay }

const dt = 1 / C.TICK_RATE;
const REPLAY_SNAPSHOT_INTERVAL = C.TICK_RATE; // 1 full snapshot per second

parentPort.on('message', (msg) => {
  switch (msg.type) {
    case 'start_game':
      handleStartGame(msg);
      break;
    case 'player_input':
      handlePlayerInput(msg);
      break;
    case 'remove_room':
      handleRemoveRoom(msg);
      break;
    case 'player_disconnect':
      handlePlayerDisconnect(msg);
      break;
    case 'resync':
      handleResync(msg);
      break;
  }
});

function handleStartGame(msg) {
  const { roomCode, maxPlayers, mapW, mapH, terrainType, aiCount, aiTeams } = msg;

  const state = G.createGameState(mapW, mapH, maxPlayers, terrainType);
  G.generateTerrain(state);
  G.spawnInitialWalkers(state);

  const room = {
    code: roomCode,
    state,
    maxPlayers,
    aiCount: aiCount || 0,
    aiTimer: 0,
    // Track which teams are AI (null = AI, non-null = human)
    players: new Array(maxPlayers).fill(null),
    needsFullSnapshot: new Array(maxPlayers).fill(true),
    interval: null,
    replay: {
      meta: { roomCode, maxPlayers, mapW, mapH, terrainType, aiCount, aiTeams, startedAt: Date.now() },
      frames: [],
    },
  };

  // Mark human players
  if (aiTeams) {
    for (let i = 0; i < maxPlayers; i++) {
      room.players[i] = aiTeams[i] ? null : 'human';
    }
  }

  rooms.set(roomCode, room);
  startTick(room);
}

function startTick(room) {
  const state = room.state;

  room.interval = setInterval(() => {
    if (state.gameOver) return;
    const _tickStart = performance.now();

    G.updateWalkers(state, dt);
    G.handleWalkerCollisions(state);
    G.processPendingEffects(state, dt);
    G.updateMana(state, dt);

    // AI update — room already has aiTimer, maxPlayers, players that updateAI expects
    if (room.aiCount > 0) {
      G.updateAI(state, room, dt);
    }

    G.computeCrops(state);

    if (!state.armageddon) {
      state.levelEvalTimer += dt;
      if (state.levelEvalTimer >= 1.0) {
        state.levelEvalTimer = 0;
        G.evaluateSettlementLevels(state);
      }

      G.updatePopulationGrowth(state, dt);
    }

    // Age and prune fires
    for (const f of state.fires) f.age += dt;
    state.fires = state.fires.filter(f => f.age < 5.0);

    state.pruneTimer += dt;
    if (state.pruneTimer >= 3.0) {
      state.pruneTimer = 0;
      G.pruneDeadEntities(state);
    }

    // Win condition: last team standing (after 30s grace)
    state._tickCount++;
    if (!state.gameOver && state._tickCount > C.TICK_RATE * 30) {
      const aliveTeams = [];
      for (let t = 0; t < state.numTeams; t++) {
        if (state.eliminated[t]) continue;
        const stats = G.getTeamStats(state, t);
        if (stats.pop > 0) {
          aliveTeams.push(t);
        } else {
          state.eliminated[t] = true;
        }
      }
      if (aliveTeams.length <= 1) {
        state.gameOver = true;
        state.winner = aliveTeams.length === 1 ? aliveTeams[0] : -1;
      }
    }

    // Serialize state for each team
    const heightsPayload = G.computeHeightsPayload(state);

    // Record replay snapshot (1 per second) — uses full heights, after normal delta tracking
    if (state._tickCount % REPLAY_SNAPSHOT_INTERVAL === 0) {
      const W = state.mapW, H = state.mapH;
      const flatH = [];
      for (let y = 0; y <= H; y++)
        for (let x = 0; x <= W; x++)
          flatH.push(state.heights[x][y]);
      room.replay.frames.push(G.serializeReplaySnapshot(state, { full: flatH }));
    }
    const periodicFull = state._fullSnapshotCounter >= 100;

    // Check if all players need full snapshot
    let allNeedFull = periodicFull;
    if (!allNeedFull) {
      allNeedFull = true;
      for (let i = 0; i < room.maxPlayers; i++) {
        if (room.players[i] !== null && !room.needsFullSnapshot[i]) {
          allNeedFull = false;
          break;
        }
      }
    }

    // Compute shared delta once if anyone will use it
    let sharedDelta = null;
    if (!allNeedFull) {
      sharedDelta = G.computeDelta(state, heightsPayload);
    }

    // Build per-team serialized messages
    const teamMessages = {};
    for (let i = 0; i < room.maxPlayers; i++) {
      if (room.players[i] === null) continue; // Skip AI teams

      let json;
      if (room.needsFullSnapshot[i] || periodicFull) {
        const msg = G.serializeFullState(state, i, heightsPayload);
        json = JSON.stringify(msg);
        room.needsFullSnapshot[i] = false;
      } else {
        const msg = Object.assign({}, sharedDelta);
        msg.mana = Math.floor(state.mana[i]);
        msg.team = i;
        msg.numTeams = state.numTeams;
        msg.mapW = state.mapW;
        msg.mapH = state.mapH;
        json = JSON.stringify(msg);
      }
      teamMessages[i] = json;
    }

    if (periodicFull) state._fullSnapshotCounter = 0;
    else state._fullSnapshotCounter++;

    state.sfxQueue = [];

    const _tickEnd = performance.now();
    const tickTimeMs = _tickEnd - _tickStart;

    // Compute game stats for admin
    let walkerCount = 0, settlementCount = 0, totalPop = 0;
    for (const w of state.walkers) if (!w.dead) walkerCount++;
    for (const s of state.settlements) if (!s.dead) { settlementCount++; totalPop += s.population; }

    // Send state back to main thread
    parentPort.postMessage({
      type: 'state',
      roomCode: room.code,
      teamMessages,
      tickTimeMs,
      walkers: walkerCount,
      settlements: settlementCount,
      totalPop,
    });

    // Send game over if needed
    if (state.gameOver) {
      // Capture final replay frame (full heights, no delta tracking)
      const W = state.mapW, H = state.mapH;
      const flatH = [];
      for (let y = 0; y <= H; y++)
        for (let x = 0; x <= W; x++)
          flatH.push(state.heights[x][y]);
      room.replay.frames.push(G.serializeReplaySnapshot(state, { full: flatH }));
      room.replay.meta.endedAt = Date.now();
      room.replay.meta.winner = state.winner;
      room.replay.meta.durationTicks = state._tickCount;

      parentPort.postMessage({
        type: 'gameover',
        roomCode: room.code,
        winner: state.winner,
        replay: room.replay,
      });
      clearInterval(room.interval);
      room.interval = null;
    }
  }, C.TICK_INTERVAL);
}

function handlePlayerInput(msg) {
  const room = rooms.get(msg.roomCode);
  if (!room || room.state.gameOver) return;

  const state = room.state;
  const team = msg.team;
  const input = msg.msg;

  switch (input.type) {
    case 'raise': {
      if (state.armageddon) return;
      const { px, py } = input;
      if (typeof px !== 'number' || typeof py !== 'number') return;
      if (px < 0 || px > state.mapW || py < 0 || py > state.mapH) return;
      if (!G.canBuildAtPoint(state, team, px, py)) return;
      if (state.mana[team] < C.TERRAIN_RAISE_COST) return;
      state.mana[team] -= C.TERRAIN_RAISE_COST;
      G.raisePoint(state, px, py);
      G.invalidateSwamps(state);
      G.invalidateRocks(state);
      G.invalidateTrees(state);
      G.invalidatePebbles(state);
      G.invalidateRuins(state);
      G.evaluateSettlementLevels(state);
      break;
    }

    case 'lower': {
      if (state.armageddon) return;
      const { px, py } = input;
      if (typeof px !== 'number' || typeof py !== 'number') return;
      if (px < 0 || px > state.mapW || py < 0 || py > state.mapH) return;
      if (!G.canBuildAtPoint(state, team, px, py)) return;
      if (state.mana[team] < C.TERRAIN_LOWER_COST) return;
      state.mana[team] -= C.TERRAIN_LOWER_COST;
      G.lowerPoint(state, px, py);
      G.invalidateSwamps(state);
      G.invalidateRocks(state);
      G.invalidateTrees(state);
      G.invalidatePebbles(state);
      G.invalidateRuins(state);
      G.evaluateSettlementLevels(state);
      break;
    }

    case 'power': {
      if (state.armageddon) return;
      const powerDef = C.POWERS.find(p => p.id === input.power);
      if (!powerDef) return;
      if (state.mana[team] < powerDef.cost) return;
      if (powerDef.targeted) {
        const { x, y } = input;
        if (typeof x !== 'number' || typeof y !== 'number') return;
        if (x < 0 || x > state.mapW || y < 0 || y > state.mapH) return;
      }
      let success = true;
      switch (powerDef.id) {
        case 'lightning':
          G.executePowerLightning(state, team, input.x, input.y);
          break;
        case 'earthquake':
          G.executePowerEarthquake(state, team, input.x, input.y);
          break;
        case 'swamp':
          success = G.executePowerSwamp(state, team, Math.floor(input.x), Math.floor(input.y));
          break;
        case 'knight':
          success = G.executePowerKnight(state, team);
          break;
        case 'meteor':
          G.executePowerMeteor(state, team, input.x, input.y);
          break;
        case 'volcano':
          G.executePowerVolcano(state, team, input.x, input.y);
          break;
        case 'flood':
          G.executePowerFlood(state, team);
          break;
        case 'armageddon':
          G.executePowerArmageddon(state, team);
          break;
      }
      if (success !== false) {
        if (powerDef.id === 'armageddon') {
          state.mana[team] = 0;
        } else {
          state.mana[team] -= powerDef.cost;
        }
      }
      break;
    }

    case 'mode': {
      if (state.armageddon) return;
      const mode = input.mode;
      if (typeof mode !== 'number' || mode < 0 || mode > 2) return;
      state.teamMode[team] = mode;
      break;
    }

    case 'magnet': {
      if (state.armageddon) return;
      if (state.magnetLocked[team]) return;
      const { x, y } = input;
      if (typeof x !== 'number' || typeof y !== 'number') return;
      state.magnetPos[team] = { x, y };
      const mx = Math.floor(x), my = Math.floor(y);
      const mkey = mx + ',' + my;
      if (state.swampSet.has(mkey)) {
        state.swamps = state.swamps.filter(sw => !(sw.x === mx && sw.y === my));
        state.swampSet.delete(mkey);
      }
      break;
    }

    case 'godmode': {
      state.mana[team] = 999999;
      break;
    }
  }
}

function handlePlayerDisconnect(msg) {
  const room = rooms.get(msg.roomCode);
  if (!room) return;

  const team = msg.team;
  room.state.eliminated[team] = true;
  room.players[team] = null;

  // Check if game should end
  const aliveTeams = [];
  for (let t = 0; t < room.maxPlayers; t++) {
    if (room.state.eliminated[t]) continue;
    const stats = G.getTeamStats(room.state, t);
    if (stats.pop > 0) aliveTeams.push(t);
  }

  // If no humans left at all, remove the room
  let anyHuman = false;
  for (let i = 0; i < room.maxPlayers; i++) {
    if (room.players[i] !== null) { anyHuman = true; break; }
  }

  if (!anyHuman) {
    handleRemoveRoom({ roomCode: msg.roomCode });
    parentPort.postMessage({ type: 'room_removed', roomCode: msg.roomCode });
    return;
  }

  // For non-AI rooms, check end condition
  if (room.aiCount === 0) {
    let humansAlive = 0;
    for (let t = 0; t < room.maxPlayers; t++) {
      if (room.players[t] !== null && !room.state.eliminated[t]) humansAlive++;
    }
    if (humansAlive <= 1 && aliveTeams.length <= 1) {
      room.state.gameOver = true;
      room.state.winner = aliveTeams.length === 1 ? aliveTeams[0] : -1;
      parentPort.postMessage({
        type: 'gameover',
        roomCode: msg.roomCode,
        winner: room.state.winner,
      });
      if (room.interval) {
        clearInterval(room.interval);
        room.interval = null;
      }
    }
  }
}

function handleResync(msg) {
  const room = rooms.get(msg.roomCode);
  if (!room) return;
  room.needsFullSnapshot[msg.team] = true;
}

function handleRemoveRoom(msg) {
  const room = rooms.get(msg.roomCode);
  if (!room) return;
  if (room.interval) clearInterval(room.interval);
  rooms.delete(msg.roomCode);
}
