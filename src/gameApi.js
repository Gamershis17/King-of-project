'use strict';

/**
 * Player-facing game API:
 *   GET  /api/state        (auth)
 *   POST /api/state        (auth)
 *   GET  /api/leaderboard  (public)
 *   GET  /api/status       (public — maintenance flag + message)
 *   GET  /api/changelog    (public — staff-only items stripped for players)
 *   GET  /api/settings     (public — tunables: goldCap)
 *   POST /api/redeem       (auth)
 *
 * Gift-code redemption runs inside a single Postgres transaction with
 * SELECT ... FOR UPDATE on the gift_codes row, so concurrent redemptions
 * serialize and cannot double-spend a code's uses.
 */

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth, asyncHandler } = require('./auth');
const { sanitizeStateBlob, validateUsername } = require('./validation');
const { makeGearItems, isValidSetId } = require('./gearSets');
const {
  getStateRow,
  getUserById,
  getUserByUsername,
  saveState,
  getLeaderboardRows,
  redeemGiftCode,
  createGuild,
  getGuildByName,
  getMyGuild,
  getGuildRoster,
  joinGuild,
  leaveGuild,
  getGoldCap,
  getSetting,
  sendFriendRequest,
  respondFriendRequest,
  getFriendshipData,
  getFriendProfiles,
  removeFriend,
  friendshipStatus,
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
// Friend-action spam protection.
const friendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many friend actions. Slow down a moment.' },
});

/**
 * Server-side copy of the client game engine (public/js/engine.js is pure
 * logic with no DOM access). Loaded once as an .mjs module so inspect and
 * compare power ratings use the exact same computeStats formula as the client.
 */
let _enginePromise = null;
function serverEngine() {
  if (!_enginePromise) {
    _enginePromise = (async () => {
      const src = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'engine.js'),
        'utf8'
      );
      const tmp = path.join(os.tmpdir(), 'kop-engine-srv.mjs');
      fs.writeFileSync(tmp, src);
      return import(tmp);
    })();
  }
  return _enginePromise;
}

/** Considered "online" for friends/inspect if active within the last 5 minutes. */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

const INSPECT_SLOTS = ['weapon', 'armor', 'helmet', 'boots', 'trinket'];

