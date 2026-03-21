'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { performance } = require('perf_hooks');
const { Worker } = require('worker_threads');
const os = require('os');
const zlib = require('zlib');
const C = require('./shared/constants');
const G = require('./game-simulation');

// ── Replay Directory ──────────────────────────────────────────────
const REPLAY_DIR = path.join(__dirname, 'data', 'replays');
fs.mkdirSync(REPLAY_DIR, { recursive: true });

// ── HTTP Static File Server ─────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.mp3':  'audio/mpeg',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.json': 'application/json',
  '.md':   'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let filePath;
  const url = req.url.split('?')[0];

  if (url === '/admin') {
    filePath = path.join(__dirname, 'public', 'admin.html');
  } else if (url.startsWith('/shared/')) {
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

const PORT = process.env.PORT || 4321;
server.listen(PORT, () => {
  console.log(`The Flattening server running on http://localhost:${PORT}`);
});

// ── Room Management ─────────────────────────────────────────────────
const rooms = new Map();
const lobbyClients = new Set();       // ws connections in lobby (not in a game)
const playerNames = new WeakMap();    // ws → name string

// ── Admin Metrics ───────────────────────────────────────────────────
const serverStartTime = Date.now();
const adminClients = new Set();
const roomMetrics = new Map();        // room code → metrics object

let serverBytesInAcc = 0, serverBytesOutAcc = 0;
let serverBytesInRate = 0, serverBytesOutRate = 0;

// History ring buffer for graphs (last 60 data points = 60 seconds)
const HISTORY_LEN = 60;
const history = {
  tickLoad: new Array(HISTORY_LEN).fill(0),
  memory: new Array(HISTORY_LEN).fill(0),
  connections: new Array(HISTORY_LEN).fill(0),
  netIn: new Array(HISTORY_LEN).fill(0),
  netOut: new Array(HISTORY_LEN).fill(0),
  games: new Array(HISTORY_LEN).fill(0),
  idx: 0,
};

// ── Worker Thread Pool ─────────────────────────────────────────────
const NUM_WORKERS = parseInt(process.env.WORKERS) || Math.max(1, os.cpus().length - 1);
const workers = [];
const workerLoad = new Map();          // worker index → number of active rooms
const roomWorkerMap = new Map();       // roomCode → worker index
const workerMetrics = new Map();       // worker index → { msgsIn, msgsOut, bytesOut, tickTimeAvg }

function spawnWorker(index) {
  const worker = new Worker('./game-worker.js');
  workerLoad.set(index, 0);
  workerMetrics.set(index, { msgsInAcc: 0, msgsOutAcc: 0, bytesOutAcc: 0, tickTimeAvg: 0, msgsInRate: 0, msgsOutRate: 0, bytesOutRate: 0 });

  worker.on('message', (msg) => {
    const wm = workerMetrics.get(index);
    wm.msgsOutAcc++;

    switch (msg.type) {
      case 'state': {
        const room = rooms.get(msg.roomCode);
        if (!room) return;
        const _rm = getOrCreateRoomMetrics(msg.roomCode);
        _rm.tickTimeMs = msg.tickTimeMs;
        _rm.tickTimeAvg = _rm.tickTimeAvg * 0.9 + msg.tickTimeMs * 0.1;
        _rm.walkers = msg.walkers;
        _rm.settlements = msg.settlements;
        _rm.totalPop = msg.totalPop;
        wm.tickTimeAvg = wm.tickTimeAvg * 0.95 + msg.tickTimeMs * 0.05;
        for (const [teamStr, data] of Object.entries(msg.teamMessages)) {
          const team = parseInt(teamStr);
          const ws = room.players[team];
          if (!ws || ws.readyState !== 1) continue;
          const size = typeof data === 'string' ? data.length : data.byteLength;
          _rm.bytesSentAcc += size;
          _rm.msgsSentAcc++;
          serverBytesOutAcc += size;
          wm.bytesOutAcc += size;
          ws.send(data);
        }
        break;
      }

      case 'gameover': {
        const room = rooms.get(msg.roomCode);
        if (!room) return;
        room.state = { gameOver: true, winner: msg.winner };
        room.endedAt = Date.now();
        let winnerName = null;
        if (msg.winner >= 0) {
          const winnerWs = room.players[msg.winner];
          winnerName = winnerWs
            ? (playerNames.get(winnerWs) || C.TEAM_NAMES[msg.winner])
            : C.TEAM_NAMES[msg.winner];
        }
        const goMsg = JSON.stringify({ type: 'gameover', winner: msg.winner, winnerName });
        for (let i = 0; i < room.maxPlayers; i++) {
          const ws = room.players[i];
          if (ws && ws.readyState === 1) ws.send(goMsg);
        }

        // Save replay
        if (msg.replay && msg.replay.frames.length > 0) {
          saveReplay(msg.roomCode, msg.replay);
        }

        cleanupRoom(msg.roomCode);
        break;
      }

      case 'room_removed': {
        const load = workerLoad.get(index) || 0;
        workerLoad.set(index, Math.max(0, load - 1));
        roomWorkerMap.delete(msg.roomCode);
        break;
      }
    }
  });

  worker.on('error', (err) => {
    console.error(`Worker ${index} error:`, err);
  });

  worker.on('exit', (code) => {
    console.error(`Worker ${index} exited with code ${code}, respawning...`);
    workers[index] = spawnWorker(index);
    // Rooms on this worker are lost
  });

  workers[index] = worker;
  return worker;
}

function getLeastLoadedWorker() {
  let minLoad = Infinity, minIdx = 0;
  for (let i = 0; i < workers.length; i++) {
    const load = workerLoad.get(i) || 0;
    if (load < minLoad) { minLoad = load; minIdx = i; }
  }
  return minIdx;
}

function sendToRoomWorker(roomCode, msg) {
  const workerIdx = roomWorkerMap.get(roomCode);
  if (workerIdx === undefined) return;
  const wm = workerMetrics.get(workerIdx);
  if (wm) wm.msgsInAcc++;
  workers[workerIdx].postMessage(msg);
}

// Spawn workers
for (let i = 0; i < NUM_WORKERS; i++) spawnWorker(i);
console.log(`Spawned ${NUM_WORKERS} game worker threads`);

function getOrCreateRoomMetrics(code) {
  let m = roomMetrics.get(code);
  if (!m) {
    m = { tickTimeMs: 0, tickTimeAvg: 0, bytesSentAcc: 0, msgsSentAcc: 0, bytesSentRate: 0, msgsSentRate: 0 };
    roomMetrics.set(code, m);
  }
  return m;
}

function sanitizeName(name) {
  if (!name || typeof name !== 'string') return 'Player';
  return name.replace(/[<>&"']/g, '').trim().slice(0, 16) || 'Player';
}

const chatRateMap = new WeakMap(); // ws → array of timestamps
function chatAllowed(ws) {
  const now = Date.now();
  let times = chatRateMap.get(ws);
  if (!times) { times = []; chatRateMap.set(ws, times); }
  // Remove entries older than 10s
  while (times.length && times[0] < now - 10000) times.shift();
  if (times.length >= 5) return false;
  times.push(now);
  return true;
}

function buildGameList() {
  const games = [];
  for (const [code, room] of rooms) {
    if (!room.isPublic || room.started) continue;
    let humanCount = 0;
    for (let i = 0; i < room.maxPlayers; i++) {
      if (room.players[i] !== null) humanCount++;
    }
    games.push({
      code,
      name: room.name || '',
      players: humanCount + room.aiCount,
      maxPlayers: room.maxPlayers,
      mapSize: room.mapSize || 'small',
      terrainType: room.terrainType || 'continental',
      creatorName: room.creatorName || 'Player',
    });
  }
  return games;
}

function broadcastGameList() {
  const msg = JSON.stringify({ type: 'game_list', games: buildGameList() });
  for (const c of lobbyClients) {
    if (c.readyState === 1) c.send(msg);
  }
}

function broadcastLobbyChat(name, text) {
  const msg = JSON.stringify({ type: 'lobby_chat', name, text, time: Date.now() });
  for (const c of lobbyClients) {
    if (c.readyState === 1) c.send(msg);
  }
}

function broadcastLobbyCount() {
  const msg = JSON.stringify({ type: 'lobby_count', count: lobbyClients.size });
  for (const c of lobbyClients) {
    if (c.readyState === 1) c.send(msg);
  }
}

function broadcastLobbySystem(text) {
  const msg = JSON.stringify({ type: 'lobby_system', text, time: Date.now() });
  for (const c of lobbyClients) {
    if (c.readyState === 1) c.send(msg);
  }
}

function broadcastWaitingUpdate(room) {
  let humanCount = 0;
  const names = [];
  for (let i = 0; i < room.maxPlayers; i++) {
    if (room.players[i] !== null) {
      humanCount++;
      names.push(playerNames.get(room.players[i]) || 'Player');
    }
  }
  const msg = JSON.stringify({
    type: 'waiting_update',
    connectedPlayers: humanCount + room.aiCount,
    maxPlayers: room.maxPlayers,
    playerNames: names,
    aiCount: room.aiCount,
  });
  for (let i = 0; i < room.maxPlayers; i++) {
    if (room.players[i] && room.players[i].readyState === 1) {
      room.players[i].send(msg);
    }
  }
}

// Periodic game list broadcast every 30s
setInterval(broadcastGameList, 30000);

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * 26)];
  } while (rooms.has(code));
  return code;
}

