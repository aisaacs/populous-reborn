# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Start server:** `npm start` (runs `node server.js`, serves on port 3000)
- No build step, linter, or test suite configured.

## Architecture

This is a Populous-inspired isometric terrain editor running entirely in the browser.

**Server (`server.js`):** Minimal Express 5 static file server. Serves everything in `public/`.

**Client (`public/game.js`):** Single-file game engine rendering a 64×64 isometric tile map on an HTML5 canvas. Key systems:

- **Height map:** `(MAP_W+1) × (MAP_H+1)` integer grid (0–8). Terrain is procedurally generated at startup via blob/island placement (`generateIsland` → `placeBlob`) with an adjacency enforcement pass ensuring no neighbor differs by more than 1 height level.
- **Rendering:** Painter's algorithm (back-to-front row/col loop). Each tile is a diamond formed by projecting its 4 corner heights with a 2:1 isometric ratio (32×16px tiles). Colors are height-based with slope darkening.
- **Terrain editing:** Left-click raises, right-click lowers a grid point. Changes propagate via BFS to maintain the ≤1 adjacency constraint.
- **Picking:** `screenToGrid` reverse-projects screen coordinates, searching nearby grid points to account for height displacement.
- **Camera:** Middle-mouse panning via offset (`camX`, `camY`). G key cycles grid overlay modes.

All game state lives in the `heights[][]` array. There are no units, settlements, or game loop yet — terrain manipulation only.