function num0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function num1(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

/**
 * Build the public inspect payload for a username. Gameplay data only:
 * never emails, password hashes, roles, currencies, or staff flags.
 * Returns null when the player does not exist.
 */
async function buildInspect(targetUsername, viewerUsername) {
  const user = await getUserByUsername(targetUsername);
  if (!user) return null;
  const row = await getStateRow(user.id);
  const blob = row ? parseBlob(row.state_json) : defaultStateBlob();
  // Defensive merge so computeStats never sees a half-shaped blob.
  const def = defaultStateBlob();
  const safe = {
    ...def,
    ...blob,
    hero: { ...def.hero, ...(blob.hero || {}) },
    stats: { ...(blob.stats || {}) },
    raid: { ...(blob.raid || {}) },
    pets: { ...(blob.pets || {}) },
  };

  const eng = await serverEngine();
  let power = 0;
  let stats = null;
  try {
    const cs = eng.computeStats(safe);
    power = num0(cs.attack);
    stats = {
      attack: num0(cs.attack),
      defense: num0(cs.defense),
      maxHp: num0(cs.maxHp),
      critChance: num1(cs.critChance),
      critDamage: num1(cs.critDamage),
      parry: num1(cs.parry),
      dodge: num1(cs.dodge),
      lifesteal: num1(cs.lifesteal),
      attackSpeed: num1(cs.attackSpeed),
      regen: num1(cs.regen),
      goldBonus: num1(cs.goldBonus),
      xpBonus: num1(cs.xpBonus),
    };
  } catch {
    stats = {
      attack: 0, defense: 0, maxHp: 1, critChance: 0, critDamage: 100,
      parry: 0, dodge: 0, lifesteal: 0, attackSpeed: 1, regen: 0,
      goldBonus: 0, xpBonus: 0,
    };
  }

  const raceDef = eng.RACES[blob.race] || {};
  const clsDef = eng.CLASSES[blob.playerClass] || {};
  const specDef = eng.SPECS[blob.spec] || {};
  const titleId = typeof blob.activeTitle === 'string' ? blob.activeTitle : null;

  // Equipped gear: item cards only (name, rarity, enchant, stats).
  const inv = Array.isArray(blob.inventory) ? blob.inventory : [];
  const gear = INSPECT_SLOTS.map((slot) => {
    const id = blob.equipped && blob.equipped[slot];
    const item = id ? inv.find((i) => i && i.id === id) : null;
    if (!item) return { slot, item: null };
    const itemStats = {};
    if (item.stats && typeof item.stats === 'object') {
      for (const [k, v] of Object.entries(item.stats)) {
        if (Number.isFinite(v)) itemStats[k] = Math.round(v * 100) / 100;
      }
    }
    return {
      slot,
      item: {
        name: String(item.name || 'Unknown item'),
        rarity: String(item.rarity || 'common'),
        enchant: Math.max(0, Math.floor(Number(item.enchant) || 0)),
        stats: itemStats,
      },
    };
  });

  // Active pets only.
  const pets = [];
  const coll = Array.isArray(safe.pets.collection) ? safe.pets.collection : [];
  const activeUids = new Set(
    [safe.pets.activeUid, safe.pets.secondActiveUid].filter((u) => typeof u === 'string' && u)
  );
  for (const p of coll) {
    if (!p || !activeUids.has(p.uid)) continue;
    const sp = (eng.PET_SPECIES && eng.PET_SPECIES[p.species]) || {};
    pets.push({
      name: sp.name || 'Pet',
      emoji: sp.emoji || '🐾',
      level: Math.max(1, Math.floor(Number(p.level) || 1)),
      rarity: sp.rarity || 'common',
    });
  }

  const guildRow = await getMyGuild(user.username);
  const lastActive = Number(user.last_active) || 0;

  let relation = 'none';
  if (viewerUsername) {
    try {
      relation = await friendshipStatus(viewerUsername, user.username);
    } catch { /* leave 'none' */ }
  }

  return {
    username: user.username,
    level: row ? row.level : 1,
    stage: row ? row.stage : 1,
    race: { id: blob.race || null, name: raceDef.name || null, emoji: raceDef.emoji || null },
    playerClass: { id: blob.playerClass || null, name: clsDef.name || null, emoji: clsDef.emoji || null },
    spec: { id: blob.spec || null, name: specDef.name || null, emoji: specDef.emoji || null },
    title: titleId ? eng.titleName(titleId) : null,
    titleId,
    badge: typeof blob.badge === 'string' ? blob.badge : null,
    country: typeof blob.country === 'string' ? blob.country : null,
    power,
    bestRaidWave: Math.max(0, Math.floor(Number((blob.raid && blob.raid.best) || 0))),
    kills: Math.max(0, Math.floor(Number((blob.stats && blob.stats.kills) || 0))),
    bossesKilled: row ? row.bosses_killed : 0,
    rebirthCount: row ? row.rebirth_count : 0,
    guild: guildRow ? { name: guildRow.name, tag: guildRow.tag } : null,
    gear,
    stats,
    pets,
    online: Date.now() - lastActive < ONLINE_WINDOW_MS,
    lastActive,
    relation,
  };
}

// ---------- server status ----------
// Public. Lets the client show a proper maintenance screen instead of
// cryptic errors. Toggle with env vars (Render → Environment):
//   MAINTENANCE_MODE=1            → maintenance screen on
//   MAINTENANCE_MESSAGE="..."     → optional custom message
// The owner can override both at runtime from the GM console (server
// settings maintenance_mode / maintenance_message); a present override
// ('1' or '0') wins over the env vars.
router.get('/status', asyncHandler(async (req, res) => {
  const override = await getSetting('maintenance_mode');
  let maintenance;
  let message;
  if (override === '1' || override === '0') {
    maintenance = override === '1';
    const msg = await getSetting('maintenance_message');
    message = (typeof msg === 'string' && msg.trim())
      ? msg
      : (process.env.MAINTENANCE_MESSAGE || null);
  } else {
    maintenance = /^(1|true|yes)$/i.test(String(process.env.MAINTENANCE_MODE || ''));
    message = process.env.MAINTENANCE_MESSAGE || null;
  }
  res.json({ ok: true, maintenance, message });
}));

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
    rebirthCount: 0,
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
    pets: { collection: [], activeUid: null, eggs: 0 },
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
    // infGold is an owner-granted perk: never trust the client's assertion.
    // Carry the server-side value forward so players can't grant it to
    // themselves by editing their save blob.
    const row = await getStateRow(req.user.id);
    let serverInfGold = false;
    if (row) {
      try {
        const prev = JSON.parse(row.state_json);
        serverInfGold = prev && prev.infGold === true;
      } catch { /* keep false */ }
    }
    result.state.infGold = serverInfGold;
    await saveState(req.user.id, result.state);
    res.json({ ok: true });
  })
);

