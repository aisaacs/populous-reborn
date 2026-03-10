# The Flattening — Balance Reference

All values defined in `shared/constants.js`. This doc explains the *why* behind each number.

---

## Starting Conditions

| Param | Value | Notes |
|-------|-------|-------|
| `START_WALKERS` | 3 | Per team, spawned near team's zone |
| `START_STRENGTH` | 5 | Each starting walker |
| `START_MANA` | 50 | ~8 terrain clicks at 6 mana each |

## Terrain Manipulation

| Param | Value | Notes |
|-------|-------|-------|
| `TERRAIN_RAISE_COST` | 6 | Mana per raise click |
| `TERRAIN_LOWER_COST` | 6 | Mana per lower click |
| `BUILD_PROXIMITY_RADIUS` | 6 | Must be within 6 tiles of own walker/settlement |

Terrain is the core mechanic — flattening land to upgrade settlements. Cost of 6 makes early
terraforming deliberate (~8 clicks from starting mana) while becoming cheap mid-game as mana
flows in. Proximity radius prevents cross-map griefing.

## Settlement Levels

9 levels. Level determines capacity, tech, and sprite. Level is set by crop count in zone.

| Lvl | Name | Crops Needed | Capacity | Tech | Growth Mult | Footprint |
|-----|------|-------------|----------|------|-------------|-----------|
| 1 | Tent | 0 | 4 | 0 | 0.4x | 1x1 |
| 2 | Hut | 2 | 8 | 1 | 0.5x | 1x1 |
| 3 | Cottage | 4 | 15 | 1 | 0.6x | 1x1 |
| 4 | House | 7 | 30 | 2 | 0.8x | 1x1 |
| 5 | Large House | 10 | 55 | 2 | 1.0x | 1x1 |
| 6 | Manor | 13 | 90 | 3 | 1.1x | 1x1 |
| 7 | Tower House | 17 | 140 | 3 | 1.2x | 1x1 |
| 8 | Fortress | 20 | 200 | 4 | 1.3x | 1x1 |
| 9 | Castle | 24 | 255 | 4 | 1.5x | 5x5 |

**Growth mult** (`GROWTH_LEVEL_MULT`): Scales population growth rate. L5 is the breakeven (1.0x).
Low-level settlements grow significantly slower, preventing tent spam from outpacing castles.
A single castle outproduces ~87 tents in walker generation.

**Castle footprint**: 5x5 tiles must all be flat. If any tile becomes non-flat, castle downgrades
to fortress (L8). This is the payoff for heavy terrain investment.

## Crop System

| Param | Value | Notes |
|-------|-------|-------|
| `CROP_ZONE_RADIUS` | 2 | 5x5 zone around settlement home tile |
| `CROP_LEVEL_THRESHOLDS` | 0,0,2,4,7,10,13,17,20,24 | Crops needed for each level |
| `GROWTH_PER_CROP_PER_SEC` | 0.1 | Base growth rate per crop tile per second |

Crops are flat tiles in the settlement's zone (excluding water, rocks, pebbles, swamps, ruins,
other settlements' footprints). Trees auto-clear when in crop zone.

**Fractional sharing**: When multiple same-team settlements share a crop tile, growth value is
split proportionally by level (castle 9 + house 4 sharing = castle gets 9/13, house gets 4/13).
Level evaluation uses raw integer counts (each settlement counts the full tile).

**Enemy blocking**: Tiles claimed by 2+ different teams are contested — no one gets them.

## Population Growth & Ejection

| Param | Value | Notes |
|-------|-------|-------|
| `EJECT_DWELL_TIME` | 15s | Time at capacity before ejecting (all levels) |
| `EJECT_FRACTION` | 0.5 | Ejects 50% of population |
| `EJECT_MIN_STRENGTH` | 2 | Minimum ejection strength |

Growth is continuous: `crops * 0.1 * growthMult * dt` per tick. Ejection only happens in
**Settle mode**. At capacity, settlement waits 15s then ejects half as a new walker inheriting
the settlement's tech level. Over-capacity from level downgrade ejects immediately.

### Production rates (approximate, 1 crop each unless noted)

| Level | Effective growth/sec | Fill time | Eject cycle | Walkers/sec |
|-------|---------------------|-----------|-------------|-------------|
| L1 Tent | 0.04 | 100s | 115s | 0.017 |
| L5 Large House | 0.10 | 55s | 70s | 0.39 |
| L9 Castle (24 crops) | 3.60 | 71s | 86s | 1.48 |

## Walker Stats

