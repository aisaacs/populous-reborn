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
    TICK_RATE, TICK_INTERVAL,
  };
}
