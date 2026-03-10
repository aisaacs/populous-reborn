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
const MAX_TEAMS = 6;
const TEAM_BLUE = 0;
const TEAM_RED = 1;
const TEAM_GREEN = 2;
const TEAM_YELLOW = 3;
const TEAM_PURPLE = 4;
const TEAM_ORANGE = 5;
const TEAM_COLORS = ['#4488ff', '#ff4444', '#44cc44', '#cccc22', '#aa44ff', '#ff8800'];
const TEAM_NAMES = ['Blue', 'Red', 'Green', 'Yellow', 'Purple', 'Orange'];
const TEAM_SPRITE_NAMES = ['blue', 'red', 'green', 'yellow', 'purple', 'orange'];

// ── Map Size Presets ────────────────────────────────────────────────
const MAP_SIZE_PRESETS = {
  small:  { w: 64,  h: 64 },
  medium: { w: 96,  h: 96 },
  large:  { w: 128, h: 128 },
};

// ── Modes ───────────────────────────────────────────────────────────
const MODE_SETTLE = 0;
const MODE_GATHER = 1;
const MODE_FIGHT = 2;
const MODE_NAMES = ['Settle', 'Gather', 'Fight'];

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
  { name: 'castle',     minCrops: 24, capacity: 255, tech: 4, sprite: 'castle',     footprint: 25 },
];

// ── Powers ──────────────────────────────────────────────────────────
const POWERS = [
  { id: 'lightning',  name: 'Lightning',  cost: 40,    hotkey: 'Q', targeted: true },
  { id: 'swamp',      name: 'Swamp',      cost: 75,    hotkey: 'W', targeted: true },
  { id: 'earthquake', name: 'Earthquake', cost: 250,   hotkey: 'E', targeted: true },
  { id: 'knight',     name: 'Knight',     cost: 400,   hotkey: 'R', targeted: false },
  { id: 'meteor',     name: 'Meteor',     cost: 1500,  hotkey: 'T', targeted: true },
  { id: 'volcano',    name: 'Volcano',    cost: 2500,  hotkey: 'Y', targeted: true },
  { id: 'flood',      name: 'Flood',      cost: 3000,  hotkey: 'U', targeted: false },
  { id: 'armageddon', name: 'Armageddon', cost: 5000,  hotkey: 'I', targeted: false },
];
const EARTHQUAKE_RADIUS = 3;
const METEOR_RADIUS = 4;
const VOLCANO_RADIUS = 5;
const KNIGHT_STRENGTH_MULT = 1.75;
const KNIGHT_SPEED_MULT = 1.5;
const KNIGHT_ATTRITION_PER_SEC = 0.5; // knights burn out ~8-10x faster than normal walkers
const KNIGHT_ASSAULT_MULT = 8; // knights use fixed assault multiplier instead of strength-based
const KNIGHT_RETAL_MULT = 2; // settlements deal extra retaliation damage to knights

// ── Terrain ──────────────────────────────────────────────────────────
const TERRAIN_TREES = 0.06;
const TERRAIN_PEBBLES = 0.04;
const TERRAIN_RAISE_COST = 6;
const TERRAIN_LOWER_COST = 6;

// ── Crops ────────────────────────────────────────────────────────────
const CROP_ZONE_RADIUS = 2;
const CROP_LEVEL_THRESHOLDS = [0, 0, 2, 4, 7, 10, 13, 17, 20, 24];
const GROWTH_PER_CROP_PER_SEC = 0.1;
// Level-based growth multiplier: L1 tents can't grow, L5 = 1.0x breakeven, castles = 2.0x
const GROWTH_LEVEL_MULT = [0, 0, 0.2, 0.35, 0.6, 1.0, 1.2, 1.4, 1.7, 2.0];

// ── Walker Ejection ─────────────────────────────────────────────────
const EJECT_DWELL_TIME = 15;
const EJECT_FRACTION = 0.5;
const EJECT_MIN_STRENGTH = 2;

// ── Mana ────────────────────────────────────────────────────────────
const MANA_PER_POP_PER_SEC = 0.0075;
const MANA_MAX = 6000;

// ── Combat ──────────────────────────────────────────────────────────
const TECH_ADVANTAGE_MULT = 1.5;
const WALKER_ATTRITION_PER_SEC = 0.05;
const HOMELESS_ATTRITION_PER_SEC = 0.5;
const ASSAULT_DMG_PER_SEC = 3; // damage dealt per second when assaulting a settlement
const ASSAULT_RETALIATE_FRAC = 0.5; // fraction of damage the settlement deals back

