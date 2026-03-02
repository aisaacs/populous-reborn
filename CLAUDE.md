# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Start server:** `npm start` (runs `node server.js`, serves on port 3000)
- No build step, linter, or test suite configured.

## Architecture

This is a Populous-inspired 1v1 multiplayer isometric god game with authoritative server.

### File Structure
- `shared/constants.js` — Constants shared between server and client (map, teams, modes, powers, tuning, tick rate)
- `server.js` — HTTP static server + WebSocket server + game simulation + room management
- `public/game.js` — Renderer + WebSocket client + walker interpolation + power targeting + music + lobby handlers
- `public/index.html` — Lobby UI + game canvas + power bar UI + music control
- `public/music/` — Music tracks (`001.mp3`, `002.mp3`, `003.mp3`)
- `public/gfx/` — Sprites: settlement sprites (`tent-blue.png`, etc.), `boulders.png`, `tree.png`, terrain textures
- `historical/` — Reference docs about the original Populous game mechanics (`manual1.txt`, `manual2.txt`, `faq.txt`, `hotkeys.txt`). Consult these when implementing or verifying faithful game mechanics.

### Shared Constants (`shared/constants.js`)
Dual-environment: loaded as `<script>` tag on client (globals), `require()` on server.
- **Map:** `MAP_W/H=64`, `TILE_HALF_W=16`, `TILE_HALF_H=8`, `HEIGHT_STEP=8`, `MAX_HEIGHT=8`, `SEA_LEVEL=0`
- **Teams:** `TEAM_BLUE=0`, `TEAM_RED=1`, `TEAM_COLORS`, `TEAM_NAMES`
- **Modes:** `MODE_SETTLE=0`, `MODE_MAGNET=1`, `MODE_FIGHT=2`, `MODE_GATHER=3`
- **Gameplay:** `WALKER_SPEED=0.8`, `MAX_LEVEL=9`, `LEVEL_CAPACITY=[0,4,8,15,30,55,90,140,200,255]`
- **Settlement Levels:** `SETTLEMENT_LEVELS` array (index 0=null, 1-9) with `{name, minCrops, capacity, tech, sprite, footprint}`. 9 levels: tent→hut→cottage→house→largehouse→manor→towerhouse→fortress→castle. Castle (level 9) has 3×3 footprint, all others 1×1.
- **Powers:** `POWERS` array of `{id, name, cost, hotkey, targeted}` for 6 powers; `EARTHQUAKE_RADIUS=7`, `VOLCANO_RADIUS=5`, `KNIGHT_STRENGTH_MULT=3`, `KNIGHT_SPEED_MULT=1.5`
- **Terrain:** `TERRAIN_TREES=0.06`, `TERRAIN_RAISE_COST=1`, `TERRAIN_LOWER_COST=1`
- **Crops:** `CROP_ZONE_RADIUS=2` (5×5 zone), `CROP_LEVEL_THRESHOLDS=[0,0,2,4,7,10,13,17,20,24]`, `GROWTH_PER_CROP_PER_SEC=0.1`
- **Ejection:** `EJECT_DWELL_TIME=15` (seconds at cap), `EJECT_FRACTION=0.5`, `EJECT_MIN_STRENGTH=2`
- **Mana:** `MANA_PER_POP_PER_SEC=0.015`, `MANA_MAX=6000`
- **Combat:** `TECH_ADVANTAGE_MULT=1.5` (damage multiplier per tech level difference), `WALKER_ATTRITION_PER_SEC=0.05`
- **Build proximity:** `BUILD_PROXIMITY_RADIUS=6`
- **Start:** `START_WALKERS=3`, `START_STRENGTH=5`, `START_MANA=50`
- **Tick:** `TICK_RATE=20`, `TICK_INTERVAL=50`

