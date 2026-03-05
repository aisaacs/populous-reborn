#!/usr/bin/env node
/**
 * Recolor blue team sprites to green, yellow, purple, orange using Gemini API.
 *
 * Usage: GEMINI_API_KEY=xxx node scripts/recolor-sprites.js [--dry-run] [--team orange] [--sprite tent]
 *
 * Options:
 *   --dry-run     List what would be generated without calling the API
 *   --team NAME   Only generate for one team (green/yellow/purple/orange)
 *   --sprite NAME Only generate for one sprite base name (e.g. tent, castle, walker-se)
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GFX_DIR = path.join(__dirname, '..', 'public', 'gfx');
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash-image';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

const TARGET_TEAMS = ['green', 'yellow', 'purple', 'orange'];

// Describe colors for the prompt
const COLOR_DESCRIPTIONS = {
  green:  'bright green (like #44cc44)',
  yellow: 'golden yellow (like #cccc22)',
  purple: 'vibrant purple (like #aa44ff)',
  orange: 'warm orange (like #ff8800)',
};

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const teamFilter = args.includes('--team') ? args[args.indexOf('--team') + 1] : null;
const spriteFilter = args.includes('--sprite') ? args[args.indexOf('--sprite') + 1] : null;

// Find all blue source sprites
function findBlueSprites() {
  const files = fs.readdirSync(GFX_DIR);
  return files
    .filter(f => f.endsWith('.png') && f.includes('-blue'))
    .map(f => ({
      file: f,
      baseName: f.replace('-blue', '').replace('.png', ''),
    }));
}

// Sleep helper for rate limiting
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Chroma-key: remove bright magenta (#FF00FF) background, with tolerance
// for slight color variations from Gemini's output.
async function chromaKey(sourceFile, geminiBuffer, debug) {
  const sourcePath = path.join(GFX_DIR, sourceFile);
  const srcMeta = await sharp(sourcePath).metadata();
  const { width, height } = srcMeta;

  const geminiMeta = await sharp(geminiBuffer).metadata();
  if (debug) console.log(`\n  Gemini: ${geminiMeta.width}x${geminiMeta.height} ${geminiMeta.format}`);

  // Resize Gemini output to match source dimensions, get raw RGBA
  const resultRaw = await sharp(geminiBuffer)
    .resize(width, height, { kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer();

  // Sample background color from corners (top-left pixel)
  const bgR = resultRaw[0], bgG = resultRaw[1], bgB = resultRaw[2];
  if (debug) console.log(`  BG color sampled: rgb(${bgR}, ${bgG}, ${bgB})`);

  const TOLERANCE = 30;
  const out = Buffer.from(resultRaw);
  let keyed = 0;
  for (let i = 0; i < width * height; i++) {
    const off = i * 4;
    const r = out[off], g = out[off + 1], b = out[off + 2];
    if (Math.abs(r - bgR) < TOLERANCE &&
        Math.abs(g - bgG) < TOLERANCE &&
        Math.abs(b - bgB) < TOLERANCE) {
      out[off + 3] = 0;
      keyed++;
    }
  }

  if (debug) console.log(`  Keyed out ${keyed}/${width * height} pixels`);

  return sharp(out, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

async function recolorSprite(sourceFile, targetTeam) {
  const sourcePath = path.join(GFX_DIR, sourceFile);
  const imageData = fs.readFileSync(sourcePath);
  const base64Image = imageData.toString('base64');

  const targetColor = COLOR_DESCRIPTIONS[targetTeam];

  const prompt = [
    `You are a pixel art recoloring tool. I'm giving you a pixel art game sprite that has blue-colored accents (clothing, flags, fabric, banners, etc.) on a transparent background.`,
    ``,
    `Replace ALL blue and blue-tinted pixels with ${targetColor}. This includes:`,
    `- Bright blue areas`,
    `- Dark blue shadows`,
    `- Light blue highlights`,
    `- Any blue-tinted shading`,
    ``,
    `Keep EVERYTHING else exactly the same:`,
    `- Same pixel dimensions`,
    `- Same outlines, shadows, and shading style`,
    `- Same non-blue colors (brown wood, gray stone, skin tones, etc.)`,
    `- Same pixel art style - do NOT smooth, anti-alias, or resize`,
    ``,
    `Place the sprite on a solid bright magenta (#FF00FF) background. Every pixel that is not part of the sprite must be exactly #FF00FF.`,
    ``,
    `Return ONLY the recolored image, nothing else.`,
  ].join('\n');

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType: 'image/png',
            data: base64Image,
          },
        },
      ],
    }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      temperature: 0.0,
    },
  };

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  const result = await response.json();

  // Extract image from response
  const candidates = result.candidates || [];
  for (const candidate of candidates) {
    const parts = candidate.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData && part.inlineData.mimeType?.startsWith('image/')) {
        console.log(`(${part.inlineData.mimeType}) `);
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }
  }

  // Debug: show what we got back
  const textParts = candidates
    .flatMap(c => c.content?.parts || [])
    .filter(p => p.text)
    .map(p => p.text);
  throw new Error(`No image in response. Text: ${textParts.join(' | ') || 'none'}`);
}

async function main() {
  if (!dryRun && !API_KEY) {
    console.error('Error: Set GEMINI_API_KEY environment variable');
    process.exit(1);
  }

  const blueSprites = findBlueSprites();
  const teams = teamFilter ? [teamFilter] : TARGET_TEAMS;

  // Build work list
  const work = [];
  for (const sprite of blueSprites) {
    if (spriteFilter && !sprite.baseName.includes(spriteFilter)) continue;
    for (const team of teams) {
      const outFile = sprite.baseName + '-' + team + '.png';
      // Note: we use the suffix pattern from the source file
      const outName = sprite.file.replace('-blue', '-' + team);
      const outPath = path.join(GFX_DIR, outName);
      const exists = fs.existsSync(outPath);
      work.push({
        source: sprite.file,
        team,
        outName,
        outPath,
        exists,
      });
    }
  }

  console.log(`Found ${blueSprites.length} blue sprites, ${work.length} recolor jobs`);
  console.log(`Skipping ${work.filter(w => w.exists).length} that already exist\n`);

  const todo = work.filter(w => !w.exists);

  if (dryRun) {
    console.log('Would generate:');
    for (const w of todo) {
      console.log(`  ${w.source} → ${w.outName} (${w.team})`);
    }
    console.log(`\nTotal: ${todo.length} images`);
    return;
  }

  if (todo.length === 0) {
    console.log('Nothing to do — all sprites exist.');
    return;
  }

  let success = 0, fail = 0;
  for (let i = 0; i < todo.length; i++) {
    const w = todo[i];
    const progress = `[${i + 1}/${todo.length}]`;
    process.stdout.write(`${progress} ${w.source} → ${w.outName} ... `);

    try {
      const rawBuffer = await recolorSprite(w.source, w.team);
      const imageBuffer = await chromaKey(w.source, rawBuffer, true);
      fs.writeFileSync(w.outPath, imageBuffer);
      console.log(`OK (${(imageBuffer.length / 1024).toFixed(1)}KB)`);
      success++;
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      fail++;
    }

    // Rate limit: Gemini free tier is ~10 RPM for image gen
    if (i < todo.length - 1) {
      await sleep(7000);
    }
  }

  console.log(`\nDone: ${success} succeeded, ${fail} failed`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
