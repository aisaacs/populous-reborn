# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Start server:** `npm start` (runs `node server.js`, serves on port 4321)
- No build step, linter, or test suite configured.

## Architecture

This is a Populous-inspired multiplayer (up to 6 players) isometric god game with authoritative server.

### File Structure
- `shared/constants.js` — Constants shared between server and client (map, teams, modes, powers, tuning, tick rate)
- `server.js` — HTTP static server + WebSocket server + game simulation + room management + delta serialization
- `public/game.js` — Renderer + WebSocket client + walker interpolation + power targeting + music + lobby handlers + guide modal
- `public/index.html` — Lobby UI + game canvas + sidebar UI + guide modal + settings popup
- `public/guide.md` — How-to-play guide (markdown, fetched and rendered client-side)
- `public/admin.html` — Admin dashboard for monitoring server metrics
- `public/music/` — Music tracks (`001.mp3`, `002.mp3`, `003.mp3`, `004.mp3`)
- `public/gfx/` — Sprites: settlement sprites (`tent-blue.png`, etc.), walker sprites, `boulders.png`, `tree.png`, `pebbles.png`, `ruins.png`, terrain textures (`.jpg`)
- `historical/` — Reference docs about the original Populous game mechanics (`manual1.txt`, `manual2.txt`, `faq.txt`, `hotkeys.txt`). Consult these when implementing or verifying faithful game mechanics.

### Shared Constants (`shared/constants.js`)
Dual-environment: loaded as `<script>` tag on client (globals), `require()` on server.
- **Map:** `MAP_W/H=64`, `TILE_HALF_W=16`, `TILE_HALF_H=8`, `HEIGHT_STEP=8`, `MAX_HEIGHT=8`, `SEA_LEVEL=0`
- **Map Presets:** `MAP_SIZE_PRESETS` — small (64x64), medium (96x96), large (128x128)
- **Teams:** `MAX_TEAMS=6`, `TEAM_BLUE=0` through `TEAM_ORANGE=5`, `TEAM_COLORS`, `TEAM_NAMES`, `TEAM_SPRITE_NAMES`
- **Modes:** `MODE_SETTLE=0`, `MODE_MAGNET=1`, `MODE_FIGHT=2`, `MODE_GATHER=3`
- **Gameplay:** `WALKER_SPEED=0.8`, `MAX_LEVEL=9`, `LEVEL_CAPACITY=[0,4,8,15,30,55,90,140,200,255]`
- **Settlement Levels:** `SETTLEMENT_LEVELS` array (index 0=null, 1-9) with `{name, minCrops, capacity, tech, sprite, footprint}`. 9 levels: tent→hut→cottage→house→largehouse→manor→towerhouse→fortress→castle. Castle (level 9) has 5×5 footprint, all others 1×1.
- **Powers:** `POWERS` array of `{id, name, cost, hotkey, targeted}` for 6 powers; `EARTHQUAKE_RADIUS=7`, `VOLCANO_RADIUS=5`, `KNIGHT_STRENGTH_MULT=1.75`, `KNIGHT_SPEED_MULT=1.5`, `KNIGHT_ATTRITION_PER_SEC=0.5`, `KNIGHT_ASSAULT_MULT=8` (fixed siege damage multiplier), `KNIGHT_RETAL_MULT=2` (settlements deal 2× retaliation to knights)
- **Terrain:** `TERRAIN_TREES=0.06`, `TERRAIN_PEBBLES=0.04`, `TERRAIN_RAISE_COST=1`, `TERRAIN_LOWER_COST=1`
- **Crops:** `CROP_ZONE_RADIUS=2` (5×5 zone), `CROP_LEVEL_THRESHOLDS=[0,0,2,4,7,10,13,17,20,24]`, `GROWTH_PER_CROP_PER_SEC=0.1`
- **Ejection:** `EJECT_DWELL_TIME=15` (seconds at cap), `EJECT_FRACTION=0.5`, `EJECT_MIN_STRENGTH=2`
- **Mana:** `MANA_PER_POP_PER_SEC=0.0075`, `MANA_MAX=6000`
- **Combat:** `TECH_ADVANTAGE_MULT=1.5` (damage multiplier per tech level difference), `WALKER_ATTRITION_PER_SEC=0.05`, `HOMELESS_ATTRITION_PER_SEC=0.5` (walkers with no settlements), `ASSAULT_DMG_PER_SEC=3`, `ASSAULT_RETALIATE_FRAC=0.5`
- **Build proximity:** `BUILD_PROXIMITY_RADIUS=6`
- **Start:** `START_WALKERS=3`, `START_STRENGTH=5`, `START_MANA=50`
- **Tick:** `TICK_RATE=20`, `TICK_INTERVAL=50`

