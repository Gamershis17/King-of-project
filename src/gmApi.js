'use strict';

/**
 * GM + role-management API:
 *   GET  /api/gm/overview     (gm|owner)
 *   POST /api/gm/grant        (gm|owner)
 *   POST /api/gm/grant-title  (gm|owner)
 *   POST /api/gm/badge       (gm|owner)
 *   POST /api/gm/grant-pet   (gm|owner) — grant unhatched pet eggs
 *   POST /api/gm/set-rebirth (gm|owner) — set a player's rebirth count
 *   POST /api/gm/inf-gold    (owner) — toggle infinite-gold perk
 *   POST /api/gm/settings    (owner) — update server tunables (gold_cap)
 *   POST /api/gm/maintenance (owner) — maintenance mode on/off + message
 *   POST /api/gm/set-stage    (gm|owner)
 *   POST /api/gm/set-level    (gm|owner) — set a player's level (1-120)
 *   POST /api/gm/set-gold     (gm|owner) — set a player's gold (absolute)
 *   POST /api/gm/heal         (gm|owner)
 *   POST /api/gm/reset        (gm|owner)
 *   GET  /api/gm/codes        (gm|owner)
 *   POST /api/gm/codes        (gm|owner)
 *   GET  /api/gm/roster       (gm|owner)
 *   POST /api/gm/roster       (gm|owner)
 *   POST /api/gm/title        (owner|admin) — unlock a title for a player
 *   POST /api/gm/stage        (owner|admin) — set a player's stage
 *   POST /api/gm/ban          (owner|admin) — stub until users.banned exists
 *   POST /api/gm/unban        (owner|admin) — stub until users.banned exists
 *   POST /api/gm/kick         (owner|admin) — force-logout a player now
 *   POST /api/gm/broadcast    (owner|admin|moderator) — server announcement
 *   GET  /api/broadcasts/latest (public) — newest announcement
 *   GET  /api/gm/players      (owner|admin|moderator) — player list w/ search
 *   POST /api/gm/reset-player (owner|admin) — wipe a player's save
 *   POST /api/gm/delete-account (owner only) — permanently delete an account
 *   POST /api/roles           (owner only)
 *   POST /api/gm/inventory      (gm|owner) — full inventory listing
 *   POST /api/gm/remove-item    (gm|owner) — remove one inventory item
 *   POST /api/gm/set-enchant    (gm|owner) — set enchant 0-10 on inventory/equipped item
 *   POST /api/gm/reset-quests   (gm|owner) — force re-roll of daily/weekly quests
 *   POST /api/gm/event-buff     (gm|owner) — server-wide XP/gold multiplier w/ expiry
 *   GET  /api/gm/audit          (gm|owner) — server-side staff action log
 *
 * All database access is async (PostgreSQL).
 */

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireRole, asyncHandler } = require('./auth');
const { sanitizeStateBlob, VALID_ROLES } = require('./validation');
const { makeGearItems, isValidSetId } = require('./gearSets');
const { loadBlob, defaultStateBlob } = require('./gameApi');
const { addBroadcast, latestBroadcast } = require('./broadcast');
const {
  pool,
  getUserByUsername,
  setUserRole,
  getPlayerCount,
  getUsernamesByRole,
  saveState,
  createGiftCode,
  listGiftCodes,
  getCodeCount,
  getGiftCode,
  getGoldCap,
  setSetting,
  getSetting,
  refreshGoldCap,
  bumpSessionVersion,
} = require('./db');

const router = express.Router();
const gmOrOwner = requireRole('gm', 'owner');
const ownerOnly = requireRole('owner');
// Moderator tier: read-only staff tools + broadcasts. Sensitive grant
// endpoints stay on gmOrOwner; never widen those to this middleware.
const requireMod = requireRole('owner', 'admin', 'gm', 'moderator');
// Admin tier: player-management commands that don't grant power.
const adminPlus = requireRole('owner', 'admin');
// Owner + admin + GM: player-moderation tier (ban/kick/mute).
const ownerAdminGm = requireRole('owner', 'admin', 'gm');

// Announcement spam protection: broadcasts toast every active player, so
// cap them at 5 per 10 minutes per staff member.
const broadcastLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => (req.user && req.user.id ? `u:${req.user.id}` : req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many announcements. Try again later.' },
});

const VALID_ROLES_FOR_ROLES_ROUTE = VALID_ROLES.filter((r) => r !== 'owner');
const STAR_GRANT_MIN = 1;
const STAR_GRANT_MAX = 100000;
// Ore ids mirrored from the client's Engine.ORE_TIERS (server is CJS,
// engine.js is ESM — keep this list in sync if tiers change).
const ORE_IDS = ['copper', 'iron', 'silver', 'gold', 'mithril', 'adamant', 'galaxy', 'supergalaxy'];
const ORE_GRANT_MIN = 1;
const ORE_GRANT_MAX = 1000000000;

// Unambiguous alphabet: no 0/O, 1/I/L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

