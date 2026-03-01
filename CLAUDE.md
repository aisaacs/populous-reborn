# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Start server:** `npm start` (runs `node server.js`, serves on port 3000)
- No build step, linter, or test suite configured.

## Architecture

This is a Populous-inspired 1v1 multiplayer isometric god game with authoritative server.

### File Structure
- `shared/constants.js` — Constants shared between server and client (map, teams, modes, powers, tick rate)
- `server.js` — HTTP static server + WebSocket server + game simulation + room management
- `public/game.js` — Renderer + WebSocket client + walker interpolation + power targeting + music + lobby handlers
- `public/index.html` — Lobby UI + game canvas + power bar UI + music control
- `public/music/` — Music tracks (`001.mp3`, `002.mp3`, `003.mp3`)

### Shared Constants (`shared/constants.js`)
Dual-environment: loaded as `<script>` tag on client (globals), `require()` on server.
- **Map:** `MAP_W/H=64`, `TILE_HALF_W=16`, `TILE_HALF_H=8`, `HEIGHT_STEP=8`, `MAX_HEIGHT=8`, `SEA_LEVEL=0`
- **Teams:** `TEAM_BLUE=0`, `TEAM_RED=1`, `TEAM_COLORS`, `TEAM_NAMES`
- **Modes:** `MODE_SETTLE=0`, `MODE_MAGNET=1`, `MODE_FIGHT=2`, `MODE_GATHER=3`
- **Gameplay:** `WALKER_SPEED=1.5`, `LEVEL_CAPACITY=[0,6,20,50,100,200]`
- **Powers:** `POWERS` array of `{id, name, cost, hotkey, targeted}` for 6 powers; `EARTHQUAKE_RADIUS=7`, `VOLCANO_RADIUS=5`, `KNIGHT_STRENGTH_MULT=3`, `KNIGHT_SPEED_MULT=1.5`
- **Tick:** `TICK_RATE=20`, `TICK_INTERVAL=50`

### Server (`server.js`)
- **HTTP:** Serves `public/` at root and `shared/` at `/shared/` using raw `http` + `fs` (no Express)
- **Rooms:** Map of 4-letter room codes to game instances. Player 1 creates, Player 2 joins. Supports vs AI mode.
- **Simulation:** Runs at 20Hz tick rate. All game logic lives server-side. Every function takes `state` as first parameter.
- **Game state** (`createGameState`): `heights` 2D array, `walkers[]`, `settlements[]`, `settlementMap` Int32Array, `walkerGrid`, `teamMode[2]`, `magnetPos[2]`, `mana[2]`, `swamps[]`, `rocks` Set, `seaLevel` (mutable, starts at `SEA_LEVEL`), `leaders[2]` (walker IDs), `armageddon` bool, timers, `nextWalkerId`, `gameOver`, `winner`
- **WebSocket protocol:**
  - Client sends: `create`, `create_ai`, `join`, `raise`, `lower`, `mode`, `magnet`, `power`
  - Server sends: `created`, `joined`, `start`, `state` (20/sec), `gameover`, `error`
  - `power` message: `{type:'power', power:<id>, x, y}` — validated against POWERS array, mana checked, dispatched to `executePower*` functions
- **State serialization:** Heights as flat array, walkers/settlements as minimal objects (walkers include `l`/`k` flags for leader/knight). Swamps as `{x,y,t}` array, rocks as flat `[x1,y1,x2,y2,...]` array. Each player receives only their own mana. Also sends `seaLevel`, `leaders`, `armageddon`.

#### Terrain System
- `heights[x][y]` — height point grid (MAP_W+1 x MAP_H+1), values 0 to MAX_HEIGHT
- `raisePoint`/`lowerPoint` — modify single point, cascade adjacency constraint (max 1 diff between neighbors)
- `isTileWater` — all 4 corners <= seaLevel
- `isTileFlat` — all 4 corners equal AND > seaLevel AND not a rock tile
- `generateTerrain` — procedural island generation with `placeBlob` + `enforceAdjacency`
- `invalidateSwamps` — filters out swamps where terrain changed (no longer flat or submerged). Called after raise, lower, earthquake, volcano, flood.