### Server (`server.js`)
- **HTTP:** Serves `public/` at root and `shared/` at `/shared/` using raw `http` + `fs` (no Express). MIME types for `.html`, `.js`, `.css`, `.mp3`, `.png`, `.jpg`, `.json`, `.md`.
- **Rooms:** Map of 4-letter room codes to game instances. Supports public/private rooms, variable player counts (2-6), AI players, three map sizes, and four terrain types.
- **Lobby:** Game browser, lobby chat, room chat, waiting room with player list, add/remove AI, host-controlled game start.
- **Simulation:** Runs at 20Hz tick rate. All game logic lives server-side. Every function takes `state` as first parameter.
- **Game state** (`createGameState`): `heights` 2D array, `walkers[]`, `settlements[]`, `settlementMap` Int32Array, `walkerGrid`, `teamMode[]`, `magnetPos[]`, `magnetLocked[]`, `mana[]`, `swamps[]`, `swampSet`, `rocks` Set, `trees` Set, `pebbles` Set, `ruins[]`, `ruinSet`, `crops[]`, `cropCounts[]`, `cropOwnerMap` Int32Array, `fires[]`, `seaLevel` (mutable), `leaders[]`, `eliminated[]`, `spawnZones[]`, `teamHadSettlement[]`, `armageddon` bool, `terrainType`, timers, `nextWalkerId`, `gameOver`, `winner`, plus delta tracking fields (`_prev*`).
- **WebSocket protocol:**
  - Client sends: `set_name`, `create`, `create_ai`, `join`, `start_game`, `add_ai`, `remove_ai`, `raise`, `lower`, `mode`, `magnet`, `power`, `resync`, `lobby_chat`, `room_chat`, `request_game_list`, `admin_subscribe`, `godmode`
  - Server sends: `created`, `joined`, `start`, `state` (20/sec, full or delta), `gameover`, `error`, `game_list`, `lobby_chat`, `room_chat`, `waiting_update`, `admin_snapshot`
  - `power` message: `{type:'power', power:<id>, x, y}` — validated against POWERS array, mana checked, dispatched to `executePower*` functions

#### Delta Serialization System
The server uses delta compression to reduce bandwidth by ~98%. Instead of sending full game state every tick, it tracks previous state and only sends changes.

- **Full snapshots** (`msg.full = true`): Sent on first tick, every 100 ticks (5s), on `resync` request, and when `ws._needsFullSnapshot` is set. Contains all data fields. Resets all `_prev*` tracking state.
- **Delta messages** (normal ticks): Only changed fields are included.
  - `wMov: [id,x,y,...]` — flat triplets for walkers with position-only changes (most common)
  - `wUpd: [{id,t,s,x,y,tx,ty,l?,k?},...]` — full objects for new/changed walkers
  - `wRem: [id,...]` — removed walker IDs
  - `sUpd: [{t,l,p,tx,ty,ox,oy,sz,hl?},...]` — new/changed settlements
  - `sRem: [tx,ty,...]` — destroyed settlements (flat pairs)
  - `fires`, `teamPop` — always sent (small, change every tick)
  - `mana`, `team`, `numTeams`, `mapW`, `mapH` — always sent (per-player mana)
  - `crops`, `rocks`, `trees`, `pebbles`, `ruins`, `swamps` — only if changed (string-compared)
  - `magnetPos`, `magnetLocked`, `teamMode`, `seaLevel`, `leaders`, `armageddon` — only if changed (JSON-compared)
