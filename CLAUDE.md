# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Start server:** `npm start` (runs `node server.js`, serves on port 3000)
- No build step, linter, or test suite configured.

## Architecture

This is a Populous-inspired 1v1 multiplayer isometric game with authoritative server.

### File Structure
- `shared/constants.js` — Constants shared between server and client (map size, teams, modes, tick rate)
- `server.js` — HTTP static server + WebSocket server + game simulation + room management
- `public/game.js` — Renderer + WebSocket client + walker interpolation + lobby handlers
- `public/index.html` — Lobby UI + game canvas

### Server (`server.js`)
- **HTTP:** Serves `public/` at root and `shared/` at `/shared/` using raw `http` + `fs` (no Express)
- **Rooms:** Map of 4-letter room codes → game instances. Player 1 creates, Player 2 joins.
- **Simulation:** Runs at 20Hz tick rate. All game logic (terrain gen, walker movement/targeting, settlements, combat, mana, population growth) lives server-side. Every function takes `state` as first parameter.
- **WebSocket protocol:** Client sends `create`, `join`, `raise`, `lower`, `mode`, `magnet`. Server sends `created`, `joined`, `start`, `state` (20/sec), `gameover`, `error`.
- **State serialization:** Heights as flat array, walkers/settlements as minimal objects. Each player receives only their own mana.

### Client (`public/game.js`)
- **Rendering only:** No simulation. Receives state snapshots from server at 20Hz.
- **Walker interpolation:** Stores prev/curr walker snapshots, lerps positions by elapsed tick fraction for smooth 60fps rendering.
- **Input:** LMB raise, RMB lower, Shift+LMB magnet, 1-4 mode keys → all sent as WebSocket messages. MMB pan + G grid toggle are local-only.
- **Lobby:** Create/Join UI in HTML overlay, hidden when game starts.

### Shared Constants (`shared/constants.js`)
Dual-environment: loaded as `<script>` tag on client (globals), `require()` on server. Contains MAP_W/H, tile sizes, team/mode constants, walker speed, level capacity, tick rate.
