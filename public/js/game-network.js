// ── WebSocket Client ────────────────────────────────────────────────
let ws = null;
let gameStarted = false;
let gameOver = false;
let gameWinner = -1;
let gameWinnerName = '';
let teamPlayerNames = [];
let room_wasAI = false;
let room_lastMaxPlayers = 2;
let room_lastMapSize = 'small';
let isCreator = false;
let lobbyReconnectTimer = null;

// Player name persistence
function getPlayerName() {
  const input = document.getElementById('player-name');
  let name = (input ? input.value.trim() : '') || 'Player';
  name = name.replace(/[<>&"']/g, '').slice(0, 16) || 'Player';
  localStorage.setItem('playerName', name);
  return name;
}

function loadPlayerName() {
  const saved = localStorage.getItem('playerName');
  const input = document.getElementById('player-name');
  if (saved && input) input.value = saved;
}

// Escape HTML for chat
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Append chat message to a container
function appendChatMessage(containerId, name, text) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = '<span class="chat-msg-name">' + escapeHtml(name) + ':</span> <span class="chat-msg-text">' + escapeHtml(text) + '</span>';
  container.appendChild(div);
  // Cap at 100 messages
  while (container.children.length > 100) container.removeChild(container.firstChild);
  container.scrollTop = container.scrollHeight;
}

// Render game browser
function renderGameBrowser(games) {
  const browser = document.getElementById('game-browser');
  if (!browser) return;
  // Update tab badge
  const browseTab = document.querySelector('.lobby-tab[data-tab="browse"]');
  if (browseTab) {
    browseTab.textContent = games && games.length > 0 ? 'Browser (' + games.length + ')' : 'Game Browser';
  }
  if (!games || games.length === 0) {
    browser.innerHTML = '<div class="game-browser-empty">No public games available</div>';
    return;
  }
  browser.innerHTML = '';
  for (const g of games) {
    const item = document.createElement('div');
    item.className = 'game-browser-item';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'gb-name';
    nameSpan.textContent = g.name || g.creatorName + "'s game";
    const infoSpan = document.createElement('span');
    infoSpan.className = 'gb-info';
    infoSpan.textContent = g.players + '/' + g.maxPlayers + ' · ' + g.mapSize;
    const joinBtn = document.createElement('button');
    joinBtn.className = 'gb-join';
    joinBtn.textContent = 'Join';
    joinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendMessage({ type: 'join', code: g.code, playerName: getPlayerName() });
    });
    item.appendChild(nameSpan);
    item.appendChild(infoSpan);
    item.appendChild(joinBtn);
    browser.appendChild(item);
  }
}

// Render waiting room players
function renderWaitingPlayers(names, aiCount, maxPlayers) {
  const list = document.getElementById('waiting-player-list');
  if (!list) return;
  list.innerHTML = '';
  const totalHumans = names ? names.length : 0;
  for (let i = 0; i < totalHumans; i++) {
    const tag = document.createElement('span');
    tag.className = 'waiting-player-tag';
    tag.textContent = names[i] || 'Player';
    list.appendChild(tag);
  }
  for (let i = 0; i < (aiCount || 0); i++) {
    const tag = document.createElement('span');
    tag.className = 'waiting-player-tag ai-tag';
    tag.textContent = 'AI';
    list.appendChild(tag);
  }
  const emptySlots = maxPlayers - totalHumans - (aiCount || 0);
  for (let i = 0; i < emptySlots; i++) {
    const tag = document.createElement('span');
    tag.className = 'waiting-player-tag empty-tag';
    tag.textContent = '...';
    list.appendChild(tag);
  }
}

