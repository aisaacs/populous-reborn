// ── Server-Driven SFX Processing ─────────────────────────────────────
const GLOBAL_SFX = new Set(['earthquake', 'swamp', 'knight', 'volcano', 'flood', 'armageddon', 'lightning', 'meteor']);
const PROXIMITY_ZOOM_THRESHOLD = 0.7;

function processSfxEvents(events) {
  if (!events || events.length === 0) return;
  const now = performance.now();
  for (const evt of events) {
    // Spawn visual effects regardless of zoom/position
    if (evt.n === 'lightning' && evt.x !== undefined) {
      spawnLightningEffect(evt.x, evt.y);
    } else if (evt.n === 'meteor' && evt.x !== undefined) {
      spawnMeteorEffect(evt.x, evt.y);
    } else if (evt.n === 'earthquake') {
      earthquakeShakes.push({ life: 1.2, maxLife: 1.2 });
    } else if (evt.n === 'volcano') {
      earthquakeShakes.push({ life: 2.0, maxLife: 2.0 });
    }

    if (GLOBAL_SFX.has(evt.n)) {
      playSfx(evt.n);
    } else {
      if (zoom < PROXIMITY_ZOOM_THRESHOLD) continue;
      if (evt.x === undefined || evt.y === undefined) continue;
      const h = heightAt(evt.x, evt.y);
      const world = project(evt.x, evt.y, h);
      const sx = world.x * zoom + _vpCX * (1 - zoom);
      const sy = world.y * zoom + _vpCY * (1 - zoom);
      if (sx >= _vpLeft && sx <= canvas.width && sy >= 0 && sy <= canvas.height) {
        if (evt.n === 'combat') {
          if (now - lastCombatSfxTime < 500) continue;
          lastCombatSfxTime = now;
        }
        playSfx(evt.n);
      }
    }
  }
}

// ── Lightning Effect ─────────────────────────────────────────────────
function spawnLightningEffect(gx, gy) {
  // Generate jagged bolt segments from sky to ground
  const segments = [];
  const h = heightAt(gx, gy);
  const ground = project(gx, gy, h);
  const skyY = ground.y - 300;
  let cx = ground.x, cy = skyY;
  const steps = 8 + Math.floor(Math.random() * 5);
  const stepY = (ground.y - skyY) / steps;
  for (let i = 0; i < steps; i++) {
    const nx = cx + (Math.random() - 0.5) * 30;
    const ny = cy + stepY;
    segments.push({ x1: cx, y1: cy, x2: nx, y2: ny });
    cx = nx; cy = ny;
    // Branch with 25% chance
    if (Math.random() < 0.25 && i > 1 && i < steps - 1) {
      const bx = cx + (Math.random() - 0.5) * 50;
      const by = cy + stepY * (0.5 + Math.random() * 0.5);
      segments.push({ x1: cx, y1: cy, x2: bx, y2: by, branch: true });
    }
  }
  // Snap last segment to ground
  if (segments.length > 0) {
    segments[segments.length - 1].x2 = ground.x;
    segments[segments.length - 1].y2 = ground.y;
  }
  lightningBolts.push({
    segments,
    gx, gy,
    life: 0.5,
    maxLife: 0.5,
    flashAlpha: 1,
  });
}

function updateLightningEffects(dt) {
  for (let i = lightningBolts.length - 1; i >= 0; i--) {
    lightningBolts[i].life -= dt;
    lightningBolts[i].flashAlpha = Math.max(0, lightningBolts[i].life / lightningBolts[i].maxLife);
    if (lightningBolts[i].life <= 0) lightningBolts.splice(i, 1);
  }
}

function drawLightningEffects() {
  // Screen darkening effect — darkens early in life, bright flash later
  for (const bolt of lightningBolts) {
    const t = 1 - bolt.life / bolt.maxLife; // 0→1 over lifetime
    let darkAlpha = 0;
    if (t < 0.15) {
      // Quick darken ramp up
      darkAlpha = (t / 0.15) * 0.45;
    } else if (t < 0.3) {
      // Hold dark then fade as flash takes over
      darkAlpha = 0.45 * (1 - (t - 0.15) / 0.15);
    }
    if (darkAlpha > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // screen space
      ctx.fillStyle = 'rgba(0, 0, 0, ' + darkAlpha.toFixed(3) + ')';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }
  }
  for (const bolt of lightningBolts) {
    const alpha = bolt.flashAlpha;
    // Flicker
    const flicker = alpha > 0.3 ? (Math.random() > 0.3 ? 1 : 0.3) : 1;
    const a = alpha * flicker;

    ctx.save();
    // Glow
    ctx.shadowColor = 'rgba(180, 200, 255, ' + (a * 0.8).toFixed(2) + ')';
    ctx.shadowBlur = 15;
    ctx.strokeStyle = 'rgba(220, 230, 255, ' + a.toFixed(2) + ')';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (const seg of bolt.segments) {
      if (seg.branch) continue;
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
    }
    ctx.stroke();

    // Bright core
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, ' + (a * 0.9).toFixed(2) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const seg of bolt.segments) {
      if (seg.branch) continue;
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
    }
    ctx.stroke();

    // Branches (thinner, dimmer)
    ctx.strokeStyle = 'rgba(180, 200, 255, ' + (a * 0.5).toFixed(2) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const seg of bolt.segments) {
      if (!seg.branch) continue;
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
    }
    ctx.stroke();

    // Impact flash at ground
    if (alpha > 0.5) {
      const h = heightAt(bolt.gx, bolt.gy);
      const gnd = project(bolt.gx, bolt.gy, h);
      const flashR = 20 * alpha;
      const grad = ctx.createRadialGradient(gnd.x, gnd.y, 0, gnd.x, gnd.y, flashR);
      grad.addColorStop(0, 'rgba(255, 255, 255, ' + (alpha * 0.6).toFixed(2) + ')');
      grad.addColorStop(0.5, 'rgba(180, 200, 255, ' + (alpha * 0.3).toFixed(2) + ')');
      grad.addColorStop(1, 'rgba(180, 200, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(gnd.x - flashR, gnd.y - flashR, flashR * 2, flashR * 2);
    }
    ctx.restore();

    // Full-screen white flash right after the dark dip
    const t = 1 - bolt.life / bolt.maxLife;
    if (t >= 0.12 && t < 0.35) {
      const flashT = (t - 0.12) / 0.23;
      const whiteAlpha = (1 - flashT) * 0.2;
      if (whiteAlpha > 0.01) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = 'rgba(200, 210, 255, ' + whiteAlpha.toFixed(3) + ')';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
      }
    }
  }
}

// ── Meteor Effect ────────────────────────────────────────────────────
function spawnMeteorEffect(gx, gy) {
  meteorEffects.push({
    gx, gy,
    life: 1.8,
    maxLife: 1.8,
    streakDur: 0.25,  // fast streak — crater forms on server same tick
    impacted: false,
    shakeIntensity: 0,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: 3 + Math.random() * 4,
  });
}

function updateMeteorEffects(dt) {
  for (let i = meteorEffects.length - 1; i >= 0; i--) {
    const m = meteorEffects[i];
    m.life -= dt;
    const elapsed = m.maxLife - m.life;
    if (!m.impacted && elapsed >= m.streakDur) {
      m.impacted = true;
    }
    if (m.impacted) {
      const impactAge = elapsed - m.streakDur;
      m.shakeIntensity = Math.max(0, (1 - impactAge / 0.8) * 8);
    }
    m.rotation += m.rotSpeed * dt;
    if (m.life <= 0) meteorEffects.splice(i, 1);
  }
}

function drawMeteorEffects() {
  for (const m of meteorEffects) {
    const h = heightAt(m.gx, m.gy);
    const ground = project(m.gx, m.gy, h);
    const elapsed = m.maxLife - m.life;

    if (!m.impacted) {
      // Streak phase — meteor sprite flying from upper-left to ground
      const t = elapsed / m.streakDur; // 0 to 1
      // Ease in (accelerate)
      const et = t * t;
      const startX = ground.x - 250, startY = ground.y - 400;
      const cx = startX + (ground.x - startX) * et;
      const cy = startY + (ground.y - startY) * et;
      // Scale grows as it approaches
      const scale = 0.3 + et * 0.7;
      const spriteSize = 40 * scale;

      ctx.save();

      // Fire trail particles behind the meteor
      const trailLen = 8;
      for (let i = 1; i <= trailLen; i++) {
        const tt = Math.max(0, et - i * 0.04);
        const tx = startX + (ground.x - startX) * tt;
        const ty = startY + (ground.y - startY) * tt;
        const a = (1 - i / trailLen) * 0.6 * scale;
        const r = (5 - i * 0.4) * scale;
        ctx.beginPath();
        ctx.arc(tx + (Math.random() - 0.5) * 4, ty + (Math.random() - 0.5) * 4, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, ' + Math.floor(120 + i * 15) + ', 30, ' + a.toFixed(2) + ')';
        ctx.fill();
      }

      // Glow behind meteor
      const glowR = spriteSize * 1.2;
      const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      glowGrad.addColorStop(0, 'rgba(255, 160, 50, ' + (0.4 * scale).toFixed(2) + ')');
      glowGrad.addColorStop(0.5, 'rgba(255, 80, 20, ' + (0.15 * scale).toFixed(2) + ')');
      glowGrad.addColorStop(1, 'rgba(255, 40, 10, 0)');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);

      // Draw meteor sprite with rotation
      if (meteorLoaded) {
        ctx.translate(cx, cy);
        ctx.rotate(m.rotation);
        ctx.drawImage(meteorImg, -spriteSize / 2, -spriteSize / 2, spriteSize, spriteSize);
      }

      ctx.restore();
    } else {
      // Impact phase
      const impactAge = elapsed - m.streakDur;
      const impactDur = m.maxLife - m.streakDur;
      const t = impactAge / impactDur;

      // White flash on impact
      if (impactAge < 0.15) {
        const flashA = (1 - impactAge / 0.15) * 0.7;
        const flashR = 50 + impactAge / 0.15 * 60;
        const grad = ctx.createRadialGradient(ground.x, ground.y, 0, ground.x, ground.y, flashR);
        grad.addColorStop(0, 'rgba(255, 255, 230, ' + flashA.toFixed(2) + ')');
        grad.addColorStop(0.4, 'rgba(255, 180, 80, ' + (flashA * 0.6).toFixed(2) + ')');
        grad.addColorStop(1, 'rgba(255, 80, 20, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(ground.x - flashR, ground.y - flashR, flashR * 2, flashR * 2);
      }

      // Expanding shockwave ring
      if (t < 0.5) {
        const ringT = t / 0.5;
        const ringR = ringT * 90;
        const ringA = (1 - ringT) * 0.7;
        ctx.beginPath();
        ctx.arc(ground.x, ground.y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 140, 40, ' + ringA.toFixed(2) + ')';
        ctx.lineWidth = 4 * (1 - ringT);
        ctx.stroke();

        // Inner dust ring
        ctx.beginPath();
        ctx.arc(ground.x, ground.y, ringR * 0.6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200, 160, 100, ' + (ringA * 0.4).toFixed(2) + ')';
        ctx.lineWidth = 6 * (1 - ringT);
        ctx.stroke();
      }

      // Lingering smoke/dust
      if (t > 0.1 && t < 0.8) {
        const smokeA = Math.min(1, (t - 0.1) / 0.2) * (1 - (t - 0.1) / 0.7) * 0.25;
        const smokeR = 40 + t * 30;
        const grad = ctx.createRadialGradient(ground.x, ground.y, 0, ground.x, ground.y, smokeR);
        grad.addColorStop(0, 'rgba(80, 60, 40, ' + smokeA.toFixed(2) + ')');
        grad.addColorStop(1, 'rgba(60, 40, 30, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(ground.x - smokeR, ground.y - smokeR, smokeR * 2, smokeR * 2);
      }
    }
  }
}


// ── Canvas ──────────────────────────────────────────────────────────
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let camX = 0, camY = 0;
let zoom = 2;

// Hoisted origin — recomputed once per frame at top of render()
let _originX = 0;
let _originY = 0;
const _tileSpriteCols = []; // reusable buffer: [col, row, col, row, ...] for depth-sorted tile sprites

// Viewport — usable area excluding sidebar. Recomputed per frame.
const SIDEBAR_WIDTH = 160;
let _vpLeft = 0;   // left edge of usable viewport (sidebar width when visible)
let _vpW = 0;      // usable viewport width
let _vpCX = 0;     // viewport center X
let _vpCY = 0;     // viewport center Y

function updateViewport() {
  const sb = document.getElementById('sidebar');
  _vpLeft = (sb && sb.classList.contains('visible')) ? SIDEBAR_WIDTH : 0;
  _vpW = canvas.width - _vpLeft;
  _vpCX = _vpLeft + _vpW / 2;
  _vpCY = canvas.height / 2;
}

function getOrigin() {
  return {
    x: Math.floor(_vpCX) + camX,
    y: 80 + camY,
  };
}

// Clamp camera so viewport edges never scroll past the map edges.
function clampCamera() {
  updateViewport();
  const hvw = (_vpW / 2) / zoom;  // half viewport width in world space
  const hvh = _vpCY / zoom;       // half viewport height in world space

  const pad = 48; // pixels of slack around the map
  const mapL = -localMapH * TILE_HALF_W - pad;
  const mapR =  localMapW * TILE_HALF_W + pad;
  const mapT = -MAX_HEIGHT * HEIGHT_STEP - pad;
  const mapB = (localMapW + localMapH) * TILE_HALF_H + pad;

  const minCamX = hvw - mapR;
  const maxCamX = -mapL - hvw;
  const minCamY = _vpCY + hvh - 80 - mapB;
  const maxCamY = _vpCY - hvh - 80 - mapT;

  if (minCamX <= maxCamX) {
    camX = Math.max(minCamX, Math.min(maxCamX, camX));
  } else {
    camX = (minCamX + maxCamX) / 2;
  }

  if (minCamY <= maxCamY) {
    camY = Math.max(minCamY, Math.min(maxCamY, camY));
  } else {
    camY = (minCamY + maxCamY) / 2;
  }
}

// ── Projection ──────────────────────────────────────────────────────
function project(px, py, h) {
  const o = getOrigin();
  return {
    x: o.x + (px - py) * TILE_HALF_W,
    y: o.y + (px + py) * TILE_HALF_H - h * HEIGHT_STEP,
  };
}

// ── Color ───────────────────────────────────────────────────────────
function darkenColor(hex, amt) {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amt);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amt);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amt);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function getTileColor(tx, ty) {
  const t = heights[tx][ty], r = heights[tx + 1][ty];
  const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];

  if (t <= seaLevel && r <= seaLevel && b <= seaLevel && l <= seaLevel) {
    return WATER_COLOR;
  }

  const idx = tileColorIdx(t, r, b, l);
  const base = TERRAIN_COLORS[idx];
  const isFlat = (t === r && r === b && b === l);
  if (isFlat) return base;
  const minH = Math.min(t, r, b, l);
  const shade = triShade(0, 1, 2, [t - minH, r - minH, b - minH, l - minH]);
  return shadeColor(base, shade);
}