### Server (`server.js`)
- **HTTP:** Serves `public/` at root and `shared/` at `/shared/` using raw `http` + `fs` (no Express)
- **Rooms:** Map of 4-letter room codes to game instances. Player 1 creates, Player 2 joins. Supports vs AI mode.
- **Simulation:** Runs at 20Hz tick rate. All game logic lives server-side. Every function takes `state` as first parameter.
- **Game state** (`createGameState`): `heights` 2D array, `walkers[]`, `settlements[]`, `settlementMap` Int32Array, `walkerGrid`, `teamMode[2]`, `magnetPos[2]`, `magnetLocked[2]`, `mana[2]`, `swamps[]`, `rocks` Set, `trees` Set, `crops[]`, `cropCounts[]`, `cropOwnerMap` Int32Array, `seaLevel` (mutable), `leaders[2]`, `armageddon` bool, timers, `nextWalkerId`, `gameOver`, `winner`
- **WebSocket protocol:**
  - Client sends: `create`, `create_ai`, `join`, `raise`, `lower`, `mode`, `magnet`, `power`
  - Server sends: `created`, `joined`, `start`, `state` (20/sec), `gameover`, `error`
  - `power` message: `{type:'power', power:<id>, x, y}` — validated against POWERS array, mana checked, dispatched to `executePower*` functions
- **State serialization:** Heights as flat array, walkers/settlements as minimal objects (walkers include `l`/`k`/`tc` flags for leader/knight/tech). Swamps as `{x,y,t}` array, rocks/trees as flat `[x1,y1,x2,y2,...]` arrays, crops as `[x,y,team,...]` triplets. Each player receives only their own mana. Also sends `seaLevel`, `leaders`, `armageddon`, `magnetLocked`, `teamPop`.

#### Terrain System
- `heights[x][y]` — height point grid (MAP_W+1 x MAP_H+1), values 0 to MAX_HEIGHT
- `raisePoint`/`lowerPoint` — modify single point, cascade adjacency constraint (max 1 diff between neighbors). Costs `TERRAIN_RAISE_COST`/`TERRAIN_LOWER_COST` mana (1 each). Restricted by build proximity (`canBuildAtPoint`).
- **Build proximity:** `canBuildAtPoint(state, team, px, py)` — terraforming only allowed within `BUILD_PROXIMITY_RADIUS=6` of own walkers or settlements. Prevents cross-map manipulation.
- `isTileWater` — all 4 corners <= seaLevel
- `isTileFlat` — all 4 corners equal AND > seaLevel AND not a rock tile
- `generateTerrain` — procedural island generation with `placeBlob` + `enforceAdjacency`
- `invalidateSwamps` — filters out swamps where terrain changed. Called after raise, lower, earthquake, volcano, flood.
- `invalidateTrees` — removes trees on submerged tiles. Called after terrain-altering powers.
- Trees: scattered at `TERRAIN_TREES` rate on land tiles (excluding spawn zones). Soft obstacles — block crops but not settlement placement (auto-cleared by settlements and crop zones).

#### Walker System
- Walkers have: `id`, `team`, `strength` (0-255), `x/y` (float position), `tx/ty` (target), `dead`, `tech` (0-4, inherited from settlement), optional `isLeader`/`isKnight`
- Targeting by team mode: `pickSettleTarget`, `pickMagnetTarget`, `pickFightTarget`, `pickGatherTarget`, `pickRandomTarget`
- `isTileSettleable` — tile must be flat, not in a settlement footprint, and not claimed by another settlement's crop field (`cropOwnerMap`)
- Knights always use `pickFightTarget`, move at `WALKER_SPEED * KNIGHT_SPEED_MULT`, lower terrain around destroyed settlements
- Leaders: auto-assigned when walker is within radius 2 of team's magnet and no leader exists. Cleared on death in `pruneDeadEntities`.
- **Papal magnet lifecycle:** `magnetLocked[team]` state. When leader dies, magnet drops at leader's death location and becomes locked. Locked magnet cannot be moved by player. When a new leader is assigned (walker near magnet), magnet unlocks. Serialized to client for UI feedback.
- Armageddon: all walkers use `pickArmageddonTarget` (head to map center, fight when near), auto-raise terrain when blocked by water
- Swamp death: walkers on enemy swamp tiles die
- **Walker attrition:** `WALKER_ATTRITION_PER_SEC=0.05` — walkers lose strength over time using fractional accumulator. Die at 0.
- Collisions: same-team merge (sum strength, keep max tech), cross-team combat (tech-modified), settlement conquest (tech-modified)