function connectToServer() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return; // Already connected/connecting
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(protocol + '//' + location.host);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    console.log('Connected to server');
    let name = getPlayerName();
    if (name === 'Player') {
      // Show name prompt modal
      const overlay = document.getElementById('name-prompt-overlay');
      const input = document.getElementById('name-prompt-input');
      const btn = document.getElementById('name-prompt-btn');
      overlay.classList.add('visible');
      input.value = '';
      input.focus();
      const submitName = () => {
        const val = (input.value || '').replace(/[<>&"']/g, '').trim().slice(0, 16);
        if (val) {
          name = val;
          const nameField = document.getElementById('player-name');
          if (nameField) nameField.value = name;
          localStorage.setItem('playerName', name);
        }
        overlay.classList.remove('visible');
        ws.send(JSON.stringify({ type: 'set_name', name }));
        const queued = pendingMessages.splice(0);
        for (const m of queued) ws.send(JSON.stringify(m));
        btn.removeEventListener('click', submitName);
        input.removeEventListener('keydown', onKey);
      };
      const onKey = (e) => { if (e.key === 'Enter') submitName(); };
      btn.addEventListener('click', submitName);
      input.addEventListener('keydown', onKey);
    } else {
      // Send player name immediately
      ws.send(JSON.stringify({ type: 'set_name', name }));
      // Flush any pending messages
      const queued = pendingMessages.splice(0);
      for (const m of queued) ws.send(JSON.stringify(m));
    }
  };

  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      // JSON message (full snapshots, lobby, chat, etc.)
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } else {
      // Binary delta: [u32 jsonLen][json bytes][walker binary]
      const buf = event.data;
      const view = new DataView(buf);
      const jsonLen = view.getUint32(0, true);
      const jsonStr = _textDecoder.decode(new Uint8Array(buf, 4, jsonLen));
      const msg = JSON.parse(jsonStr);
      decodeWalkerBinary(buf, 4 + jsonLen);
      handleServerMessage(msg);
    }
  };

  ws.onclose = () => {
    console.log('Disconnected from server');
    // Auto-reconnect if still in lobby
    if (!gameStarted) {
      if (lobbyReconnectTimer) clearTimeout(lobbyReconnectTimer);
      lobbyReconnectTimer = setTimeout(() => {
        if (!gameStarted) connectToServer();
      }, 2000);
    }
  };
}