- **Delta tracking** in `createGameState`: `_prevWalkerMap` (Map), `_prevSettlements` (array), `_prevCropStr`, `_prevRocksStr`, `_prevTreesStr`, etc. for string comparison, `_fullSnapshotCounter` for periodic resets.
- **Key functions:** `computeWalkerDelta()`, `computeSettlementDelta()`, `computeDelta()`, `serializeFullState()`.
- **Heights** already use separate delta encoding via `computeHeightsPayload()` — changed points as `[x,y,h,...]` triplets, falls back to full array if >50% changed.

#### Terrain System
- `heights[x][y]` — height point grid (mapW+1 x mapH+1), values 0 to MAX_HEIGHT
- **Height constraints:** All 8 neighbors (cardinal + diagonal) must differ by at most 1. Additionally, no "saddle" tiles allowed (opposite corners equal but different from other pair: `t===b && r===l && t!==r`). Enforced by `enforceAdjacency`, `raisePoint`, and `lowerPoint`. Helper constants `NB8_OFFSETS`, `TILE_OFFSETS` and functions `isSaddleTile`, `fixSaddleRaise`, `fixSaddleLower`.
- `raisePoint`/`lowerPoint` — modify single point, BFS cascade for adjacency + saddle constraints. Costs `TERRAIN_RAISE_COST`/`TERRAIN_LOWER_COST` mana (1 each). Restricted by build proximity (`canBuildAtPoint`). Also clears pebbles and ruins on affected tiles.
- **Build proximity:** `canBuildAtPoint(state, team, px, py)` — terraforming only allowed within `BUILD_PROXIMITY_RADIUS=6` of own walkers or settlements. Prevents cross-map manipulation.
- `isTileWater` — all 4 corners <= seaLevel
- `isTileFlat` — all 4 corners equal AND > seaLevel AND not a rock/pebble tile
- **Terrain type presets:** `TERRAIN_TYPE_PRESETS` in constants — continental (default), archipelago (high sea level, fragmented islands), mountains (steep, rocky), flatlands (gentle terrain, many trees). Each preset defines noise, height, mask, scatter, and sea level parameters. Selected at room creation.
- `generateTerrain` — procedural island generation with noise + multi-center blob masks + `enforceAdjacency`. Uses terrain type preset for all parameters. Force-flattens spawn areas after generation. Retries up to 20 times until all spawn zones have 5×5 flat areas. Scatters rocks, trees, and pebbles at preset-defined rates.
- `invalidateSwamps`/`invalidateRocks`/`invalidateTrees`/`invalidatePebbles`/`invalidateRuins` — remove entities on invalid tiles (submerged, terrain changed). Called after terrain-altering operations.
- Trees: scattered at preset `treeRate` on land tiles (excluding spawn zones). Soft obstacles — auto-cleared by settlements and crop zones.
- Pebbles: scattered at preset `pebbleRate`. Block tile flatness (prevent settlement/crops). Cleared by terrain modification.
- Ruins: left behind when knights destroy settlements. Block tile settleability. Cleared by terrain modification.

#### Walker System
- Walkers have: `id`, `team`, `strength` (0-255), `x/y` (float position), `tx/ty` (target), `dead`, `tech` (0-4, inherited from settlement), optional `isLeader`/`isKnight`, `attritionFrac` (accumulator)
- Targeting by team mode: `pickSettleTarget`, `pickMagnetTarget`, `pickFightTarget`, `pickGatherTarget`, `pickRandomTarget`
- `isTileSettleable` — tile must be flat, not in a settlement footprint, not claimed by cropOwnerMap, not a ruin, not adjacent to rocks
- Knights always use `pickFightTarget` (player cannot steer them), move at `WALKER_SPEED * KNIGHT_SPEED_MULT`, immune to swamps, avoid swamps via perpendicular dodge, higher attrition (`KNIGHT_ATTRITION_PER_SEC=0.5`)
- Leaders: auto-assigned when walker is within radius 2 of team's magnet and no leader exists. Cleared on death in `pruneDeadEntities`.
- **Papal magnet lifecycle:** `magnetLocked[team]` state. When leader dies, magnet drops at leader's death location and becomes locked. Locked magnet cannot be moved by player. When a new leader is assigned (walker near magnet), magnet unlocks.
- Armageddon: all walkers use `pickArmageddonTarget` (head to map center, fight when near), auto-raise terrain when blocked by water
- Swamp death: walkers on enemy swamp tiles die (knights immune)
- **Walker attrition:** `WALKER_ATTRITION_PER_SEC=0.05` — walkers lose strength over time using fractional accumulator. Die at 0.
- Collisions: same-team merge (sum strength, keep max tech, skip knights), cross-team combat (tech-modified)