#### Walker System
- Walkers have: `id`, `team`, `strength` (0-255), `x/y` (float position), `tx/ty` (target), `dead`, optional `isLeader`/`isKnight`
- Targeting by team mode: `pickSettleTarget`, `pickMagnetTarget`, `pickFightTarget`, `pickGatherTarget`, `pickRandomTarget`
- Knights always use `pickFightTarget`, move at `WALKER_SPEED * KNIGHT_SPEED_MULT`, lower terrain around destroyed settlements
- Leaders: auto-assigned when walker is within radius 2 of team's magnet and no leader exists. Cleared on death in `pruneDeadEntities`.
- Armageddon: all walkers use `pickArmageddonTarget` (head to map center, fight when near), auto-raise terrain when blocked by water
- Swamp death: walkers on enemy swamp tiles die
- Collisions: same-team merge (sum strength), cross-team combat (subtract), settlement assault

#### Settlement System
- Settle on flat tiles, `findLargestFlatSquare` determines level (1-5)
- `tryMergeSettlements` — absorb same-team neighbors into larger squares
- `evaluateSettlementLevels` — periodic re-check, eject population if over capacity
- Population growth every 10 seconds; eject delay scales with level
- Skipped during armageddon

#### Divine Powers (6 powers)
All server-side. Cost deducted from `state.mana[team]`. Armageddon blocks all further power/input.

| Power | Cost | Hotkey | Targeted | Function |
|-------|------|--------|----------|----------|
| Earthquake | 200 | Q | Yes | Randomly lower points 0-2 times within radius 7 |
| Swamp | 350 | W | Yes | Place trap on flat tile; enemy walkers die on contact |
| Knight | 600 | E | No | Promote team's leader to knight (3x strength, 1.5x speed, fights only) |
| Volcano | 1500 | R | Yes | Raise terrain to MAX_HEIGHT with falloff, add rock tiles, kill units in radius 5 |
| Flood | 4000 | T | No | Raise sea level by 1, kill/destroy newly submerged entities |
| Armageddon | 10000 | Y | No | Destroy all settlements (eject as walkers), all march to center and fight |

- `executePowerSwamp` and `executePowerKnight` return `false` on invalid state (no mana deducted)
- Volcano adds rock tiles in inner radius (radius/2) — rocks make tiles non-flat, preventing settlements

#### AI System
- Simple AI for vs-AI mode, runs every 3 seconds
- Chooses settle or fight mode based on stats
- Flattens terrain near a settlement by raising/lowering points (costs 10 mana each)

#### Tick Loop (`startGame`)
1. `updateWalkers` — movement, swamp check, leader assignment, targeting
2. `handleWalkerCollisions` — merging, combat, settlement assault
3. `updateMana` — population * dt * 0.1
4. AI update (if vs AI)
5. Every 1s: `tryMergeSettlements` + `evaluateSettlementLevels` (skipped during armageddon)
6. Every 10s: `updatePopulationGrowth` (skipped during armageddon)
7. Every 3s: `pruneDeadEntities` (clears dead walkers/settlements, resets leaders)
8. Win check after 30s grace period (team with 0 pop loses)
9. Serialize + send state to both players