// Connect immediately on page load
loadPlayerName();
connectToServer();

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'game_list':
      renderGameBrowser(msg.games);
      break;

    case 'lobby_chat':
      appendChatMessage('lobby-chat-messages', msg.name, msg.text);
      break;

    case 'lobby_system': {
      const container = document.getElementById('lobby-chat-messages');
      if (!container) break;
      const div = document.createElement('div');
      div.className = 'chat-msg chat-msg-system';
      div.textContent = msg.text;
      container.appendChild(div);
      while (container.children.length > 100) container.removeChild(container.firstChild);
      container.scrollTop = container.scrollHeight;
      break;
    }

    case 'lobby_count': {
      const el = document.getElementById('lobby-count');
      if (el) el.textContent = msg.count + ' online';
      break;
    }

    case 'room_chat':
      appendChatMessage('room-chat-messages', msg.name, msg.text);
      break;

    case 'created':
      myTeam = msg.team;
      isCreator = true;
      document.getElementById('room-code').textContent = msg.code;
      document.getElementById('create-join-section').style.display = 'none';
      document.getElementById('waiting-section').style.display = 'block';
      document.getElementById('waiting-game-name').textContent = msg.gameName || '';
      document.getElementById('waiting-ai-btns').style.display = 'flex';
      document.getElementById('start-game-row').style.display = 'block';
      document.getElementById('btn-start-game').disabled = true;
      document.getElementById('room-chat-messages').innerHTML = '';
      break;

    case 'joined':
      myTeam = msg.team;
      isCreator = false;
      document.getElementById('create-join-section').style.display = 'none';
      document.getElementById('waiting-section').style.display = 'block';
      document.getElementById('waiting-game-name').textContent = msg.gameName || '';
      document.getElementById('waiting-ai-btns').style.display = 'none';
      document.getElementById('start-game-row').style.display = 'none';
      document.getElementById('room-code').textContent = msg.code;
      // Load chat history
      document.getElementById('room-chat-messages').innerHTML = '';
      if (msg.chatLog) {
        for (const entry of msg.chatLog) {
          appendChatMessage('room-chat-messages', entry.name, entry.text);
        }
      }
      break;

    case 'waiting_update':
      document.getElementById('waiting-text').textContent =
        'Waiting for players... (' + msg.connectedPlayers + ' of ' + msg.maxPlayers + ')';
      renderWaitingPlayers(msg.playerNames, msg.aiCount, msg.maxPlayers);
      if (isCreator) {
        document.getElementById('btn-start-game').disabled = msg.connectedPlayers < 2;
      }
      break;

    case 'start': {
      if (myTeam < 0) myTeam = 0; // AI game — default to blue

      // Extract map dimensions and team count from start message
      const startNumTeams = msg.numTeams || 2;
      const startMapW = msg.mapW || MAP_W;
      const startMapH = msg.mapH || MAP_H;
      const startSpawnZones = msg.spawnZones || [];

      // Set dynamic dimensions
      localMapW = startMapW;
      localMapH = startMapH;
      numTeams = startNumTeams;

      // Reinitialize walker grid and typed arrays for new dimensions
      walkerGrid = new Array(localMapW * localMapH);
      reinitTypedArrays();

      // Initialize team arrays
      initTeamArrays(numTeams);

      // Set home position from spawn zones
      if (startSpawnZones.length > myTeam) {
        homePos = { x: startSpawnZones[myTeam].cx, y: startSpawnZones[myTeam].cy };
      } else {
        homePos = { x: localMapW / 2, y: localMapH / 2 };
      }

      // Store player names
      teamPlayerNames = msg.playerNames || TEAM_NAMES.slice(0, numTeams);

      // Build population bars for N teams
      buildPopBars(numTeams);

      gameStarted = true;
      lobbyActive = false;
      document.getElementById('lobby').style.display = 'none';
      document.getElementById('lobby-bg').style.display = 'none';
      const lobbyVol = document.getElementById('lobby-vol');
      if (lobbyVol) lobbyVol.style.display = 'none';
      document.getElementById('game').style.display = 'block';
      showSidebar();
      startMusic();
      resize();
      centerOnHome();
      lastFrame = performance.now();
      requestAnimationFrame(gameLoop);
      break;
    }

    case 'state':
      applyStateSnapshot(msg);
      break;

    case 'gameover':
      gameOver = true;
      gameWinner = msg.winner;
      gameWinnerName = msg.winnerName || (msg.winner >= 0 ? TEAM_NAMES[msg.winner] : null);
      playSfx(msg.winner === myTeam ? 'victory' : 'defeat');
      break;

    case 'error':
      document.getElementById('error-text').textContent = msg.message;
      break;

    case 'sprite_config':
      spriteConfig = msg.config;
      _terrainDirtyAll();
      console.log('[sprite-config] live reload via WS');
      break;
  }
}

function applyStateSnapshot(msg) {
  if (msg.full) {
    applyFullSnapshot(msg);
  } else {
    applyDeltaSnapshot(msg);
  }
}

// ── Tile Overlay Helpers ───────────────────────────────────────────
function applySwamps(data) {
  swamps = data || [];
  swampTiles.fill(0);
  for (const s of swamps) swampTiles[s.y * localMapW + s.x] = 1;
}

function applyRocks(data) {
  rockTiles.fill(0);
  if (data) {
    for (let i = 0; i < data.length; i += 2)
      rockTiles[data[i + 1] * localMapW + data[i]] = 1;
  }
}

function applyTrees(data) {
  treeTiles.fill(0);
  treeCoords = data || [];
  if (data) {
    for (let i = 0; i < data.length; i += 2)
      treeTiles[data[i + 1] * localMapW + data[i]] = 1;
  }
}

function applyPebbles(data) {
  pebbleTiles.fill(0);
  pebbleCoords = data || [];
  if (data) {
    for (let i = 0; i < data.length; i += 2)
      pebbleTiles[data[i + 1] * localMapW + data[i]] = 1;
  }
}

function applyRuins(data) {
  ruins = [];
  ruinTiles.fill(0);
  if (data) {
    for (let i = 0; i < data.length; i += 3) {
      ruins.push({ x: data[i], y: data[i + 1], team: data[i + 2] });
      ruinTiles[data[i + 1] * localMapW + data[i]] = data[i + 2] + 1;
    }
  }
}