#### Combat System
- **Tech advantage:** Each tech level difference gives a `TECH_ADVANTAGE_MULT` (1.5×) damage multiplier. Walker tech inherited from settlement level at ejection.
- **Walker vs walker:** Effective strength = `strength × 1.5^(techAdvantage)`. Higher effective strength wins. Survivor keeps remainder adjusted for tech ratio.
- **Settlement assault:** Walkers on enemy settlements deal `ASSAULT_DMG_PER_SEC` damage per tick (modified by tech and walker strength via `strMult = strength/5`). Settlement retaliates at `ASSAULT_RETALIATE_FRAC`. When population reaches 0: best attacker captures (or knight destroys + leaves ruins + fire). Uses fractional accumulators for sub-integer damage.
- **Knight siege:** Knights use fixed `KNIGHT_ASSAULT_MULT=8` instead of strength-based damage, creating a gradual siege rather than instant destruction. Settlements deal `KNIGHT_RETAL_MULT=2×` retaliation to knights. Both sides trade damage over time — small settlements fall quickly with minimal knight loss, but fortresses/castles deal heavy damage and can kill knights.
- **Homeless attrition:** `HOMELESS_ATTRITION_PER_SEC=0.5` — walkers whose team once had settlements but now has none (all destroyed) suffer 10× normal attrition. Tracked via `state.teamHadSettlement[]`.
- **Same-team merge:** Strengths sum (capped 255), highest tech kept. Knights don't merge.

#### Settlement System
- **9 levels:** tent(1)→hut(2)→cottage(3)→house(4)→largehouse(5)→manor(6)→towerhouse(7)→fortress(8)→castle(9)
- **Level determination:** Based on crop field count in zone around home tile. `getLevelFromCropCount()` checks `CROP_LEVEL_THRESHOLDS`. Evaluated every 1s by `evaluateSettlementLevels`.
- **Castle (level 9):** Requires 5×5 flat area around home tile (`isCastleAreaValid`). If compromised, downgrades to level 8. `LEVEL_SQ_SIZE=[0,1,1,1,1,1,1,1,1,5]`.
- **Footprint:** Levels 1-8 occupy 1 tile. Castle occupies 5×5 centered on home tile. Managed by `updateSettlementFootprint`.
- **Settling:** `settleWalker` creates settlement, auto-clears trees, evaluates initial level from crops. Chain-settling: if walker strength > capacity, deposits capacity and continues with remainder.
- **No merges:** Settlements don't merge (faithful to Populous).
- **Crop fields (Populous-faithful):** Flat tiles in zone around settlement. Exclude water, rocks, pebbles, swamps, ruins, settlement footprints. Trees auto-cleared. **Same-team sharing:** multiple same-team settlements in range all count the shared tile. **Enemy blocking:** tiles claimed by 2+ teams are contested and blocked for all (cropOwnerMap = -2). Computed by `computeCrops()` every tick in 3 phases: claim, contest, count.
- **`cropOwnerMap`:** Int32Array mapping tile → settlement index (-1 = unclaimed, -2 = contested). Prevents new settlements on claimed crop tiles.

#### Population Growth & Ejection
- **Growth:** Continuous per-tick. `GROWTH_PER_CROP_PER_SEC=0.1` per crop field per second. Zero crops = zero growth. Uses fractional accumulator (`popFrac`) for sub-integer precision.
- **Ejection:** Only in **Settle mode**. When at capacity, dwell for `EJECT_DWELL_TIME` (15s), then eject `EJECT_FRACTION` (50%) of population (min `EJECT_MIN_STRENGTH`=2). Ejected walker inherits settlement's tech level.
- **Non-Settle modes:** Population accumulates to capacity and stops. No ejection.
- **Over-capacity:** If level drops (terrain change), excess population ejected immediately.
- Skipped during armageddon.