| Param | Value | Notes |
|-------|-------|-------|
| `WALKER_SPEED` | 0.8 | Tiles/sec. ~80s to cross a 64-tile map |
| `WALKER_ATTRITION_PER_SEC` | 0.05 | Slow strength drain over time |
| `HOMELESS_ATTRITION_PER_SEC` | 0.5 | 10x attrition when team has no settlements |

Walkers carry strength (1-255) and tech (0-4, inherited from settlement). They move toward
targets based on team mode: Settle (find flat land), Magnet (go to papal magnet), Fight
(attack enemies), Gather (go to own settlements).

## Combat

| Param | Value | Notes |
|-------|-------|-------|
| `TECH_ADVANTAGE_MULT` | 1.5 | Damage multiplier per tech level difference |
| `ASSAULT_DMG_PER_SEC` | 3 | Walker damage to settlements, scaled by strength |
| `ASSAULT_RETALIATE_FRAC` | 0.5 | Settlement hits back at 50% of damage dealt |

**Walker vs walker**: Effective strength = `strength * 1.5^techDiff`. Higher wins, keeps remainder.

**Settlement siege**: Walkers deal `3 * (strength/5) * techMult` DPS. Settlement retaliates at
50%. Gradual siege — small settlements fall fast, fortresses/castles are tough.

## Knights

| Param | Value | Notes |
|-------|-------|-------|
| `KNIGHT_STRENGTH_MULT` | 1.75 | Strength = settlement pop * 1.75 |
| `KNIGHT_SPEED_MULT` | 1.5 | Move 50% faster |
| `KNIGHT_ATTRITION_PER_SEC` | 0.5 | Burns out ~10x faster than normal walkers |
| `KNIGHT_ASSAULT_MULT` | 8 | Fixed siege damage multiplier (ignores strength scaling) |
| `KNIGHT_RETAL_MULT` | 2 | Settlements deal 2x retaliation to knights |

Knights are glass cannons. Created from leader at a settlement (consuming it). Always fight,
can't be steered, immune to swamps, avoid swamps via perpendicular dodge. Destroy settlements
(leaving ruins) rather than capturing them.

## Mana

| Param | Value | Notes |
|-------|-------|-------|
| `MANA_PER_POP_PER_SEC` | 0.0075 | Per settlement population unit |
| `MANA_MAX` | 6000 | Hard cap |

Mana generation example: 500 total pop = 3.75 mana/sec = 225 mana/min. First earthquake (~250)
available after ~1 min of having 500 pop. Volcano (1500) requires sustained high population.

## Powers

Ordered by cost. Hotkeys Q-Y left to right.

| Power | Cost | Key | Targeted | Effect |
|-------|------|-----|----------|--------|
| Swamp | 75 | Q | Yes | 3-5 swamp tiles near target. Enemy walkers die on contact (knights immune) |
| Earthquake | 250 | W | Yes | Random raise/lower in radius 7. Devastates settlements |
| Knight | 400 | E | No | Leader + settlement → knight. Consumes settlement, creates ruins |
| Volcano | 1500 | R | Yes | Raise to max height in radius 5, add rocks, kill everything |
| Flood | 3000 | T | No | Lower ALL terrain by 1. Drowns low-lying entities |
| Armageddon | 5000 | Y | No | Destroy all settlements, everyone fights at map center. Drains all mana |

**Design intent**: Swamp/earthquake are tactical (affordable, frequent). Knight is a mid-game
investment. Volcano/flood are strategic (rare, game-changing). Armageddon is the endgame gambit.

## Tick & Network

| Param | Value | Notes |
|-------|-------|-------|
| `TICK_RATE` | 20 | Server simulation ticks per second |
| `TICK_INTERVAL` | 50ms | Derived from tick rate |

Delta compression reduces bandwidth ~98%. Full snapshots every 100 ticks (5s) and on resync.

## Map Sizes

| Preset | Size | Tiles | Notes |
|--------|------|-------|-------|
| Small | 64x64 | 4,096 | Fast games, tight quarters |
| Medium | 96x96 | 9,216 | Standard |
| Large | 128x128 | 16,384 | Long games, room to expand |

## Terrain Types

| Type | Sea Level | Character |
|------|-----------|-----------|
| Continental | 0 | Default. Single landmass, moderate terrain |
| Archipelago | 3 | High sea, fragmented islands. Water control matters |
| Mountains | 0 | Steep, rocky. Hard to flatten, many rocks |
| Flatlands | 0 | Gentle terrain, many trees. Easy expansion |
