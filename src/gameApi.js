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
  getGuildRankings,
  redeemGiftCode,
  createGuild,
  getGuildByName,
  getMyGuild,
  addGuildNews,
  getGuildRoster,
  joinGuild,
  leaveGuild,
  getGoldCap,
  getSetting,
  // guild rework
  GUILD_RANKS,
  guildPerks,
  xpForGuildLevel,
  setMemberRank,
  kickGuildMember,
  setGuildMotd,
  setGuildDescription,
  unlockGuildBanner,
  setGuildBanner,
  getUnlockedBanners,
  addGuildChat,
  getGuildChat,
  deleteGuildChat,
  getGuildNews,
  getGuildChallenges,
  recordMemberActivity,
  buyVendorItem,
  GUILD_VENDOR,
  getGuildPerksFor,
  inviteToGuild,
  getMyInvites,
  acceptGuildInvite,
  declineGuildInvite,
} = require('./db');

const router = express.Router();

// Singular aliases: the guild rework spec requests /api/guild/* routes.
// The codebase convention is /api/guilds/*; rewrite the singular form to
// the plural form before route matching so both work identically.
router.use((req, res, next) => {
  if (req.url === '/guild' || req.url.startsWith('/guild/') || req.url.startsWith('/guild?')) {
    req.url = req.url.replace(/^\/guild(?=\/|\?|$)/, '/guilds');
  }
  next();
});

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
    // Guild XP: award the player's guild for activity since the last save.
    // Deltas are clamped >= 0 and the per-save contribution is capped in
    // recordMemberActivity, so a single save can't spike the guild. Guild
    // failures must never break saving.
    try {
      if (row && row.state_json) {
        const prev = JSON.parse(row.state_json);
        const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        const deltas = {
          kills: Math.max(0, Math.floor(num(result.state.stats && result.state.stats.kills) - num(prev.stats && prev.stats.kills))),
          bosses: Math.max(0, Math.floor(num(result.state.bossesKilled) - num(prev.bossesKilled))),
          quests: Math.max(0, Math.floor(num(result.state.stats && result.state.stats.questsCompleted) - num(prev.stats && prev.stats.questsCompleted))),
        };
        if (deltas.kills || deltas.bosses || deltas.quests) {
          await recordMemberActivity(req.user.username, deltas);
          // Announce boss kills in guild news (aggregated per save so a
          // boss-grinding session doesn't flood the feed).
          if (deltas.bosses > 0) {
            try {
              const mg = await getMyGuild(req.user.username);
              if (mg) {
                await addGuildNews(
                  mg.id,
                  'boss',
                  `${req.user.username} slew ${deltas.bosses} boss${deltas.bosses === 1 ? '' : 'es'}!`
                );
              }
            } catch { /* news must never break the save */ }
          }
        }
      }
    } catch {
      // ignore guild bookkeeping errors; the save itself succeeded
    }
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
        guildTag: r.guild_tag || null,
      };
    });
    res.json({ entries });
  })
);

// ---------- guild rankings (public) ----------
// Ranks guilds by: level DESC, then total member power DESC, then member
// count DESC. Served for the leaderboard "Guilds" category tab.
router.get(
  '/guilds/rankings',
  asyncHandler(async (req, res) => {
    const guilds = await getGuildRankings(50);
    res.json({ guilds });
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

// ---------- guild invites ----------
// Officers and the Guild Master can invite a player by username.
router.post(
  '/guilds/invite',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const invite = await inviteToGuild(req.user.username, req.body && req.body.username);
      res.json({ ok: true, invite });
    } catch (err) {
      if (err.code === 'GUILD_NOT_IN') return res.status(404).json({ error: 'You are not in a guild.' });
      if (err.code === 'GUILD_NO_PERMISSION') {
        return res.status(403).json({ error: 'Only the Guild Master and Officers can invite players.' });
      }
      if (err.code === 'GUILD_USER_NOT_FOUND') return res.status(404).json({ error: 'Player not found.' });
      if (err.code === 'GUILD_ALREADY_IN') return res.status(409).json({ error: 'That player is already in a guild.' });
      if (err.code === 'GUILD_ALREADY_INVITED') {
        return res.status(409).json({ error: 'That player is already invited.' });
      }
      throw err;
    }
  })
);

// Pending invites for the signed-in player.
router.get(
  '/guilds/invites',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ invites: await getMyInvites(req.user.username) });
  })
);

router.post(
  '/guilds/invites/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const result = await acceptGuildInvite(req.user.username, req.body && req.body.inviteId);
      res.json({ ok: true, guildId: result.guildId });
    } catch (err) {
      if (err.code === 'GUILD_NOT_FOUND') return res.status(404).json({ error: 'Invite not found.' });
      if (err.code === 'GUILD_ALREADY_IN') return res.status(409).json({ error: 'You are already in a guild.' });
      throw err;
    }
  })
);

