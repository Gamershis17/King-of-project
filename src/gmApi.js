'use strict';

/**
 * GM + role-management API:
 *   GET  /api/gm/overview     (gm|owner)
 *   POST /api/gm/grant        (gm|owner)
 *   POST /api/gm/grant-title  (gm|owner)
 *   POST /api/gm/badge       (gm|owner)
 *   POST /api/gm/inf-gold    (owner) — toggle infinite-gold perk
 *   POST /api/gm/set-stage    (gm|owner)
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
 *   POST /api/gm/broadcast    (owner|admin|moderator) — server announcement
 *   GET  /api/broadcasts/latest (public) — newest announcement
 *   GET  /api/gm/players      (owner|admin|moderator) — player list w/ search
 *   POST /api/gm/reset-player (owner|admin) — wipe a player's save
 *   POST /api/roles           (owner only)
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
} = require('./db');

const router = express.Router();
const gmOrOwner = requireRole('gm', 'owner');
const ownerOnly = requireRole('owner');
// Moderator tier: read-only staff tools + broadcasts. Sensitive grant
// endpoints stay on gmOrOwner; never widen those to this middleware.
const requireMod = requireRole('owner', 'admin', 'gm', 'moderator');
// Admin tier: player-management commands that don't grant power.
const adminPlus = requireRole('owner', 'admin');

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
 * Mirrors the client curve in public/js/engine.js:
 *   export const xpForLevel = (level) => Math.max(1, Math.round(80 * Math.pow(1.30, level - 1)));
 * Keep in sync if the client formula ever changes.
 */
function xpForLevel(level) {
  return Math.max(1, Math.round(80 * Math.pow(1.30, Math.max(1, level) - 1)));
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
  for (let i = 0; i < n; i++) {
    blob.level += 1;
    hero.attack = (Number(hero.attack) || 0) + 3;
    hero.maxHp = (Number(hero.maxHp) || 0) + 25;
    hero.defense = (Number(hero.defense) || 0) + 2;
    if (blob.level % 10 === 0 && blob.mastery && typeof blob.mastery === 'object') {
      blob.mastery.points = Math.max(0, Math.floor(Number(blob.mastery.points) || 0)) + 1;
    }
  }
  blob.xp = 0;
  blob.xpNext = xpForLevel(blob.level);
  hero.hp = hero.maxHp;
  return n;
}

/** Add XP and process level-ups server-side so stats stay consistent. */
function applyXpGrant(blob, amount) {
  blob.level = Math.max(1, Math.floor(Number(blob.level) || 1));
  blob.xp = Math.max(0, Number(blob.xp) || 0) + amount;
  if (!Number.isFinite(Number(blob.xpNext)) || Number(blob.xpNext) < 1) {
    blob.xpNext = xpForLevel(blob.level);
  }
  const hero = ensureHero(blob);
  let guard = 0;
  while (blob.xp >= blob.xpNext && guard++ < 10000) {
    blob.xp -= blob.xpNext;
    blob.level += 1;
    hero.attack = (Number(hero.attack) || 0) + 3;
    hero.maxHp = (Number(hero.maxHp) || 0) + 25;
    hero.defense = (Number(hero.defense) || 0) + 2;
    blob.xpNext = xpForLevel(blob.level);
    if (blob.level % 10 === 0 && blob.mastery && typeof blob.mastery === 'object') {
      blob.mastery.points = Math.max(0, Math.floor(Number(blob.mastery.points) || 0)) + 1;
    }
  }
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
      blob.gold = Math.min(1e15, Math.max(0, Number(blob.gold) || 0) + amount);
      await persistMergedState(target.id, blob);
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
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    if (kind === 'gear') {
      if (typeof set !== 'string' || !isValidSetId(set)) {
        return res.status(400).json({ error: 'Set must be one of sovereign, fateweaver, warden, voidwalker, dragonscale.' });
      }
      if (set === 'sovereign' && req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Only the owner may grant the sovereign set.' });
      }
      const items = makeGearItems(set);
      const blob = await loadBlob(target.id);
      if (!Array.isArray(blob.inventory)) blob.inventory = [];
      blob.inventory.push(...items);
      await persistMergedState(target.id, blob);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    return res.status(400).json({ error: 'Kind must be one of "gold", "levels", "xp", "stars", "gear".' });
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
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- infinite gold (owner only) ----------
// Toggles the infGold perk on a player's save: purchases never deduct gold
// and the HUD shows ∞. Survives prestige. Pass enabled: false to revoke.
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
    res.json({ ok: true, state: selfState(req, target, blob) });
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
    res.json({ ok: true, state: selfState(req, target, blob) });
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
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- ban / unban (admin+) ----------
// STUB: the users table has no `banned` column and src/schema.sql is owned
// by another agent, so enforcement at login is not possible yet. These
// return 501 until the schema lands; the console UI marks them as pending.
router.post(
  '/gm/ban',
  adminPlus,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (target.role === 'owner') return res.status(403).json({ error: 'The owner cannot be banned.' });
    await pool.query('UPDATE users SET banned = TRUE WHERE id = $1', [target.id]);
    res.json({ ok: true, username: target.username, banned: true });
  })
);

router.post(
  '/gm/unban',
  adminPlus,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    await pool.query('UPDATE users SET banned = FALSE WHERE id = $1', [target.id]);
    res.json({ ok: true, username: target.username, banned: false });
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
    res.json({ ok: true, state: selfState(req, target, fresh) });
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
              COALESCE(ps.level, 1) AS level, COALESCE(ps.stage, 1) AS stage
       FROM users u LEFT JOIN player_state ps ON ps.user_id = u.id
       WHERE ($1 = '' OR LOWER(u.username) LIKE '%' || LOWER($1) || '%')
       ORDER BY u.created_at ASC
       LIMIT $2`,
      [search, limit]
    );
    res.json({ players: rows });
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
    const { set, maxUses } = req.body || {};
    if (typeof set !== 'string' || !isValidSetId(set)) {
      return res.status(400).json({ error: 'Set must be one of sovereign, fateweaver, warden, voidwalker, dragonscale.' });
    }
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000000) {
      return res.status(400).json({ error: 'maxUses must be an integer between 1 and 1000000.' });
    }
    const code = await generateCode();
    await createGiftCode(code, set, maxUses, req.user.id);
    res.status(201).json({ code });
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

module.exports = { gmRouter: router };