function createRoom(maxPlayers, mapSize, opts) {
  opts = opts || {};
  const code = generateRoomCode();
  maxPlayers = Math.max(2, Math.min(C.MAX_TEAMS, maxPlayers || 2));
  const preset = C.MAP_SIZE_PRESETS[mapSize] || C.MAP_SIZE_PRESETS.small;
  const room = {
    code,
    players: new Array(maxPlayers).fill(null),
    maxPlayers,
    mapSize: mapSize || 'small',
    mapW: preset.w,
    mapH: preset.h,
    state: null,
    tickInterval: null,
    started: false,
    ai: false,
    aiCount: 0,
    aiTimer: 0,
    name: sanitizeName(opts.gameName) || '',
    isPublic: !!opts.isPublic,
    terrainType: opts.terrainType || 'continental',
    creatorName: opts.creatorName || 'Player',
    chatLog: [],
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.tickInterval) clearInterval(room.tickInterval);
  // Notify worker to clean up
  const workerIdx = roomWorkerMap.get(code);
  if (workerIdx !== undefined) {
    workers[workerIdx].postMessage({ type: 'remove_room', roomCode: code });
    workerLoad.set(workerIdx, Math.max(0, (workerLoad.get(workerIdx) || 0) - 1));
    roomWorkerMap.delete(code);
  }
  rooms.delete(code);
  roomMetrics.delete(code);
}

