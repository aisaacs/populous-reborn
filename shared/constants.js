'use strict';

// ── Map & Tile ──────────────────────────────────────────────────────
const MAP_W = 64;
const MAP_H = 64;
const TILE_HALF_W = 16;
const TILE_HALF_H = 8;
const HEIGHT_STEP = 8;
const MAX_HEIGHT = 8;
const SEA_LEVEL = 0;

// ── Teams ───────────────────────────────────────────────────────────
const TEAM_BLUE = 0;
const TEAM_RED = 1;
const TEAM_COLORS = ['#4488ff', '#ff4444'];
const TEAM_NAMES = ['Blue', 'Red'];

// ── Modes ───────────────────────────────────────────────────────────
const MODE_SETTLE = 0;
const MODE_MAGNET = 1;
const MODE_FIGHT = 2;
const MODE_GATHER = 3;
const MODE_NAMES = ['Settle', 'Magnet', 'Fight', 'Gather'];

// ── Gameplay ────────────────────────────────────────────────────────
const WALKER_SPEED = 1.5;
const LEVEL_CAPACITY = [0, 6, 20, 50, 100, 200];

// ── Powers ──────────────────────────────────────────────────────────
const POWERS = [
  { id: 'earthquake', name: 'Earthquake', cost: 200,   hotkey: 'Q', targeted: true },
  { id: 'swamp',      name: 'Swamp',      cost: 350,   hotkey: 'W', targeted: true },
  { id: 'knight',     name: 'Knight',     cost: 600,   hotkey: 'E', targeted: false },
  { id: 'volcano',    name: 'Volcano',    cost: 1500,  hotkey: 'R', targeted: true },
  { id: 'flood',      name: 'Flood',      cost: 4000,  hotkey: 'T', targeted: false },
  { id: 'armageddon', name: 'Armageddon', cost: 10000, hotkey: 'Y', targeted: false },
];
const EARTHQUAKE_RADIUS = 7;
const VOLCANO_RADIUS = 5;
const KNIGHT_STRENGTH_MULT = 3;
const KNIGHT_SPEED_MULT = 1.5;

// ── Terrain ──────────────────────────────────────────────────────────
const TERRAIN_TREES = 0.06; // fraction of land tiles with trees

// ── Crops ────────────────────────────────────────────────────────────
const CROP_ZONE_RADIUS = 2;  // 5×5 evaluation zone (center ± 2)
const CROP_LEVEL_THRESHOLDS = [0, 0, 4, 8, 13, 18]; // crop count to reach level (indexed by level)
const CROP_GROWTH_FACTOR = 0.5; // population growth per crop tile per growth tick

// ── Tick ────────────────────────────────────────────────────────────
const TICK_RATE = 20;
const TICK_INTERVAL = 50;

// ── Dual-environment export ─────────────────────────────────────────
if (typeof module !== 'undefined') {
  module.exports = {
    MAP_W, MAP_H, TILE_HALF_W, TILE_HALF_H, HEIGHT_STEP, MAX_HEIGHT, SEA_LEVEL,
    TEAM_BLUE, TEAM_RED, TEAM_COLORS, TEAM_NAMES,
    MODE_SETTLE, MODE_MAGNET, MODE_FIGHT, MODE_GATHER, MODE_NAMES,
    WALKER_SPEED, LEVEL_CAPACITY,
    POWERS, EARTHQUAKE_RADIUS, VOLCANO_RADIUS, KNIGHT_STRENGTH_MULT, KNIGHT_SPEED_MULT,
    TERRAIN_TREES, CROP_ZONE_RADIUS, CROP_LEVEL_THRESHOLDS, CROP_GROWTH_FACTOR,
    TICK_RATE, TICK_INTERVAL,
  };
}