function applyCrops(data) {
  cropTeamTiles.fill(0);
  if (data) {
    for (let i = 0; i < data.length; i += 3) {
      const team = data[i + 2];
      if (team >= 0 && team < numTeams)
        cropTeamTiles[data[i + 1] * localMapW + data[i]] = team + 1;
    }
  }
}

function applyHeights(heightsPayload) {
  if (!heightsPayload) return;
  if (heightsPayload.full) {
    const flat = heightsPayload.full;
    if (heights.length === 0) {
      for (let x = 0; x <= localMapW; x++) {
        heights[x] = [];
        for (let y = 0; y <= localMapH; y++) {
          heights[x][y] = 0;
        }
      }
    }
    let idx = 0;
    for (let y = 0; y <= localMapH; y++) {
      for (let x = 0; x <= localMapW; x++) {
        heights[x][y] = flat[idx++];
      }
    }
  } else if (heightsPayload.delta) {
    const delta = heightsPayload.delta;
    for (let i = 0; i < delta.length; i += 3) {
      const x = delta[i], y = delta[i + 1], h = delta[i + 2];
      if (heights[x]) heights[x][y] = h;
    }
  }
}

function applyFullSnapshot(msg) {
  if (msg.mapW) localMapW = msg.mapW;
  if (msg.mapH) localMapH = msg.mapH;
  if (msg.numTeams) numTeams = msg.numTeams;

  applyHeights(msg.heights);

  // Shift walker snapshots for interpolation
  prevWalkers = currWalkers;
  currWalkers = msg.walkers;
  lastTickTime = performance.now();

  // Rebuild walkerMap from full walker list
  walkerMap = new Map();
  for (const w of currWalkers) walkerMap.set(w.id, w);

  // Unpack settlements
  settlements = msg.settlements;

  // Rebuild settlementMap
  settlementMap = new Map();
  for (const s of settlements) settlementMap.set(s.tx + ',' + s.ty, s);

  // Other state
  magnetPos = msg.magnetPos;
  teamMode = msg.teamMode;
  myMana = msg.mana;

  applySwamps(msg.swamps);
  applyRocks(msg.rocks);
  applyTrees(msg.trees);
  applyPebbles(msg.pebbles);
  applyRuins(msg.ruins);
  applyCrops(msg.crops);

  seaLevel = msg.seaLevel !== undefined ? msg.seaLevel : SEA_LEVEL;
  leaders = msg.leaders || [];
  const wasArmageddon = armageddon;
  armageddon = msg.armageddon || false;
  if (armageddon && !wasArmageddon) onArmageddonStart();
  magnetLocked = msg.magnetLocked || [];
  teamPop = msg.teamPop || [];
  fires = msg.fires || [];
  minimapDirty = true;

  processSfxEvents(msg.sfx);
  detectTerrainDirty(msg);
}

// Decode binary walker payload and apply directly to walkerMap
// Format: [u16 movCount][u16 updCount][u16 remCount]
//         [mov × 8B: id(u32) x(u16) y(u16)]
//         [upd × 14B: id(u32) flags(u8) str(u8) x(u16) y(u16) tx(u16) ty(u16)]
//         [rem × 4B: id(u32)]
function decodeWalkerBinary(buf, offset) {
  const view = new DataView(buf);
  const movCount = view.getUint16(offset, true); offset += 2;
  const updCount = view.getUint16(offset, true); offset += 2;
  const remCount = view.getUint16(offset, true); offset += 2;

  // Position-only moves
  for (let i = 0; i < movCount; i++) {
    const id = view.getUint32(offset, true); offset += 4;
    const x = view.getUint16(offset, true) / 100; offset += 2;
    const y = view.getUint16(offset, true) / 100; offset += 2;
    const w = walkerMap.get(id);
    if (w) { w.x = x; w.y = y; }
  }

  // Full updates (new or changed walkers)
  for (let i = 0; i < updCount; i++) {
    const id = view.getUint32(offset, true); offset += 4;
    const flags = view.getUint8(offset); offset += 1;
    const s = view.getUint8(offset); offset += 1;
    const x = view.getUint16(offset, true) / 100; offset += 2;
    const y = view.getUint16(offset, true) / 100; offset += 2;
    const tx = view.getUint16(offset, true) / 100; offset += 2;
    const ty = view.getUint16(offset, true) / 100; offset += 2;
    const t = (flags >> 5) & 0x07;
    const w = { id, t, s, x, y, tx, ty };
    if (flags & 0x10) w.l = 1;
    if (flags & 0x08) w.k = 1;
    walkerMap.set(id, w);
  }

  // Removals
  for (let i = 0; i < remCount; i++) {
    const id = view.getUint32(offset, true); offset += 4;
    walkerMap.delete(id);
  }
}