#### Mana System
- **Generation:** `MANA_PER_POP_PER_SEC=0.0075` × total settlement population, continuous per-tick. Capped at `MANA_MAX=6000`.
- **Starting mana:** `START_MANA=50`
- **Terrain costs:** `TERRAIN_RAISE_COST=1`, `TERRAIN_LOWER_COST=1` per click.

#### Divine Powers (6 powers)
All server-side. Cost deducted from `state.mana[team]`. Armageddon blocks all further power/input.

| Power | Cost | Hotkey | Targeted | Function |
|-------|------|--------|----------|----------|
| Swamp | 60 | W | Yes | Place 3-5 swamp tiles near target; enemy walkers die on contact (knights immune) |
| Knight | 200 | E | No | Leader at a settlement consumes it, becomes knight (1.75× strength, 1.5× speed, fast attrition, auto-fights only), leaves fire |
| Flood | 500 | T | No | Lower all terrain by 1, kill/destroy newly submerged entities |
| Earthquake | 1500 | Q | Yes | Randomly raise/lower points 0-2 times within radius 7 |
| Volcano | 5000 | R | Yes | Raise terrain to MAX_HEIGHT with falloff, add rock tiles, kill units in radius 5 |
| Armageddon | 6000 | Y | No | Destroy all settlements (eject as walkers), all march to center and fight |

- `executePowerSwamp` and `executePowerKnight` return `false` on invalid state (no mana deducted)
- **Knight power:** Requires leader at a friendly settlement. Destroys the settlement, creates knight walker, drops magnet at location, adds fire. If no leader or leader not at settlement, power fails.
- Volcano adds rock tiles in inner radius (radius/2) — rocks make tiles non-flat, preventing settlements
- Armageddon drains all mana (cost=6000 in POWERS array)

#### AI System
- AI runs every 1.5 seconds for each AI-controlled team
- Mode selection: settle if few settlements, fight if population advantage, gather if low walkers
- Powers: armageddon at 2.5× pop advantage, knight when leader available, swamps near enemies, earthquake/flood/volcano probabilistically
- Terrain flattening: raises/lowers up to 3 points near random own settlement (costs mana per click). If no settlements, flattens near strongest walker to help it settle. Extracted to `aiTryFlatten` helper.

#### Tick Loop (`startGame`)
1. `updateWalkers` — movement, swamp check, knight swamp avoidance, leader assignment, targeting, attrition
2. `handleWalkerCollisions` — merging, tech-based combat, settlement assault (with fractional damage accumulators)
3. `updateMana` — `MANA_PER_POP_PER_SEC × totalPop × dt`, capped at `MANA_MAX`
4. AI update (if AI teams present)
5. `computeCrops` — every tick, for rendering + growth
6. Every 1s: `evaluateSettlementLevels` (skipped during armageddon)
7. Every tick: `updatePopulationGrowth(state, dt)` — continuous crop-based growth + dwell ejection (skipped during armageddon)
8. Age and prune fires (5s lifetime)
9. Every 3s: `pruneDeadEntities` (clears dead walkers/settlements, resets leaders)
10. Win check after 30s grace period (team with 0 pop is eliminated, last team standing wins)
11. Delta serialize + send state to all players

#### Starting Conditions
- `START_WALKERS=3` walkers per team, `START_STRENGTH=5` each, `START_MANA=50`
- Walkers spawned near team spawn zones (computed by `computeSpawnZones` based on map size and team count)