#### Combat System
- **Tech advantage:** Each tech level difference gives a `TECH_ADVANTAGE_MULT` (1.5×) damage multiplier. Walker tech inherited from settlement level at ejection.
- **Walker vs walker:** Effective strength = `strength × 1.5^(techAdvantage)`. Higher effective strength wins. Survivor keeps remainder adjusted for tech ratio.
- **Settlement conquest:** Walker overpowers settlement → captures it (changes team), walker consumed. Remaining population becomes the conquered settlement's new population. Knights are an exception — they still destroy settlements and wreck terrain.
- **Same-team merge:** Strengths sum (capped 255), highest tech kept.

#### Settlement System
- **9 levels:** tent(1)→hut(2)→cottage(3)→house(4)→largehouse(5)→manor(6)→towerhouse(7)→fortress(8)→castle(9)
- **Level determination:** Based on crop field count in fixed 5×5 zone (`CROP_ZONE_RADIUS=2`) around home tile. `getLevelFromCropCount()` checks `CROP_LEVEL_THRESHOLDS`. Evaluated every 1s by `evaluateSettlementLevels`.
- **Castle (level 9):** Requires 3×3 flat area around home tile (`isCastleAreaValid`). If compromised, downgrades to level 8. `LEVEL_SQ_SIZE=[0,1,1,1,1,1,1,1,1,3]`.
- **Footprint:** Levels 1-8 occupy 1 tile. Castle occupies 3×3 centered on home tile. Managed by `updateSettlementFootprint`.
- **Settling:** `settleWalker` creates settlement, auto-clears trees, evaluates initial level from crops. Chain-settling: if walker strength > capacity, deposits capacity and continues with remainder.
- **No merges:** Settlements don't merge (faithful to Populous).
- **Crop fields:** Flat tiles in 5×5 zone around settlement. Exclude water, rocks, swamps, settlement footprints. Trees auto-cleared. Competition: higher-level settlement wins contested crops; same level = lower index wins. Computed by `computeCrops()` every tick.
- **`cropOwnerMap`:** Int32Array mapping tile → settlement index. Prevents new settlements on claimed crop tiles.

#### Population Growth & Ejection
- **Growth:** Continuous per-tick. `GROWTH_PER_CROP_PER_SEC=0.1` per crop field per second. Zero crops = zero growth. Uses fractional accumulator (`popFrac`) for sub-integer precision.
- **Ejection:** Only in **Settle mode**. When at capacity, dwell for `EJECT_DWELL_TIME` (15s), then eject `EJECT_FRACTION` (50%) of population (min `EJECT_MIN_STRENGTH`=2). Ejected walker inherits settlement's tech level.
- **Non-Settle modes:** Population accumulates to capacity and stops. No ejection.
- **Over-capacity:** If level drops (terrain change), excess population ejected immediately.
- Skipped during armageddon.

#### Mana System
- **Generation:** `MANA_PER_POP_PER_SEC=0.015` × total settlement population, continuous per-tick. Capped at `MANA_MAX=6000`.
- **Starting mana:** `START_MANA=50`
- **Terrain costs:** `TERRAIN_RAISE_COST=1`, `TERRAIN_LOWER_COST=1` per click.

#### Divine Powers (6 powers)
All server-side. Cost deducted from `state.mana[team]`. Armageddon blocks all further power/input.

| Power | Cost | Hotkey | Targeted | Function |
|-------|------|--------|----------|----------|
| Swamp | 60 | W | Yes | Place trap on flat tile; enemy walkers die on contact |
| Knight | 200 | E | No | Leader at a settlement consumes it, becomes knight (3x strength, 1.5x speed, fights only), wrecks terrain |
| Flood | 500 | T | No | Raise sea level by 1, kill/destroy newly submerged entities |
| Earthquake | 1500 | Q | Yes | Randomly lower points 0-2 times within radius 7 |
| Volcano | 5000 | R | Yes | Raise terrain to MAX_HEIGHT with falloff, add rock tiles, kill units in radius 5 |
| Armageddon | All mana | Y | No | Destroy all settlements (eject as walkers), all march to center and fight |