// ── Game Simulation (imported from game-simulation.js) ─────────────
const { computeSpawnZones, getTeamStats } = G;

// ── Start Game (delegates to worker thread) ────────────────────────
function startGame(room) {
  room.state = { gameOver: false, winner: -1, eliminated: new Array(room.maxPlayers).fill(false) };
  room.started = true;

  // Determine which teams are AI
  const aiTeams = [];
  for (let i = 0; i < room.maxPlayers; i++) {
    aiTeams[i] = room.players[i] === null; // null slot = AI
  }

  // Assign to least-loaded worker
  const workerIdx = getLeastLoadedWorker();
  roomWorkerMap.set(room.code, workerIdx);
  workerLoad.set(workerIdx, (workerLoad.get(workerIdx) || 0) + 1);

  workers[workerIdx].postMessage({
    type: 'start_game',
    roomCode: room.code,
    maxPlayers: room.maxPlayers,
    mapW: room.mapW,
    mapH: room.mapH,
    terrainType: room.terrainType,
    aiCount: room.aiCount,
    aiTeams,
  });
}

// ── WebSocket Handler ───────────────────────────────────────────────
const wss = new WebSocketServer({ server, perMessageDeflate: true });

// ── Sprite Config Live Reload ─────────────────────────────────────
const SPRITE_CONFIG_PATH = path.join(__dirname, 'public', 'sprite-config.json');
try {
  fs.watch(SPRITE_CONFIG_PATH, { persistent: false }, () => {
    try {
      const config = JSON.parse(fs.readFileSync(SPRITE_CONFIG_PATH, 'utf8'));
      const msg = JSON.stringify({ type: 'sprite_config', config });
      for (const c of wss.clients) {
        if (c.readyState === 1) c.send(msg);
      }
      console.log('[sprite-config] pushed to', wss.clients.size, 'clients');
    } catch(e) { /* ignore parse errors during save */ }
  });
} catch(e) { console.warn('[sprite-config] watch failed:', e.message); }

