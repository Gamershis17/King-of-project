'use strict';

/**
 * Multi-hero API (3 hero slots per account).
 *
 *   GET  /api/heroes          (auth) list the 3 slots
 *   POST /api/heroes          (auth) create a hero in an empty slot
 *   POST /api/heroes/switch   (auth) switch the active hero
 *
 * Design (kept deliberately small):
 * - The ACTIVE hero's save lives in player_state, exactly as before.
 * - Parked heroes live in hero_storage (user_id, slot).
 * - users.active_slot tracks which slot is active (0 = original hero).
 * - Guilds / friends / account settings stay on the account and are shared.
 * - Create + switch run inside a single Postgres transaction so a hero can
 *   never be lost between the park and the load.
 */

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { requireAuth, asyncHandler } = require('./auth');
const { pool } = require('./db');
const { sanitizeStateBlob } = require('./validation');

const router = express.Router();

const MAX_HEROES = 3;

// Server-side copy of the client game engine (same technique as gameApi.js:
// public/js/engine.js is pure logic with no DOM access). Used to validate
// race/class/spec ids and to build a fresh level-1 hero state.
let _enginePromise = null;
function serverEngine() {
  if (!_enginePromise) {
    _enginePromise = (async () => {
      const src = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'engine.js'),
        'utf8'
      );
      const tmp = path.join(os.tmpdir(), 'kop-engine-heroes.mjs');
      fs.writeFileSync(tmp, src);
      return import(tmp);
    })();
  }
  return _enginePromise;
}

function parseBlob(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
  } catch { /* fall through */ }
  return null;
}

async function getActiveSlot(client, userId) {
  const { rows } = await client.query(
    'SELECT active_slot FROM users WHERE id = $1',
    [userId]
  );
  const s = rows.length ? Number(rows[0].active_slot) : 0;
  return Number.isInteger(s) && s >= 0 && s < MAX_HEROES ? s : 0;
}

// Small summary for the slot list: never ships the full save blob.
function summarize(slot, active, blob, eng) {
  const race = (eng.RACES && eng.RACES[blob.race]) || {};
  const cls = (eng.CLASSES && eng.CLASSES[blob.playerClass]) || {};
  const spec = (eng.SPECS && eng.SPECS[blob.spec]) || {};
  return {
    slot,
    active,
    race: blob.race || null,
    raceName: race.name || null,
    raceEmoji: race.emoji || null,
    playerClass: blob.playerClass || null,
    className: cls.name || null,
    classEmoji: cls.emoji || null,
    spec: blob.spec || null,
    specName: spec.name || null,
    level: Math.max(1, Math.floor(Number(blob.level) || 1)),
  };
}

function bad(res, status, error) {
  return res.status(status).json({ error });
}

// Park the row currently in player_state into hero_storage under slot.
// No-op when the account has no save row yet.
async function parkActive(client, userId, slot) {
  const { rows } = await client.query(
    'SELECT level, stage, bosses_killed, rebirth_count, state_json FROM player_state WHERE user_id = $1',
    [userId]
  );
  if (!rows.length) return;
  const r = rows[0];
  await client.query(
    `INSERT INTO hero_storage (user_id, slot, level, stage, bosses_killed, rebirth_count, state_json, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, slot) DO UPDATE SET
       level = EXCLUDED.level,
       stage = EXCLUDED.stage,
       bosses_killed = EXCLUDED.bosses_killed,
       rebirth_count = EXCLUDED.rebirth_count,
       state_json = EXCLUDED.state_json,
       updated_at = EXCLUDED.updated_at`,
    [userId, slot, r.level, r.stage, r.bosses_killed, r.rebirth_count, r.state_json, Date.now()]
  );
}

// Write a state blob into player_state (same column set as db.upsertState).
async function writeActive(client, userId, blob) {
  const level = Math.max(1, Math.floor(Number(blob.level) || 1));
  const stage = Math.max(1, Math.floor(Number(blob.stage) || 1));
  const bossesKilled = Math.max(0, Math.floor(Number(blob.bossesKilled) || 0));
  const rebirthCount = Math.max(0, Math.floor(Number(blob.rebirthCount) || 0));
  await client.query(
    `INSERT INTO player_state (user_id, level, stage, bosses_killed, rebirth_count, state_json, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE SET
       level = EXCLUDED.level,
       stage = EXCLUDED.stage,
       bosses_killed = EXCLUDED.bosses_killed,
       rebirth_count = EXCLUDED.rebirth_count,
       state_json = EXCLUDED.state_json,
       updated_at = EXCLUDED.updated_at`,
    [userId, level, stage, bossesKilled, rebirthCount, JSON.stringify(blob), Date.now()]
  );
}

