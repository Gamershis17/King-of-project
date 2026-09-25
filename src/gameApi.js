'use strict';

/**
 * Player-facing game API:
 *   GET  /api/state        (auth)
 *   POST /api/state        (auth)
 *   GET  /api/leaderboard  (public)
 *   GET  /api/status       (public — maintenance flag + message)
 *   POST /api/redeem       (auth)
 *
 * Gift-code redemption runs inside a single Postgres transaction with
 * SELECT ... FOR UPDATE on the gift_codes row, so concurrent redemptions
 * serialize and cannot double-spend a code's uses.
 */

const express = require('express');
const { requireAuth, asyncHandler } = require('./auth');
const { sanitizeStateBlob } = require('./validation');
const { makeGearItems, isValidSetId } = require('./gearSets');
const {
  getStateRow,
  saveState,
  getLeaderboardRows,
  redeemGiftCode,
} = require('./db');

const router = express.Router();

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

module.exports = { gameRouter: router, defaultStateBlob, loadBlob };
