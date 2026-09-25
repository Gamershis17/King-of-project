'use strict';

/**
 * GM + role-management API:
 *   GET  /api/gm/overview     (gm|owner)
 *   POST /api/gm/grant        (gm|owner)
 *   POST /api/gm/grant-title  (gm|owner)
 *   POST /api/gm/set-stage    (gm|owner)
 *   POST /api/gm/heal         (gm|owner)
 *   POST /api/gm/reset        (gm|owner)
 *   GET  /api/gm/codes        (gm|owner)
 *   POST /api/gm/codes        (gm|owner)
 *   GET  /api/gm/roster       (gm|owner)
 *   POST /api/gm/roster       (gm|owner)
 *   POST /api/roles           (owner only)
 *
 * All database access is async (PostgreSQL).
 */

const crypto = require('crypto');
const express = require('express');
const { requireRole, asyncHandler } = require('./auth');
const { sanitizeStateBlob } = require('./validation');
const { makeGearItems, isValidSetId } = require('./gearSets');
const { loadBlob, defaultStateBlob } = require('./gameApi');
const {
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

const VALID_ROLES_FOR_ROLES_ROUTE = ['gm', 'admin', 'player'];
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
        return res.status(400).json({ error: 'Set must be one of sovereign, fateweaver, warden.' });
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
      return res.status(400).json({ error: 'Set must be one of sovereign, fateweaver, warden.' });
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
      return res.status(400).json({ error: 'Role must be one of gm, admin, player.' });
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