function applyDeltaSnapshot(msg) {
  if (msg.mapW) localMapW = msg.mapW;
  if (msg.mapH) localMapH = msg.mapH;
  if (msg.numTeams) numTeams = msg.numTeams;

  // Heights (already supports delta)
  if (msg.heights) applyHeights(msg.heights);

  // Walker positions already applied by decodeWalkerBinary before this runs
  prevWalkers = currWalkers;

  // Rebuild currWalkers array from map
  currWalkers = Array.from(walkerMap.values());
  lastTickTime = performance.now();

  // Settlement delta
  if (msg.sUpd) {
    for (const s of msg.sUpd) {
      const key = s.tx + ',' + s.ty;
      settlementMap.set(key, s);
    }
  }
  if (msg.sRem) {
    for (let i = 0; i < msg.sRem.length; i += 2) {
      const key = msg.sRem[i] + ',' + msg.sRem[i + 1];
      settlementMap.delete(key);
    }
  }
  if (msg.sUpd || msg.sRem) {
    settlements = Array.from(settlementMap.values());
  }

  // Always-present fields
  if (msg.mana !== undefined) myMana = msg.mana;
  if (msg.teamPop) teamPop = msg.teamPop;
  if (msg.fires) fires = msg.fires;

  // Conditional fields — only update if present
  if (msg.swamps !== undefined) applySwamps(msg.swamps);
  if (msg.rocks !== undefined) applyRocks(msg.rocks);
  if (msg.trees !== undefined) applyTrees(msg.trees);
  if (msg.pebbles !== undefined) applyPebbles(msg.pebbles);
  if (msg.ruins !== undefined) applyRuins(msg.ruins);
  if (msg.crops !== undefined) applyCrops(msg.crops);

  if (msg.magnetPos !== undefined) magnetPos = msg.magnetPos;
  if (msg.teamMode !== undefined) teamMode = msg.teamMode;
  if (msg.seaLevel !== undefined) seaLevel = msg.seaLevel;
  if (msg.leaders !== undefined) leaders = msg.leaders;
  if (msg.magnetLocked !== undefined) magnetLocked = msg.magnetLocked;

  if (msg.armageddon !== undefined) {
    const wasArmageddon = armageddon;
    armageddon = msg.armageddon;
    if (armageddon && !wasArmageddon) onArmageddonStart();
  }

  processSfxEvents(msg.sfx);
  minimapDirty = true;
  detectTerrainDirty(msg);
}

// ── Terrain Buffer Dirty Detection ──────────────────────────────────
function markTileDirty(tx, ty) {
  if (!terrainBufferDirty) return;
  // Mark tile and all 8 neighbors (tiles overlap due to height and isometric projection)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const nx = tx + dx, ny = ty + dy;
      if (nx >= 0 && nx < localMapW && ny >= 0 && ny < localMapH) {
        terrainBufferDirty[ny * localMapW + nx] = 1;
      }
    }
  }
}