- `executePowerSwamp` and `executePowerKnight` return `false` on invalid state (no mana deducted)
- **Knight power:** Requires leader at a friendly settlement. Destroys the settlement, drops magnet at location, applies `knightDestroyTerrain` (patchwork — random ±1 height at 60% of points in radius, then enforceAdjacency). If no leader or leader not at settlement, power fails.
- Volcano adds rock tiles in inner radius (radius/2) — rocks make tiles non-flat, preventing settlements
- Armageddon drains all mana (cost=0 in POWERS array, special-cased in handler)

#### AI System
- Simple AI for vs-AI mode, runs every 3 seconds
- Chooses settle or fight mode based on stats
- Flattens terrain near a settlement by raising/lowering points (costs `TERRAIN_RAISE_COST`/`TERRAIN_LOWER_COST` mana each)

#### Tick Loop (`startGame`)
1. `updateWalkers` — movement, swamp check, leader assignment, targeting
2. `handleWalkerCollisions` — merging, tech-based combat, settlement assault
3. `updateMana` — `MANA_PER_POP_PER_SEC × totalPop × dt`, capped at `MANA_MAX`
4. AI update (if vs AI)
5. `computeCrops` — every tick, for rendering + growth
6. Every 1s: `evaluateSettlementLevels` (skipped during armageddon)
7. Every tick: `updatePopulationGrowth(state, dt)` — continuous crop-based growth + dwell ejection (skipped during armageddon)
8. Every 3s: `pruneDeadEntities` (clears dead walkers/settlements, resets leaders)
9. Win check after 30s grace period (team with 0 pop loses)
10. Serialize + send state to both players

#### Starting Conditions
- `START_WALKERS=3` walkers per team, `START_STRENGTH=5` each, `START_MANA=50`
- Walkers spawned near team spawn zones (Blue: 10,10; Red: 50,50)

### Client (`public/game.js`)
- **Rendering only:** No simulation. Receives state snapshots from server at 20Hz.
- **Walker interpolation:** Stores prev/curr walker snapshots, lerps positions by elapsed tick fraction for smooth 60fps rendering. Passes through `isLeader`/`isKnight` flags.
- **Settlement sprites:** 9 levels × 2 teams = 18 sprites loaded from `gfx/`. `SETT_LEVEL_NAMES = ['tent','hut','cottage','house','largehouse','manor','towerhouse','fortress','castle']`. Sprite sizing varies by level: 75% for tent/hut, 85% for cottage–manor, 95% for towerhouse/fortress, 60% for castle (3×3). Sprites scaled around visual center (`pTop.y + tileH*0.25` for 1×1, midpoint for 3×3).
- **Drawing pipeline:** Pass 1: terrain tiles (with crop/swamp overlays, boulder/tree sprites). Pass 2: settlements (sorted by depth). Pass 3: walkers via grid (with leader crown / knight cross markers). Then: targeting overlay, magnet flags. Reset to screen space: HUD, power bar update, minimap, population meters, inspect tooltip, armageddon overlay, game over overlay.
- **Crop overlay:** Blue team: `rgba(100,180,60,0.35)`, Red team: `rgba(160,160,40,0.35)` on crop tiles.
- **Swamp overlay:** Green-brown semi-transparent (`rgba(80,100,30,0.5)`) on swamp tiles
- **Rock overlay:** Boulder sprite on rock tiles
- **Tree sprite:** Loaded from `gfx/tree.png`, drawn on tree tiles
- **Leader visual:** Gold crown polygon above walker
- **Knight visual:** Larger radius + white cross above walker
- **Targeting mode:** `targetingPower` variable. For earthquake/volcano shows orange-tinted radius overlay. For swamp shows single-tile highlight. Click sends `{type:'power', power, x, y}`, Escape cancels.
- **Armageddon overlay:** Red "ARMAGEDDON" text, disables all player input except camera
- **Sea level:** Mutable `seaLevel` variable, updated from server state, replaces `SEA_LEVEL` constant in water checks
- **State reception:** `applyStateSnapshot` unpacks heights, walkers, settlements, magnetPos, teamMode, mana, swamps (builds `swampSet`), rocks (builds Set), trees (builds Set), crops (builds `cropSetBlue`/`cropSetRed`), seaLevel, leaders, armageddon, magnetLocked, teamPop
- **Minimap:** 200x200px top-down map in bottom-right corner. Pass 1: terrain. Pass 2a: crops (blue/red tints). Pass 2b: trees (dark green). Pass 2c: swamps. Pass 3: settlements. Pass 4: walkers. Pass 5: magnets. Pass 6: viewport bounds. LMB click scrolls main view.
- **Population meters:** `drawPopulationMeters()` — two vertical bars (blue/red) centered at top of screen, showing relative team population. Updated from `teamPop` sent by server.
- **Inspect tool:** `I` hotkey toggles inspect mode. Click on settlement or walker shows tooltip with stats (level, pop/cap, tech, strength, team). Escape dismisses. `performInspect(sx, sy)` hit-tests settlements then walkers, `drawInspectTooltip()` renders info box.
- **Input:** LMB raise (or power targeting click, or minimap click, or inspect click), RMB lower, Shift+LMB magnet, 1-4 mode keys, Q/W/E/R/T/Y power hotkeys, I inspect toggle, Escape cancel targeting/inspect, M mute toggle, MMB pan, G grid toggle, mouse wheel zoom, edge pan. Armageddon blocks all non-camera input.
- **Power bar:** `updatePowerBar()` called each frame toggles `disabled`/`active` CSS classes. `showPowerBar()` on game start. Button click handlers mirror hotkey behavior via `activatePower()`.
- **Music:** 3 tracks in `public/music/`, shuffled and played sequentially in a loop. Starts on game start. Volume (0-1, default 0.3) and mute state persisted to `localStorage`.
- **Lobby:** Create/Join/AI UI in HTML overlay, hidden when game starts.

