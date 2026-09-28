'use strict';

/**
 * Input validation and player-state sanity clamps.
 */

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MAX_BLOB_BYTES = 1024 * 1024; // 1 MB

// Server gold cap (owner-adjustable via server_settings). sanitizeStateBlob
// clamps player gold to it on every save. Refreshed from the DB at boot and
// whenever the owner changes it (see db.refreshGoldCap).
let goldCap = 9.99e20; // 999Qi default
function setGoldCap(cap) {
  if (Number.isFinite(cap) && cap >= 1e12) goldCap = cap;
}
function getGoldCapValue() { return goldCap; }

// Server-side mirror of the client XP curve in public/js/engine.js (v19):
// levels 1-30 use a 1.30 exponent, 31-60 continue from the level-30 value
// with a 1.35 exponent, 61-90 continue from the level-60 value with a 1.44
// exponent, 91-120 continue from the level-90 value with a 1.47 exponent
// (continuous at every kink), and every rebirth multiplies
// requirements by 1.35^rebirths.
// Keep in sync if the client formula ever changes.
const SV_XP_V30 = 80 * Math.pow(1.30, 29);
const SV_XP_V60 = SV_XP_V30 * Math.pow(1.35, 30);
const SV_XP_V90 = SV_XP_V60 * Math.pow(1.44, 30);
function xpForLevelServer(level, rebirthCount) {
  const l = Math.max(1, Math.floor(Number(level) || 1));
  const base = l <= 30
    ? 80 * Math.pow(1.30, l - 1)
    : l <= 60
    ? SV_XP_V30 * Math.pow(1.35, l - 30)
    : l <= 90
    ? SV_XP_V60 * Math.pow(1.44, l - 60)
    : SV_XP_V90 * Math.pow(1.47, l - 90);
  const rb = Math.min(200, Math.max(0, Math.floor(Number(rebirthCount) || 0)));
  const mult = Math.pow(1.35, rb);
  return Math.max(1, Math.round(base * mult));
}

// All roles recognized by the server, highest privilege first.
const VALID_ROLES = ['owner', 'gm', 'admin', 'moderator', 'player'];

function validateUsername(username) {
  if (typeof username !== 'string') return 'Username is required.';
  const trimmed = username.trim();
  if (!USERNAME_RE.test(trimmed)) {
    return 'Username must be 3-20 characters: letters, numbers, underscore.';
  }
  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  return null;
}

// Named root fields and their clamp ranges [min, max]. Only applied when the
// field exists and holds a finite number; non-finite numbers become the min.
const CLAMPED_FIELDS = {
  level: [1, 120],
  stage: [1, 100000],
  gold: [0, 9.99e20], // 999Qi
  stars: [0, 1e15],
  xp: [0, 1e21], // xpForLevel(120) alone is ~7.7e18
  xpNext: [0, 1e21],
  bossesKilled: [0, 100000000],
  rebirthCount: [0, 100000],
};

function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Deep-sanitize a state blob: every number must be finite (non-finite become
 * 0), then named root fields are clamped to their allowed ranges.
 * Mutates and returns the blob.
 */
function sanitizeNumbers(node) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === 'number') {
        node[i] = Number.isFinite(v) ? v : 0;
      } else if (v && typeof v === 'object') {
        sanitizeNumbers(v);
      }
    }
    return;
  }
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (typeof v === 'number') {
      node[key] = Number.isFinite(v) ? v : 0;
    } else if (v && typeof v === 'object') {
      sanitizeNumbers(v);
    }
  }
}

/**
 * Validate + sanitize a state blob sent by the client.
 * Returns { ok: true, state } or { ok: false, error }.
 */