router.post(
  '/guilds/invites/decline',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await declineGuildInvite(req.user.username, req.body && req.body.inviteId);
      res.json({ ok: true });
    } catch (err) {
      if (err.code === 'GUILD_NOT_FOUND') return res.status(404).json({ error: 'Invite not found.' });
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
    const { my_rank: myRank, my_credits: myCredits, my_title: myTitle, ...guild } = mine;
    const members = await getGuildRoster(guild.id);
    const challenges = await getGuildChallenges(guild.id);
    const unlockedBanners = await getUnlockedBanners(guild.id);
    const level = Number(guild.level) || 1;
    res.json({
      guild: {
        ...guild,
        myRank,
        myName: req.user.username,
        myCredits: Number(myCredits) || 0,
        myTitle: myTitle || null,
        perks: guildPerks(level),
        xpForNext: xpForGuildLevel(level + 1),
        unlockedBanners,
      },
      members,
      challenges,
    });
  })
);

// Slim endpoint so the client can apply guild perks at boot without
// pulling the whole roster.
router.get(
  '/guilds/perks',
  requireAuth,
  asyncHandler(async (req, res) => {
    const mine = await getMyGuild(req.user.username);
    if (!mine) return res.json({ inGuild: false, perks: null });
    res.json({ inGuild: true, perks: guildPerks(Number(mine.level) || 1) });
  })
);

// Guild level / XP progress (explicit endpoint for the rework spec).
router.get(
  '/guilds/xp',
  requireAuth,
  asyncHandler(async (req, res) => {
    const mine = await getMyGuild(req.user.username);
    if (!mine) return res.json({ inGuild: false });
    const level = Number(mine.level) || 1;
    const xp = Number(mine.xp) || 0;
    res.json({
      inGuild: true,
      level,
      xp,
      xpForNext: xpForGuildLevel(level + 1),
      xpForCurrent: xpForGuildLevel(level),
      perks: guildPerks(level),
    });
  })
);

// Weekly guild challenges (explicit endpoint for the rework spec).
router.get(
  '/guilds/challenges',
  requireAuth,
  asyncHandler(async (req, res) => {
    const mine = await getMyGuild(req.user.username);
    if (!mine) return res.json({ inGuild: false, challenges: [] });
    res.json({ inGuild: true, challenges: await getGuildChallenges(mine.id) });
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

// ---------- guild rework endpoints ----------

/** Load the caller's guild + rank; 404 when not in a guild. */
async function guildContext(req, res) {
  const mine = await getMyGuild(req.user.username);
  if (!mine) {
    res.status(404).json({ error: 'You are not in a guild.' });
    return null;
  }
  const { my_rank: myRank, ...guild } = mine;
  return { guild, myRank };
}

function rankAtLeast(rank, need) {
  return (GUILD_RANKS[rank] || 0) >= (GUILD_RANKS[need] || 0);
}

// Chat flood protection: 20 messages/min per user.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Chatting too fast. Slow down a moment.' },
});

router.get(
  '/guilds/chat',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    const after = Math.max(0, Math.floor(Number((req.query && req.query.after) || 0)));
    res.json({ messages: await getGuildChat(ctx.guild.id, after) });
  })
);

router.post(
  '/guilds/chat',
  requireAuth,
  chatLimiter,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    const raw = req.body && typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (!raw) return res.status(400).json({ error: 'Message is empty.' });
    if (raw.length > 500) return res.status(400).json({ error: 'Message is too long (max 500 characters).' });
    const msg = await addGuildChat(ctx.guild.id, req.user.username, raw);
    res.json({ ok: true, message: { id: msg.id, username: req.user.username, message: raw, created_at: msg.created_at } });
  })
);

// Officers+ can delete a guild chat message.
router.delete(
  '/guilds/chat/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    if (!rankAtLeast(ctx.myRank, 'officer')) {
      return res.status(403).json({ error: 'Only officers and the Guild Master can delete messages.' });
    }
    const id = Math.floor(Number(req.params.id));
    if (!id || id < 1) return res.status(400).json({ error: 'Bad message id.' });
    const ok = await deleteGuildChat(ctx.guild.id, id);
    if (!ok) return res.status(404).json({ error: 'Message not found.' });
    res.json({ ok: true });
  })
);

router.get(
  '/guilds/news',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    res.json({ news: await getGuildNews(ctx.guild.id) });
  })
);