// ---------- public settings ----------
// Tunables the client needs at boot (currently just the gold cap).
router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    res.json({ ok: true, goldCap: await getGoldCap() });
  })
);

// ---------- leaderboard (public) ----------
// Valid class/spec ids for leaderboard parsing (mirrors Engine.CLASSES and
// Engine.SPECS; engine.js is ESM so the lists are duplicated here for the CJS server).
const VALID_CLASSES = new Set(['hunter', 'warrior', 'mage', 'assassin']);
const VALID_SPECS = new Set(['tank', 'dps', 'healer', 'classic']);
router.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const rows = await getLeaderboardRows(100);
    const entries = rows.map((r) => {
      let race = null;
      let title = null;
      let badge = null;
      let country = null;
      let playerClass = null;
      let spec = null;
      let power = 0;
      try {
        const blob = JSON.parse(r.state_json);
        if (blob && typeof blob.race === 'string') race = blob.race;
        if (blob && typeof blob.activeTitle === 'string') title = blob.activeTitle;
        if (blob && typeof blob.badge === 'string') badge = blob.badge;
        if (blob && typeof blob.country === 'string') country = blob.country;
        if (blob && typeof blob.playerClass === 'string' && VALID_CLASSES.has(blob.playerClass)) {
          playerClass = blob.playerClass;
        }
        if (blob && typeof blob.spec === 'string' && VALID_SPECS.has(blob.spec)) {
          spec = blob.spec;
        }
        if (blob && Number.isFinite(blob.power) && blob.power >= 0) power = Math.floor(blob.power);
      } catch {
        // leave race/title/badge/country/playerClass/spec null
      }
      return {
        username: r.username,
        race,
        title,
        badge,
        country,
        playerClass,
        spec,
        level: r.level,
        stage: r.stage,
        power,
        bossesKilled: r.bosses_killed,
        rebirth: r.rebirth_count,
      };
    });
    res.json({ entries });
  })
);

// ---------- player inspect (public) ----------
// Full gameplay character sheet for any existing player. Privacy: gameplay
// data only — no currencies, roles, or account details.
router.get(
  '/player/:username/inspect',
  asyncHandler(async (req, res) => {
    const raw = req.params.username;
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(raw)) {
      return res.status(400).json({ error: 'Invalid username.' });
    }
    let viewer = null;
    try {
      const viewerId = req.session && req.session.userId;
      if (viewerId) {
        const vu = await getUserById(viewerId);
        viewer = vu ? vu.username : null;
      }
    } catch { /* anonymous inspect */ }
    const data = await buildInspect(raw, viewer);
    if (!data) return res.status(404).json({ error: 'Player not found.' });
    res.json(data);
  })
);

