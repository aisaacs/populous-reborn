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
const WALKER_SPEED = 0.8;
const MAX_LEVEL = 9;
const LEVEL_CAPACITY = [0, 4, 8, 15, 30, 55, 90, 140, 200, 255];

// ── Settlement Levels ──────────────────────────────────────────────
// Index 0 unused; levels 1-9
const SETTLEMENT_LEVELS = [
  null,
  { name: 'tent',       minCrops: 0,  capacity: 4,   tech: 0, sprite: 'tent',       footprint: 1 },
  { name: 'hut',        minCrops: 2,  capacity: 8,   tech: 1, sprite: 'hut',        footprint: 1 },
  { name: 'cottage',    minCrops: 4,  capacity: 15,  tech: 1, sprite: 'cottage',    footprint: 1 },
  { name: 'house',      minCrops: 7,  capacity: 30,  tech: 2, sprite: 'house',      footprint: 1 },
  { name: 'largehouse', minCrops: 10, capacity: 55,  tech: 2, sprite: 'largehouse', footprint: 1 },
  { name: 'manor',      minCrops: 13, capacity: 90,  tech: 3, sprite: 'manor',      footprint: 1 },
  { name: 'towerhouse', minCrops: 17, capacity: 140, tech: 3, sprite: 'towerhouse', footprint: 1 },
  { name: 'fortress',   minCrops: 20, capacity: 200, tech: 4, sprite: 'fortress',   footprint: 1 },
  { name: 'castle',     minCrops: 24, capacity: 255, tech: 4, sprite: 'castle',     footprint: 9 },
];

// ── Powers ──────────────────────────────────────────────────────────
const POWERS = [
  { id: 'earthquake', name: 'Earthquake', cost: 1500,  hotkey: 'Q', targeted: true },
  { id: 'swamp',      name: 'Swamp',      cost: 60,    hotkey: 'W', targeted: true },
  { id: 'knight',     name: 'Knight',     cost: 200,   hotkey: 'E', targeted: false },
  { id: 'volcano',    name: 'Volcano',    cost: 5000,  hotkey: 'R', targeted: true },
  { id: 'flood',      name: 'Flood',      cost: 500,   hotkey: 'T', targeted: false },
  { id: 'armageddon', name: 'Armageddon', cost: 0,     hotkey: 'Y', targeted: false },
];
const EARTHQUAKE_RADIUS = 7;
const VOLCANO_RADIUS = 5;
const KNIGHT_STRENGTH_MULT = 3;
const KNIGHT_SPEED_MULT = 1.5;

// ── Terrain ──────────────────────────────────────────────────────────
const TERRAIN_TREES = 0.06;
const TERRAIN_RAISE_COST = 1;
const TERRAIN_LOWER_COST = 1;

// ── Crops ────────────────────────────────────────────────────────────
const CROP_ZONE_RADIUS = 2;
const CROP_LEVEL_THRESHOLDS = [0, 0, 2, 4, 7, 10, 13, 17, 20, 24];
const GROWTH_PER_CROP_PER_SEC = 0.1;

// ── Walker Ejection ─────────────────────────────────────────────────
const EJECT_DWELL_TIME = 15;
const EJECT_FRACTION = 0.5;
const EJECT_MIN_STRENGTH = 2;

// ── Mana ────────────────────────────────────────────────────────────
const MANA_PER_POP_PER_SEC = 0.015;
const MANA_MAX = 6000;

// ── Combat ──────────────────────────────────────────────────────────
const TECH_ADVANTAGE_MULT = 1.5;
const WALKER_ATTRITION_PER_SEC = 0.05;

// ── Build Proximity ─────────────────────────────────────────────────
const BUILD_PROXIMITY_RADIUS = 6;

// ── Starting Conditions ─────────────────────────────────────────────
const START_WALKERS = 3;
const START_STRENGTH = 5;
const START_MANA = 50;

// ── Tick ────────────────────────────────────────────────────────────
const TICK_RATE = 20;
const TICK_INTERVAL = 50;

// ── Dual-environment export ─────────────────────────────────────────
if (typeof module !== 'undefined') {
  module.exports = {
    MAP_W, MAP_H, TILE_HALF_W, TILE_HALF_H, HEIGHT_STEP, MAX_HEIGHT, SEA_LEVEL,
    TEAM_BLUE, TEAM_RED, TEAM_COLORS, TEAM_NAMES,
    MODE_SETTLE, MODE_MAGNET, MODE_FIGHT, MODE_GATHER, MODE_NAMES,
    WALKER_SPEED, MAX_LEVEL, LEVEL_CAPACITY, SETTLEMENT_LEVELS,
    POWERS, EARTHQUAKE_RADIUS, VOLCANO_RADIUS, KNIGHT_STRENGTH_MULT, KNIGHT_SPEED_MULT,
    TERRAIN_TREES, TERRAIN_RAISE_COST, TERRAIN_LOWER_COST,
    CROP_ZONE_RADIUS, CROP_LEVEL_THRESHOLDS, GROWTH_PER_CROP_PER_SEC,
    EJECT_DWELL_TIME, EJECT_FRACTION, EJECT_MIN_STRENGTH,
    MANA_PER_POP_PER_SEC, MANA_MAX,
    TECH_ADVANTAGE_MULT, WALKER_ATTRITION_PER_SEC,
    BUILD_PROXIMITY_RADIUS,
    START_WALKERS, START_STRENGTH, START_MANA,
    TICK_RATE, TICK_INTERVAL,
  };
}
