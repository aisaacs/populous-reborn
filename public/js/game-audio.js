// ── Music System ───────────────────────────────────────────────────
const MUSIC_TRACKS = ['music/001.mp3', 'music/002.mp3', 'music/003.mp3', 'music/004.mp3'];
let musicQueue = [];
let musicAudio = null;
let musicMuted = localStorage.getItem('musicMuted') === 'true';
let musicVolume = parseFloat(localStorage.getItem('musicVolume') ?? '0.3');
let musicStarted = false;

function shuffleTracks() {
  musicQueue = MUSIC_TRACKS.slice();
  for (let i = musicQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [musicQueue[i], musicQueue[j]] = [musicQueue[j], musicQueue[i]];
  }
}

function playNextTrack() {
  if (musicQueue.length === 0) shuffleTracks();
  const src = musicQueue.shift();
  musicAudio = new Audio(src);
  musicAudio.volume = musicMuted ? 0 : musicVolume;
  musicAudio.addEventListener('ended', playNextTrack);
  musicAudio.play().catch(() => {});
}

function startMusic() {
  if (musicStarted || !settingMusic) return;
  musicStarted = true;
  shuffleTracks();
  playNextTrack();
  syncMusicUI();
}

function setMusicVolume(v) {
  musicVolume = Math.max(0, Math.min(1, v));
  localStorage.setItem('musicVolume', String(musicVolume));
  if (musicAudio) musicAudio.volume = musicMuted ? 0 : musicVolume;
  syncMusicUI();
}

function toggleMusicMute() {
  musicMuted = !musicMuted;
  localStorage.setItem('musicMuted', String(musicMuted));
  if (musicAudio) musicAudio.volume = musicMuted ? 0 : musicVolume;
  syncMusicUI();
}

function syncMusicUI() {
  const btn = document.getElementById('btn-mute');
  if (btn) btn.textContent = musicMuted ? '\u266C' : '\u266B';
  if (btn) btn.style.opacity = musicMuted ? '0.4' : '1';
  const slider = document.getElementById('music-vol');
  if (slider) slider.value = musicVolume * 100;
}

// Volume slider
document.getElementById('music-vol').addEventListener('input', (e) => {
  setMusicVolume(e.target.valueAsNumber / 100);
  if (musicMuted) toggleMusicMute();
});

// Mute button
document.getElementById('btn-mute').addEventListener('click', () => {
  if (!musicStarted) startMusic();
  else toggleMusicMute();
});


// Init UI from saved prefs
syncMusicUI();

// ── SFX System ────────────────────────────────────────────────────
const SFX_FILES = [
  'volcano', 'earthquake', 'armageddon', 'flood', 'knight', 'swamp', 'lightning', 'meteor',
  'victory', 'defeat', 'settle', 'levelup', 'destroy', 'combat', 'terrain'
];
const sfxBuffers = {};
let sfxVolume = parseFloat(localStorage.getItem('sfxVolume') ?? '0.5');
let sfxMuted = localStorage.getItem('sfxMuted') === 'true';
let settingSfx = localStorage.getItem('settingSfx') !== 'false'; // default true

// Preload all SFX
for (const name of SFX_FILES) {
  const a = new Audio('snd/' + name + '.mp3');
  a.preload = 'auto';
  sfxBuffers[name] = a;
}

let lastCombatSfxTime = 0;

function playSfx(name) {
  if (!settingSfx || sfxMuted) return;
  const src = sfxBuffers[name];
  if (!src) return;
  const clone = src.cloneNode();
  clone.volume = sfxVolume;
  clone.play().catch(() => {});
}

function setSfxVolume(v) {
  sfxVolume = Math.max(0, Math.min(1, v));
  localStorage.setItem('sfxVolume', String(sfxVolume));
  syncSfxUI();
}

function syncSfxUI() {
  const slider = document.getElementById('sfx-vol');
  if (slider) slider.value = sfxVolume * 100;
}

// SFX volume slider
const sfxVolSlider = document.getElementById('sfx-vol');
if (sfxVolSlider) {
  sfxVolSlider.addEventListener('input', (e) => {
    setSfxVolume(e.target.valueAsNumber / 100);
    if (sfxMuted) { sfxMuted = false; localStorage.setItem('sfxMuted', String(sfxMuted)); }
  });
}

syncSfxUI();