### Client (`public/game.js`)
- **Rendering only:** No simulation. Receives state snapshots from server at 20Hz.
- **Walker interpolation:** Stores prev/curr walker snapshots, lerps positions by elapsed tick fraction for smooth 60fps rendering. Passes through `isLeader`/`isKnight` flags.
- **Drawing pipeline:** Pass 1: terrain tiles (with swamp/rock overlays). Pass 2: settlements (sorted by depth). Pass 3: walkers via grid (with leader crown / knight cross markers). Then: targeting overlay, magnet flags. Reset to screen space: HUD, power bar update, minimap, armageddon overlay, game over overlay.
- **Swamp overlay:** Green-brown semi-transparent (`rgba(80,100,30,0.5)`) on swamp tiles
- **Rock overlay:** Dark grey-brown semi-transparent (`rgba(60,50,40,0.6)`) on rock tiles
- **Leader visual:** Gold crown polygon above walker
- **Knight visual:** Larger radius + white cross above walker
- **Targeting mode:** `targetingPower` variable. For earthquake/volcano shows orange-tinted radius overlay. For swamp shows single-tile highlight. Click sends `{type:'power', power, x, y}`, Escape cancels.
- **Armageddon overlay:** Red "ARMAGEDDON" text, disables all player input except camera
- **Sea level:** Mutable `seaLevel` variable, updated from server state, replaces `SEA_LEVEL` constant in water checks
- **State reception:** `applyStateSnapshot` unpacks heights, walkers, settlements, magnetPos, teamMode, mana, swamps (builds `swampSet` for O(1) lookup), rocks (builds Set from flat array), seaLevel, leaders, armageddon
- **Minimap:** 200x200px top-down map in bottom-right corner. `MM_SCALE = 200/64 ≈ 3.125` px/tile. Drawn in screen space every frame from the same game state. Pass 1: terrain colored by `getTileColor`. Pass 2: swamps (dark green). Pass 3: settlements (team-colored squares sized to footprint). Pass 4: walkers (single team-colored pixels). Pass 5: magnets (white 3x3 dots). Pass 6: viewport bounds (white polygon from `screenToGridFlat` at 4 screen corners — appears as diamond due to isometric projection). LMB click on minimap calls `centerCameraOnGrid` to scroll the main view. Minimap click is intercepted before all other input handlers.
- **Input:** LMB raise (or power targeting click, or minimap click), RMB lower, Shift+LMB magnet, 1-4 mode keys, Q/W/E/R/T/Y power hotkeys, Escape cancel targeting, M mute toggle, MMB pan, G grid toggle, mouse wheel zoom, edge pan. Armageddon blocks all non-camera input.
- **Power bar:** `updatePowerBar()` called each frame toggles `disabled`/`active` CSS classes. `showPowerBar()` on game start. Button click handlers mirror hotkey behavior via `activatePower()`.
- **Music:** 3 tracks in `public/music/`, shuffled and played sequentially in a loop. Starts on game start (satisfies autoplay policy since it follows a user click). Volume (0-1, default 0.3) and mute state persisted to `localStorage` (`musicVolume`, `musicMuted`). `startMusic()`, `playNextTrack()`, `toggleMusicMute()`, `setMusicVolume()`, `syncMusicUI()`.
- **Lobby:** Create/Join/AI UI in HTML overlay, hidden when game starts.

### HTML/CSS (`public/index.html`)
- Full-viewport canvas with crosshair cursor
- Lobby overlay: centered box with create/join/AI buttons, room code display, waiting state
- Power bar: fixed bottom-center flex row of 6 buttons, each showing hotkey, name, cost. Dark semi-transparent background. `.disabled` class (opacity 0.35), `.active` class (orange border + glow).
- Music control: fixed top-right, mute button (note icon) + volume slider (range input). Always visible.
- Help text bar: fixed top-left showing all controls including powers, Escape, and M for mute

### Key Design Patterns
- **Authoritative server:** All game logic is server-side. Client is pure renderer + input sender.
- **Dual-environment constants:** `shared/constants.js` uses `if (typeof module !== 'undefined') module.exports = {...}` pattern.
- **State-first functions:** All server game functions take `state` as first parameter.
- **String-key Sets:** Swamps and rocks use `"x,y"` string keys in Sets for O(1) tile lookup.
- **Mutable sea level:** `state.seaLevel` replaces the constant `SEA_LEVEL` on server, `seaLevel` variable replaces it on client, enabling the Flood power.
- **Power validation:** Server validates power name against POWERS array, checks mana, validates coordinates for targeted powers. Some powers (`swamp`, `knight`) return false on invalid state to prevent mana deduction.
- **Settlement merges:** When settlements merge, the highest-population settlement survives at its position; smaller ones are absorbed.
- **localStorage persistence:** Music volume and mute state saved across sessions.