async function generateCode() {
  for (let attempt = 0; attempt < 100; attempt++) {
    let chars = '';
    const bytes = crypto.randomBytes(12);
    for (const b of bytes) chars += CODE_ALPHABET[b % CODE_ALPHABET.length];
    const code = `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
    if (!(await getGiftCode(code))) return code;
  }
  throw new Error('Failed to generate a unique gift code.');
}

async function persistMergedState(userId, blob) {
  const sanitized = sanitizeStateBlob(blob);
  await saveState(userId, sanitized.ok ? sanitized.state : blob);
}
// The client hot-reloads its live game state after a self-grant. Only ever
// include the blob when the GM targeted themselves — never leak another
// player's full state through a GM response.
function selfState(req, target, blob) {
  return target.id === req.user.id ? blob : undefined;
}


async function resolveTarget(username) {
  if (typeof username !== 'string' || !username.trim()) return null;
  return getUserByUsername(username.trim());
}

// ---------- overview ----------
router.get(
  '/gm/overview',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    res.json({
      role: req.user.role,
      playerCount: await getPlayerCount(),
      codeCount: await getCodeCount(),
    });
  })
);

// ---------- grants ----------
/**
 * Mirrors the client curve in public/js/engine.js (v19 mega-update: cap raised
 * to 120; kinks at 30, 60 and 90, 1.35^rebirths):
 *   xpForLevelBase: 1-30 -> 80*1.30^(l-1); 31-60 -> V30*1.35^(l-30);
 *                   61-90 -> V60*1.44^(l-60); 91-120 -> V90*1.47^(l-90)
 *                 (V30 = 80*1.30^29, V60 = V30*1.35^30, V90 = V60*1.44^30;
 *                  continuous at every kink)
 *   xpForLevel(level, rebirthCount) = round(base * 1.35^rebirthCount)
 * Keep in sync if the client formula ever changes.
 */
const GM_XP_V30 = 80 * Math.pow(1.30, 29);
const GM_XP_V60 = GM_XP_V30 * Math.pow(1.35, 30);
const GM_XP_V90 = GM_XP_V60 * Math.pow(1.44, 30);
const GM_MAX_LEVEL = 120;
function xpForLevel(level, rebirthCount) {
  const l = Math.max(1, Math.floor(Number(level) || 1));
  const base = l <= 30
    ? 80 * Math.pow(1.30, l - 1)
    : l <= 60
    ? GM_XP_V30 * Math.pow(1.35, l - 30)
    : l <= 90
    ? GM_XP_V60 * Math.pow(1.44, l - 60)
    : GM_XP_V90 * Math.pow(1.47, l - 90);
  return Math.max(1, Math.round(base * Math.pow(1.35, Math.max(0, Math.floor(Number(rebirthCount) || 0)))));
}

function ensureHero(blob) {
  if (!blob.hero || typeof blob.hero !== 'object') blob.hero = {};
  return blob.hero;
}

/** Mirrors client grantLevels(): per-level stat gains + mastery points + full heal. */
function applyLevelGrant(blob, n) {
  n = Math.max(1, Math.min(100, Math.floor(n) || 0));
  if (!n) return 0;
  blob.level = Math.max(1, Math.floor(Number(blob.level) || 1));
  const hero = ensureHero(blob);
  let granted = 0;
  for (let i = 0; i < n && blob.level < GM_MAX_LEVEL; i++) {
    blob.level += 1;
    hero.attack = (Number(hero.attack) || 0) + 3;
    hero.maxHp = (Number(hero.maxHp) || 0) + 25;
    hero.defense = (Number(hero.defense) || 0) + 2;
    if (blob.level % 10 === 0 && blob.mastery && typeof blob.mastery === 'object') {
      blob.mastery.points = Math.max(0, Math.floor(Number(blob.mastery.points) || 0)) + 1;
    }
    granted += 1;
  }
  blob.xp = 0;
  blob.xpNext = xpForLevel(blob.level, blob.rebirthCount);
  hero.hp = hero.maxHp;
  return granted;
}

/** Add XP and process level-ups server-side so stats stay consistent. */
function applyXpGrant(blob, amount) {
  blob.level = Math.max(1, Math.floor(Number(blob.level) || 1));
  blob.xp = Math.max(0, Number(blob.xp) || 0) + amount;
  if (!Number.isFinite(Number(blob.xpNext)) || Number(blob.xpNext) < 1) {
    blob.xpNext = xpForLevel(blob.level, blob.rebirthCount);
  }
  const hero = ensureHero(blob);
  let guard = 0;
  while (blob.xp >= blob.xpNext && guard++ < 10000 && blob.level < GM_MAX_LEVEL) {
    blob.xp -= blob.xpNext;
    blob.level += 1;
    hero.attack = (Number(hero.attack) || 0) + 3;
    hero.maxHp = (Number(hero.maxHp) || 0) + 25;
    hero.defense = (Number(hero.defense) || 0) + 2;
    blob.xpNext = xpForLevel(blob.level, blob.rebirthCount);
    if (blob.level % 10 === 0 && blob.mastery && typeof blob.mastery === 'object') {
      blob.mastery.points = Math.max(0, Math.floor(Number(blob.mastery.points) || 0)) + 1;
    }
  }
  if (blob.level >= GM_MAX_LEVEL) blob.xp = 0; // cap reached: bank no XP past it
}

const GOLD_GRANT_MIN = 1;
const GOLD_GRANT_MAX = 1000000;
const LEVEL_GRANT_MIN = 1;
const LEVEL_GRANT_MAX = 100;
const XP_GRANT_MIN = 1;
const XP_GRANT_MAX = 1e12;

router.post(
  '/gm/grant',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, kind, amount, set } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });

    if (kind === 'gold') {
      if (!Number.isInteger(amount) || amount < GOLD_GRANT_MIN || amount > GOLD_GRANT_MAX) {
        return res
          .status(400)
          .json({ error: `Amount must be an integer between ${GOLD_GRANT_MIN} and ${GOLD_GRANT_MAX}.` });
      }
      const blob = await loadBlob(target.id);
      const cur = Math.max(0, Number(blob.gold) || 0);
      // Infinite-gold perk holders bypass the cap; everyone else clamps to it.
      blob.gold = blob.infGold === true ? cur + amount : Math.min(await getGoldCap(), cur + amount);
      await persistMergedState(target.id, blob);
      await logAudit(req, 'grant', target.username, `gold x${amount}`);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    if (kind === 'levels') {
      if (!Number.isInteger(amount) || amount < LEVEL_GRANT_MIN || amount > LEVEL_GRANT_MAX) {
        return res
          .status(400)
          .json({ error: `Amount must be an integer between ${LEVEL_GRANT_MIN} and ${LEVEL_GRANT_MAX}.` });
      }
      const blob = await loadBlob(target.id);
      applyLevelGrant(blob, amount);
      await persistMergedState(target.id, blob);
      await logAudit(req, 'grant', target.username, `levels x${amount}`);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    if (kind === 'xp') {
      if (!Number.isInteger(amount) || amount < XP_GRANT_MIN || amount > XP_GRANT_MAX) {
        return res
          .status(400)
          .json({ error: `Amount must be an integer between ${XP_GRANT_MIN} and ${XP_GRANT_MAX}.` });
      }
      const blob = await loadBlob(target.id);
      applyXpGrant(blob, amount);
      blob.xp = Math.min(1e15, blob.xp);
      await persistMergedState(target.id, blob);
      await logAudit(req, 'grant', target.username, `xp x${amount}`);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    if (kind === 'stars') {
      if (!Number.isInteger(amount) || amount < STAR_GRANT_MIN || amount > STAR_GRANT_MAX) {
        return res
          .status(400)
          .json({ error: `Amount must be an integer between ${STAR_GRANT_MIN} and ${STAR_GRANT_MAX}.` });
      }
      const blob = await loadBlob(target.id);
      blob.stars = Math.min(1e15, Math.max(0, Number(blob.stars) || 0) + amount);
      await persistMergedState(target.id, blob);
      await logAudit(req, 'grant', target.username, `stars x${amount}`);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    if (kind === 'gear') {
      if (typeof set !== 'string' || !isValidSetId(set)) {
        return res.status(400).json({ error: 'Set must be one of sovereign, fateweaver, warden, voidwalker, dragonscale, gamemaster.' });
      }
      if (set === 'sovereign' && req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Only the owner may grant the sovereign set.' });
      }
      const items = makeGearItems(set);
      const blob = await loadBlob(target.id);
      if (!Array.isArray(blob.inventory)) blob.inventory = [];
      blob.inventory.push(...items);
      await persistMergedState(target.id, blob);
      await logAudit(req, 'grant', target.username, `gear set ${set}`);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    if (kind === 'ore') {
      const { ore } = req.body || {};
      if (typeof ore !== 'string' || !ORE_IDS.includes(ore)) {
        return res.status(400).json({ error: `Ore must be one of: ${ORE_IDS.join(', ')}.` });
      }
      if (!Number.isInteger(amount) || amount < ORE_GRANT_MIN || amount > ORE_GRANT_MAX) {
        return res
          .status(400)
          .json({ error: `Amount must be an integer between ${ORE_GRANT_MIN} and ${ORE_GRANT_MAX}.` });
      }
      const blob = await loadBlob(target.id);
      if (!blob.mine || typeof blob.mine !== 'object') blob.mine = { depth: 1, ores: {} };
      if (!blob.mine.ores || typeof blob.mine.ores !== 'object') blob.mine.ores = {};
      blob.mine.ores[ore] = Math.min(1e12, Math.max(0, Math.floor(Number(blob.mine.ores[ore]) || 0)) + amount);
      await persistMergedState(target.id, blob);
      await logAudit(req, 'grant', target.username, `ore ${ore} x${amount}`);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    if (kind === 'pickaxe') {
      const { tier } = req.body || {};
      if (!Number.isInteger(tier) || tier < 0 || tier > 7) {
        return res.status(400).json({ error: 'Tier must be an integer between 0 and 7.' });
      }
      const blob = await loadBlob(target.id);
      if (!blob.mine || typeof blob.mine !== 'object') blob.mine = { depth: 1, ores: {} };
      blob.mine.pickaxe = Math.max(0, Math.min(7, tier));
      await persistMergedState(target.id, blob);
      await logAudit(req, 'grant', target.username, `pickaxe tier ${tier}`);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    return res.status(400).json({ error: 'Kind must be one of "gold", "levels", "xp", "stars", "gear", "ore", "pickaxe".' });
  })
);

// ---------- grant title ----------
router.post(
  '/gm/grant-title',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, titleId } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (typeof titleId !== 'string' || !titleId.trim() || titleId.length > 64) {
      return res
        .status(400)
        .json({ error: 'titleId must be a non-empty string of at most 64 characters.' });
    }
    const blob = await loadBlob(target.id);
    if (!Array.isArray(blob.titlesUnlocked)) blob.titlesUnlocked = [];
    const id = titleId.trim();
    if (!blob.titlesUnlocked.includes(id)) blob.titlesUnlocked.push(id);
    await persistMergedState(target.id, blob);
    await logAudit(req, 'grant-title', target.username, id);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- set badge (gm|owner) ----------
// Grants a creator badge (e.g. 'youtuber') shown next to the name on the
// leaderboard. Pass badge: '' to clear it.
const VALID_BADGES = new Set(['youtuber', 'streamer', 'vip', 'admin', 'mod']);
router.post(
  '/gm/badge',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, badge } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const id = typeof badge === 'string' ? badge.trim().toLowerCase() : '';
    if (id !== '' && !VALID_BADGES.has(id)) {
      return res
        .status(400)
        .json({ error: 'Badge must be one of "youtuber", "streamer", "vip", "admin", "mod" or empty to clear.' });
    }
    const blob = await loadBlob(target.id);
    blob.badge = id === '' ? null : id;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'badge', target.username, id === '' ? 'cleared' : id);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- grant pet eggs (gm|owner) ----------
// Adds unhatched pet eggs to a player's save. Mirrors the client shape in
// public/js/engine.js defaultPets(): { collection, activeUid, eggs, shopEggs }.
const PET_GRANT_MIN = 1;
const PET_GRANT_MAX = 99;
function ensurePets(blob) {
  if (!blob.pets || typeof blob.pets !== 'object' || Array.isArray(blob.pets)) {
    blob.pets = { collection: [], activeUid: null, eggs: 0 };
  }
  const p = blob.pets;
  if (!Array.isArray(p.collection)) p.collection = [];
  if (typeof p.eggs !== 'number' || !Number.isFinite(p.eggs)) p.eggs = 0;
  return p;
}
router.post(
  '/gm/grant-pet',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, amount } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(amount) || amount < PET_GRANT_MIN || amount > PET_GRANT_MAX) {
      return res
        .status(400)
        .json({ error: `Amount must be an integer between ${PET_GRANT_MIN} and ${PET_GRANT_MAX}.` });
    }
    const blob = await loadBlob(target.id);
    const pets = ensurePets(blob);
    pets.eggs = Math.min(9999, Math.max(0, Math.floor(pets.eggs)) + amount);
    await persistMergedState(target.id, blob);
    await logAudit(req, 'grant-pet', target.username, `eggs x${amount}`);
    res.json({ ok: true, eggs: pets.eggs, state: selfState(req, target, blob) });
  })
);

// ---------- set rebirth count (gm|owner) ----------
const REBIRTH_SET_MIN = 0;
const REBIRTH_SET_MAX = 999;
router.post(
  '/gm/set-rebirth',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, count } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(count) || count < REBIRTH_SET_MIN || count > REBIRTH_SET_MAX) {
      return res
        .status(400)
        .json({ error: `Count must be an integer between ${REBIRTH_SET_MIN} and ${REBIRTH_SET_MAX}.` });
    }
    const blob = await loadBlob(target.id);
    blob.rebirthCount = count;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'set-rebirth', target.username, `count → ${count}`);
    res.json({ ok: true, rebirthCount: count, state: selfState(req, target, blob) });
  })
);

// ---------- infinite gold (owner only) ----------
// Toggles the infGold perk on a player's save: purchases never deduct gold
// and the HUD shows ∞. Survives rebirth. Pass enabled: false to revoke.
router.post(
  '/gm/inf-gold',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { username, enabled } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const blob = await loadBlob(target.id);
    blob.infGold = enabled === true;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'inf-gold', target.username, enabled === true ? 'enabled' : 'revoked');
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- server settings (owner only) ----------
// Owner-tunable tunables. Currently: goldCap (max player gold, default 999Dc).
// The client fetches the live value from GET /api/settings at boot.
router.post(
  '/gm/settings',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { goldCap } = req.body || {};
    if (goldCap !== undefined) {
      if (!Number.isFinite(goldCap) || goldCap < 1e12) {
        return res.status(400).json({ error: 'goldCap must be a number ≥ 1e12 (1T).' });
      }
      await setSetting('gold_cap', String(Math.floor(goldCap)));
    }
    await refreshGoldCap();
    const __newCap = await getGoldCap();
    await logAudit(req, 'settings', '—', `goldCap → ${__newCap}`);
    res.json({ ok: true, goldCap: __newCap });
  })
);

// ---------- maintenance mode (owner only) ----------
// Runtime override for GET /api/status. When a maintenance_mode setting is
// present ('1'/'0') it wins over the MAINTENANCE_MODE env var; deleting the
// override is done by turning maintenance off (writes '0').
router.post(
  '/gm/maintenance',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { enabled, message } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean.' });
    }
    const msg = typeof message === 'string' ? message.trim().slice(0, 500) : '';
    await setSetting('maintenance_mode', enabled ? '1' : '0');
    await setSetting('maintenance_message', msg);
    await logAudit(req, 'maintenance', '—', enabled ? `ON: ${msg || 'no message'}` : 'OFF');
    res.json({ ok: true, maintenance: enabled, message: msg || null });
  })
);

// ---------- set stage ----------
router.post(
  '/gm/set-stage',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, stage } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(stage) || stage < 1 || stage > 10000) {
      return res.status(400).json({ error: 'stage must be an integer between 1 and 10000.' });
    }
    const blob = await loadBlob(target.id);
    blob.stage = stage;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'set-stage', target.username, `stage → ${stage}`);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- set level (absolute) ----------
// Sets the target's level directly. Hero base stats are recomputed
// deterministically from the per-level formula (level 1 base 10 atk / 100 HP /
// 2 def, +3/+25/+2 per level) because level gains are the only thing that ever
// writes to hero.attack/maxHp/defense. Mastery points are left untouched.
router.post(
  '/gm/set-level',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, level } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(level) || level < 1 || level > GM_MAX_LEVEL) {
      return res.status(400).json({ error: `level must be an integer between 1 and ${GM_MAX_LEVEL}.` });
    }
    const blob = await loadBlob(target.id);
    const hero = ensureHero(blob);
    hero.attack = 10 + 3 * (level - 1);
    hero.maxHp = 100 + 25 * (level - 1);
    hero.defense = 2 + 2 * (level - 1);
    blob.level = level;
    blob.xp = 0;
    blob.rebirthCount = Math.max(0, Math.floor(Number(blob.rebirthCount) || 0));
    blob.xpNext = xpForLevel(level, blob.rebirthCount);
    hero.hp = hero.maxHp;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'set-level', target.username, `level → ${level}`);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- set gold (absolute) ----------
// Sets the target's gold to an exact amount (0 clears it). Respects the
// dynamic gold cap unless the target has the infinite-gold perk.
router.post(
  '/gm/set-gold',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, amount } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(amount) || amount < 0) {
      return res.status(400).json({ error: 'amount must be a non-negative integer.' });
    }
    const blob = await loadBlob(target.id);
    const cap = blob.infGold === true ? amount : await getGoldCap();
    if (amount > cap) {
      return res.status(400).json({ error: `amount exceeds the gold cap (${cap}).` });
    }
    blob.gold = amount;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'set-gold', target.username, `gold → ${amount}`);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- set xp ----------
// Sets the player's EXACT xp then processes level-ups with the normal curve.
router.post(
  '/gm/set-xp',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, amount } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(amount) || amount < 0 || amount > 1e15) {
      return res.status(400).json({ error: 'amount must be an integer between 0 and 1000000000000000.' });
    }
    const blob = await loadBlob(target.id);
    blob.xp = 0;
    blob.level = Math.max(1, Math.floor(Number(blob.level) || 1));
    applyXpGrant(blob, amount);
    blob.xp = Math.min(1e15, blob.xp);
    await persistMergedState(target.id, blob);
    await logAudit(req, 'set-xp', target.username, `xp → ${amount}`);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- grant single item ----------
// Grants one gear piece (by slot) from a set instead of the full 5-piece set.
const GRANT_ITEM_SLOTS = ['weapon', 'armor', 'helmet', 'boots', 'trinket'];
router.post(
  '/gm/grant-item',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, set, slot } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (typeof set !== 'string' || !isValidSetId(set)) {
      return res.status(400).json({ error: 'Set must be one of sovereign, fateweaver, warden, voidwalker, dragonscale, gamemaster.' });
    }
    if (set === 'sovereign' && req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only the owner may grant the sovereign set.' });
    }
    if (typeof slot !== 'string' || !GRANT_ITEM_SLOTS.includes(slot)) {
      return res.status(400).json({ error: 'Slot must be one of weapon, armor, helmet, boots, trinket.' });
    }
    const piece = makeGearItems(set).find((p) => p.slot === slot);
    if (!piece) return res.status(400).json({ error: 'That set has no piece for the requested slot.' });
    const blob = await loadBlob(target.id);
    if (!Array.isArray(blob.inventory)) blob.inventory = [];
    blob.inventory.push(piece);
    await persistMergedState(target.id, blob);
    await logAudit(req, 'grant-item', target.username, `${piece.name} [${slot}]`);
    res.json({ ok: true, item: piece.name, state: selfState(req, target, blob) });
  })
);

// ---------- mute / unmute ----------
// Timed guild-chat mute. minutes=0 (or omitted) clears the mute.
router.post(
  '/gm/mute',
  ownerAdminGm,
  asyncHandler(async (req, res) => {
    const { username, minutes } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const mins = minutes === undefined || minutes === null ? 0 : minutes;
    if (!Number.isInteger(mins) || mins < 0 || mins > 10080) {
      return res.status(400).json({ error: 'minutes must be an integer between 0 and 10080 (7 days).' });
    }
    const blob = await loadBlob(target.id);
    blob.chatMutedUntil = mins === 0 ? 0 : Date.now() + mins * 60000;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'mute', target.username, mins === 0 ? 'unmuted' : `${mins} min`);
    res.json({ ok: true, mutedUntil: blob.chatMutedUntil, state: selfState(req, target, blob) });
  })
);

// ---------- name style ----------
// Sets a player's name color / effect directly.
const NAME_FX_IDS = ['none', 'fire', 'neon', 'rainbow', 'shine', 'galaxy', 'ice', 'lightning', 'shadow', 'glitch', 'falling-leaves', 'harvest-ember', 'autumn-mist', 'snowfall', 'aurora', 'frostbite', 'tidal', 'sunscorched', 'wildfire', 'fireworks', 'champagne', 'midnight'];
router.post(
  '/gm/name-style',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, color, fx } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (color !== undefined && color !== '' && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({ error: 'color must be a hex like #ff8800, or empty to clear.' });
    }
    if (fx !== undefined && !NAME_FX_IDS.includes(fx)) {
      return res.status(400).json({ error: 'fx must be one of ' + NAME_FX_IDS.join(', ') + '.' });
    }
    const blob = await loadBlob(target.id);
    if (color !== undefined) blob.nameColor = color || null;
    if (fx !== undefined) blob.nameFx = fx;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'name-style', target.username, `${color || 'cleared'} / ${fx || 'unchanged'}`);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- inspect (player dossier) ----------
// Read-only full view of a player's account for GMs: identity, currencies,
// hero, inventory + loadout, pets, mine, forge, titles. Never mutates.
router.post(
  '/gm/inspect',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const blob = await loadBlob(target.id);
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const inv = Array.isArray(blob.inventory) ? blob.inventory : [];
    const loadout = blob.loadout && typeof blob.loadout === 'object' ? blob.loadout : {};
    const equipped = {};
    for (const [slot, it] of Object.entries(loadout)) {
      equipped[slot] = it && it.name ? it.name : String(it);
    }
    const pets = blob.pets && typeof blob.pets === 'object' ? blob.pets : {};
    const mine = blob.mine && typeof blob.mine === 'object' ? blob.mine : {};
    const forge = blob.forge && typeof blob.forge === 'object' ? blob.forge : {};
    const titles = Array.isArray(blob.titles) ? blob.titles : (blob.titles && Array.isArray(blob.titles.unlocked) ? blob.titles.unlocked : []);
    res.json({
      ok: true,
      dossier: {
        username: target.username,
        role: target.role,
        level: num(blob.level), xp: num(blob.xp), xpNext: num(blob.xpNext),
        gold: num(blob.gold), stars: num(blob.stars),
        playerClass: blob.playerClass || '—', spec: blob.spec || '—',
        stage: num(blob.stage), kills: num(blob.kills), bossesKilled: num(blob.bossesKilled),
        rebirthCount: num(blob.rebirthCount),
        hero: {
          hp: num(blob.hero && blob.hero.hp), maxHp: num(blob.hero && blob.hero.maxHp),
          attack: num(blob.hero && blob.hero.attack), defense: num(blob.hero && blob.hero.defense),
        },
        nameStyle: { color: blob.nameColor || null, fx: blob.nameFx || 'none' },
        activeTitle: blob.activeTitle || '—',
        titlesUnlocked: titles.length,
        badge: (blob.badge && (blob.badge.emoji || blob.badge.name)) || '—',
        inventoryCount: inv.length,
        inventorySample: inv.slice(-10).map((i) => (i && i.name ? `${i.name} [${i.slot || '?'}]` : '?')),
        equipped,
        pets: { eggs: num(pets.eggs), active: Array.isArray(pets.active) ? pets.active.length : num(pets.activeCount) },
        mine: { depth: num(mine.depth), pickaxe: mine.pickaxeTier || mine.pickaxe || 0, totalMined: num(mine.totalMined) },
        forge: { crafts: num(forge.crafts) },
        muted: !!(blob.chatMutedUntil && blob.chatMutedUntil > Date.now()),
        mutedUntil: blob.chatMutedUntil || 0,
        banned: !!target.banned,
      },
    });
  })
);

// ---------- heal ----------
// Note: the death streak is client-side only (public/js/app.js `App.deathStreak`),
// not persisted in the state blob, so there is nothing server-side to reset.
router.post(
  '/gm/heal',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const blob = await loadBlob(target.id);
    if (blob.hero && typeof blob.hero === 'object') {
      const maxHp = Math.max(1, Number(blob.hero.maxHp) || 100);
      blob.hero.maxHp = maxHp;
      blob.hero.hp = maxHp;
    }
    if (Array.isArray(blob.party)) {
      for (const c of blob.party) {
        if (c && typeof c === 'object') {
          const m = Math.max(1, Number(c.maxHp) || 1);
          c.maxHp = m;
          c.hp = m;
        }
      }
    }
    await persistMergedState(target.id, blob);
    await logAudit(req, 'heal', target.username, '');
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- reset progress ----------
// Writes a fresh default blob (same shape as a new registration via
// defaultStateBlob()). Identity (username, role) lives in the users table
// and is untouched; no role changes happen here.
router.post(
  '/gm/reset',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const fresh = defaultStateBlob();
    await persistMergedState(target.id, fresh);
    await logAudit(req, 'reset-progress', target.username, 'save wiped to fresh');
    res.json({ ok: true, state: selfState(req, target, fresh) });
  })
);

// ---------- player management (admin+) ----------
// Unlock a title id for a player (mirrors /gm/grant-title; separate route
// with the admin tier so moderators never touch it).
router.post(
  '/gm/title',
  adminPlus,
  asyncHandler(async (req, res) => {
    const { username, title } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (typeof title !== 'string' || !title.trim() || title.length > 64) {
      return res
        .status(400)
        .json({ error: 'title must be a non-empty string of at most 64 characters.' });
    }
    const blob = await loadBlob(target.id);
    if (!Array.isArray(blob.titlesUnlocked)) blob.titlesUnlocked = [];
    const id = title.trim();
    if (!blob.titlesUnlocked.includes(id)) blob.titlesUnlocked.push(id);
    await persistMergedState(target.id, blob);
    await logAudit(req, 'grant-title', target.username, id);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// Set a player's stage (mirrors /gm/set-stage on the admin tier).
router.post(
  '/gm/stage',
  adminPlus,
  asyncHandler(async (req, res) => {
    const { username, stage } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(stage) || stage < 1 || stage > 10000) {
      return res.status(400).json({ error: 'stage must be an integer between 1 and 10000.' });
    }
    const blob = await loadBlob(target.id);
    blob.stage = stage;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'set-stage', target.username, `stage → ${stage}`);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- ban / unban (gm+) ----------
// STUB: the users table has no `banned` column and src/schema.sql is owned
// by another agent, so enforcement at login is not possible yet. These
// return 501 until the schema lands; the console UI marks them as pending.
router.post(
  '/gm/ban',
  ownerAdminGm,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (target.role === 'owner') return res.status(403).json({ error: 'The owner cannot be banned.' });
    await pool.query('UPDATE users SET banned = TRUE WHERE id = $1', [target.id]);
    await logAudit(req, 'ban', target.username, 'account banned');
    res.json({ ok: true, username: target.username, banned: true });
  })
);

router.post(
  '/gm/unban',
  ownerAdminGm,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    await pool.query('UPDATE users SET banned = FALSE WHERE id = $1', [target.id]);
    await logAudit(req, 'unban', target.username, 'account unbanned');
    res.json({ ok: true, username: target.username, banned: false });
  })
);

// ---------- kick (admin+) ----------
// Force-logout a player right now by bumping their session_version; their
// next authenticated request fails the version check in requireAuth and the
// session is destroyed. Unlike a ban, they can sign straight back in.
router.post(
  '/gm/kick',
  ownerAdminGm,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'The owner cannot be kicked.' });
    }
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot kick yourself.' });
    }
    await bumpSessionVersion(target.id);
    await logAudit(req, 'kick', target.username, 'force-logged out');
    res.json({ ok: true, username: target.username, kicked: true });
  })
);

// ---------- reset player save (admin+) ----------
router.post(
  '/gm/reset-player',
  adminPlus,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const fresh = defaultStateBlob();
    await persistMergedState(target.id, fresh);
    await logAudit(req, 'reset-player', target.username, 'save wiped to fresh');
    res.json({ ok: true, state: selfState(req, target, fresh) });
  })
);

// ---------- delete account (owner only) ----------
// Permanently deletes a player account and its data: the users row
// (player_state, party rows/memberships cascade), guild membership, guild
// invites, friendships, and code redemptions. Gift codes the target created
// are kept but detached (created_by → NULL). Blocked when the target owns a
// guild — transfer or disband it first — and never on self or the owner role.
router.post(
  '/gm/delete-account',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'The owner account cannot be deleted.' });
    }
    const owned = await pool.query(
      'SELECT name FROM guilds WHERE LOWER(owner_username) = LOWER($1) LIMIT 1',
      [target.username]
    );
    if (owned.rows.length) {
      return res.status(400).json({
        error: `Target owns guild "${owned.rows[0].name}" — transfer or disband it first.`,
      });
    }
    const uname = target.username;
    await pool.query('DELETE FROM guild_members WHERE LOWER(username) = LOWER($1)', [uname]);
    await pool.query(
      'DELETE FROM guild_invites WHERE LOWER(username) = LOWER($1) OR LOWER(invited_by) = LOWER($1)',
      [uname]
    );
    await pool.query(
      'DELETE FROM friendships WHERE LOWER(requester) = LOWER($1) OR LOWER(addressee) = LOWER($1)',
      [uname]
    );
    await pool.query('DELETE FROM code_redemptions WHERE user_id = $1', [target.id]);
    await pool.query('UPDATE gift_codes SET created_by = NULL WHERE created_by = $1', [target.id]);
    // parties led by the target disband via ON DELETE CASCADE; their
    // party_members rows cascade as well. Their sessions die with the row.
    await pool.query('DELETE FROM users WHERE id = $1', [target.id]);
    await logAudit(req, 'delete-account', uname, 'account permanently deleted');
    res.json({ ok: true, username: uname });
  })
);

// ---------- broadcast (moderators+) ----------
// Server-wide announcement persisted in the broadcasts table (see
// src/broadcast.js). Clients poll GET /api/broadcasts/latest.
router.post(
  '/gm/broadcast',
  requireMod,
  broadcastLimiter,
  asyncHandler(async (req, res) => {
    const { message } = req.body || {};
    if (typeof message !== 'string' || !message.trim() || message.trim().length > 500) {
      return res.status(400).json({ error: 'message must be 1–500 characters.' });
    }
    const row = await addBroadcast(message.trim(), req.user.username);
    await logAudit(req, 'broadcast', '—', message.trim().slice(0, 120));
    res.status(201).json({ ok: true, broadcast: row });
  })
);

// ---------- latest broadcast (public, no auth) ----------
router.get(
  '/broadcasts/latest',
  asyncHandler(async (req, res) => {
    res.json({ broadcast: await latestBroadcast() });
  })
);

// ---------- player list (moderators+) ----------
router.get(
  '/gm/players',
  requireMod,
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 20) : '';
    const limit = Math.max(1, Math.min(200, Math.floor(Number(req.query.limit)) || 50));
    const { rows } = await pool.query(
      `SELECT u.username, u.role,
              COALESCE(ps.level, 1) AS level, COALESCE(ps.stage, 1) AS stage,
              ps.state_json AS state_json
       FROM users u LEFT JOIN player_state ps ON ps.user_id = u.id
       WHERE ($1 = '' OR LOWER(u.username) LIKE '%' || LOWER($1) || '%')
       ORDER BY u.created_at ASC
       LIMIT $2`,
      [search, limit]
    );
    // Extract the player's class and spec from their save blob
    // (mirrors Engine.CLASSES / Engine.SPECS).
    const VALID_SPECS = ['tank', 'dps', 'healer', 'classic'];
    const players = rows.map((r) => {
      let playerClass = null;
      let spec = null;
      try {
        const raw = r.state_json;
        const blob = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (blob && typeof blob.playerClass === 'string' &&
            ['hunter', 'warrior', 'mage', 'assassin'].includes(blob.playerClass)) {
          playerClass = blob.playerClass;
        }
        if (blob && typeof blob.spec === 'string' && VALID_SPECS.includes(blob.spec)) {
          spec = blob.spec;
        }
      } catch { /* leave null */ }
      const { state_json, ...rest } = r;
      return { ...rest, playerClass, spec };
    });
    res.json({ players });
  })
);

// ---------- gift codes ----------
router.get(
  '/gm/codes',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const codes = await listGiftCodes();
    // pg returns BIGINT as string; the contract shape uses epoch-ms numbers.
    res.json({ codes: codes.map((c) => ({ ...c, created_at: Number(c.created_at) })) });
  })
);
router.post(
  '/gm/codes',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { rewardKind = 'gear', set, amount, maxUses } = req.body || {};
    if (!['gear', 'gold', 'stars'].includes(rewardKind)) {
      return res.status(400).json({ error: 'rewardKind must be one of "gear", "gold", "stars".' });
    }
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000000) {
      return res.status(400).json({ error: 'maxUses must be an integer between 1 and 1000000.' });
    }
    let gearSet = 'none';
    let rewardAmount = 0;
    if (rewardKind === 'gear') {
      if (typeof set !== 'string' || !isValidSetId(set)) {
        return res.status(400).json({ error: 'Set must be one of sovereign, fateweaver, warden, voidwalker, dragonscale, gamemaster.' });
      }
      gearSet = set;
    } else if (rewardKind === 'gold') {
      if (!Number.isInteger(amount) || amount < 1 || amount > 1e12) {
        return res.status(400).json({ error: 'Gold amount must be an integer between 1 and 1000000000000.' });
      }
      rewardAmount = amount;
    } else {
      if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
        return res.status(400).json({ error: 'Star amount must be an integer between 1 and 100000.' });
      }
      rewardAmount = amount;
    }
    const code = await generateCode();
    await createGiftCode(code, gearSet, maxUses, req.user.id, rewardKind, rewardAmount);
    await logAudit(req, 'gift-code', '—', `${code}: ${rewardKind}${rewardKind === 'gear' ? ' ' + gearSet : ' x' + rewardAmount} (${maxUses} uses)`);
    res.status(201).json({ code, rewardKind, rewardAmount, set: gearSet });
  })
);

// ---------- admin roster ----------
router.get(
  '/gm/roster',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    res.json({
      admins: await getUsernamesByRole('admin'),
      gms: await getUsernamesByRole('gm'),
    });
  })
);

router.post(
  '/gm/roster',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, action } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });

    if (action === 'add-admin') {
      if (target.role !== 'player') {
        return res.status(400).json({ error: 'Only players can be added to the admin roster.' });
      }
      await setUserRole(target.id, 'admin');
      return res.json({ ok: true });
    }
    if (action === 'remove-admin') {
      if (target.role !== 'admin') {
        return res.status(400).json({ error: 'Target user is not an admin.' });
      }
      await setUserRole(target.id, 'player');
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'Action must be "add-admin" or "remove-admin".' });
  })
);

// ---------- role management (owner only) ----------
router.post(
  '/roles',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { username, role } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!VALID_ROLES_FOR_ROLES_ROUTE.includes(role)) {
      return res.status(400).json({ error: 'Role must be one of gm, admin, moderator, player.' });
    }
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'Owner accounts cannot be changed.' });
    }
    if (target.id === req.user.id) {
      return res.status(403).json({ error: 'You cannot change your own role.' });
    }
    await setUserRole(target.id, role);
    res.json({ ok: true });
  })
);

// ---------- GM audit log ----------
// Server-side record of staff actions (who did what, to whom, when).
// Stored in server_settings as JSON so it survives restarts; capped at 300.
const AUDIT_MAX = 300;
async function readAudit() {
  try {
    const raw = await getSetting('gm_audit');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
async function logAudit(req, action, targetUsername, detail) {
  try {
    const entries = await readAudit();
    entries.unshift({
      ts: Date.now(),
      actor: (req.user && req.user.username) || '?',
      actorRole: (req.user && req.user.role) || '?',
      action,
      target: targetUsername || '—',
      detail: detail === undefined || detail === null ? '' : String(detail).slice(0, 300),
    });
    await setSetting('gm_audit', JSON.stringify(entries.slice(0, AUDIT_MAX)));
  } catch (e) { /* audit must never break the action itself */ }
}

// ---------- inventory browser + item removal ----------
// Full inventory listing for a player (the dossier only shows a sample).
router.post(
  '/gm/inventory',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const blob = await loadBlob(target.id);
    const inv = Array.isArray(blob.inventory) ? blob.inventory : [];
    const items = inv.map((it, i) => ({
      index: i,
      id: it && it.id ? String(it.id) : null,
      name: it && it.name ? String(it.name) : '?',
      slot: it && it.slot ? String(it.slot) : '?',
      enchant: Math.max(0, Math.min(10, Math.floor(Number(it && it.enchant) || 0))),
    }));
    res.json({ ok: true, username: target.username, count: items.length, items });
  })
);

// Remove one inventory item by index (e.g. duped/exploited gear).
router.post(
  '/gm/remove-item',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, index } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const blob = await loadBlob(target.id);
    const inv = Array.isArray(blob.inventory) ? blob.inventory : [];
    const idx = Math.floor(Number(index));
    if (!Number.isInteger(idx) || idx < 0 || idx >= inv.length) {
      return res.status(400).json({ error: 'index out of range for this player\'s inventory.' });
    }
    const [removed] = inv.splice(idx, 1);
    const removedName = removed && removed.name ? removed.name : '?';
    await persistMergedState(target.id, blob);
    await logAudit(req, 'remove-item', target.username, `${removedName} (index ${idx})`);
    res.json({ ok: true, removed: removedName, state: selfState(req, target, blob) });
  })
);

// ---------- set enchant level ----------
// Sets enchant (0-10) on an inventory item (by index) or an equipped item
// (by slot: weapon/armor/helmet/boots/trinket).
const ENCHANT_SLOTS = ['weapon', 'armor', 'helmet', 'boots', 'trinket'];
router.post(
  '/gm/set-enchant',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, index, slot, level } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const lv = Math.floor(Number(level));
    if (!Number.isInteger(lv) || lv < 0 || lv > 10) {
      return res.status(400).json({ error: 'level must be an integer between 0 and 10.' });
    }
    const blob = await loadBlob(target.id);
    let item = null;
    let where = '';
    if (typeof slot === 'string' && ENCHANT_SLOTS.includes(slot)) {
      if (!blob.loadout || typeof blob.loadout !== 'object' || !blob.loadout[slot]) {
        return res.status(400).json({ error: `No item equipped in the ${slot} slot.` });
      }
      item = blob.loadout[slot];
      where = `equipped ${slot}`;
    } else {
      const inv = Array.isArray(blob.inventory) ? blob.inventory : [];
      const idx = Math.floor(Number(index));
      if (!Number.isInteger(idx) || idx < 0 || idx >= inv.length) {
        return res.status(400).json({ error: 'index out of range for this player\'s inventory.' });
      }
      item = inv[idx];
      where = `inventory index ${idx}`;
    }
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ error: 'No item found at that location.' });
    }
    item.enchant = lv;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'set-enchant', target.username, `${item.name || '?'} (${where}) → +${lv}`);
    res.json({ ok: true, item: item.name || '?', enchant: lv, state: selfState(req, target, blob) });
  })
);

// ---------- reset quests ----------
// Forces a player's daily/weekly quests to re-roll (unsticks broken sets).
router.post(
  '/gm/reset-quests',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, period } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const p = period === undefined || period === null ? 'both' : String(period);
    if (!['daily', 'weekly', 'both'].includes(p)) {
      return res.status(400).json({ error: 'period must be one of daily, weekly, both.' });
    }
    const blob = await loadBlob(target.id);
    if (!blob.quests || typeof blob.quests !== 'object') blob.quests = {};
    // Clearing the roll keys makes the client's ensureQuests() re-roll fresh
    // sets on next tick; claimed flags live on the rolled entries, so they
    // reset too.
    if (p === 'daily' || p === 'both') { blob.quests.dailyKey = ''; blob.quests.daily = []; }
    if (p === 'weekly' || p === 'both') { blob.quests.weeklyKey = ''; blob.quests.weekly = []; }
    await persistMergedState(target.id, blob);
    await logAudit(req, 'reset-quests', target.username, p);
    res.json({ ok: true, period: p, state: selfState(req, target, blob) });
  })
);

// ---------- server event buffs ----------
// Server-wide XP/gold multiplier with an expiry (e.g. double-XP weekend).
// The client picks it up from GET /api/settings at boot and applies it to
// kill rewards + offline earnings. Owner + GM tier; every change is audited.
router.post(
  '/gm/event-buff',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { xpMult, goldMult, hours, label } = req.body || {};
    const xm = Number(xpMult);
    const gm = Number(goldMult);
    const hrs = Number(hours);
    if (!(xm >= 1 && xm <= 10) || !(gm >= 1 && gm <= 10)) {
      return res.status(400).json({ error: 'xpMult and goldMult must each be between 1 and 10.' });
    }
    if (!(hrs >= 0 && hrs <= 168)) {
      return res.status(400).json({ error: 'hours must be between 0 (clear) and 168 (7 days).' });
    }
    if (hrs === 0) {
      await setSetting('event_buff', '');
      await logAudit(req, 'event-buff', '—', 'cleared');
      return res.json({ ok: true, cleared: true });
    }
    const buff = {
      xpMult: xm,
      goldMult: gm,
      endsAt: Date.now() + Math.floor(hrs * 3600 * 1000),
      label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 60) : 'Event',
      setBy: (req.user && req.user.username) || '?',
    };
    await setSetting('event_buff', JSON.stringify(buff));
    await logAudit(req, 'event-buff', '—', `${buff.label}: ${xm}x XP / ${gm}x gold for ${hrs}h`);
    res.json({ ok: true, buff });
  })
);

router.get(
  '/gm/audit',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const entries = await readAudit();
    res.json({ ok: true, entries: entries.slice(0, 100) });
  })
);

module.exports = { gmRouter: router };
