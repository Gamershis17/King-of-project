'use strict';

/**
 * Player-facing game API:
 *   GET  /api/state        (auth)
 *   POST /api/state        (auth)
 *   GET  /api/leaderboard  (public)
 *   GET  /api/status       (public — maintenance flag + message)
 *   GET  /api/changelog    (public — staff-only items stripped for players)
 *   POST /api/redeem       (auth)
 *
 * Gift-code redemption runs inside a single Postgres transaction with
 * SELECT ... FOR UPDATE on the gift_codes row, so concurrent redemptions
 * serialize and cannot double-spend a code's uses.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth, asyncHandler } = require('./auth');
const { sanitizeStateBlob } = require('./validation');
const { makeGearItems, isValidSetId } = require('./gearSets');
const {
  getStateRow,
  getUserById,
  saveState,
  getLeaderboardRows,
  redeemGiftCode,
  createGuild,
  getGuildByName,
  getMyGuild,
  getGuildRoster,
  joinGuild,
  leaveGuild,
} = require('./db');

const router = express.Router();

// Per-user flood protection (keyed on user id so one bad actor can't
// exhaust a shared IP budget, e.g. behind NAT). Applied after requireAuth
// so req.user is populated for the key generator.
const userKey = (req) => (req.user && req.user.id ? `u:${req.user.id}` : req.ip);
// Autosave runs every 15s; 30/min is generous for real play and stops
// tight-loop DB write floods.
const saveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Saving too fast. Slow down a moment.' },
});
// Gift-code guessing protection.
const redeemLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many code attempts. Try again in a minute.' },
});

// ---------- server status ----------
// Public. Lets the client show a proper maintenance screen instead of
// cryptic errors. Toggle with env vars (Render → Environment):
//   MAINTENANCE_MODE=1            → maintenance screen on
//   MAINTENANCE_MESSAGE="..."     → optional custom message
router.get('/status', (req, res) => {
  const maintenance = /^(1|true|yes)$/i.test(String(process.env.MAINTENANCE_MODE || ''));
  const message = process.env.MAINTENANCE_MESSAGE || null;
  res.json({ ok: true, maintenance, message });
});

// ---------- changelog ----------
// Public, but role-aware: entries/items flagged "staff" in changelog.json are
// stripped for regular players so the What's New panel never leaks GM/staff
// additions. Staff (owner/admin/gm/moderator) see the full log.
const CHANGELOG_PATH = path.join(__dirname, '..', 'public', 'changelog.json');
const STAFF_CHANGELOG_ROLES = new Set(['owner', 'admin', 'gm', 'moderator']);
function filterChangelog(log, isStaff) {
  if (!Array.isArray(log)) return [];
  const out = [];
  for (const e of log) {
    if (!e || typeof e !== 'object') continue;
    if (e.staff && !isStaff) continue;
    const changes = (e.changes || [])
      .filter(c => (typeof c === 'string') || (c && typeof c === 'object' && (isStaff || !c.staff)))
      .map(c => (typeof c === 'string' ? c : c.text));
    if (!changes.length) continue;
    out.push({ ...e, changes });
  }
  return out;
}
router.get('/changelog', asyncHandler(async (req, res) => {
  let role = null;
  try {
    const userId = req.session && req.session.userId;
    if (userId) {
      const user = await getUserById(userId);
      role = user && user.role;
    }
  } catch { /* treat as anonymous player */ }
  let log = [];
  try {
    log = JSON.parse(fs.readFileSync(CHANGELOG_PATH, 'utf8'));
  } catch { /* serve empty on read/parse failure */ }
  res.json({ ok: true, log: filterChangelog(log, STAFF_CHANGELOG_ROLES.has(role)) });
}));

/** Fresh default blob per the API contract's state schema. */
function defaultStateBlob() {
  return {
    race: 'human',
    mode: 'clicker',
    level: 1,
    xp: 0,
    xpNext: 100,
    gold: 0,
    stars: 0,
    stage: 1,
    bossesKilled: 0,
    prestigeCount: 0,
    prestigeBonus: 0,
    hero: {
      hp: 100, maxHp: 100, attack: 10, defense: 2,
      critChance: 5, critDamage: 150, parry: 0, dodge: 5,
      lifesteal: 0, attackSpeed: 1.0, regen: 0,
    },
    party: [],
    inventory: [],
    equipped: { weapon: null, armor: null, helmet: null, boots: null, trinket: null },
    upgrades: { weapon: 1, armor: 1, skill: 1 },
    skills: ['power-strike'],
    companions: [],
    codesRedeemed: [],
    stats: { taps: 0, kills: 0, playTimeSec: 0 },
  };
}

function parseBlob(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
  } catch {
    // fall through to default
  }
  return defaultStateBlob();
}

/** Load the player's blob from their saved row, or a fresh default. */
async function loadBlob(userId) {
  const row = await getStateRow(userId);
  return row ? parseBlob(row.state_json) : defaultStateBlob();
}

// ---------- state ----------
router.get(
  '/state',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await getStateRow(req.user.id);
    if (!row) {
      return res.json({ state: defaultStateBlob(), lastSeenAt: null });
    }
    res.json({ state: parseBlob(row.state_json), lastSeenAt: Number(row.updated_at) });
  })
);

router.post(
  '/state',
  requireAuth,
  saveLimiter,
  asyncHandler(async (req, res) => {
    const { state } = req.body || {};
    const result = sanitizeStateBlob(state);
    if (!result.ok) return res.status(400).json({ error: result.error });
    await saveState(req.user.id, result.state);
    res.json({ ok: true });
  })
);

