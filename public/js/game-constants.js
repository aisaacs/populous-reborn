'use strict';

// ── Client-only Constants ───────────────────────────────────────────
// Shared constants (MAP_W, MAP_H, etc.) loaded via <script> from /shared/constants.js
const WATER_COLOR = '#2244aa';
const TERRAIN_COLORS = {
  1: '#2a7a2a', 2: '#2a7a2a',
  3: '#44aa44', 4: '#44aa44',
  5: '#66bb33', 6: '#66bb33',
  7: '#887755', 8: '#887755',
};
const SLOPE_DARKEN = 20;
const SHADE_PER_UNIT = 12; // RGB adjustment per shade unit

// Directional shade for a triangle surface facing the player
// Corners: 0=Top(0,0), 1=Right(1,0), 2=Bottom(1,1), 3=Left(0,1)
const _SHADE_GX = [0, 1, 1, 0];
const _SHADE_GY = [0, 0, 1, 1];
function triShade(ci, cj, ck, h) {
  const ax = _SHADE_GX[ci], ay = _SHADE_GY[ci], ah = h[ci];
  const bx = _SHADE_GX[cj], by = _SHADE_GY[cj], bh = h[cj];
  const cx = _SHADE_GX[ck], cy = _SHADE_GY[ck], ch = h[ck];
  const nx = (by - ay) * (ch - ah) - (bh - ah) * (cy - ay);
  const ny = (bh - ah) * (cx - ax) - (bx - ax) * (ch - ah);
  // Primary: toward player (1,1). Secondary: from left (1,-1) for E-W differentiation
  return (nx + ny) + 0.3 * (nx - ny); // = 1.3*nx + 0.7*ny
}

// Terrain band index for a tile. Flat tiles use exact height.
// Slopes use ceil(avg) so 3+1 and 2+2 tiles at the same boundary use the same terrain band.
function tileColorIdx(t, r, b, l) {
  if (t === r && r === b && b === l) return Math.max(1, Math.min(MAX_HEIGHT, t));
  return Math.max(1, Math.min(MAX_HEIGHT, Math.ceil((t + r + b + l) / 4)));
}

function shadeColor(hex, shade) {
  if (shade === 0) return hex;
  const amt = Math.round(shade * SHADE_PER_UNIT);
  const r = Math.max(0, Math.min(255, parseInt(hex.slice(1, 3), 16) + amt));
  const g = Math.max(0, Math.min(255, parseInt(hex.slice(3, 5), 16) + amt));
  const b = Math.max(0, Math.min(255, parseInt(hex.slice(5, 7), 16) + amt));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
const GRID_MODES = [null, 'rgba(0,0,0,0.15)', 'rgba(255,255,255,0.25)'];
let gridMode = 2;

// ── Dynamic Map Dimensions ──────────────────────────────────────────
let localMapW = MAP_W;
let localMapH = MAP_H;
let numTeams = 2;

// ── Crop Overlay Colors (per team) ──────────────────────────────────
const CROP_OVERLAY_COLORS = [
  'rgba(100,180,60,0.35)',   // Blue
  'rgba(160,160,40,0.35)',   // Red
  'rgba(60,180,100,0.35)',   // Green
  'rgba(180,180,60,0.35)',   // Yellow
  'rgba(140,100,180,0.35)',  // Purple
  'rgba(180,140,60,0.35)',   // Orange
];

// ── Minimap Crop Colors (per team) ──────────────────────────────────
const MINIMAP_CROP_COLORS = [
  '#5a8a3a',  // Blue
  '#8a8a2a',  // Red
  '#3a8a5a',  // Green
  '#8a8a3a',  // Yellow
  '#6a4a8a',  // Purple
  '#8a6a2a',  // Orange
];