### Client (`public/game.js`)
- **Rendering only:** No simulation. Receives state from server at 20Hz (full or delta).
- **Delta state application:** `applyStateSnapshot` routes to `applyFullSnapshot` (on `msg.full`) or `applyDeltaSnapshot`. Persistent `walkerMap` (Map by id) and `settlementMap` (Map by "tx,ty") enable incremental updates. Delta applies `wMov`/`wUpd`/`wRem` and `sUpd`/`sRem`, only processes fields present in the message. Helper functions `applySwamps`/`applyRocks`/`applyTrees`/`applyPebbles`/`applyRuins`/`applyCrops`/`applyHeights` shared by both paths.
- **Walker interpolation:** Stores prev/curr walker snapshots, lerps positions by elapsed tick fraction for smooth 60fps rendering. Passes through `isLeader`/`isKnight` flags.
- **Settlement sprites:** 9 levels × 6 teams. Blue/red loaded from `gfx/`. Green/yellow/purple/orange generated via canvas tinting from blue sprites. Sprite sizing varies by level.
- **Walker sprites:** Directional (se/nw + mirrored sw/ne), 2 frames, blue/red loaded, other teams tinted.
- **Space background:** Dark cosmic void with 300 twinkling stars and 3 nebula glows (cached to offscreen canvas). Stars have random brightness and twinkle speed. Rare diffraction spikes.
- **Waterfall particles:** 3000-particle pool on front map edges. Particles stored in grid coordinates with pixel offsets so they scroll with the map. Edge mist effect.
- **Fire particles:** Spawned at burning settlement ruins (from `fires[]` in state). Intensity decreases over 5s fire lifetime.
- **Terrain rendering:** Pre-rendered land tile cache (shape × color × swamp variants, `VALID_SHAPE_KEYS` excludes saddle shapes). Terrain buffer (full-map offscreen canvas) with dirty-tile tracking for incremental redraws. `detectTerrainDirty` compares typed arrays for overlay changes.
- **Drawing pipeline:** Space background (screen space) → zoom transform → terrain buffer blit → settlements (depth-sorted) → walkers via grid (leader crown / knight cross) → fire particles → targeting overlay → magnet flags → edge mist → waterfall particles → reset to screen space → sidebar update → minimap → population meters → inspect tooltip → armageddon/game over overlays.
- **Overlays:** Crop tiles (per-team colors via `CROP_OVERLAY_COLORS`), swamp tiles (green-brown, baked into land tile cache), rock tiles (boulder sprite), pebble tiles (pebble sprite), ruin tiles (ruin sprite), tree tiles (tree sprite). All use Uint8Array typed arrays for O(1) lookup.
- **Targeting mode:** `targetingPower` variable. For earthquake/volcano shows orange-tinted radius overlay. For swamp shows single-tile highlight. Click sends `{type:'power', power, x, y}`, Escape cancels.
- **Armageddon overlay:** Red "ARMAGEDDON" text with screen shake, disables all player input except camera.
- **Sea level:** Mutable `seaLevel` variable, updated from server state.
- **Minimap:** 200×200px top-down map in bottom-right corner. Multiple passes: terrain, crops, trees, swamps, settlements, walkers, magnets, viewport bounds. Click scrolls main view.
- **Population meters:** Vertical bars per team centered at top of screen, showing relative team population.
- **Inspect tool:** `I` hotkey toggles inspect mode. Click on settlement or walker shows tooltip with stats.
- **Zoom:** Mouse wheel zoom. Min zoom dynamically calculated to fit entire map.
- **Input:** LMB raise (or power targeting click, or minimap click, or inspect click), RMB lower, Shift+LMB magnet, 1-4 mode keys, Q/W/E/R/T/Y power hotkeys, F magnet mode, I inspect toggle, Escape cancel targeting/inspect, M mute toggle, MMB pan, G grid toggle (3 modes), mouse wheel zoom, edge pan. Armageddon blocks all non-camera input.
- **Guide modal:** Fetches `guide.md`, parses markdown to HTML client-side (`parseMarkdown`/`inlineFormat`), displays in scrollable overlay modal. Accessible from lobby ("How to Play" link) and sidebar bottom ("How to Play" button).
- **Settings:** Popup triggered from sidebar bottom. Toggles: Hi-Res Textures, Effects, Music (with volume slider), Simplify at Low Zoom. All persisted to `localStorage`.
- **Sidebar:** Left-side panel (160px). Sections: population bars (N teams), mana bar, 2×2 mode grid, powers list, tools (Magnet/Inspect), team stats, opponent stats. Bottom: Settings + How to Play links (tiny font), FPS/frame-time counter (8px).
- **Music:** 4 tracks in `public/music/`, shuffled and played sequentially in a loop. Starts on game start. Volume (0-1, default 0.3) and mute state persisted to `localStorage`.
- **Lobby:** Tabbed Create Game / Game Browser interface, player name input, lobby chat, room waiting area with player list, add/remove AI, room chat, host-controlled start.