// ---------- friends ----------
router.post(
  '/friends/request',
  requireAuth,
  friendLimiter,
  asyncHandler(async (req, res) => {
    const target = req.body && req.body.username;
    const usernameError = validateUsername(target);
    if (usernameError) return res.status(400).json({ error: usernameError });
    try {
      const r = await sendFriendRequest(req.user.username, target.trim());
      res.json({ ok: true, username: r.username });
    } catch (err) {
      if (err.code === 'FRIEND_SELF') {
        return res.status(400).json({ error: "You can't add yourself as a friend." });
      }
      if (err.code === 'FRIEND_NOT_FOUND') {
        return res.status(404).json({ error: 'Player not found. Check the exact username.' });
      }
      if (err.code === 'FRIEND_EXISTS') {
        return res.status(409).json({ error: 'Already friends, or a request is already pending.' });
      }
      throw err;
    }
  })
);

router.post(
  '/friends/respond',
  requireAuth,
  friendLimiter,
  asyncHandler(async (req, res) => {
    const { username, accept } = req.body || {};
    const usernameError = validateUsername(username);
    if (usernameError) return res.status(400).json({ error: usernameError });
    try {
      const r = await respondFriendRequest(req.user.username, username.trim(), accept === true);
      res.json({ ok: true, accepted: accept === true, username: r.username });
    } catch (err) {
      if (err.code === 'FRIEND_NO_REQUEST') {
        return res.status(404).json({ error: 'No pending friend request from that player.' });
      }
      throw err;
    }
  })
);

router.get(
  '/friends',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await getFriendshipData(req.user.username);
    const friends = await getFriendProfiles(data.friends);
    const now = Date.now();
    res.json({
      ok: true,
      friends: friends.map((f) => ({
        ...f,
        online: now - (Number(f.lastActive) || 0) < ONLINE_WINDOW_MS,
      })),
      incoming: data.incoming,
      outgoing: data.outgoing,
    });
  })
);

router.delete(
  '/friends/:username',
  requireAuth,
  friendLimiter,
  asyncHandler(async (req, res) => {
    const raw = req.params.username;
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(raw)) {
      return res.status(400).json({ error: 'Invalid username.' });
    }
    try {
      await removeFriend(req.user.username, raw);
      res.json({ ok: true });
    } catch (err) {
      if (err.code === 'FRIEND_NOT_FOUND') {
        return res.status(404).json({ error: 'No friendship with that player.' });
      }
      throw err;
    }
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

    const cap = await getGoldCap();
    let giftRow;
    try {
      giftRow = await redeemGiftCode(
        code,
        req.user.id,
        (giftCode, blob) => {
          const kind = giftCode.reward_kind || 'gear';
          const amount = Math.max(0, Math.floor(Number(giftCode.reward_amount)) || 0);
          if (!Array.isArray(blob.codesRedeemed)) blob.codesRedeemed = [];
          if (!blob.codesRedeemed.includes(code)) blob.codesRedeemed.push(code);
          if (kind === 'gold') {
            const cur = Math.max(0, Number(blob.gold) || 0);
            // Infinite-gold perk holders bypass the cap; everyone else clamps.
            blob.gold = blob.infGold === true ? cur + amount : Math.min(cap, cur + amount);
          } else if (kind === 'stars') {
            blob.stars = Math.min(1e15, Math.max(0, Number(blob.stars) || 0) + amount);
          } else {
            if (!isValidSetId(giftCode.gear_set)) {
              const err = new Error('Code has an invalid gear set.');
              err.status = 500;
              throw err;
            }
            const items = makeGearItems(giftCode.gear_set);
            if (!Array.isArray(blob.inventory)) blob.inventory = [];
            blob.inventory.push(...items);
          }
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

    const rewardKind = giftRow.reward_kind || 'gear';
    const rewardAmount = Math.max(0, Math.floor(Number(giftRow.reward_amount)) || 0);
    res.json({
      ok: true,
      set: rewardKind === 'gear' ? giftRow.gear_set : null,
      reward: { kind: rewardKind, amount: rewardAmount },
    });
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