router.post(
  '/guilds/motd',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    if (!rankAtLeast(ctx.myRank, 'officer')) {
      return res.status(403).json({ error: 'Only the Guild Master and Officers can set the Message of the Day.' });
    }
    const raw = req.body && typeof req.body.motd === 'string' ? req.body.motd.trim() : '';
    if (raw.length > 200) return res.status(400).json({ error: 'Message of the Day is too long (max 200 characters).' });
    await setGuildMotd(ctx.guild.id, raw);
    res.json({ ok: true, motd: raw });
  })
);

router.post(
  '/guilds/description',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    if (!rankAtLeast(ctx.myRank, 'officer')) {
      return res.status(403).json({ error: 'Only the Guild Master and Officers can edit the description.' });
    }
    const raw = req.body && typeof req.body.description === 'string' ? req.body.description.trim() : '';
    if (raw.length > 500) return res.status(400).json({ error: 'Description is too long (max 500 characters).' });
    await setGuildDescription(ctx.guild.id, raw);
    res.json({ ok: true, description: raw });
  })
);

router.post(
  '/guilds/rank',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    const target = req.body && typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const rank = req.body && typeof req.body.rank === 'string' ? req.body.rank.trim().toLowerCase() : '';
    if (!target) return res.status(400).json({ error: 'Username is required.' });
    try {
      const updated = await setMemberRank(ctx.guild.id, req.user.username, target, rank);
      res.json({ ok: true, member: { username: updated.username, rank: updated.rank } });
    } catch (err) {
      if (err.code === 'GUILD_BAD_RANK') return res.status(400).json({ error: 'Invalid rank.' });
      if (err.code === 'GUILD_SELF') return res.status(400).json({ error: 'You cannot change your own rank.' });
      if (err.code === 'GUILD_NOT_IN') return res.status(404).json({ error: 'That player is not in your guild.' });
      if (err.code === 'GUILD_FORBIDDEN') {
        return res.status(403).json({ error: 'You do not have permission to do that.' });
      }
      throw err;
    }
  })
);

router.post(
  '/guilds/kick',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    const target = req.body && typeof req.body.username === 'string' ? req.body.username.trim() : '';
    if (!target) return res.status(400).json({ error: 'Username is required.' });
    try {
      await kickGuildMember(ctx.guild.id, req.user.username, target);
      res.json({ ok: true });
    } catch (err) {
      if (err.code === 'GUILD_SELF') return res.status(400).json({ error: 'You cannot kick yourself. Leave instead.' });
      if (err.code === 'GUILD_NOT_IN') return res.status(404).json({ error: 'That player is not in your guild.' });
      if (err.code === 'GUILD_FORBIDDEN') {
        return res.status(403).json({ error: 'You do not have permission to do that.' });
      }
      throw err;
    }
  })
);

router.get(
  '/guilds/vendor',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    const mine = await getMyGuild(req.user.username);
    const unlockedBanners = await getUnlockedBanners(ctx.guild.id);
    res.json({
      items: GUILD_VENDOR,
      credits: Number(mine.my_credits) || 0,
      myTitle: mine.my_title || null,
      bannerStyle: ctx.guild.banner_style,
      unlockedBanners,
      canSetBanner: rankAtLeast(ctx.myRank, 'officer'),
    });
  })
);

router.post(
  '/guilds/vendor/buy',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    const itemId = req.body && typeof req.body.itemId === 'string' ? req.body.itemId : '';
    try {
      const result = await buyVendorItem(ctx.guild.id, req.user.username, itemId);
      res.json({ ok: true, item: result.item });
    } catch (err) {
      if (err.code === 'GUILD_ITEM_UNKNOWN') return res.status(400).json({ error: 'Unknown item.' });
      if (err.code === 'GUILD_NOT_IN') return res.status(404).json({ error: 'You are not in a guild.' });
      if (err.code === 'GUILD_NO_CREDITS') {
        return res.status(402).json({ error: 'Not enough guild credits. Contribute guild XP to earn more.' });
      }
      throw err;
    }
  })
);

router.post(
  '/guilds/banner',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    if (!rankAtLeast(ctx.myRank, 'officer')) {
      return res.status(403).json({ error: 'Only the Guild Master and Officers can change the banner.' });
    }
    const style = req.body && typeof req.body.style === 'string' ? req.body.style.trim() : '';
    try {
      await setGuildBanner(ctx.guild.id, style, req.user.username);
      res.json({ ok: true, bannerStyle: style });
    } catch (err) {
      if (err.code === 'GUILD_LOCKED') {
        return res.status(400).json({ error: 'That banner is not unlocked yet. Buy it in Rewards.' });
      }
      throw err;
    }
  })
);

module.exports = { gameRouter: router, defaultStateBlob, loadBlob };