function detectTerrainDirty(msg) {
  if (!terrainBufferInited) return;

  const sz = localMapW * localMapH;
  let dirtyCount = 0;

  // 1. Height deltas — each [x,y,h] triplet marks surrounding tiles dirty
  const hp = msg.heights;
  if (hp) {
    if (hp.full) {
      // Full height update — need full redraw
      terrainBufferNeedsFull = true;
      // Copy overlay state for next diff
      if (prevCropTeamTiles) prevCropTeamTiles.set(cropTeamTiles);
      if (prevSwampTiles) prevSwampTiles.set(swampTiles);
      if (prevRockTiles) prevRockTiles.set(rockTiles);
      if (prevTreeTiles) prevTreeTiles.set(treeTiles);
      if (prevPebbleTiles) prevPebbleTiles.set(pebbleTiles);
      if (prevRuinTiles) prevRuinTiles.set(ruinTiles);
      prevSeaLevel = seaLevel;
      return;
    }
    if (hp.delta) {
      const delta = hp.delta;
      for (let i = 0; i < delta.length; i += 3) {
        const px = delta[i], py = delta[i + 1];
        // Height point (px,py) affects tiles (px-1,py-1), (px,py-1), (px-1,py), (px,py)
        for (let dx = -1; dx <= 0; dx++) {
          for (let dy = -1; dy <= 0; dy++) {
            const tx = px + dx, ty = py + dy;
            if (tx >= 0 && tx < localMapW && ty >= 0 && ty < localMapH) {
              markTileDirty(tx, ty);
              dirtyCount++;
            }
          }
        }
      }
    }
  }

  // 2. Sea level change
  if (seaLevel !== prevSeaLevel) {
    terrainBufferNeedsFull = true;
    if (prevCropTeamTiles) prevCropTeamTiles.set(cropTeamTiles);
    if (prevSwampTiles) prevSwampTiles.set(swampTiles);
    if (prevRockTiles) prevRockTiles.set(rockTiles);
    if (prevTreeTiles) prevTreeTiles.set(treeTiles);
    if (prevPebbleTiles) prevPebbleTiles.set(pebbleTiles);
    if (prevRuinTiles) prevRuinTiles.set(ruinTiles);
    prevSeaLevel = seaLevel;
    return;
  }

  // 3. Overlay diffs — compare typed arrays against prev copies
  if (prevCropTeamTiles) {
    for (let i = 0; i < sz; i++) {
      if (cropTeamTiles[i] !== prevCropTeamTiles[i]) {
        const tx = i % localMapW, ty = (i / localMapW) | 0;
        markTileDirty(tx, ty);
        dirtyCount++;
      }
    }
    prevCropTeamTiles.set(cropTeamTiles);
  }
  if (prevSwampTiles) {
    for (let i = 0; i < sz; i++) {
      if (swampTiles[i] !== prevSwampTiles[i]) {
        const tx = i % localMapW, ty = (i / localMapW) | 0;
        markTileDirty(tx, ty);
        dirtyCount++;
      }
    }
    prevSwampTiles.set(swampTiles);
  }
  if (prevRockTiles) {
    for (let i = 0; i < sz; i++) {
      if (rockTiles[i] !== prevRockTiles[i]) {
        const tx = i % localMapW, ty = (i / localMapW) | 0;
        markTileDirty(tx, ty);
        dirtyCount++;
      }
    }
    prevRockTiles.set(rockTiles);
  }
  if (prevTreeTiles) {
    for (let i = 0; i < sz; i++) {
      if (treeTiles[i] !== prevTreeTiles[i]) {
        const tx = i % localMapW, ty = (i / localMapW) | 0;
        markTileDirty(tx, ty);
        dirtyCount++;
      }
    }
    prevTreeTiles.set(treeTiles);
  }
  if (prevPebbleTiles) {
    for (let i = 0; i < sz; i++) {
      if (pebbleTiles[i] !== prevPebbleTiles[i]) {
        const tx = i % localMapW, ty = (i / localMapW) | 0;
        markTileDirty(tx, ty);
        dirtyCount++;
      }
    }
    prevPebbleTiles.set(pebbleTiles);
  }
  if (prevRuinTiles) {
    for (let i = 0; i < sz; i++) {
      if (ruinTiles[i] !== prevRuinTiles[i]) {
        const tx = i % localMapW, ty = (i / localMapW) | 0;
        markTileDirty(tx, ty);
        dirtyCount++;
      }
    }
    prevRuinTiles.set(ruinTiles);
  }

  prevSeaLevel = seaLevel;

  // If >25% tiles dirty, just do a full redraw
  if (dirtyCount > sz * 0.25) {
    terrainBufferNeedsFull = true;
  }
}

let pendingMessages = [];

function sendMessage(msg) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  } else {
    pendingMessages.push(msg);
  }
}