function getSettlementDiamondColor(team, level) {
  const base = TEAM_COLORS[team];
  const brighten = level * 4;
  const r = Math.min(255, parseInt(base.slice(1, 3), 16) + brighten);
  const g = Math.min(255, parseInt(base.slice(3, 5), 16) + brighten);
  const b = Math.min(255, parseInt(base.slice(5, 7), 16) + brighten);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// ── Height Interpolation (for rendering) ────────────────────────────
function heightAt(fx, fy) {
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const cx = Math.max(0, Math.min(localMapW, ix));
  const cy = Math.max(0, Math.min(localMapH, iy));
  const cx1 = Math.min(localMapW, cx + 1);
  const cy1 = Math.min(localMapH, cy + 1);
  const fx2 = fx - ix, fy2 = fy - iy;
  const h00 = heights[cx][cy], h10 = heights[cx1][cy];
  const h01 = heights[cx][cy1], h11 = heights[cx1][cy1];
  return h00 * (1 - fx2) * (1 - fy2) + h10 * fx2 * (1 - fy2) +
         h01 * (1 - fx2) * fy2 + h11 * fx2 * fy2;
}

// ── Drawing ─────────────────────────────────────────────────────────
function drawTile(tx, ty) {
  const t = heights[tx][ty], r = heights[tx + 1][ty];
  const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];

  const isWater = (t <= seaLevel && r <= seaLevel && b <= seaLevel && l <= seaLevel);

  // Fast path: blit pre-rendered water frame
  if (isWater && waterFrames) {
    const pTopX = _originX + (tx - ty) * TILE_HALF_W;
    const pTopY = _originY + (tx + ty) * TILE_HALF_H;
    const fi = (waterFrameCounter + tx + ty) % WATER_FRAME_COUNT;
    const wf = waterFrames[fi];
    ctx.drawImage(wf, 0, 0, wf.width, wf.height,
      pTopX - TILE_HALF_W, pTopY, TILE_HALF_W * 2, TILE_HALF_H * 2);
    if (GRID_MODES[gridMode]) {
      ctx.strokeStyle = GRID_MODES[gridMode];
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pTopX, pTopY);
      ctx.lineTo(pTopX + TILE_HALF_W, pTopY + TILE_HALF_H);
      ctx.lineTo(pTopX, pTopY + 2 * TILE_HALF_H);
      ctx.lineTo(pTopX - TILE_HALF_W, pTopY + TILE_HALF_H);
      ctx.closePath();
      ctx.stroke();
    }
    return;
  }

  const tileIdx = ty * localMapW + tx;

  // ── LOW ZOOM SIMPLIFY: color-fill only when enabled and zoomed out ──
  if (settingLowZoomSimplify && zoom < LOW_ZOOM_THRESHOLD) {
    const pTopX = _originX + (tx - ty) * TILE_HALF_W;
    const pTopY = _originY + (tx + ty) * TILE_HALF_H - t * HEIGHT_STEP;
    const pRightX = pTopX + TILE_HALF_W;
    const pRightY = pTopY + TILE_HALF_H - (r - t) * HEIGHT_STEP;
    const pBottomX = pTopX;
    const pBottomY = pTopY + 2 * TILE_HALF_H - (b - t) * HEIGHT_STEP;
    const pLeftX = pTopX - TILE_HALF_W;
    const pLeftY = pTopY + TILE_HALF_H - (l - t) * HEIGHT_STEP;

    ctx.beginPath();
    ctx.moveTo(pTopX, pTopY);
    ctx.lineTo(pRightX, pRightY);
    ctx.lineTo(pBottomX, pBottomY);
    ctx.lineTo(pLeftX, pLeftY);
    ctx.closePath();

    const colorIdx = tileColorIdx(t, r, b, l);
    const isFlat = (t === r && r === b && b === l);
    if (isFlat) {
      ctx.fillStyle = TERRAIN_COLORS[colorIdx];
    } else {
      const minH = Math.min(t, r, b, l);
      const shade = triShade(0, 1, 2, [t - minH, r - minH, b - minH, l - minH]);
      ctx.fillStyle = shadeColor(TERRAIN_COLORS[colorIdx], shade);
    }
    ctx.fill();

    if (GRID_MODES[gridMode]) {
      ctx.strokeStyle = GRID_MODES[gridMode];
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const cropTeam = cropTeamTiles[tileIdx];
    if (cropTeam) {
      ctx.fillStyle = CROP_OVERLAY_COLORS[cropTeam - 1] || CROP_OVERLAY_COLORS[0];
      ctx.fill();
    }
    if (swampTiles[tileIdx]) {
      ctx.fillStyle = 'rgba(80, 100, 30, 0.5)';
      ctx.fill();
    }
    return;
  }

  // ── Pre-rendered blit path ──
  if (landTileCache) {
    const minH = Math.min(t, r, b, l);
    const dt = t - minH, dr = r - minH, db = b - minH, dl = l - minH;
    const shapeKey = dt * 27 + dr * 9 + db * 3 + dl;
    const colorIdx = tileColorIdx(t, r, b, l);
    const swampFlag = swampTiles[tileIdx] ? 1 : 0;
    const cacheIdx = shapeKey * 18 + (colorIdx - 1) * 2 + swampFlag;
    const frame = landTileCache[cacheIdx];

    if (frame) {
      // Inline project pTop only
      const pTopX = _originX + (tx - ty) * TILE_HALF_W;
      const pTopY = _originY + (tx + ty) * TILE_HALF_H - t * HEIGHT_STEP;
      const maxRel = Math.max(dt, dr, db, dl);
      const blitX = pTopX - TILE_HALF_W;
      const blitY = pTopY - (maxRel - dt) * HEIGHT_STEP;
      // Blit scaled frame into world-space dimensions
      const dstW = TILE_HALF_W * 2;
      const dstH = TILE_HALF_H * 2 + maxRel * HEIGHT_STEP;
      ctx.drawImage(frame, 0, 0, frame.width, frame.height, blitX, blitY, dstW, dstH);

      // Grid at screen resolution (crisp at any zoom)
      if (GRID_MODES[gridMode]) {
        ctx.beginPath();
        ctx.moveTo(pTopX, pTopY);
        ctx.lineTo(pTopX + TILE_HALF_W, pTopY + TILE_HALF_H - (dr - dt) * HEIGHT_STEP);
        ctx.lineTo(pTopX, pTopY + 2 * TILE_HALF_H - (db - dt) * HEIGHT_STEP);
        ctx.lineTo(pTopX - TILE_HALF_W, pTopY + TILE_HALF_H - (dl - dt) * HEIGHT_STEP);
        ctx.closePath();
        ctx.strokeStyle = GRID_MODES[gridMode];
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Overlay-only path: only compute 4 corners if needed
      const cropTeam = cropTeamTiles[tileIdx];
      const needOverlay = cropTeam || rockTiles[tileIdx] || treeTiles[tileIdx] ||
                          pebbleTiles[tileIdx] || ruinTiles[tileIdx];
      if (!needOverlay) return;

      // Compute 4 corners for overlays
      const pRightX = _originX + (tx + 1 - ty) * TILE_HALF_W;
      const pRightY = _originY + (tx + 1 + ty) * TILE_HALF_H - r * HEIGHT_STEP;
      const pBottomX = _originX + (tx + 1 - ty - 1) * TILE_HALF_W;
      const pBottomY = _originY + (tx + 1 + ty + 1) * TILE_HALF_H - b * HEIGHT_STEP;
      const pLeftX = _originX + (tx - ty - 1) * TILE_HALF_W;
      const pLeftY = _originY + (tx + ty + 1) * TILE_HALF_H - l * HEIGHT_STEP;

      // Crop overlay
      if (cropTeam) {
        ctx.beginPath();
        ctx.moveTo(pTopX, pTopY);
        ctx.lineTo(pRightX, pRightY);
        ctx.lineTo(pBottomX, pBottomY);
        ctx.lineTo(pLeftX, pLeftY);
        ctx.closePath();
        ctx.fillStyle = CROP_OVERLAY_COLORS[cropTeam - 1] || CROP_OVERLAY_COLORS[0];
        ctx.fill();
      }

      // Collect sprite for depth-sorted pass (don't draw inline)
      if (rockTiles[tileIdx] || treeTiles[tileIdx] || pebbleTiles[tileIdx] || ruinTiles[tileIdx]) {
        _tileSpriteCols.push(tx, ty);
      }
      return;
    }
  }

  // ── FALLBACK: original full rendering (before textures load) ──
  const pTop    = project(tx,     ty,     t);
  const pRight  = project(tx + 1, ty,     r);
  const pBottom = project(tx + 1, ty + 1, b);
  const pLeft   = project(tx,     ty + 1, l);

  ctx.beginPath();
  ctx.moveTo(pTop.x, pTop.y);
  ctx.lineTo(pRight.x, pRight.y);
  ctx.lineTo(pBottom.x, pBottom.y);
  ctx.lineTo(pLeft.x, pLeft.y);
  ctx.closePath();
  ctx.fillStyle = getTileColor(tx, ty);
  ctx.fill();

  // Texture overlay — split into 2 triangles for correct projection on slopes
  if (texturesLoaded && textureOpacity > 0) {
    const tex = getTileTexture(tx, ty);
    const iw = tex.width, ih = tex.height;
    const hcx = canvas.width / 2;
    const hcy = canvas.height / 2;
    const zox = hcx * (1 - zoom), zoy = hcy * (1 - zoom);

    // Triangle 1: Top -> Right -> Bottom
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pTop.x, pTop.y);
    ctx.lineTo(pRight.x, pRight.y);
    ctx.lineTo(pBottom.x, pBottom.y);
    ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = textureOpacity;
    ctx.setTransform(
      zoom * (pRight.x - pTop.x) / iw,
      zoom * (pRight.y - pTop.y) / iw,
      zoom * (pBottom.x - pRight.x) / ih,
      zoom * (pBottom.y - pRight.y) / ih,
      zoom * pTop.x + zox,
      zoom * pTop.y + zoy
    );
    ctx.drawImage(tex, 0, 0);
    ctx.restore();

    // Triangle 2: Top -> Bottom -> Left
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pTop.x, pTop.y);
    ctx.lineTo(pBottom.x, pBottom.y);
    ctx.lineTo(pLeft.x, pLeft.y);
    ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = textureOpacity;
    ctx.setTransform(
      zoom * (pBottom.x - pLeft.x) / iw,
      zoom * (pBottom.y - pLeft.y) / iw,
      zoom * (pLeft.x - pTop.x) / ih,
      zoom * (pLeft.y - pTop.y) / ih,
      zoom * pTop.x + zox,
      zoom * pTop.y + zoy
    );
    ctx.drawImage(tex, 0, 0);
    ctx.restore();

    // Rebuild diamond path (destroyed by clip's beginPath)
    ctx.beginPath();
    ctx.moveTo(pTop.x, pTop.y);
    ctx.lineTo(pRight.x, pRight.y);
    ctx.lineTo(pBottom.x, pBottom.y);
    ctx.lineTo(pLeft.x, pLeft.y);
    ctx.closePath();
  }

  // Crop overlay — single typed array lookup
  const cropTeam = cropTeamTiles[tileIdx];
  if (cropTeam) {
    ctx.fillStyle = CROP_OVERLAY_COLORS[cropTeam - 1] || CROP_OVERLAY_COLORS[0];
    ctx.fill();
  }

  // Swamp overlay
  if (swampTiles[tileIdx]) {
    ctx.fillStyle = 'rgba(80, 100, 30, 0.5)';
    ctx.fill();
  }

  if (GRID_MODES[gridMode]) {
    ctx.strokeStyle = GRID_MODES[gridMode];
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Collect sprite for depth-sorted pass (don't draw inline)
  if (rockTiles[tileIdx] || treeTiles[tileIdx] || pebbleTiles[tileIdx] || ruinTiles[tileIdx]) {
    _tileSpriteCols.push(tx, ty);
  }
}

// Draw a sprite using config params.
// anchorX: 0=left, 0.5=center, 1=right (fraction of sprite width from left)
// anchorY: 0=top, 0.5=center, 1=bottom (fraction of sprite height from top)
// offsetY: 0=tile center, 1=tile bottom corner (interpolation toward pBottomY)
// scale: fraction of tileW used as sprite width
function _drawSpriteOnTile(targetCtx, img, tileW, midX, midY, pBottomY, params) {
  const sw = tileW * params.scale;
  const sh = sw * (img.height / img.width);
  const baseY = midY + (pBottomY - midY) * (params.offsetY || 0);
  const dx = midX - sw * (params.anchorX || 0.5);
  const dy = baseY - sh * (params.anchorY || 1.0);
  targetCtx.drawImage(img, dx, dy, sw, sh);
}

// Extracted sprite overlays (boulders, trees, pebbles, ruins)
function drawTileSprites(tileIdx, pTopX, pTopY, pRightX, pRightY, pBottomX, pBottomY, pLeftX, pLeftY) {
  const tx = tileIdx % localMapW;
  const ty = (tileIdx - tx) / localMapW;
  const midX = (pTopX + pBottomX) / 2;
  const midY = (pTopY + pBottomY) / 2;
  const tileW = (pRightX - pLeftX);

  if (rockTiles[tileIdx]) {
    const variant = getBoulderVariant(tx, ty);
    const img = boulderImgs[variant];
    if (boulderLoadState[variant]) {
      _drawSpriteOnTile(ctx, img, tileW, midX, midY, pBottomY, getSpriteParams('boulder', variant));
    }
  }

  if (treeTiles[tileIdx]) {
    const variant = getTreeVariant(tx, ty);
    const img = treeImgs[variant];
    if (treeLoadState[variant]) {
      _drawSpriteOnTile(ctx, img, tileW, midX, midY, pBottomY, getSpriteParams('tree', variant));
    }
  }

  if (pebbleTiles[tileIdx]) {
    const variant = getPebblesVariant(tx, ty);
    const img = pebblesImgs[variant];
    if (pebblesLoadState[variant]) {
      _drawSpriteOnTile(ctx, img, tileW, midX, midY, pBottomY, getSpriteParams('pebbles', variant));
    } else {
      ctx.fillStyle = '#8a7a6a';
      for (let i = 0; i < 4; i++) {
        const ox = (i % 2 - 0.5) * tileW * 0.2;
        const oy = (Math.floor(i / 2) - 0.5) * tileW * 0.1;
        ctx.beginPath();
        ctx.arc(midX + ox, midY + oy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Ruins sprite on ruin tiles
  const ruinTeam = ruinTiles[tileIdx];
  if (ruinTeam) {
    const ruinTeamIdx = ruinTeam - 1;
    if (ruinsLoaded) {
      const rp = getSpriteParams('ruins', 'default');
      const sw = tileW * rp.scale;
      const sh = sw * (ruinsImg.height / ruinsImg.width);
      const baseY = midY + (pBottomY - midY) * (rp.offsetY || 0);
      const dx = midX - sw * (rp.anchorX || 0.5);
      const dy = baseY - sh * (rp.anchorY || 0.6);
      ctx.drawImage(ruinsImg, dx, dy, sw, sh);
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = TEAM_COLORS[ruinTeamIdx];
      ctx.fillRect(dx, dy, sw, sh);
      ctx.restore();
    } else {
      ctx.fillStyle = ruinTeamIdx === TEAM_BLUE ? '#4a5a6a' : '#6a4a4a';
      const offsets = [[-0.15, -0.06], [0.1, 0.04], [-0.05, 0.08], [0.12, -0.04], [0.0, 0.0]];
      for (const [fx, fy] of offsets) {
        ctx.fillRect(midX + fx * tileW - 1, midY + fy * tileW - 1, 3, 2);
      }
    }
  }
}

// ── Draw single tile to terrain buffer (buffer-local coords) ────────
function drawTileToBuffer(tx, ty) {
  const bCtx = terrainBufferCtx;
  const t = heights[tx][ty], r = heights[tx + 1][ty];
  const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];
  const tileIdx = ty * localMapW + tx;

  // Buffer-local origin: top-left corner maps to buffer pixel coords
  const bOriginX = localMapH * TILE_HALF_W;
  const bOriginY = MAX_HEIGHT * HEIGHT_STEP + 32; // margin for tallest tiles

  const isWater = (t <= seaLevel && r <= seaLevel && b <= seaLevel && l <= seaLevel);

  if (isWater && waterFrames) {
    // Static water frame (spatial variation only, no temporal animation)
    const pTopX = bOriginX + (tx - ty) * TILE_HALF_W;
    const pTopY = bOriginY + (tx + ty) * TILE_HALF_H;
    const fi = (tx + ty) % WATER_FRAME_COUNT; // static spatial variation
    const wf = waterFrames[fi];
    bCtx.drawImage(wf, 0, 0, wf.width, wf.height,
      pTopX - TILE_HALF_W, pTopY, TILE_HALF_W * 2, TILE_HALF_H * 2);
    return;
  }

  // Land tile via pre-rendered cache
  if (landTileCache) {
    const minH = Math.min(t, r, b, l);
    const dt = t - minH, dr = r - minH, db = b - minH, dl = l - minH;
    const shapeKey = dt * 27 + dr * 9 + db * 3 + dl;
    const colorIdx = tileColorIdx(t, r, b, l);
    const swampFlag = swampTiles[tileIdx] ? 1 : 0;
    const cacheIdx = shapeKey * 18 + (colorIdx - 1) * 2 + swampFlag;
    const frame = landTileCache[cacheIdx];

    if (frame) {
      const pTopX = bOriginX + (tx - ty) * TILE_HALF_W;
      const pTopY = bOriginY + (tx + ty) * TILE_HALF_H - t * HEIGHT_STEP;
      const maxRel = Math.max(dt, dr, db, dl);
      const blitX = pTopX - TILE_HALF_W;
      const blitY = pTopY - (maxRel - dt) * HEIGHT_STEP;
      const dstW = TILE_HALF_W * 2;
      const dstH = TILE_HALF_H * 2 + maxRel * HEIGHT_STEP;
      bCtx.drawImage(frame, 0, 0, frame.width, frame.height, blitX, blitY, dstW, dstH);

      // Crop overlay
      const cropTeam = cropTeamTiles[tileIdx];
      if (cropTeam) {
        const pRightX = bOriginX + (tx + 1 - ty) * TILE_HALF_W;
        const pRightY = bOriginY + (tx + 1 + ty) * TILE_HALF_H - r * HEIGHT_STEP;
        const pBottomX = bOriginX + (tx + 1 - ty - 1) * TILE_HALF_W;
        const pBottomY = bOriginY + (tx + 1 + ty + 1) * TILE_HALF_H - b * HEIGHT_STEP;
        const pLeftX = bOriginX + (tx - ty - 1) * TILE_HALF_W;
        const pLeftY = bOriginY + (tx + ty + 1) * TILE_HALF_H - l * HEIGHT_STEP;
        bCtx.beginPath();
        bCtx.moveTo(pTopX, pTopY);
        bCtx.lineTo(pRightX, pRightY);
        bCtx.lineTo(pBottomX, pBottomY);
        bCtx.lineTo(pLeftX, pLeftY);
        bCtx.closePath();
        bCtx.fillStyle = CROP_OVERLAY_COLORS[cropTeam - 1] || CROP_OVERLAY_COLORS[0];
        bCtx.fill();
      }

      return;
    }
  }

  // Fallback: color-fill path for buffer (before textures load)
  const pTopX = bOriginX + (tx - ty) * TILE_HALF_W;
  const pTopY = bOriginY + (tx + ty) * TILE_HALF_H - t * HEIGHT_STEP;
  const pRightX = bOriginX + (tx + 1 - ty) * TILE_HALF_W;
  const pRightY = bOriginY + (tx + 1 + ty) * TILE_HALF_H - r * HEIGHT_STEP;
  const pBottomX = bOriginX + (tx + 1 - ty - 1) * TILE_HALF_W;
  const pBottomY = bOriginY + (tx + 1 + ty + 1) * TILE_HALF_H - b * HEIGHT_STEP;
  const pLeftX = bOriginX + (tx - ty - 1) * TILE_HALF_W;
  const pLeftY = bOriginY + (tx + ty + 1) * TILE_HALF_H - l * HEIGHT_STEP;

  bCtx.beginPath();
  bCtx.moveTo(pTopX, pTopY);
  bCtx.lineTo(pRightX, pRightY);
  bCtx.lineTo(pBottomX, pBottomY);
  bCtx.lineTo(pLeftX, pLeftY);
  bCtx.closePath();
  const colorIdx = tileColorIdx(t, r, b, l);
  const isFlat = (t === r && r === b && b === l);
  if (isFlat) {
    bCtx.fillStyle = TERRAIN_COLORS[colorIdx];
  } else {
    const minH = Math.min(t, r, b, l);
    const shade = triShade(0, 1, 2, [t - minH, r - minH, b - minH, l - minH]);
    bCtx.fillStyle = shadeColor(TERRAIN_COLORS[colorIdx], shade);
  }
  bCtx.fill();
}

// ── Terrain Buffer Update ────────────────────────────────────────────
// Always does a full redraw when anything is dirty. A full pass over a
// 64×64 map is ~4096 canvas-to-canvas blits on the offscreen buffer —
// well under 1 ms — and avoids all partial-clear artifacts from
// isometric tile overlap.
function updateTerrainBuffer() {
  if (!terrainBufferInited || !terrainBuffer) return;

  if (terrainBufferNeedsFull) {
    terrainBufferCtx.clearRect(0, 0, terrainBufferW, terrainBufferH);
    for (let ty = 0; ty < localMapH; ty++) {
      for (let tx = 0; tx < localMapW; tx++) {
        drawTileToBuffer(tx, ty);
      }
    }
    terrainBufferDirty.fill(0);
    terrainBufferNeedsFull = false;
    return;
  }

  // Any dirty tiles at all → full redraw
  let hasDirty = false;
  for (let i = 0; i < localMapW * localMapH; i++) {
    if (terrainBufferDirty[i]) { hasDirty = true; break; }
  }
  if (!hasDirty) return;

  terrainBufferCtx.clearRect(0, 0, terrainBufferW, terrainBufferH);
  for (let ty = 0; ty < localMapH; ty++) {
    for (let tx = 0; tx < localMapW; tx++) {
      drawTileToBuffer(tx, ty);
    }
  }
  terrainBufferDirty.fill(0);
}

function rebuildWalkerGrid() {
  for (let i = 0; i < localMapW * localMapH; i++) walkerGrid[i] = null;
  for (let i = 0; i < walkers.length; i++) {
    const w = walkers[i];
    const tx = Math.floor(w.x), ty = Math.floor(w.y);
    if (tx < 0 || tx >= localMapW || ty < 0 || ty >= localMapH) continue;
    const key = ty * localMapW + tx;
    if (!walkerGrid[key]) walkerGrid[key] = [];
    walkerGrid[key].push(w);
  }
}

function getWalkerDirection(w) {
  if (w.tx == null || w.ty == null) return 'se';
  // Movement vector in grid space
  const dx = w.tx - w.x;
  const dy = w.ty - w.y;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return 'se'; // stationary
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'se' : 'nw';
  } else {
    return dy >= 0 ? 'sw' : 'ne';
  }
}

function drawWalker(w) {
  const h = heightAt(w.x, w.y);
  const p = project(w.x, w.y, h);
  const isKnight = w.isKnight;
  const isLeader = w.isLeader;
  const team = TEAM_SPRITE_NAMES[w.team] || 'blue';

  // Determine direction and animation frame
  const dir = getWalkerDirection(w);
  const animFrame = Math.floor(performance.now() / 250) % 2;

  // Map direction to sprite key + mirror flag
  let spriteDir, mirror;
  if (dir === 'se') { spriteDir = 'se'; mirror = false; }
  else if (dir === 'nw') { spriteDir = 'nw'; mirror = false; }
  else if (dir === 'sw') { spriteDir = 'se'; mirror = true; }
  else { spriteDir = 'nw'; mirror = true; } // ne

  const key = spriteDir + '-' + team + '-' + animFrame;
  const img = walkerSprites[key];
  const wCfg = spriteConfig && spriteConfig.walker || {};
  const spriteH = isKnight ? (wCfg.knightHeight || 18) : (wCfg.height || 14);
  const wOffsetY = wCfg.offsetY !== undefined ? wCfg.offsetY : 2;
  const spriteReady = walkerSpritesLoaded && img && (img instanceof HTMLCanvasElement || (img.complete && img.naturalWidth > 0));

  if (spriteReady) {
    const scale = spriteH / (img.height || img.naturalHeight || 14);
    const spriteW = (img.width || img.naturalWidth || 14) * scale;
    const drawX = p.x - spriteW / 2;
    const drawY = p.y - spriteH + wOffsetY;

    ctx.save();
    if (mirror) {
      ctx.translate(p.x, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, -spriteW / 2, drawY, spriteW, spriteH);
    } else {
      ctx.drawImage(img, drawX, drawY, spriteW, spriteH);
    }
    ctx.restore();
  } else {
    // Fallback: colored circle
    const radius = isKnight ? 4 + Math.min(3, Math.floor(w.strength / 50)) : 2 + Math.min(3, Math.floor(w.strength / 50));
    ctx.beginPath();
    ctx.arc(p.x, p.y - 3, radius, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLORS[w.team];
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // Leader: gold crown above sprite
  if (isLeader) {
    const crownY = spriteReady ? p.y - spriteH - 2 : p.y - 8;
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.moveTo(p.x - 4, crownY + 4);
    ctx.lineTo(p.x - 3, crownY);
    ctx.lineTo(p.x - 1, crownY + 3);
    ctx.lineTo(p.x, crownY - 1);
    ctx.lineTo(p.x + 1, crownY + 3);
    ctx.lineTo(p.x + 3, crownY);
    ctx.lineTo(p.x + 4, crownY + 4);
    ctx.closePath();
    ctx.fill();
  }

  // Knight: white cross above sprite
  if (isKnight) {
    const crossY = spriteReady ? p.y - spriteH - 4 : p.y - 10;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, crossY);
    ctx.lineTo(p.x, crossY - 5);
    ctx.moveTo(p.x - 2.5, crossY - 3);
    ctx.lineTo(p.x + 2.5, crossY - 3);
    ctx.stroke();
  }
}

function drawSettlement(s) {
  const h = heights[s.tx][s.ty];

  // Diamond footprint: 1 tile for levels 1-8, 3x3 for castle (level 9)
  const cx = s.ox + s.sz * 0.5;
  const cy = s.oy + s.sz * 0.5;
  const he = s.sz * 0.5;

  const pTop    = project(cx - he, cy - he, h);
  const pRight  = project(cx + he, cy - he, h);
  const pBottom = project(cx + he, cy + he, h);
  const pLeft   = project(cx - he, cy + he, h);

  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.moveTo(pTop.x, pTop.y);
  ctx.lineTo(pRight.x, pRight.y);
  ctx.lineTo(pBottom.x, pBottom.y);
  ctx.lineTo(pLeft.x, pLeft.y);
  ctx.closePath();

  ctx.fillStyle = getSettlementDiamondColor(s.t, s.l);
  ctx.fill();

  ctx.strokeStyle = darkenColor(TEAM_COLORS[s.t], 40);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Sprite: positioned via sprite-config.json
  if (settlementSpritesLoaded && s.l >= 1 && s.l <= SETT_LEVEL_NAMES.length) {
    const levelName = SETT_LEVEL_NAMES[s.l - 1];
    const team = TEAM_SPRITE_NAMES[s.t] || 'blue';
    const key = levelName + '-' + team;
    const img = settlementSprites[key];
    if (img && (img instanceof HTMLCanvasElement || (img.complete && img.naturalWidth > 0))) {
      const imgW = img.width || img.naturalWidth;
      const imgH = img.height || img.naturalHeight;
      const tileH = pBottom.y - pTop.y;
      const cfg = getSpriteParams('settlement', levelName);
      const fillPct = cfg.fillPct !== undefined ? cfg.fillPct : 0.85;
      const centerYPct = cfg.centerY !== undefined ? cfg.centerY : 0.25;
      const centerY = pTop.y + tileH * centerYPct;
      const dh = tileH * fillPct / 0.75;
      const scale = dh / imgH;
      const dw = imgW * scale;
      ctx.drawImage(img, pTop.x - dw / 2, centerY - dh / 2, dw, dh);
    }
  }

  // Draw leader crown on settlement containing leader
  if (s.hl) {
    const crownX = pTop.x;
    const crownY = pTop.y - 6;
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.moveTo(crownX - 5, crownY);
    ctx.lineTo(crownX - 3, crownY - 5);
    ctx.lineTo(crownX, crownY - 2);
    ctx.lineTo(crownX + 3, crownY - 5);
    ctx.lineTo(crownX + 5, crownY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#b8960f';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

// ── Papal Magnet — Beacon ────────────────────────────────────────────
const BEACON_COLORS = [
  { core: '130,180,255', glow: '60,120,255', base: '100,160,255' },   // TEAM_BLUE
  { core: '255,160,130', glow: '255,60,40',  base: '255,100,80' },    // TEAM_RED
  { core: '130,255,130', glow: '40,200,40',  base: '80,220,80' },     // TEAM_GREEN
  { core: '255,255,130', glow: '200,200,40', base: '220,220,80' },    // TEAM_YELLOW
  { core: '200,130,255', glow: '140,40,255', base: '170,80,255' },    // TEAM_PURPLE
  { core: '255,180,100', glow: '255,120,30', base: '255,150,60' },    // TEAM_ORANGE
];

function drawMagnetFlag(team) {
  if (team >= magnetPos.length) return;
  const mp = magnetPos[team];
  if (!mp) return;
  const h = heightAt(mp.x, mp.y);
  const p = project(mp.x, mp.y, h);
  const sx = p.x, sy = p.y;
  const time = performance.now() / 1000;
  const isLocked = magnetLocked[team] || false;
  const colors = BEACON_COLORS[team] || BEACON_COLORS[0];

  // Pulse (gentle 0.85-1.0) or locked flicker (stuttery)
  const pulse = 0.85 + 0.15 * Math.sin(time * 2.5);
  const flicker = isLocked
    ? (Math.sin(time * 17) > 0.3 ? 0.4 : 0.15)
    : pulse;
  const alpha = flicker;

  const beamHeight = 220;
  const beamTopW = 1;
  const beamBotW = 6;
  const topY = sy - beamHeight;

  // Core beam (bright trapezoid)
  ctx.save();
  ctx.globalAlpha = alpha * 0.9;
  ctx.beginPath();
  ctx.moveTo(sx - beamTopW, topY);
  ctx.lineTo(sx + beamTopW, topY);
  ctx.lineTo(sx + beamBotW, sy);
  ctx.lineTo(sx - beamBotW, sy);
  ctx.closePath();
  const beamGrad = ctx.createLinearGradient(sx, topY, sx, sy);
  beamGrad.addColorStop(0, `rgba(${colors.core},0)`);
  beamGrad.addColorStop(0.1, `rgba(${colors.core},0.3)`);
  beamGrad.addColorStop(0.5, `rgba(${colors.core},0.7)`);
  beamGrad.addColorStop(1, `rgba(${colors.core},1)`);
  ctx.fillStyle = beamGrad;
  ctx.fill();
  ctx.restore();

  // Outer glow beam (wider, softer)
  ctx.save();
  ctx.globalAlpha = alpha * 0.3;
  const glowW = beamBotW * 3;
  ctx.beginPath();
  ctx.moveTo(sx - beamTopW * 2, topY);
  ctx.lineTo(sx + beamTopW * 2, topY);
  ctx.lineTo(sx + glowW, sy);
  ctx.lineTo(sx - glowW, sy);
  ctx.closePath();
  const glowGrad = ctx.createLinearGradient(sx, topY, sx, sy);
  glowGrad.addColorStop(0, `rgba(${colors.glow},0)`);
  glowGrad.addColorStop(0.3, `rgba(${colors.glow},0.1)`);
  glowGrad.addColorStop(1, `rgba(${colors.glow},0.3)`);
  ctx.fillStyle = glowGrad;
  ctx.fill();
  ctx.restore();

  // Base glow (radial)
  ctx.save();
  ctx.globalAlpha = alpha * 0.6;
  const baseR = 20;
  const baseGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, baseR);
  baseGrad.addColorStop(0, `rgba(${colors.base},0.8)`);
  baseGrad.addColorStop(0.5, `rgba(${colors.base},0.2)`);
  baseGrad.addColorStop(1, `rgba(${colors.base},0)`);
  ctx.fillStyle = baseGrad;
  ctx.fillRect(sx - baseR, sy - baseR / 2, baseR * 2, baseR);
  ctx.restore();

  // Base diamond
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = `rgb(${colors.core})`;
  ctx.beginPath();
  ctx.moveTo(sx, sy - 4);
  ctx.lineTo(sx + 5, sy);
  ctx.lineTo(sx, sy + 3);
  ctx.lineTo(sx - 5, sy);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${alpha * 0.8})`;
  ctx.fillRect(sx - 1, sy - 1, 2, 2);
  ctx.restore();

  // Rising particles (deterministic, no pool needed)
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,0.8)`;
  for (let i = 0; i < 8; i++) {
    const phase = (time * 40 + i * 31.7) % beamHeight;
    const py = sy - phase;
    const px = sx + Math.sin(time * 3 + i * 2.1) * 3;
    const pAlpha = Math.sin((phase / beamHeight) * Math.PI);
    ctx.globalAlpha = alpha * 0.6 * pAlpha;
    ctx.fillRect(Math.floor(px), Math.floor(py), 1, 1);
  }
  ctx.restore();
}

// ── Fire Particle System ─────────────────────────────────────────────
function updateFireParticles(dt) {
  // Spawn particles for active fires
  for (const f of fires) {
    const intensity = Math.max(0, 1 - f.a / 5);
    const spawnCount = Math.floor(intensity * 3 * dt * 60);
    for (let i = 0; i < spawnCount; i++) {
      fireParticles.push({
        x: f.x + 0.3 + Math.random() * 0.4,
        y: f.y + 0.3 + Math.random() * 0.4,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -0.5 - Math.random() * 0.8,
        life: 0.4 + Math.random() * 0.6,
        maxLife: 0.4 + Math.random() * 0.6,
        size: 1.5 + Math.random() * 2.5,
      });
    }
  }
  // Update existing particles
  for (let i = fireParticles.length - 1; i >= 0; i--) {
    const p = fireParticles[i];
    p.life -= dt;
    if (p.life <= 0) {
      fireParticles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.vy -= 0.5 * dt;
    p.size *= (1 - 0.5 * dt);
  }
}

function drawSingleFire(f) {
  const h = heightAt(f.x + 0.5, f.y + 0.5);
  const p = project(f.x + 0.5, f.y + 0.5, h);
  const intensity = Math.max(0, 1 - f.a / 5);

  // Glow at base
  const glowR = 8 + intensity * 6;
  const grd = ctx.createRadialGradient(p.x, p.y - 4, 0, p.x, p.y - 4, glowR);
  grd.addColorStop(0, `rgba(255,120,20,${0.4 * intensity})`);
  grd.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(p.x - glowR, p.y - 4 - glowR, glowR * 2, glowR * 2);
}

function drawFireParticles() {
  for (const fp of fireParticles) {
    const h = heightAt(fp.x, fp.y);
    const base = project(fp.x, fp.y, h);
    const sx = base.x;
    const sy = base.y + fp.vy * (fp.maxLife - fp.life) * 12;
    const t = 1 - fp.life / fp.maxLife;
    const r = Math.floor(255 - t * 80);
    const g = Math.floor(180 - t * 160);
    const b = Math.floor(30 - t * 30);
    const a = fp.life / fp.maxLife;
    ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, fp.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Armageddon Sky Effects ──────────────────────────────────────────
let armageddonStartTime = 0;
let armageddonShake = { x: 0, y: 0 };
const armageddonEmbers = [];
const EMBER_MAX = 200;

// Supernova targets — a subset of stars that will explode
let supernovaStars = [];

// Falling tiles — edge tiles that break off and tumble into the void
const fallingTiles = [];
const FALLING_TILE_MAX = 80;
let fallingTileTimer = 0;
// Track which tiles have already fallen so we don't repeat (uses fallenTiles Uint8Array declared above)
// Frontier: tiles eligible to fall next (adjacent to already-fallen or on edge)
let fallingFrontier = [];

function onArmageddonStart() {
  armageddonStartTime = performance.now() / 1000;
  fallingTiles.length = 0;
  fallenTiles.fill(0);
  fallingTileTimer = 0;
  fallingFrontier = [];
  // Seed frontier with all map edge tiles
  for (let x = 0; x < localMapW; x++) { fallingFrontier.push([x, 0]); fallingFrontier.push([x, localMapH - 1]); }
  for (let y = 1; y < localMapH - 1; y++) { fallingFrontier.push([0, y]); fallingFrontier.push([localMapW - 1, y]); }

  // Pick ~15 bright stars to go supernova at staggered times
  supernovaStars = [];
  const candidates = stars.filter(s => s.brightness > 0.4);
  for (let i = 0; i < Math.min(15, candidates.length); i++) {
    const idx = Math.floor(Math.random() * candidates.length);
    const s = candidates.splice(idx, 1)[0];
    supernovaStars.push({
      star: s,
      delay: Math.random() * 4,
      ringRadius: 0,
      ringAlpha: 1,
      exploded: false,
    });
  }
}

function updateArmageddonEffects(dt) {
  if (!armageddon) return;
  const elapsed = performance.now() / 1000 - armageddonStartTime;

  // Screen shake
  const shakeIntensity = elapsed < 2 ? 8 * (1 - elapsed / 2)
    : elapsed < 8 ? (1.5 + Math.sin(elapsed * 7) * 0.5) * (1 - (elapsed - 2) / 6)
    : 0;
  armageddonShake.x = (Math.random() - 0.5) * shakeIntensity * 2;
  armageddonShake.y = (Math.random() - 0.5) * shakeIntensity * 2;

  // Spawn embers
  if (armageddonEmbers.length < EMBER_MAX && Math.random() < 0.4) {
    armageddonEmbers.push({
      x: Math.random() * canvas.width,
      y: -10,
      vx: (Math.random() - 0.5) * 40,
      vy: 60 + Math.random() * 120,
      size: 1.5 + Math.random() * 3,
      life: 3 + Math.random() * 4,
      maxLife: 3 + Math.random() * 4,
      bright: 0.5 + Math.random() * 0.5,
    });
  }

  // Update embers
  for (let i = armageddonEmbers.length - 1; i >= 0; i--) {
    const e = armageddonEmbers[i];
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.vy += 15 * dt;
    e.life -= dt;
    if (e.life <= 0 || e.y > canvas.height + 20) {
      armageddonEmbers.splice(i, 1);
    }
  }

  // Update supernova rings
  for (const sn of supernovaStars) {
    if (elapsed < sn.delay) continue;
    if (!sn.exploded) {
      sn.exploded = true;
      sn.ringRadius = 0;
      sn.ringAlpha = 1;
    }
    const snElapsed = elapsed - sn.delay;
    sn.ringRadius = snElapsed * 120;
    sn.ringAlpha = Math.max(0, 1 - snElapsed / 3);
  }

  // Falling tiles — erode edges progressively from map edges inward
  if (elapsed > 3 && heights.length > 0) {
    fallingTileTimer += dt;
    const spawnInterval = Math.max(0.05, 0.3 - elapsed * 0.003);
    while (fallingTileTimer >= spawnInterval && fallingTiles.length < FALLING_TILE_MAX) {
      fallingTileTimer -= spawnInterval;

      // Remove already-fallen entries from frontier
      while (fallingFrontier.length > 0) {
        const last = fallingFrontier[fallingFrontier.length - 1];
        if (fallenTiles[last[1] * localMapW + last[0]]) fallingFrontier.pop();
        else break;
      }
      if (fallingFrontier.length === 0) break;

      // Pick a random frontier tile
      const idx = Math.floor(Math.random() * fallingFrontier.length);
      const [tx, ty] = fallingFrontier[idx];
      fallingFrontier[idx] = fallingFrontier[fallingFrontier.length - 1];
      fallingFrontier.pop();

      const fallenIdx = ty * localMapW + tx;
      if (fallenTiles[fallenIdx]) continue;
      fallenTiles[fallenIdx] = 1;

      // Add neighbors to frontier
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = tx + dx, ny = ty + dy;
        if (nx >= 0 && nx < localMapW && ny >= 0 && ny < localMapH && !fallenTiles[ny * localMapW + nx]) {
          fallingFrontier.push([nx, ny]);
        }
      }

      // Capture current tile appearance
      const t = heights[tx][ty], r = heights[tx + 1][ty];
      const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];
      const color = getTileColor(tx, ty);

      fallingTiles.push({
        tx, ty, t, r, b, l, color,
        offsetY: 0,
        vy: 5 + Math.random() * 20,
        rotAngle: 0,
        rotSpeed: (Math.random() - 0.5) * 3,
        driftX: (Math.random() - 0.5) * 30,
        alpha: 1,
        fallen: true,
      });
    }
  }

  // Update falling tiles
  for (let i = fallingTiles.length - 1; i >= 0; i--) {
    const ft = fallingTiles[i];
    ft.vy += 180 * dt;
    ft.offsetY += ft.vy * dt;
    ft.rotAngle += ft.rotSpeed * dt;
    ft.alpha = Math.max(0, 1 - ft.offsetY / 600);
    if (ft.alpha <= 0) {
      fallingTiles.splice(i, 1);
    }
  }
}

// ── Space Background ────────────────────────────────────────────────
function drawSpaceBackground(time) {
  const elapsed = armageddon ? time - armageddonStartTime : 0;

  // Sky color shifts red during armageddon
  if (armageddon) {
    const redShift = Math.min(1, elapsed / 8);
    const r = Math.floor(5 + redShift * 25);
    const g = Math.floor(8 - redShift * 4);
    const b = Math.floor(15 - redShift * 10);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
  } else {
    ctx.fillStyle = '#05080f';
  }
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Nebula (cached)
  if (!nebulaCanvas || nebulaCanvas.width !== canvas.width || nebulaCanvas.height !== canvas.height) {
    buildNebulaCanvas(canvas.width, canvas.height);
  }
  ctx.drawImage(nebulaCanvas, 0, 0);

  if (armageddon) {
    const redIntensity = Math.min(0.15, elapsed * 0.02);
    const rGrad = ctx.createRadialGradient(canvas.width * 0.5, canvas.height * 0.4, 0,
      canvas.width * 0.5, canvas.height * 0.4, canvas.width * 0.6);
    rGrad.addColorStop(0, `rgba(120, 20, 0, ${redIntensity})`);
    rGrad.addColorStop(1, `rgba(60, 0, 0, ${redIntensity * 0.5})`);
    ctx.fillStyle = rGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Stars
  for (const star of stars) {
    const twinkle = 0.5 + 0.5 * Math.sin(time * star.twinkleSpeed + star.x * 100);
    let alpha = star.brightness * twinkle;
    let size = star.size;
    let r = 255, g = 255, b = 255;

    if (armageddon) {
      const boost = Math.min(1, elapsed / 5);
      alpha = Math.min(1, alpha * (1 + boost * 1.5));
      size = star.size * (1 + boost * 0.8);
      g = Math.floor(255 - boost * 80);
      b = Math.floor(255 - boost * 160);
    }

    const sx = Math.floor(star.x * canvas.width);
    const sy = Math.floor(star.y * canvas.height);
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
    if (size <= 1.5) {
      ctx.fillRect(sx, sy, size, size);
    } else {
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Normal spikes (when not armageddon)
    if (!armageddon && star.brightness > 0.6 && twinkle > 0.8) {
      const spikeHash = Math.sin(Math.floor(time * star.twinkleSpeed * 0.1) * 9999 + star.x * 7777 + star.y * 3333) * 0.5 + 0.5;
      if (spikeHash < 0.002) {
        const intensity = (twinkle - 0.8) / 0.2;
        const len = star.spikeLen * intensity;
        const scx = sx + star.size * 0.5;
        const scy = sy + star.size * 0.5;
        ctx.beginPath();
        ctx.moveTo(scx - len, scy); ctx.lineTo(scx + len, scy);
        ctx.moveTo(scx, scy - len); ctx.lineTo(scx, scy + len);
        ctx.strokeStyle = `rgba(200,220,255,${(alpha * intensity * 0.6).toFixed(2)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(scx - len * 0.6, scy); ctx.lineTo(scx + len * 0.6, scy);
        ctx.moveTo(scx, scy - len * 0.6); ctx.lineTo(scx, scy + len * 0.6);
        ctx.strokeStyle = `rgba(180,200,255,${(alpha * intensity * 0.25).toFixed(2)})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  }

  // Supernova explosions
  if (armageddon) {
    for (const sn of supernovaStars) {
      if (!sn.exploded || sn.ringAlpha <= 0) continue;
      const sx = Math.floor(sn.star.x * canvas.width);
      const sy = Math.floor(sn.star.y * canvas.height);

      const flashAlpha = Math.min(1, sn.ringAlpha * 2);
      if (flashAlpha > 0.05) {
        const flashR = 4 + (1 - sn.ringAlpha) * 12;
        const flashGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, flashR);
        flashGrad.addColorStop(0, `rgba(255, 240, 200, ${flashAlpha.toFixed(2)})`);
        flashGrad.addColorStop(0.4, `rgba(255, 160, 60, ${(flashAlpha * 0.6).toFixed(2)})`);
        flashGrad.addColorStop(1, 'rgba(255, 80, 0, 0)');
        ctx.fillStyle = flashGrad;
        ctx.fillRect(sx - flashR, sy - flashR, flashR * 2, flashR * 2);
      }

      if (sn.ringRadius > 5) {
        ctx.beginPath();
        ctx.arc(sx, sy, sn.ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, ${Math.floor(100 + sn.ringAlpha * 100)}, ${Math.floor(sn.ringAlpha * 60)}, ${(sn.ringAlpha * 0.5).toFixed(2)})`;
        ctx.lineWidth = 2 + sn.ringAlpha * 3;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(sx, sy, sn.ringRadius * 0.85, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 200, 120, ${(sn.ringAlpha * 0.15).toFixed(2)})`;
        ctx.lineWidth = sn.ringRadius * 0.15;
        ctx.stroke();
      }

      if (sn.ringAlpha > 0.5) {
        const spikeLen = 20 + (1 - sn.ringAlpha) * 60;
        const spikeA = (sn.ringAlpha - 0.5) * 2;
        ctx.beginPath();
        ctx.moveTo(sx - spikeLen, sy); ctx.lineTo(sx + spikeLen, sy);
        ctx.moveTo(sx, sy - spikeLen); ctx.lineTo(sx, sy + spikeLen);
        ctx.strokeStyle = `rgba(255, 220, 160, ${(spikeA * 0.7).toFixed(2)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

  }
}

// Draw embers in screen space (on top of map)
function drawArmageddonEmbers() {
  if (!armageddon || armageddonEmbers.length === 0) return;
  for (const e of armageddonEmbers) {
    const t = 1 - e.life / e.maxLife;
    const r = 255;
    const g = Math.floor(200 - t * 150);
    const b = Math.floor(60 - t * 60);
    const a = (e.life / e.maxLife) * e.bright;
    ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.size * (0.5 + 0.5 * (e.life / e.maxLife)), 0, Math.PI * 2);
    ctx.fill();

    // Tiny trail
    ctx.fillStyle = `rgba(${r},${g},${b},${(a * 0.3).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(e.x - e.vx * 0.03, e.y - e.vy * 0.03, e.size * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Draw falling tiles in world space
function drawFallingTiles() {
  if (!armageddon || fallingTiles.length === 0) return;
  for (const ft of fallingTiles) {
    const pTop    = project(ft.tx,     ft.ty,     ft.t);
    const pRight  = project(ft.tx + 1, ft.ty,     ft.r);
    const pBottom = project(ft.tx + 1, ft.ty + 1, ft.b);
    const pLeft   = project(ft.tx,     ft.ty + 1, ft.l);

    const cx = (pTop.x + pRight.x + pBottom.x + pLeft.x) / 4;
    const cy = (pTop.y + pRight.y + pBottom.y + pLeft.y) / 4;

    ctx.save();
    ctx.globalAlpha = ft.alpha;
    ctx.translate(cx + ft.driftX * (ft.offsetY / 200), cy + ft.offsetY);
    ctx.rotate(ft.rotAngle);

    ctx.beginPath();
    ctx.moveTo(pTop.x - cx, pTop.y - cy);
    ctx.lineTo(pRight.x - cx, pRight.y - cy);
    ctx.lineTo(pBottom.x - cx, pBottom.y - cy);
    ctx.lineTo(pLeft.x - cx, pLeft.y - cy);
    ctx.closePath();
    ctx.fillStyle = ft.color;
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    ctx.restore();
  }
}

// ── Waterfall System ────────────────────────────────────────────────
function clientIsTileWater(tx, ty) {
  if (tx < 0 || tx >= localMapW || ty < 0 || ty >= localMapH) return true;
  return heights[tx][ty] <= seaLevel &&
         heights[tx + 1][ty] <= seaLevel &&
         heights[tx + 1][ty + 1] <= seaLevel &&
         heights[tx][ty + 1] <= seaLevel;
}

function spawnWaterfallParticles(dt) {
  if (heights.length === 0) return;
  const rate = 3;
  for (let x = 0; x < localMapW; x++) {
    if (clientIsTileWater(x, localMapH - 1)) spawnAtEdge(x, localMapH - 1, dt, rate);
  }
  for (let y = 0; y < localMapH - 1; y++) {
    if (clientIsTileWater(localMapW - 1, y)) spawnAtEdge(localMapW - 1, y, dt, rate);
  }
}

let wfNextIdx = 0;
function spawnAtEdge(tx, ty, dt, rate) {
  if (Math.random() > rate * dt) return;

  let wp = null;
  for (let i = 0; i < 20; i++) {
    const candidate = waterfallParticles[wfNextIdx];
    wfNextIdx = (wfNextIdx + 1) % WATERFALL_MAX;
    if (!candidate.active) { wp = candidate; break; }
  }
  if (!wp) return;

  const t = Math.random();
  let gx, gy, dvx = 0, dvy = 0;

  if (tx === localMapW - 1 && ty === localMapH - 1) {
    if (Math.random() < 0.5) {
      gx = tx + 1; gy = ty + t;
      dvx = 6; dvy = 3;
    } else {
      gx = tx + t; gy = ty + 1;
      dvx = -3; dvy = 6;
    }
  } else if (tx === localMapW - 1) {
    gx = tx + 1; gy = ty + t;
    dvx = 6; dvy = 3;
  } else {
    gx = tx + t; gy = ty + 1;
    dvx = -3; dvy = 6;
  }

  wp.gx = gx;
  wp.gy = gy;
  wp.ox = 0;
  wp.oy = 0;
  wp.vx = dvx + (Math.random() - 0.5) * 4;
  wp.vy = 15 + Math.random() * 25;
  wp.life = 2.5 + Math.random() * 2.0;
  wp.maxLife = wp.life;
  wp.size = 1 + Math.random() * 1.5;
  wp.active = true;
}

function updateWaterfallParticles(dt) {
  for (const p of waterfallParticles) {
    if (!p.active) continue;
    p.ox += p.vx * dt;
    p.oy += p.vy * dt;
    p.vy += 25 * dt;
    p.life -= dt;
    if (p.life <= 0) p.active = false;
  }
}

function drawWaterfallParticles() {
  for (const p of waterfallParticles) {
    if (!p.active) continue;
    const proj = project(p.gx, p.gy, 0);
    const sx = proj.x + p.ox;
    const sy = proj.y + p.oy;
    const alpha = Math.min(1, p.life / p.maxLife) * 0.6;
    ctx.fillStyle = `rgba(150,200,255,${alpha.toFixed(2)})`;
    ctx.fillRect(Math.floor(sx), Math.floor(sy), p.size, p.size);
  }
}

function drawEdgeMist() {
  for (let x = 0; x < localMapW; x++) {
    if (clientIsTileWater(x, localMapH - 1)) drawMistAt(project(x + 0.5, localMapH - 0.5, 0));
  }
  for (let y = 0; y < localMapH - 1; y++) {
    if (clientIsTileWater(localMapW - 1, y)) drawMistAt(project(localMapW - 0.5, y + 0.5, 0));
  }
}

function drawMistAt(p) {
  const sx = p.x * zoom + _vpCX * (1 - zoom);
  const sy = p.y * zoom + _vpCY * (1 - zoom);
  if (sx < -60 || sx > canvas.width + 60 || sy < -60 || sy > canvas.height + 200) return;

  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#c8dcff';
  const w = TILE_HALF_W * 2;
  const h = TILE_HALF_H * 2;
  ctx.fillRect(p.x - TILE_HALF_W, p.y, w, h);
  ctx.restore();
}

function getTeamStats(team) {
  let pop = 0, set = 0, walk = 0;
  for (const s of settlements) {
    if (s.t !== team) continue;
    pop += s.p;
    set++;
  }
  for (const w of walkers) {
    if (w.team !== team) continue;
    walk++;
    pop += w.strength;
  }
  return { pop, set, walk };
}

// ── Dynamic Population Bars ─────────────────────────────────────────
function buildPopBars(n) {
  const container = document.getElementById('pop-bars');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const color = TEAM_COLORS[i] || '#888';
    const name = (teamPlayerNames[i] || TEAM_NAMES[i] || '?');
    const label = name.length > 10 ? name.slice(0, 9) + '\u2026' : name;
    const row = document.createElement('div');
    row.className = 'pop-row';
    row.innerHTML =
      '<span class="pop-label" style="color:' + color + ';min-width:60px;font-size:10px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + name + '">' + label + '</span>' +
      '<div class="pop-bar-bg"><div class="pop-bar-fill" id="pop-bar-' + i + '" style="width:0;background:' + color + '"></div></div>' +
      '<span class="pop-val" id="pop-val-' + i + '">0</span>';
    container.appendChild(row);
  }
}

function updateSidebar() {
  const maxPop = 800;

  // Update pop bars for all teams
  for (let i = 0; i < numTeams; i++) {
    const pct = Math.min(100, ((teamPop[i] || 0) / maxPop) * 100);
    const popBar = document.getElementById('pop-bar-' + i);
    const popVal = document.getElementById('pop-val-' + i);
    if (popBar) popBar.style.width = pct + '%';
    if (popVal) popVal.textContent = Math.floor(teamPop[i] || 0);
  }

  // Mana
  const manaPct = Math.min(100, (myMana / MANA_MAX) * 100);
  const manaFill = document.getElementById('mana-bar-fill');
  const manaText = document.getElementById('mana-text');
  if (manaFill) manaFill.style.width = manaPct + '%';
  if (manaText) manaText.textContent = Math.floor(myMana) + ' / ' + MANA_MAX;

  // Mode buttons
  const modeBtns = document.querySelectorAll('.mode-btn');
  modeBtns.forEach(btn => {
    const m = parseInt(btn.dataset.mode);
    btn.classList.toggle('active', teamMode[myTeam] === m);
  });

  // Tool buttons
  const inspBtn = document.getElementById('btn-inspect');
  if (inspBtn) inspBtn.classList.toggle('active', inspectMode);
  const magBtn = document.getElementById('btn-magnet');
  if (magBtn) magBtn.classList.toggle('active', magnetMode);

  // Stats
  const myStats = getTeamStats(myTeam);
  const el = id => document.getElementById(id);
  const s = (id, v) => { const e = el(id); if (e) e.textContent = v; };
  s('stat-my-set', myStats.set);
  s('stat-my-walk', myStats.walk);

  // Opponent stats — show all non-own teams
  const oppDiv = document.getElementById('opp-stats');
  if (oppDiv) {
    let html = '';
    for (let t = 0; t < numTeams; t++) {
      if (t === myTeam) continue;
      const oppStats = getTeamStats(t);
      const color = TEAM_COLORS[t] || '#888';
      const name = teamPlayerNames[t] || TEAM_NAMES[t] || 'Team ' + t;
      html += '<div class="stat-line" style="color:' + color + '">' + name + ': <span class="stat-val">' + oppStats.set + 's / ' + oppStats.walk + 'w</span></div>';
    }
    oppDiv.innerHTML = html;
  }
}

function showSidebar() {
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.add('visible');
}

function centerOnHome() {
  let home;
  if (homePos) {
    home = homePos;
  } else {
    // Fallback: center of map
    home = { x: localMapW / 2, y: localMapH / 2 };
  }
  const h = 3; // approximate land height
  camX = -(home.x - home.y) * TILE_HALF_W;
  updateViewport();
  camY = _vpCY - 80 - (home.x + home.y) * TILE_HALF_H + h * HEIGHT_STEP;
  clampCamera();
}

// ── Profiling ──────────────────────────────────────────────────────
let _profiling = false;
let _profSamples = [];
let _profSections = ['interpolate', 'space', 'walkerGrid', 'culling', 'terrain', 'entities', 'fire', 'mist', 'targeting', 'magnets', 'waterfall', 'hud', 'minimap', 'overlays'];

function startTiming() {
  _profiling = true;
  _profSamples = [];
  console.log('%c[Profiler] Started — collecting frame samples...', 'color: #0af');
}

function stopTimingWithResults() {
  _profiling = false;
  if (_profSamples.length === 0) { console.log('No samples collected.'); return; }
  const n = _profSamples.length;
  const avg = {};
  const max = {};
  for (const key of _profSections.concat(['total', 'tileCount', 'waterCount', 'landCount'])) {
    avg[key] = 0;
    max[key] = 0;
  }
  for (const s of _profSamples) {
    for (const key in s) {
      avg[key] = (avg[key] || 0) + s[key];
      max[key] = Math.max(max[key] || 0, s[key]);
    }
  }
  for (const key in avg) avg[key] /= n;

  console.log(`%c[Profiler] Results over ${n} frames:`, 'color: #0af; font-weight: bold');
  console.log(`  Total:       avg ${avg.total.toFixed(2)}ms   max ${max.total.toFixed(2)}ms`);
  console.log('  ─── Breakdown ───');
  for (const key of _profSections) {
    if (avg[key] !== undefined) {
      const pct = (avg[key] / avg.total * 100).toFixed(0);
      console.log(`  ${key.padEnd(14)} avg ${avg[key].toFixed(2).padStart(7)}ms   max ${max[key].toFixed(2).padStart(7)}ms   ${pct.padStart(3)}%`);
    }
  }
  console.log('  ─── Tile Stats ───');
  console.log(`  Tiles drawn: avg ${Math.round(avg.tileCount)}  (water: ${Math.round(avg.waterCount)}, land: ${Math.round(avg.landCount)})`);
  console.log(`  Visible range: ${_endCol_dbg - _startCol_dbg} cols × ${_endRow_dbg - _startRow_dbg} rows`);
  console.log(`  Zoom: ${zoom.toFixed(3)}`);
  return { avg, max, n };
}

// Expose to console
window.startTiming = startTiming;
window.stopTimingWithResults = stopTimingWithResults;

let _startCol_dbg = 0, _endCol_dbg = 0, _startRow_dbg = 0, _endRow_dbg = 0;

function render() {
  if (heights.length === 0) return;
  const _p = _profiling;
  let _t0, _tStart, _sample;
  if (_p) { _t0 = _tStart = performance.now(); _sample = {}; }

  // Update viewport dimensions and hoist origin
  updateViewport();
  _originX = Math.floor(_vpCX) + camX;
  _originY = 80 + camY;

  // Rebuild land tile cache if invalidated
  if (texturesLoaded) {
    if (landTileCache === null ||
        landTileCacheTexOpacity !== textureOpacity ||
        landTileCacheHiRes !== settingHiRes) {
      buildLandTileFrames();
      // Terrain buffer depends on land tile cache, needs full redraw
      terrainBufferNeedsFull = true;
    }
  }

  // Get interpolated walkers for smooth rendering
  walkers = getInterpolatedWalkers();
  if (_p) { const _t = performance.now(); _sample.interpolate = _t - _t0; _t0 = _t; }

  // Space background (screen space, before zoom)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (settingEffects) {
    drawSpaceBackground(performance.now() / 1000);
  } else {
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (_p) { const _t = performance.now(); _sample.space = _t - _t0; _t0 = _t; }

  // Apply zoom around viewport center (with screen shake)
  let shx = armageddon ? armageddonShake.x : 0;
  let shy = armageddon ? armageddonShake.y : 0;
  for (const m of meteorEffects) {
    if (m.impacted && m.shakeIntensity > 0) {
      shx += (Math.random() - 0.5) * m.shakeIntensity * 2;
      shy += (Math.random() - 0.5) * m.shakeIntensity * 2;
    }
  }
  for (const eq of earthquakeShakes) {
    const t = eq.life / eq.maxLife;
    const intensity = t * 10;
    shx += (Math.random() - 0.5) * intensity * 2;
    shy += (Math.random() - 0.5) * intensity * 2;
  }
  ctx.setTransform(zoom, 0, 0, zoom, _vpCX * (1 - zoom) + shx, _vpCY * (1 - zoom) + shy);

  rebuildWalkerGrid();
  if (_p) { const _t = performance.now(); _sample.walkerGrid = _t - _t0; _t0 = _t; }

  // Falling tiles (behind the map, tumbling into the void during armageddon)
  drawFallingTiles();

  // Compute visible tile range from screen corners (viewport culling)
  const _c0 = screenToGridFlat(0, 0);
  const _c1 = screenToGridFlat(canvas.width, 0);
  const _c2 = screenToGridFlat(0, canvas.height);
  const _c3 = screenToGridFlat(canvas.width, canvas.height);
  const _margin = MAX_HEIGHT;
  const _startCol = Math.max(0, Math.floor(Math.min(_c0.gx, _c1.gx, _c2.gx, _c3.gx)) - _margin);
  const _endCol = Math.min(localMapW, Math.ceil(Math.max(_c0.gx, _c1.gx, _c2.gx, _c3.gx)) + _margin);
  const _startRow = Math.max(0, Math.floor(Math.min(_c0.gy, _c1.gy, _c2.gy, _c3.gy)) - _margin);
  const _endRow = Math.min(localMapH, Math.ceil(Math.max(_c0.gy, _c1.gy, _c2.gy, _c3.gy)) + _margin);
  _startCol_dbg = _startCol; _endCol_dbg = _endCol; _startRow_dbg = _startRow; _endRow_dbg = _endRow;
  if (_p) { const _t = performance.now(); _sample.culling = _t - _t0; _t0 = _t; }

  // Pass 1: terrain
  let _waterCount = 0, _landCount = 0;

  // Init terrain buffer on first frame with state data
  if (!terrainBufferInited && heights.length > 0 && landTileCache) {
    initTerrainBuffer();
  }

  // Use terrain buffer when zoomed out (at high zoom, per-tile rendering is sharper).
  // Buffer is at 1:1 world-space resolution; zoom > 1.5 would visibly blur.
  const useTerrainBuffer = terrainBufferInited && terrainBuffer && !armageddon && zoom <= 1.5;

  if (useTerrainBuffer) {
    // ── Buffer path: single blit + water animation overlay + grid lines ──
    updateTerrainBuffer();

    // Buffer-local origin matches drawTileToBuffer
    const bOriginX = localMapH * TILE_HALF_W;
    const bOriginY = MAX_HEIGHT * HEIGHT_STEP + 32;

    // Buffer pixel (bx, by) corresponds to world pixel (bx - bOriginX + _originX, by - bOriginY + _originY).
    // Buffer's top-left corner sits at world position:
    const bufWorldX = _originX - bOriginX;
    const bufWorldY = _originY - bOriginY;

    // Compute visible world-space bounds and clip to buffer for efficient blit
    const invZ = 1 / zoom;
    const zOffX = _vpCX * (1 - zoom);
    const zOffY = _vpCY * (1 - zoom);
    const wLeft  = (0            - zOffX) * invZ;
    const wTop   = (0            - zOffY) * invZ;
    const wRight = (canvas.width - zOffX) * invZ;
    const wBot   = (canvas.height- zOffY) * invZ;

    // Map visible world bounds to buffer coords
    let srcX = Math.max(0, Math.floor(wLeft - bufWorldX));
    let srcY = Math.max(0, Math.floor(wTop  - bufWorldY));
    let srcR = Math.min(terrainBufferW, Math.ceil(wRight  - bufWorldX));
    let srcB = Math.min(terrainBufferH, Math.ceil(wBot    - bufWorldY));
    let srcW = srcR - srcX;
    let srcH = srcB - srcY;

    if (srcW > 0 && srcH > 0) {
      ctx.drawImage(terrainBuffer, srcX, srcY, srcW, srcH,
        bufWorldX + srcX, bufWorldY + srcY, srcW, srcH);
    }

    // Water animation overlay: iterate visible tiles, draw only water with animated frame
    for (let row = _startRow; row < _endRow; row++) {
      for (let col = _startCol; col < _endCol; col++) {
        const t = heights[col][row], r = heights[col + 1][row];
        const b = heights[col + 1][row + 1], l = heights[col][row + 1];
        const isWater = (t <= seaLevel && r <= seaLevel && b <= seaLevel && l <= seaLevel);
        if (!isWater || !waterFrames) continue;
        if (_p) _waterCount++;
        const pTopX = _originX + (col - row) * TILE_HALF_W;
        const pTopY = _originY + (col + row) * TILE_HALF_H;
        const fi = (waterFrameCounter + col + row) % WATER_FRAME_COUNT;
        const wf = waterFrames[fi];
        ctx.drawImage(wf, 0, 0, wf.width, wf.height,
          pTopX - TILE_HALF_W, pTopY, TILE_HALF_W * 2, TILE_HALF_H * 2);
      }
    }

    // Grid lines overlay: iterate visible tiles, stroke at screen resolution
    if (GRID_MODES[gridMode]) {
      ctx.strokeStyle = GRID_MODES[gridMode];
      ctx.lineWidth = 1;
      for (let row = _startRow; row < _endRow; row++) {
        for (let col = _startCol; col < _endCol; col++) {
          const tileIdx = row * localMapW + col;
          if (fallenTiles[tileIdx]) continue;
          const t = heights[col][row], r = heights[col + 1][row];
          const b = heights[col + 1][row + 1], l = heights[col][row + 1];
          const pTopX = _originX + (col - row) * TILE_HALF_W;
          const pTopY = _originY + (col + row) * TILE_HALF_H - t * HEIGHT_STEP;
          ctx.beginPath();
          ctx.moveTo(pTopX, pTopY);
          ctx.lineTo(pTopX + TILE_HALF_W, pTopY + TILE_HALF_H - (r - t) * HEIGHT_STEP);
          ctx.lineTo(pTopX, pTopY + 2 * TILE_HALF_H - (b - t) * HEIGHT_STEP);
          ctx.lineTo(pTopX - TILE_HALF_W, pTopY + TILE_HALF_H - (l - t) * HEIGHT_STEP);
          ctx.closePath();
          ctx.stroke();
        }
      }
    }

    // Collect visible tile sprites for depth-sorted rendering (pass 2)
    for (let row = _startRow; row < _endRow; row++) {
      for (let col = _startCol; col < _endCol; col++) {
        const tileIdx = row * localMapW + col;
        if (fallenTiles[tileIdx]) continue;
        if (!rockTiles[tileIdx] && !treeTiles[tileIdx] && !pebbleTiles[tileIdx] && !ruinTiles[tileIdx]) continue;
        _tileSpriteCols.push(col, row);
      }
    }

    if (_p) _landCount = localMapW * localMapH - _waterCount;
  } else {
    // ── Fallback path: per-tile rendering (armageddon or buffer disabled) ──
    for (let row = _startRow; row < _endRow; row++) {
      for (let col = _startCol; col < _endCol; col++) {
        if (fallenTiles[row * localMapW + col]) continue;
        if (_p) {
          const t = heights[col][row], r = heights[col + 1][row];
          const b = heights[col + 1][row + 1], l = heights[col][row + 1];
          if (t <= seaLevel && r <= seaLevel && b <= seaLevel && l <= seaLevel) _waterCount++;
          else _landCount++;
        }
        drawTile(col, row);
      }
    }
  }

  if (_p) { const _t = performance.now(); _sample.terrain = _t - _t0; _sample.tileCount = _waterCount + _landCount; _sample.waterCount = _waterCount; _sample.landCount = _landCount; _t0 = _t; }

  // Pass 2: tile sprites, settlements, walkers, and fires sorted together by depth (x+y)
  const drawList = [];
  // Add tile sprites collected from terrain pass (or fallback: scan visible tiles)
  for (let i = 0; i < _tileSpriteCols.length; i += 2) {
    const col = _tileSpriteCols[i], row = _tileSpriteCols[i + 1];
    drawList.push({ depth: col + row + 0.25, type: 't', col: col, row: row });
  }
  _tileSpriteCols.length = 0;
  for (const s of settlements) {
    drawList.push({ depth: s.ox + s.oy + s.sz, type: 's', obj: s });
  }
  for (const w of walkers) {
    drawList.push({ depth: w.x + w.y, type: 'w', obj: w });
  }
  for (const f of fires) {
    drawList.push({ depth: f.x + f.y + 0.5, type: 'f', obj: f });
  }
  drawList.sort((a, b) => a.depth - b.depth);
  for (const item of drawList) {
    if (item.type === 't') {
      const col = item.col, row = item.row;
      const tileIdx = row * localMapW + col;
      const t = heights[col][row], r = heights[col + 1][row];
      const b = heights[col + 1][row + 1], l = heights[col][row + 1];
      const pTopX = _originX + (col - row) * TILE_HALF_W;
      const pTopY = _originY + (col + row) * TILE_HALF_H - t * HEIGHT_STEP;
      const pRightX = _originX + (col + 1 - row) * TILE_HALF_W;
      const pRightY = _originY + (col + 1 + row) * TILE_HALF_H - r * HEIGHT_STEP;
      const pBottomX = _originX + (col + 1 - row - 1) * TILE_HALF_W;
      const pBottomY = _originY + (col + 1 + row + 1) * TILE_HALF_H - b * HEIGHT_STEP;
      const pLeftX = _originX + (col - row - 1) * TILE_HALF_W;
      const pLeftY = _originY + (col + row + 1) * TILE_HALF_H - l * HEIGHT_STEP;
      drawTileSprites(tileIdx, pTopX, pTopY, pRightX, pRightY, pBottomX, pBottomY, pLeftX, pLeftY);
    }
    else if (item.type === 's') drawSettlement(item.obj);
    else if (item.type === 'w') drawWalker(item.obj);
    else drawSingleFire(item.obj);
  }
  if (_p) { const _t = performance.now(); _sample.entities = _t - _t0; _t0 = _t; }

  // Fire particles (on top of everything in world space)
  drawFireParticles();
  drawLightningEffects();
  drawMeteorEffects();
  if (_p) { const _t = performance.now(); _sample.fire = _t - _t0; _t0 = _t; }

  // Edge mist (world space, tied to tiles)
  if (settingEffects) drawEdgeMist();
  if (_p) { const _t = performance.now(); _sample.mist = _t - _t0; _t0 = _t; }

  // Targeting overlay
  if (targetingPower) {
    const powerDef = POWERS.find(p => p.id === targetingPower);
    if (powerDef) {
      const { px, py } = screenToGrid(mouseX, mouseY);
      let radius = 0;
      if (targetingPower === 'earthquake') radius = EARTHQUAKE_RADIUS;
      else if (targetingPower === 'volcano') radius = VOLCANO_RADIUS;
      else if (targetingPower === 'meteor') radius = METEOR_RADIUS;

      if (radius > 0) {
        for (let tx = Math.max(0, px - radius); tx < Math.min(localMapW, px + radius); tx++) {
          for (let ty = Math.max(0, py - radius); ty < Math.min(localMapH, py + radius); ty++) {
            const dx = tx + 0.5 - px, dy = ty + 0.5 - py;
            if (dx * dx + dy * dy < radius * radius) {
              const t = heights[tx][ty], r = heights[tx + 1][ty];
              const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];
              const pTop    = project(tx,     ty,     t);
              const pRight  = project(tx + 1, ty,     r);
              const pBottom = project(tx + 1, ty + 1, b);
              const pLeft   = project(tx,     ty + 1, l);
              ctx.beginPath();
              ctx.moveTo(pTop.x, pTop.y);
              ctx.lineTo(pRight.x, pRight.y);
              ctx.lineTo(pBottom.x, pBottom.y);
              ctx.lineTo(pLeft.x, pLeft.y);
              ctx.closePath();
              ctx.fillStyle = targetingPower === 'meteor' ? 'rgba(255, 60, 20, 0.3)' : 'rgba(255, 140, 0, 0.25)';
              ctx.fill();
            }
          }
        }
      } else if (targetingPower === 'lightning') {
        const tx = Math.floor(px), ty = Math.floor(py);
        if (tx >= 0 && tx < localMapW && ty >= 0 && ty < localMapH) {
          const t = heights[tx][ty], r = heights[tx + 1][ty];
          const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];
          const pTop    = project(tx,     ty,     t);
          const pRight  = project(tx + 1, ty,     r);
          const pBottom = project(tx + 1, ty + 1, b);
          const pLeft   = project(tx,     ty + 1, l);
          ctx.beginPath();
          ctx.moveTo(pTop.x, pTop.y);
          ctx.lineTo(pRight.x, pRight.y);
          ctx.lineTo(pBottom.x, pBottom.y);
          ctx.lineTo(pLeft.x, pLeft.y);
          ctx.closePath();
          ctx.fillStyle = 'rgba(180, 200, 255, 0.4)';
          ctx.fill();
        }
      } else if (targetingPower === 'swamp') {
        const tx = Math.floor(px), ty = Math.floor(py);
        if (tx >= 0 && tx < localMapW && ty >= 0 && ty < localMapH) {
          const t = heights[tx][ty], r = heights[tx + 1][ty];
          const b = heights[tx + 1][ty + 1], l = heights[tx][ty + 1];
          const pTop    = project(tx,     ty,     t);
          const pRight  = project(tx + 1, ty,     r);
          const pBottom = project(tx + 1, ty + 1, b);
          const pLeft   = project(tx,     ty + 1, l);
          ctx.beginPath();
          ctx.moveTo(pTop.x, pTop.y);
          ctx.lineTo(pRight.x, pRight.y);
          ctx.lineTo(pBottom.x, pBottom.y);
          ctx.lineTo(pLeft.x, pLeft.y);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255, 140, 0, 0.35)';
          ctx.fill();
        }
      }
    }
  }

  // Terrain crosshair — show which height point will be raised/lowered
  if (!targetingPower && !inspectMode && !armageddon && heights && localMapW > 0) {
    const { px, py } = screenToGrid(mouseX, mouseY);
    if (px >= 0 && px <= localMapW && py >= 0 && py <= localMapH) {
      const sp = project(px, py, heights[px][py]);
      const sz = 3; // crosshair arm length in pixels
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sp.x - sz, sp.y); ctx.lineTo(sp.x + sz, sp.y);
      ctx.moveTo(sp.x, sp.y - sz); ctx.lineTo(sp.x, sp.y + sz);
      ctx.stroke();
    }
  }

  if (_p) { const _t = performance.now(); _sample.targeting = _t - _t0; _t0 = _t; }

  // Magnet flags — draw for all teams
  for (let t = 0; t < numTeams; t++) {
    drawMagnetFlag(t);
  }
  if (_p) { const _t = performance.now(); _sample.magnets = _t - _t0; _t0 = _t; }

  // Waterfall particles (front edges, falling into the void)
  if (settingEffects) drawWaterfallParticles();
  if (_p) { const _t = performance.now(); _sample.waterfall = _t - _t0; _t0 = _t; }

  // Reset transform for HUD (drawn in screen space)
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Armageddon embers (screen space, in front of everything)
  if (settingEffects) drawArmageddonEmbers();

  // Power bar needs responsive updates (targeting feedback)
  updatePowerBar();
  // Sidebar — throttle DOM updates to ~4/sec
  const _now = performance.now();
  if (!updateSidebar._last || _now - updateSidebar._last > 250) {
    updateSidebar._last = _now;
    updateSidebar();
  }
  if (_p) { const _t = performance.now(); _sample.hud = _t - _t0; _t0 = _t; }

  // Minimap (drawn on top of HUD, in screen space)
  drawMinimap();
  if (_p) { const _t = performance.now(); _sample.minimap = _t - _t0; _t0 = _t; }

  // Inspect tooltip
  if (inspectData) drawInspectTooltip();

  // Armageddon overlay
  if (armageddon && !gameOver) {
    const t = performance.now() / 1000;
    const cx = canvas.width / 2;

    // Screen-edge red vignette
    const vigGrad = ctx.createRadialGradient(cx, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.3,
      cx, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.7);
    vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vigGrad.addColorStop(1, `rgba(80, 0, 0, ${(0.3 + 0.1 * Math.sin(t * 2)).toFixed(2)})`);
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Title text with glow
    const pulse = 0.7 + 0.3 * Math.sin(t * 3);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.shadowColor = `rgba(255, 40, 0, ${(pulse * 0.8).toFixed(2)})`;
    ctx.shadowBlur = 30 + pulse * 20;
    ctx.font = "900 52px 'Cinzel', serif";
    ctx.fillStyle = `rgba(255, ${Math.floor(60 + pulse * 40)}, 0, 0.95)`;
    ctx.fillText('ARMAGEDDON', cx, 55);

    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(255, ${Math.floor(180 + pulse * 75)}, ${Math.floor(80 + pulse * 60)}, 1)`;
    ctx.fillText('ARMAGEDDON', cx, 55);

    ctx.restore();
  }

  // Game over overlay
  if (gameOver) {
    const t = performance.now() / 1000;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const won = gameWinner === myTeam;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const hlColor = won ? 'rgba(200, 168, 76, 0.1)' : 'rgba(200, 40, 40, 0.08)';
    const hlGrad = ctx.createRadialGradient(cx, cy - 40, 0, cx, cy - 40, 300);
    hlGrad.addColorStop(0, hlColor);
    hlGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hlGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const isDraw = gameWinner < 0;
    const resultText = won ? 'VICTORY' : (isDraw ? 'DRAW' : 'DEFEAT');
    const resultColor = won ? '#c9a84c' : (isDraw ? '#aaa' : '#ff5544');
    const glowColor = won ? 'rgba(200, 168, 76, 0.6)' : (isDraw ? 'rgba(160, 160, 160, 0.5)' : 'rgba(255, 60, 40, 0.5)');
    const pulse = 0.8 + 0.2 * Math.sin(t * 2);

    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 25 * pulse;
    ctx.font = "900 64px 'Cinzel', serif";
    ctx.fillStyle = resultColor;
    ctx.fillText(resultText, cx, cy - 50);

    ctx.shadowBlur = 0;
    ctx.fillText(resultText, cx, cy - 50);

    ctx.font = "300 18px 'Raleway', sans-serif";
    ctx.letterSpacing = '4px';
    ctx.fillStyle = 'rgba(200, 210, 230, 0.7)';
    const subText = won
      ? `${teamPlayerNames[myTeam] || 'You'}, the ${TEAM_NAMES[myTeam]} God`
      : isDraw
        ? 'All civilizations have perished'
        : gameWinnerName === TEAM_NAMES[gameWinner]
          ? `The ${TEAM_NAMES[gameWinner]} God has prevailed`
          : `${gameWinnerName}, the ${TEAM_NAMES[gameWinner]} God has prevailed`;
    ctx.fillText(subText, cx, cy + 10);

    const lineW = 160;
    const lineGrad = ctx.createLinearGradient(cx - lineW, 0, cx + lineW, 0);
    lineGrad.addColorStop(0, 'rgba(200,168,76,0)');
    lineGrad.addColorStop(0.5, 'rgba(200,168,76,0.2)');
    lineGrad.addColorStop(1, 'rgba(200,168,76,0)');
    ctx.fillStyle = lineGrad;
    ctx.fillRect(cx - lineW, cy + 35, lineW * 2, 1);

    // Buttons
    ctx.font = "600 14px 'Raleway', sans-serif";
    const btnY = cy + 70;
    const btn1X = cx - 90, btn2X = cx + 90;
    const btnW = 140, btnH = 40;

    const b1hover = gameOverHover === 'again';
    ctx.fillStyle = b1hover ? 'rgba(70, 55, 22, 0.95)' : 'rgba(40, 32, 14, 0.85)';
    ctx.strokeStyle = b1hover ? 'rgba(200, 168, 76, 0.6)' : 'rgba(180, 150, 80, 0.3)';
    ctx.lineWidth = 1;
    roundRect(ctx, btn1X - btnW/2, btnY - btnH/2, btnW, btnH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = b1hover ? '#fff5e0' : 'rgba(220, 200, 150, 0.9)';
    ctx.fillText('PLAY AGAIN', btn1X, btnY);

    const b2hover = gameOverHover === 'lobby';
    ctx.fillStyle = b2hover ? 'rgba(50, 42, 25, 0.9)' : 'rgba(25, 20, 10, 0.8)';
    ctx.strokeStyle = b2hover ? 'rgba(180, 150, 80, 0.4)' : 'rgba(120, 100, 50, 0.2)';
    roundRect(ctx, btn2X - btnW/2, btnY - btnH/2, btnW, btnH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = b2hover ? '#fff5e0' : 'rgba(200, 185, 150, 0.7)';
    ctx.fillText('LOBBY', btn2X, btnY);

    gameOverBtns.again = { x: btn1X - btnW/2, y: btnY - btnH/2, w: btnW, h: btnH };
    gameOverBtns.lobby = { x: btn2X - btnW/2, y: btnY - btnH/2, w: btnW, h: btnH };

    ctx.restore();
  }

  if (_p) { const _t = performance.now(); _sample.overlays = _t - _t0; _sample.total = _t - _tStart; _profSamples.push(_sample); }
}

// Rounded rect helper
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

// Game over button state
let gameOverHover = null;
const gameOverBtns = { again: null, lobby: null };

function updateCursor() {
  canvas.style.cursor = gameOverHover ? 'pointer' : (gameOver ? 'default' : (inspectMode ? 'zoom-in' : (targetingPower ? 'cell' : (magnetMode ? 'move' : 'crosshair'))));
}

// Track hover over game over buttons
window.addEventListener('mousemove', (e) => {
  if (!gameOver) { gameOverHover = null; return; }
  const mx = e.clientX, my = e.clientY;
  gameOverHover = null;
  for (const key of ['again', 'lobby']) {
    const b = gameOverBtns[key];
    if (b && mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
      gameOverHover = key;
      break;
    }
  }
  updateCursor();
});

function returnToLobby() {
  // Close existing connection
  if (ws) { ws.close(); ws = null; }

  // Reset game state
  gameStarted = false;
  gameOver = false;
  gameWinner = -1;
  gameWinnerName = '';
  teamPlayerNames = [];
  gameOverHover = null;
  gameOverBtns.again = null;
  gameOverBtns.lobby = null;
  armageddon = false;
  fallingTiles.length = 0;
  fallenTiles.fill(0);
  fallingFrontier = [];
  armageddonEmbers.length = 0;
  supernovaStars = [];
  heights = [];
  walkers = [];
  settlements = [];
  myTeam = -1;
  myMana = 0;
  targetingPower = null;
  inspectMode = false;
  inspectData = null;
  magnetMode = false;
  homePos = null;

  // Reset dynamic dimensions
  localMapW = MAP_W;
  localMapH = MAP_H;
  numTeams = 2;
  initTeamArrays(2);
  walkerGrid = new Array(localMapW * localMapH);
  reinitTypedArrays();

  // Show lobby, hide game
  document.getElementById('game').style.display = 'none';
  document.getElementById('sidebar').classList.remove('visible');
  document.getElementById('settings-popup').classList.remove('visible');
  document.getElementById('lobby').style.display = 'flex';
  document.getElementById('lobby-bg').style.display = 'block';
  const lobbyVol = document.getElementById('lobby-vol');
  if (lobbyVol) lobbyVol.style.display = 'flex';
  document.getElementById('create-join-section').style.display = '';
  document.getElementById('waiting-section').style.display = 'none';
  document.getElementById('error-text').textContent = '';
  document.getElementById('room-chat-messages').innerHTML = '';
  document.getElementById('lobby-chat-messages').innerHTML = '';
  document.getElementById('start-game-row').style.display = 'none';
  isCreator = false;
  canvas.style.cursor = 'default';

  // Restart lobby background
  lobbyActive = true;
  resizeLobbyBg();
  requestAnimationFrame(renderLobby);

  // Reconnect fresh for lobby browsing
  connectToServer();
}

// ── Picking ─────────────────────────────────────────────────────────
function screenToGrid(sx, sy) {
  // Reverse zoom transform to get world-space screen coords
  sx = (sx - _vpCX * (1 - zoom)) / zoom;
  sy = (sy - _vpCY * (1 - zoom)) / zoom;

  const o = getOrigin();
  const dx = sx - o.x, dy = sy - o.y;
  const fpx = (dx / TILE_HALF_W + dy / TILE_HALF_H) / 2;
  const fpy = (dy / TILE_HALF_H - dx / TILE_HALF_W) / 2;

  let bestDist = Infinity, bestPx = Math.round(fpx), bestPy = Math.round(fpy);
  const bx = Math.floor(fpx), by = Math.floor(fpy);
  const R = Math.ceil(MAX_HEIGHT / 2) + 1;

  for (let ix = bx - R; ix <= bx + R; ix++) {
    for (let iy = by - R; iy <= by + R; iy++) {
      if (ix < 0 || ix > localMapW || iy < 0 || iy > localMapH) continue;
      const sp = project(ix, iy, heights[ix][iy]);
      const d = (sp.x - sx) ** 2 + (sp.y - sy) ** 2;
      if (d < bestDist) { bestDist = d; bestPx = ix; bestPy = iy; }
    }
  }
  return { px: bestPx, py: bestPy };
}