function sanitizeStateBlob(blob) {
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
    return { ok: false, error: 'State must be a JSON object.' };
  }
  let size;
  try {
    size = Buffer.byteLength(JSON.stringify(blob), 'utf8');
  } catch (e) {
    return { ok: false, error: 'State is not serializable.' };
  }
  if (size > MAX_BLOB_BYTES) {
    return { ok: false, error: 'State too large (max 1 MB).' };
  }
  sanitizeNumbers(blob);
  for (const [field, [min, max]] of Object.entries(CLAMPED_FIELDS)) {
    if (typeof blob[field] === 'number') {
      // Gold clamps to the live owner-set cap; the infinite-gold perk
      // (owner-granted, server-side) bypasses it entirely.
      if (field === 'gold') {
        if (blob.infGold === true) continue;
        blob.gold = clamp(blob.gold, 0, goldCap);
        continue;
      }
      blob[field] = clamp(blob[field], min, max);
    }
  }
  // Indexed columns must exist as numbers for db.saveState.
  if (typeof blob.level !== 'number') blob.level = 1;
  if (typeof blob.stage !== 'number') blob.stage = 1;
  if (typeof blob.bossesKilled !== 'number') blob.bossesKilled = 0;
  if (typeof blob.rebirthCount !== 'number') blob.rebirthCount = 0;
  if (!Array.isArray(blob.inventory)) blob.inventory = [];
  if (!Array.isArray(blob.codesRedeemed)) blob.codesRedeemed = [];
  // Anti-spoof: never trust client-supplied xpNext — recompute it from
  // level + rebirthCount so tampered saves can't grant cheap levels.
  // Mirrors public/js/engine.js xpForLevel (v18: kinks at 30 and 60, 1.35^rebirths).
  blob.xpNext = xpForLevelServer(blob.level, blob.rebirthCount);
  // Mining + forge: keep legit saves passing. Ores are plain finite
  // non-negative counts (clamped); forged item stats are clamped to a
  // sane cap so tampered values can't smuggle Infinity-scale numbers.
  if (blob.mine && typeof blob.mine === 'object' && !Array.isArray(blob.mine)) {
    if (typeof blob.mine.depth === 'number') {
      blob.mine.depth = clamp(Math.floor(blob.mine.depth), 1, 100);
    }
    // Pickaxe tier must be an int 0..7; lifetime mining counters must be
    // finite non-negative ints.
    blob.mine.pickaxe = typeof blob.mine.pickaxe === 'number'
      ? clamp(Math.floor(blob.mine.pickaxe), 0, 7)
      : 0;
    for (const k of ['totalTaps', 'totalMined', 'maxDepth']) {
      const v = blob.mine[k];
      blob.mine[k] = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    }
    const ores = blob.mine.ores;
    if (ores && typeof ores === 'object' && !Array.isArray(ores)) {
      for (const k of Object.keys(ores)) {
        ores[k] = Number.isFinite(ores[k]) ? clamp(Math.floor(ores[k]), 0, 1e12) : 0;
      }
    }
  }
  if (blob.forge && typeof blob.forge === 'object' && !Array.isArray(blob.forge)) {
    // Forge lifetime counters: crafts is a non-negative int, superCrafted
    // is strictly boolean.
    const cr = blob.forge.crafts;
    blob.forge.crafts = Number.isFinite(cr) ? Math.max(0, Math.floor(cr)) : 0;
    blob.forge.superCrafted = blob.forge.superCrafted === true;
    for (const slot of ['weapon', 'armor']) {
      const it = blob.forge[slot];
      if (it && typeof it === 'object' && it.stats && typeof it.stats === 'object') {
        for (const k of Object.keys(it.stats)) {
          it.stats[k] = Number.isFinite(it.stats[k]) ? Math.min(1e9, Math.max(0, it.stats[k])) : 0;
        }
      }
    }
  }
  return { ok: true, state: blob };
}

module.exports = {
  validateUsername,
  validatePassword,
  sanitizeStateBlob,
  setGoldCap,
  getGoldCapValue,
  MAX_BLOB_BYTES,
  VALID_ROLES,
};