### HTML/CSS (`public/index.html`)
- Full-viewport canvas with crosshair cursor
- Lobby overlay (`#lobby`): centered `.lobby-box` with title, "How to Play" link, player name input, tabbed create/browse sections, lobby chat, waiting room with room chat
- Sidebar (`#sidebar`): fixed left panel, 160px wide. Sections: population bars, mana bar, 2×2 mode grid (`.mode-grid`), powers list (`.power-list`), tools, stats, bottom links (Settings | How to Play in 8px font), FPS counter (8px). `.disabled` (opacity 0.35), `.active` (orange border + glow for powers, green for modes).
- Settings popup (`#settings-popup`): fixed near sidebar, toggle buttons for rendering options
- Guide modal (`#guide-overlay`): full-screen overlay with scrollable `.guide-modal` containing parsed markdown. Styled tables, headers, lists. Custom scrollbar.

### Key Design Patterns
- **Authoritative server:** All game logic is server-side. Client is pure renderer + input sender.
- **Delta serialization:** Server tracks previous state per field. Full snapshots every 100 ticks and on connect/resync. Delta messages omit unchanged fields. ~98% bandwidth reduction.
- **Dual-environment constants:** `shared/constants.js` uses `if (typeof module !== 'undefined') module.exports = {...}` pattern.
- **State-first functions:** All server game functions take `state` as first parameter.
- **String-key Sets:** Swamps, rocks, trees, pebbles use `"x,y"` string keys in Sets for O(1) tile lookup.
- **Typed array overlays:** Client uses Uint8Array per tile type (swampTiles, rockTiles, treeTiles, pebbleTiles, ruinTiles, cropTeamTiles) for O(1) lookup and efficient dirty detection via array comparison.
- **Terrain buffer caching:** Full-map offscreen canvas with per-tile dirty tracking. Only redraws changed tiles. Full redraw on sea level change or >25% tiles dirty.
- **Mutable sea level:** `state.seaLevel` replaces the constant `SEA_LEVEL` on server, `seaLevel` variable replaces it on client, enabling the Flood power.
- **Power validation:** Server validates power name against POWERS array, checks mana, validates coordinates for targeted powers. Some powers (`swamp`, `knight`) return false on invalid state to prevent mana deduction.
- **Crop-based settlement levels:** Settlement level determined by count of flat tiles in zone, not by flat square size. No settlement merges.
- **Settlement assault:** Gradual siege with damage accumulators. Capture on population depletion (knight exception: destroy + ruins). Knights use fixed assault multiplier and take 2× retaliation for balanced siege gameplay.
- **Tech inheritance:** Walkers inherit tech level from their settlement when ejected. Tech affects combat via `TECH_ADVANTAGE_MULT`.
- **Papal magnet lifecycle:** Magnet drops and locks on leader death, unlocks when new leader assigned. Prevents magnet manipulation without a leader.
- **localStorage persistence:** Music volume, mute state, graphics settings saved across sessions.
- **Admin metrics:** Server tracks per-room tick time, bytes sent/received rates. Admin dashboard via `/admin`.

### Tuning Philosophy
Target: ~20 minute games, slow strategic pace. Terrain manipulation is nearly free (1 mana). Population growth is gradual (0.1 per crop/sec). Ejection has 15s dwell time. Walker speed is slow (0.8 tiles/sec, ~80s to cross map). Powers are exponentially spaced: swamp (60) is tactical, knight (200) is an investment, earthquake (1500) is rare, volcano (5000) is once-per-game. Mana generation is slow (0.0075/pop/sec) making every power a meaningful decision.