// ---------- leaderboard (public) ----------
router.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const rows = await getLeaderboardRows(100);
    const entries = rows.map((r) => {
      let race = null;
      let title = null;
      let badge = null;
      let country = null;
      try {
        const blob = JSON.parse(r.state_json);
        if (blob && typeof blob.race === 'string') race = blob.race;
        if (blob && typeof blob.activeTitle === 'string') title = blob.activeTitle;
        if (blob && typeof blob.badge === 'string') badge = blob.badge;
        if (blob && typeof blob.country === 'string') country = blob.country;
      } catch {
        // leave race/title/badge/country null
      }
      return {
        username: r.username,
        race,
        title,
        badge,
        country,
        level: r.level,
        stage: r.stage,
        bossesKilled: r.bosses_killed,
        prestige: r.prestige_count,
      };
    });
    res.json({ entries });
  })
);

// ---------- gift codes ----------
router.post(
  '/redeem',
  requireAuth,
  redeemLimiter,
  asyncHandler(async (req, res) => {
    let { code } = req.body || {};
    if (typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'Code is required.' });
    }
    code = code.trim().toUpperCase();

    let gearSet;
    try {
      gearSet = await redeemGiftCode(
        code,
        req.user.id,
        (giftCode, blob) => {
          if (!isValidSetId(giftCode.gear_set)) {
            const err = new Error('Code has an invalid gear set.');
            err.status = 500;
            throw err;
          }
          const items = makeGearItems(giftCode.gear_set);
          if (!Array.isArray(blob.inventory)) blob.inventory = [];
          blob.inventory.push(...items);
          if (!Array.isArray(blob.codesRedeemed)) blob.codesRedeemed = [];
          if (!blob.codesRedeemed.includes(code)) blob.codesRedeemed.push(code);
          return blob;
        },
        () => defaultStateBlob()
      );
    } catch (err) {
      // Preserve the exact status codes from the original implementation:
      // unknown code -> 404, exhausted -> 409, already redeemed -> 409.
      if (err.code === 'REDEEM_NOT_FOUND') {
        return res.status(404).json({ error: 'Code not found.' });
      }
      if (err.code === 'REDEEM_EXHAUSTED') {
        return res.status(409).json({ error: 'Code has been fully redeemed.' });
      }
      if (err.code === 'REDEEM_ALREADY') {
        return res.status(409).json({ error: 'You have already redeemed this code.' });
      }
      throw err;
    }

    res.json({ ok: true, set: gearSet });
  })
);

// ---------- guilds ----------
function cleanGuildName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.length < 3 || n.length > 20) return null;
  if (!/^[A-Za-z0-9 ]+$/.test(n)) return null;
  return n;
}

function cleanGuildTag(tag) {
  if (typeof tag !== 'string') return null;
  const t = tag.trim().toUpperCase();
  if (t.length < 2 || t.length > 4) return null;
  if (!/^[A-Za-z0-9]+$/.test(t)) return null;
  return t;
}

router.post(
  '/guilds',
  requireAuth,
  asyncHandler(async (req, res) => {
    const name = cleanGuildName(req.body && req.body.name);
    const tag = cleanGuildTag(req.body && req.body.tag);
    if (!name) {
      return res.status(400).json({ error: 'Guild name must be 3-20 characters (letters, numbers, spaces).' });
    }
    if (!tag) {
      return res.status(400).json({ error: 'Guild tag must be 2-4 characters (letters, numbers).' });
    }
    try {
      const guild = await createGuild(name, tag, req.user.username);
      res.json({ ok: true, guild });
    } catch (err) {
      if (err.code === 'GUILD_NAME_TAKEN') {
        return res.status(409).json({ error: 'That guild name is taken.' });
      }
      if (err.code === 'GUILD_ALREADY_IN') {
        return res.status(409).json({ error: 'You are already in a guild.' });
      }
      throw err;
    }
  })
);

router.post(
  '/guilds/join',
  requireAuth,
  asyncHandler(async (req, res) => {
    const raw = req.body && typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!raw) return res.status(400).json({ error: 'Guild name is required.' });
    const guild = await getGuildByName(raw);
    if (!guild) return res.status(404).json({ error: 'Guild not found.' });
    try {
      await joinGuild(guild.id, req.user.username);
      res.json({ ok: true, guild });
    } catch (err) {
      if (err.code === 'GUILD_ALREADY_IN') {
        return res.status(409).json({ error: 'You are already in a guild. Leave it first.' });
      }
      throw err;
    }
  })
);

router.post(
  '/guilds/leave',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const result = await leaveGuild(req.user.username);
      res.json({ ok: true, guildDeleted: result.guildDeleted, guildName: result.guildName });
    } catch (err) {
      if (err.code === 'GUILD_NOT_IN') {
        return res.status(404).json({ error: 'You are not in a guild.' });
      }
      throw err;
    }
  })
);

router.get(
  '/guilds/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const mine = await getMyGuild(req.user.username);
    if (!mine) return res.json({ guild: null, members: [] });
    const { my_rank: myRank, ...guild } = mine;
    const members = await getGuildRoster(guild.id);
    res.json({ guild: { ...guild, myRank }, members });
  })
);

router.get(
  '/guilds/roster',
  asyncHandler(async (req, res) => {
    const raw = req.query && typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!raw) return res.status(400).json({ error: 'Guild name is required.' });
    const guild = await getGuildByName(raw);
    if (!guild) return res.status(404).json({ error: 'Guild not found.' });
    const members = await getGuildRoster(guild.id);
    res.json({ guild, members });
  })
);

module.exports = { gameRouter: router, defaultStateBlob, loadBlob };