wss.on('connection', (ws) => {
  let playerRoom = null;
  let playerTeam = -1;

  // Add to lobby clients and send current game list
  lobbyClients.add(ws);
  ws._lobbyAnnounced = false;
  ws.send(JSON.stringify({ type: 'game_list', games: buildGameList() }));
  broadcastLobbyCount();

  ws.on('message', (raw) => {
    serverBytesInAcc += (typeof raw === 'string' ? raw.length : raw.byteLength || 0);
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'set_name': {
        const name = sanitizeName(msg.name);
        const oldName = playerNames.get(ws);
        playerNames.set(ws, name);
        if (lobbyClients.has(ws)) {
          if (!ws._lobbyAnnounced) {
            ws._lobbyAnnounced = true;
            broadcastLobbySystem(name + ' has joined');
          } else if (oldName && oldName !== name) {
            broadcastLobbySystem(oldName + ' is now known as ' + name);
          }
        }
        break;
      }

      case 'request_game_list': {
        ws.send(JSON.stringify({ type: 'game_list', games: buildGameList() }));
        break;
      }

      case 'lobby_chat': {
        if (!lobbyClients.has(ws)) return;
        if (!chatAllowed(ws)) return;
        const text = (msg.text || '').replace(/[<>&"']/g, '').trim().slice(0, 200);
        if (!text) return;
        const name = playerNames.get(ws) || 'Player';
        broadcastLobbyChat(name, text);
        break;
      }

      case 'room_chat': {
        if (!playerRoom || playerRoom.started) return;
        if (!chatAllowed(ws)) return;
        const text = (msg.text || '').replace(/[<>&"']/g, '').trim().slice(0, 200);
        if (!text) return;
        const name = playerNames.get(ws) || 'Player';
        const chatEntry = { name, text, time: Date.now() };
        playerRoom.chatLog.push(chatEntry);
        if (playerRoom.chatLog.length > 100) playerRoom.chatLog.shift();
        const chatMsg = JSON.stringify({ type: 'room_chat', name, text, time: chatEntry.time });
        for (let i = 0; i < playerRoom.maxPlayers; i++) {
          if (playerRoom.players[i] && playerRoom.players[i].readyState === 1) {
            playerRoom.players[i].send(chatMsg);
          }
        }
        break;
      }

      case 'add_ai': {
        if (!playerRoom || playerRoom.started) return;
        if (playerTeam !== 0) return; // Only creator
        let humanCount = 0;
        for (let i = 0; i < playerRoom.maxPlayers; i++) {
          if (playerRoom.players[i] !== null) humanCount++;
        }
        if (humanCount + playerRoom.aiCount >= playerRoom.maxPlayers) return;
        playerRoom.ai = true;
        playerRoom.aiCount++;
        broadcastWaitingUpdate(playerRoom);
        if (playerRoom.isPublic) broadcastGameList();
        break;
      }

      case 'remove_ai': {
        if (!playerRoom || playerRoom.started) return;
        if (playerTeam !== 0) return; // Only creator
        if (playerRoom.aiCount <= 0) return;
        playerRoom.aiCount--;
        if (playerRoom.aiCount === 0) playerRoom.ai = false;
        broadcastWaitingUpdate(playerRoom);
        if (playerRoom.isPublic) broadcastGameList();
        break;
      }

      case 'start_game': {
        if (!playerRoom || playerRoom.started) return;
        if (playerTeam !== 0) return; // Only host can start
        // Need at least 2 participants (humans + AI)
        let humanCount = 0;
        for (let i = 0; i < playerRoom.maxPlayers; i++) {
          if (playerRoom.players[i] !== null) humanCount++;
        }
        if (humanCount + playerRoom.aiCount < 2) return;
        // Fill remaining slots with AI
        const slotsNeeded = playerRoom.maxPlayers - humanCount - playerRoom.aiCount;
        playerRoom.aiCount += slotsNeeded;
        if (playerRoom.aiCount > 0) playerRoom.ai = true;
        const spawnZones = computeSpawnZones(playerRoom.mapW, playerRoom.mapH, playerRoom.maxPlayers);
        const names = [];
        for (let i = 0; i < playerRoom.maxPlayers; i++) {
          names[i] = playerRoom.players[i]
            ? (playerNames.get(playerRoom.players[i]) || C.TEAM_NAMES[i])
            : C.TEAM_NAMES[i];
        }
        for (let i = 0; i < playerRoom.maxPlayers; i++) {
          if (playerRoom.players[i] && playerRoom.players[i].readyState === 1) {
            playerRoom.players[i].send(JSON.stringify({
              type: 'start',
              team: i,
              numTeams: playerRoom.maxPlayers,
              mapW: playerRoom.mapW,
              mapH: playerRoom.mapH,
              spawnZones,
              playerNames: names,
            }));
          }
        }
        startGame(playerRoom);
        if (playerRoom.isPublic) broadcastGameList();
        break;
      }

      case 'create': {
        const maxPlayers = Math.max(2, Math.min(C.MAX_TEAMS, msg.maxPlayers || 2));
        const mapSize = msg.mapSize || 'small';
        const terrainType = msg.terrainType || 'continental';
        const pName = sanitizeName(msg.playerName);
        playerNames.set(ws, pName);
        const room = createRoom(maxPlayers, mapSize, {
          gameName: msg.gameName,
          isPublic: msg.isPublic,
          terrainType,
          creatorName: pName,
        });
        room.players[0] = ws;
        playerRoom = room;
        playerTeam = 0;
        lobbyClients.delete(ws);
        broadcastLobbySystem(pName + ' has left');
        broadcastLobbyCount();
        ws.send(JSON.stringify({
          type: 'created',
          code: room.code,
          team: 0,
          maxPlayers: room.maxPlayers,
          mapW: room.mapW,
          mapH: room.mapH,
          gameName: room.name,
        }));
        broadcastWaitingUpdate(room);
        if (room.isPublic) broadcastGameList();
        console.log(`Room ${room.code} created (${maxPlayers}p, ${mapSize}, ${room.isPublic ? 'public' : 'private'})`);
        break;
      }

      case 'create_ai': {
        const maxPlayers = Math.max(2, Math.min(C.MAX_TEAMS, msg.maxPlayers || 2));
        const mapSize = msg.mapSize || 'small';
        const terrainType = msg.terrainType || 'continental';
        const pName = sanitizeName(msg.playerName);
        playerNames.set(ws, pName);
        const room = createRoom(maxPlayers, mapSize, { terrainType, creatorName: pName });
        room.players[0] = ws;
        room.ai = true;
        room.aiCount = maxPlayers - 1;
        playerRoom = room;
        playerTeam = 0;
        lobbyClients.delete(ws);
        broadcastLobbySystem(pName + ' has left');
        broadcastLobbyCount();
        const spawnZones = computeSpawnZones(room.mapW, room.mapH, maxPlayers);
        const names = [pName];
        for (let i = 1; i < maxPlayers; i++) names[i] = C.TEAM_NAMES[i];
        ws.send(JSON.stringify({
          type: 'start',
          team: 0,
          numTeams: maxPlayers,
          mapW: room.mapW,
          mapH: room.mapH,
          spawnZones,
          playerNames: names,
        }));
        startGame(room);
        console.log(`Room ${room.code} created (vs ${room.aiCount} AI, ${mapSize})`);
        break;
      }

      case 'join': {
        const code = (msg.code || '').toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        if (room.started) {
          ws.send(JSON.stringify({ type: 'error', message: 'Game already started' }));
          return;
        }

        const pName = sanitizeName(msg.playerName);
        playerNames.set(ws, pName);

        // If room has AI and a human is joining, displace one AI slot
        let slot = -1;
        for (let i = 0; i < room.maxPlayers; i++) {
          if (room.players[i] === null) { slot = i; break; }
        }
        if (slot < 0 && room.aiCount > 0) {
          // Displace one AI to make room for human
          room.aiCount--;
          if (room.aiCount === 0) room.ai = false;
          // Find first empty slot now (there should be one since we reduced AI)
          for (let i = 0; i < room.maxPlayers; i++) {
            if (room.players[i] === null) { slot = i; break; }
          }
        }
        if (slot < 0) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
          return;
        }
        room.players[slot] = ws;
        playerRoom = room;
        playerTeam = slot;
        const joinLeaveName = playerNames.get(ws) || 'Player';
        lobbyClients.delete(ws);
        broadcastLobbySystem(joinLeaveName + ' has left');
        broadcastLobbyCount();
        ws.send(JSON.stringify({
          type: 'joined',
          code: room.code,
          team: slot,
          maxPlayers: room.maxPlayers,
          mapW: room.mapW,
          mapH: room.mapH,
          gameName: room.name,
          chatLog: room.chatLog,
        }));
        console.log(`Player joined room ${room.code} as team ${slot}`);

        broadcastWaitingUpdate(room);
        if (room.isPublic) broadcastGameList();

        // Count connected players + AI
        break;
      }

      case 'raise':
      case 'lower':
      case 'power':
      case 'mode':
      case 'godmode':
      case 'magnet': {
        if (!playerRoom || !playerRoom.started || playerRoom.state.gameOver) return;
        sendToRoomWorker(playerRoom.code, {
          type: 'player_input',
          roomCode: playerRoom.code,
          team: playerTeam,
          msg,
        });
        break;
      }

      case 'resync': {
        if (!playerRoom || !playerRoom.started) return;
        sendToRoomWorker(playerRoom.code, {
          type: 'resync',
          roomCode: playerRoom.code,
          team: playerTeam,
        });
        break;
      }

      case 'admin_subscribe': {
        adminClients.add(ws);
        const snap = buildAdminSnapshot();
        snap.history = {
          tickLoad: reorderRing(history.tickLoad, history.idx),
          memory: reorderRing(history.memory, history.idx),
          connections: reorderRing(history.connections, history.idx),
          netIn: reorderRing(history.netIn, history.idx),
          netOut: reorderRing(history.netOut, history.idx),
          games: reorderRing(history.games, history.idx),
        };
        ws.send(JSON.stringify(snap));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (lobbyClients.has(ws)) {
      const leaveName = playerNames.get(ws) || 'Player';
      lobbyClients.delete(ws);
      broadcastLobbySystem(leaveName + ' has left');
      broadcastLobbyCount();
    } else {
      lobbyClients.delete(ws);
    }
    adminClients.delete(ws);

    if (!playerRoom) return;
    const room = playerRoom;

    if (room.started && !room.state.gameOver) {
      room.state.eliminated[playerTeam] = true;
      room.players[playerTeam] = null;

      // Notify worker about the disconnect
      sendToRoomWorker(room.code, {
        type: 'player_disconnect',
        roomCode: room.code,
        team: playerTeam,
      });
    } else if (!room.started) {
      // Remove from waiting room
      room.players[playerTeam] = null;
      let connected = 0;
      for (let i = 0; i < room.maxPlayers; i++) {
        if (room.players[i] !== null) connected++;
      }
      if (connected === 0) {
        cleanupRoom(room.code);
        broadcastGameList();
      } else {
        broadcastWaitingUpdate(room);
        if (room.isPublic) broadcastGameList();
      }
      return;
    }

    // Check if all humans disconnected from a started game
    let anyHuman = false;
    for (let i = 0; i < room.maxPlayers; i++) {
      if (room.players[i] !== null) { anyHuman = true; break; }
    }
    if (!anyHuman) cleanupRoom(room.code);

    console.log(`Player ${playerTeam} left room ${room.code}`);
  });
});

// ── Replay Saving ──────────────────────────────────────────────────
function saveReplay(roomCode, replay) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${ts}_${roomCode}.json.gz`;
  const filePath = path.join(REPLAY_DIR, filename);
  const json = JSON.stringify(replay);
  zlib.gzip(json, (err, compressed) => {
    if (err) {
      console.error(`Failed to compress replay ${roomCode}:`, err.message);
      return;
    }
    fs.writeFile(filePath, compressed, (err) => {
      if (err) {
        console.error(`Failed to save replay ${roomCode}:`, err.message);
      } else {
        const sizeMB = (compressed.length / 1024 / 1024).toFixed(2);
        console.log(`Replay saved: ${filename} (${replay.frames.length} frames, ${sizeMB}MB)`);
      }
    });
  });
}

// ── Admin Snapshot & Broadcast ──────────────────────────────────────
function buildAdminSnapshot() {
  const mem = process.memoryUsage();
  const gamesList = [];
  let totalTickLoad = 0;
  let activeGames = 0;

  for (const [code, room] of rooms) {
    const m = roomMetrics.get(code) || { tickTimeAvg: 0, bytesSentRate: 0, msgsSentRate: 0 };
    let humanCount = 0;
    for (let i = 0; i < room.maxPlayers; i++) {
      if (room.players[i] !== null) humanCount++;
    }

    const endTime = room.endedAt || Date.now();
    const g = {
      code,
      name: room.name || '',
      status: room.started ? (room.state && room.state.gameOver ? 'ended' : 'playing') : 'waiting',
      humans: humanCount,
      maxPlayers: room.maxPlayers,
      aiCount: room.aiCount,
      mapSize: room.mapSize,
      duration: room.createdAt ? Math.floor((endTime - room.createdAt) / 1000) : 0,
      tickTimeMs: Math.round(m.tickTimeAvg * 100) / 100,
      bytesSentRate: m.bytesSentRate,
      msgsSentRate: m.msgsSentRate,
      walkers: m.walkers,
      settlements: m.settlements,
      totalPop: m.totalPop,
      workerIdx: roomWorkerMap.get(code),
    };

    if (room.started) {
      totalTickLoad += m.tickTimeAvg;
      activeGames++;
    }

    gamesList.push(g);
  }

  const tickLoad = activeGames > 0 ? Math.round(totalTickLoad / C.TICK_INTERVAL * 100 * 10) / 10 : 0;
  const memPressure = mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal * 100 : 0;
  const connLoad = Math.min(wss.clients.size / 50 * 100, 100);
  const temperature = Math.round(tickLoad * 0.5 + memPressure * 0.3 + connLoad * 0.2);

  // Build worker stats
  const workerStats = [];
  for (let i = 0; i < NUM_WORKERS; i++) {
    const wm = workerMetrics.get(i) || {};
    workerStats.push({
      id: i,
      rooms: workerLoad.get(i) || 0,
      tickTimeMs: Math.round((wm.tickTimeAvg || 0) * 100) / 100,
      msgsInRate: wm.msgsInRate || 0,
      msgsOutRate: wm.msgsOutRate || 0,
      bytesOutRate: wm.bytesOutRate || 0,
    });
  }

  return {
    type: 'admin_snapshot',
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
    },
    connections: wss.clients.size,
    lobbyCount: lobbyClients.size,
    adminCount: adminClients.size,
    activeGames,
    totalRooms: rooms.size,
    numWorkers: NUM_WORKERS,
    workers: workerStats,
    tickLoad,
    temperature,
    netInRate: serverBytesInRate,
    netOutRate: serverBytesOutRate,
    games: gamesList,
  };
}

setInterval(() => {
  if (adminClients.size === 0) return;

  // Compute per-second rates from accumulators and reset
  for (const [code, m] of roomMetrics) {
    m.bytesSentRate = m.bytesSentAcc;
    m.msgsSentRate = m.msgsSentAcc;
    m.bytesSentAcc = 0;
    m.msgsSentAcc = 0;
  }
  // Compute worker per-second rates and reset
  for (const [idx, wm] of workerMetrics) {
    wm.msgsInRate = wm.msgsInAcc;
    wm.msgsOutRate = wm.msgsOutAcc;
    wm.bytesOutRate = wm.bytesOutAcc;
    wm.msgsInAcc = 0;
    wm.msgsOutAcc = 0;
    wm.bytesOutAcc = 0;
  }

  serverBytesInRate = serverBytesInAcc;
  serverBytesOutRate = serverBytesOutAcc;
  serverBytesInAcc = 0;
  serverBytesOutAcc = 0;

  const snap = buildAdminSnapshot();

  // Record history for graphs
  const hi = history.idx % HISTORY_LEN;
  history.tickLoad[hi] = snap.tickLoad;
  history.memory[hi] = snap.memory.heapUsed;
  history.connections[hi] = snap.connections;
  history.netIn[hi] = snap.netInRate;
  history.netOut[hi] = snap.netOutRate;
  history.games[hi] = snap.activeGames;
  history.idx++;
  snap.history = {
    tickLoad: reorderRing(history.tickLoad, history.idx),
    memory: reorderRing(history.memory, history.idx),
    connections: reorderRing(history.connections, history.idx),
    netIn: reorderRing(history.netIn, history.idx),
    netOut: reorderRing(history.netOut, history.idx),
    games: reorderRing(history.games, history.idx),
  };

  const snapshotStr = JSON.stringify(snap);
  for (const ws of adminClients) {
    if (ws.readyState === 1) ws.send(snapshotStr);
  }
}, 1000);

function reorderRing(arr, idx) {
  const len = arr.length;
  const start = idx % len;
  return arr.slice(start).concat(arr.slice(0, start));
}