// ── Build Proximity ─────────────────────────────────────────────────
const BUILD_PROXIMITY_RADIUS = 6;

// ── Starting Conditions ─────────────────────────────────────────────
const START_WALKERS = 3;
const START_STRENGTH = 5;
const START_MANA = 50;

// ── Terrain Type Presets ───────────────────────────────────────────
const TERRAIN_TYPE_PRESETS = {
  continental: {
    noiseScale: 0.7, noiseBias: 0.5, heightMul: 1.55,
    maskPower: 1.0, seaLevel: 0,
    rockRate: 0.03, freqBase: 0.03, freqRange: 0.05,
    spawnRBase: 0.4, spawnRRange: 0.25,
    extraRBase: 0.2, extraRRange: 0.35, extraCentersMax: 4,
    treeRate: 0.06, pebbleRate: 0.04,
  },
  archipelago: {
    noiseScale: 0.9, noiseBias: 0.45, heightMul: 1.5,
    maskPower: 0.3, seaLevel: 3,
    rockRate: 0.02, freqBase: 0.06, freqRange: 0.04,
    spawnRBase: 0.45, spawnRRange: 0.2,
    extraRBase: 0.3, extraRRange: 0.2, extraCentersMax: 3,
    treeRate: 0.04, pebbleRate: 0.03,
  },
  mountains: {
    noiseScale: 0.9, noiseBias: 0.45, heightMul: 1.5,
    maskPower: 0.3, seaLevel: 0,
    rockRate: 0.06, freqBase: 0.06, freqRange: 0.04,
    spawnRBase: 0.45, spawnRRange: 0.2,
    extraRBase: 0.3, extraRRange: 0.2, extraCentersMax: 3,
    treeRate: 0.03, pebbleRate: 0.06,
  },
  flatlands: {
    noiseScale: 0.5, noiseBias: 0.6, heightMul: 0.75,
    maskPower: 0.5, seaLevel: 0,
    rockRate: 0.01, freqBase: 0.02, freqRange: 0.03,
    spawnRBase: 0.55, spawnRRange: 0.25,
    extraRBase: 0.4, extraRRange: 0.35, extraCentersMax: 5,
    treeRate: 0.08, pebbleRate: 0.02,
  },
};

// ── Tick ────────────────────────────────────────────────────────────
const TICK_RATE = 20;
const TICK_INTERVAL = Math.round(1000 / TICK_RATE);

// ── Dual-environment export ─────────────────────────────────────────
if (typeof module !== 'undefined') {
  module.exports = {
    MAP_W, MAP_H, TILE_HALF_W, TILE_HALF_H, HEIGHT_STEP, MAX_HEIGHT, SEA_LEVEL,
    MAX_TEAMS, TEAM_BLUE, TEAM_RED, TEAM_GREEN, TEAM_YELLOW, TEAM_PURPLE, TEAM_ORANGE,
    TEAM_COLORS, TEAM_NAMES, TEAM_SPRITE_NAMES, MAP_SIZE_PRESETS,
    MODE_SETTLE, MODE_GATHER, MODE_FIGHT, MODE_NAMES,
    WALKER_SPEED, MAX_LEVEL, LEVEL_CAPACITY, SETTLEMENT_LEVELS,
    POWERS, EARTHQUAKE_RADIUS, METEOR_RADIUS, VOLCANO_RADIUS, KNIGHT_STRENGTH_MULT, KNIGHT_SPEED_MULT, KNIGHT_ATTRITION_PER_SEC, KNIGHT_ASSAULT_MULT, KNIGHT_RETAL_MULT,
    TERRAIN_TREES, TERRAIN_PEBBLES, TERRAIN_RAISE_COST, TERRAIN_LOWER_COST,
    CROP_ZONE_RADIUS, CROP_LEVEL_THRESHOLDS, GROWTH_PER_CROP_PER_SEC, GROWTH_LEVEL_MULT,
    EJECT_DWELL_TIME, EJECT_FRACTION, EJECT_MIN_STRENGTH,
    MANA_PER_POP_PER_SEC, MANA_MAX,
    TECH_ADVANTAGE_MULT, WALKER_ATTRITION_PER_SEC, HOMELESS_ATTRITION_PER_SEC, ASSAULT_DMG_PER_SEC, ASSAULT_RETALIATE_FRAC,
    BUILD_PROXIMITY_RADIUS,
    START_WALKERS, START_STRENGTH, START_MANA,
    TERRAIN_TYPE_PRESETS,
    TICK_RATE, TICK_INTERVAL,
  };
}