router.get(
  '/heroes',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const eng = await serverEngine();
    const activeSlot = await getActiveSlot(pool, userId);
    const { rows: activeRows } = await pool.query(
      'SELECT state_json FROM player_state WHERE user_id = $1',
      [userId]
    );
    const { rows: storedRows } = await pool.query(
      'SELECT slot, state_json FROM hero_storage WHERE user_id = $1',
      [userId]
    );
    const stored = {};
    for (const r of storedRows) stored[r.slot] = r;
    const heroes = [];
    for (let slot = 0; slot < MAX_HEROES; slot++) {
      if (slot === activeSlot) {
        const blob = activeRows.length ? parseBlob(activeRows[0].state_json) : null;
        heroes.push(blob ? summarize(slot, true, blob, eng) : null);
      } else if (stored[slot]) {
        const blob = parseBlob(stored[slot].state_json);
        heroes.push(blob ? summarize(slot, false, blob, eng) : null);
      } else {
        heroes.push(null);
      }
    }
    res.json({ heroes, activeSlot, maxHeroes: MAX_HEROES });
  })
);

router.post(
  '/heroes',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { slot, race, playerClass, spec, petSpecies } = req.body || {};
    const eng = await serverEngine();
    const s = Number(slot);
    if (!Number.isInteger(s) || s < 0 || s >= MAX_HEROES) return bad(res, 400, 'BAD_SLOT');
    if (!race || !eng.RACES[race]) return bad(res, 400, 'BAD_RACE');
    if (!playerClass || !eng.CLASSES[playerClass]) return bad(res, 400, 'BAD_CLASS');
    if (!spec || !eng.SPECS[spec]) return bad(res, 400, 'BAD_SPEC');
    if (playerClass === 'hunter' && petSpecies && !eng.HUNTER_STARTERS.includes(petSpecies)) {
      return bad(res, 400, 'BAD_PET');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!locked.rows.length) { await client.query('ROLLBACK'); return bad(res, 404, 'NO_USER'); }
      const activeSlot = await getActiveSlot(client, userId);
      if (s === activeSlot) { await client.query('ROLLBACK'); return bad(res, 400, 'SLOT_ACTIVE'); }
      const taken = await client.query(
        'SELECT 1 FROM hero_storage WHERE user_id = $1 AND slot = $2',
        [userId, s]
      );
      if (taken.rows.length) { await client.query('ROLLBACK'); return bad(res, 400, 'SLOT_TAKEN'); }

      // Park the current hero, then start the new one 100% fresh.
      await parkActive(client, userId, activeSlot);
      const fresh = eng.ensureState({ race, playerClass, spec });
      if (playerClass === 'hunter' && petSpecies) eng.addStarterPet(fresh, petSpecies);
      const clean = sanitizeStateBlob(fresh);
      if (!clean.ok) { await client.query('ROLLBACK'); return bad(res, 500, 'BAD_FRESH_STATE'); }
      await writeActive(client, userId, clean.state);
      await client.query('UPDATE users SET active_slot = $1 WHERE id = $2', [s, userId]);
      await client.query('COMMIT');
      res.json({ ok: true, activeSlot: s });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  })
);

router.post(
  '/heroes/switch',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const s = Number((req.body || {}).slot);
    if (!Number.isInteger(s) || s < 0 || s >= MAX_HEROES) return bad(res, 400, 'BAD_SLOT');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!locked.rows.length) { await client.query('ROLLBACK'); return bad(res, 404, 'NO_USER'); }
      const activeSlot = await getActiveSlot(client, userId);
      if (s === activeSlot) { await client.query('ROLLBACK'); return bad(res, 400, 'SLOT_ACTIVE'); }
      const target = await client.query(
        'SELECT state_json FROM hero_storage WHERE user_id = $1 AND slot = $2',
        [userId, s]
      );
      if (!target.rows.length) { await client.query('ROLLBACK'); return bad(res, 400, 'SLOT_EMPTY'); }
      const blob = parseBlob(target.rows[0].state_json);
      if (!blob) { await client.query('ROLLBACK'); return bad(res, 500, 'BAD_STORED_STATE'); }

      // Park current -> storage, load target -> player_state, in one txn.
      await parkActive(client, userId, activeSlot);
      await writeActive(client, userId, blob);
      await client.query('DELETE FROM hero_storage WHERE user_id = $1 AND slot = $2', [userId, s]);
      await client.query('UPDATE users SET active_slot = $1 WHERE id = $2', [s, userId]);
      await client.query('COMMIT');
      res.json({ ok: true, activeSlot: s });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  })
);

module.exports = { heroesRouter: router };