### HTML/CSS (`public/index.html`)
- Full-viewport canvas with crosshair cursor
- Lobby overlay: centered box with create/join/AI buttons, room code display, waiting state
- Power bar: fixed bottom-center flex row of 6 buttons, each showing hotkey, name, cost. Costs: Swamp 60, Knight 200, Flood 500, Quake 1500, Volcano 5000, Armageddon ALL. Dark semi-transparent background. `.disabled` class (opacity 0.35), `.active` class (orange border + glow).
- Music control: fixed top-right, mute button (note icon) + volume slider (range input). Always visible.
- Texture opacity slider: adjacent to music controls.
- Help text bar: fixed top-left showing all controls including powers, I for inspect, Escape, and M for mute

### Key Design Patterns
- **Authoritative server:** All game logic is server-side. Client is pure renderer + input sender.
- **Dual-environment constants:** `shared/constants.js` uses `if (typeof module !== 'undefined') module.exports = {...}` pattern.
- **State-first functions:** All server game functions take `state` as first parameter.
- **String-key Sets:** Swamps, rocks, trees use `"x,y"` string keys in Sets for O(1) tile lookup.
- **Mutable sea level:** `state.seaLevel` replaces the constant `SEA_LEVEL` on server, `seaLevel` variable replaces it on client, enabling the Flood power.
- **Power validation:** Server validates power name against POWERS array, checks mana, validates coordinates for targeted powers. Some powers (`swamp`, `knight`) return false on invalid state to prevent mana deduction. Armageddon special-cased to drain all mana.
- **Crop-based settlement levels:** Settlement level determined by count of flat tiles in 5×5 zone, not by flat square size. No settlement merges.
- **Settlement conquest:** Walkers capture (not destroy) enemy settlements. Knights are the exception — they destroy and wreck terrain.
- **Tech inheritance:** Walkers inherit tech level from their settlement when ejected. Tech affects combat via `TECH_ADVANTAGE_MULT`.
- **Papal magnet lifecycle:** Magnet drops and locks on leader death, unlocks when new leader assigned. Prevents magnet manipulation without a leader.
- **localStorage persistence:** Music volume, mute state, texture opacity saved across sessions.

### Tuning Philosophy
Target: ~20 minute games, slow strategic pace. Terrain manipulation is nearly free (1 mana). Population growth is gradual (0.1 per crop/sec). Ejection has 15s dwell time. Walker speed is slow (0.8 tiles/sec, ~80s to cross map). Powers are exponentially spaced: swamp (60) is tactical, knight (200) is an investment, earthquake (1500) is rare, volcano (5000) is once-per-game. Mana generation is slow (0.015/pop/sec) making every power a meaningful decision.
