'use strict';

/**
 * PostgreSQL database layer (node-postgres `pg`).
 *
 * Connection comes from DATABASE_URL. SSL is enabled with
 * { rejectUnauthorized: false } for any non-localhost URL (required by
 * Neon / Supabase on Render); plain TCP is used for localhost.
 * Local fallback when DATABASE_URL is unset:
 *   postgres://localhost:5432/king_of_project
 * (create that database and make sure the OS user can connect, e.g. via
 * peer/trust auth — see README).
 *
 * Schema is applied at boot by migrate() (CREATE TABLE IF NOT EXISTS).
 * All queries are parameterized ($1, $2, ...). Every function is async.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { sanitizeStateBlob } = require('./validation');

function buildPoolConfig() {
  let connectionString =
    process.env.DATABASE_URL || 'postgres://localhost:5432/king_of_project';
  // Strip libpq-only params (e.g. Neon's channel_binding=require) that
  // node-postgres does not understand.
  try {
    const u = new URL(connectionString);
    if (u.searchParams.has('channel_binding')) {
      u.searchParams.delete('channel_binding');
      connectionString = u.toString();
    }
  } catch { /* leave the string untouched if it doesn't parse */ }
  const isLocal = /(^|[@:/])(localhost|127\.0\.0\.1)([:/]|$)/.test(connectionString);
  return {
    connectionString,
    // Hosted Postgres (Neon, Supabase, ...) requires TLS; their certs are
    // not in the default trust chain, so we don't reject unauthorized certs.
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
}

const pool = new Pool(buildPoolConfig());

pool.on('error', (err) => {
  console.error('[db] unexpected pool error:', err.message);
});

/** Create tables/indexes if missing. Safe to run on every boot. */
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

async function closePool() {
  await pool.end();
}

// ---------- users ----------
async function getUserByUsername(username) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
    [username]
  );
  return rows[0] || null;
}

async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createUser(username, passwordHash) {
  return createUserWithRole(username, passwordHash, 'player');
}

async function createUserWithRole(username, passwordHash, role) {
  const { rows } = await pool.query(
    'INSERT INTO users (username, password_hash, role, created_at) VALUES ($1, $2, $3, $4) RETURNING *',
    [username, passwordHash, role, Date.now()]
  );
  return rows[0];
}

async function setUserRole(userId, role) {
  await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
}

async function ownerExists() {
  const { rows } = await pool.query("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'");
  return Number(rows[0].n) > 0;
}

async function getPlayerCount() {
  const { rows } = await pool.query('SELECT COUNT(*) AS n FROM users');
  return Number(rows[0].n);
}

async function getUsernamesByRole(role) {
  const { rows } = await pool.query(
    'SELECT username FROM users WHERE role = $1 ORDER BY username ASC',
    [role]
  );
  return rows.map((r) => r.username);
}

// ---------- player state ----------
async function getStateRow(userId) {
  const { rows } = await pool.query('SELECT * FROM player_state WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

/** Works with a Pool or a transaction Client (both expose .query). */
async function upsertState(q, userId, blob) {
  const level = Math.max(1, Math.floor(Number(blob.level) || 1));
  const stage = Math.max(1, Math.floor(Number(blob.stage) || 1));
  const bossesKilled = Math.max(0, Math.floor(Number(blob.bossesKilled) || 0));
  const prestigeCount = Math.max(0, Math.floor(Number(blob.prestigeCount) || 0));
  await q.query(
    `INSERT INTO player_state (user_id, level, stage, bosses_killed, prestige_count, state_json, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE SET
       level = EXCLUDED.level,
       stage = EXCLUDED.stage,
       bosses_killed = EXCLUDED.bosses_killed,
       prestige_count = EXCLUDED.prestige_count,
       state_json = EXCLUDED.state_json,
       updated_at = EXCLUDED.updated_at`,
    [userId, level, stage, bossesKilled, prestigeCount, JSON.stringify(blob), Date.now()]
  );
}

/**
 * Save a full player state. `blob` is the sanitized state object.
 * Indexed columns are derived from the blob.
 */
async function saveState(userId, blob) {
  await upsertState(pool, userId, blob);
}

async function getLeaderboardRows(limit = 100) {
  const { rows } = await pool.query(
    `SELECT u.username, ps.level, ps.stage, ps.bosses_killed, ps.prestige_count, ps.state_json
     FROM player_state ps
     JOIN users u ON u.id = ps.user_id
     ORDER BY ps.level DESC, ps.stage DESC, ps.bosses_killed DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

// ---------- gift codes ----------
async function getGiftCode(code) {
  const { rows } = await pool.query('SELECT * FROM gift_codes WHERE code = $1', [code]);
  return rows[0] || null;
}

async function createGiftCode(code, gearSet, maxUses, createdBy) {
  await pool.query(
    'INSERT INTO gift_codes (code, gear_set, max_uses, uses, created_by, created_at) VALUES ($1, $2, $3, 0, $4, $5)',
    [code, gearSet, maxUses, createdBy, Date.now()]
  );
}

async function incrementCodeUses(code) {
  await pool.query('UPDATE gift_codes SET uses = uses + 1 WHERE code = $1', [code]);
}

async function listGiftCodes() {
  const { rows } = await pool.query(
    'SELECT code, gear_set, max_uses, uses, created_at FROM gift_codes ORDER BY created_at DESC'
  );
  return rows;
}

async function getCodeCount() {
  const { rows } = await pool.query('SELECT COUNT(*) AS n FROM gift_codes');
  return Number(rows[0].n);
}

async function hasRedeemed(code, userId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM code_redemptions WHERE code = $1 AND user_id = $2',
    [code, userId]
  );
  return rows.length > 0;
}

async function addRedemption(code, userId) {
  await pool.query(
    'INSERT INTO code_redemptions (code, user_id, redeemed_at) VALUES ($1, $2, $3)',
    [code, userId, Date.now()]
  );
}

function redeemError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

/**
 * Redeem a gift code atomically.
 *
 * Runs in a single transaction with SELECT ... FOR UPDATE on the gift_codes
 * row, so concurrent redemptions serialize on the row lock and cannot
 * double-spend uses. `grantFn(giftCodeRow, blob)` merges the reward into the
 * player's blob (may throw to abort, e.g. invalid gear set config).
 * `defaultBlobFn()` supplies a fresh blob when the player has no saved row.
 *
 * Returns the gear_set id. Throws errors with .code:
 *   REDEEM_NOT_FOUND | REDEEM_EXHAUSTED | REDEEM_ALREADY
 */
async function redeemGiftCode(code, userId, grantFn, defaultBlobFn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM gift_codes WHERE code = $1 FOR UPDATE',
      [code]
    );
    const giftCode = rows[0] || null;
    if (!giftCode) throw redeemError('REDEEM_NOT_FOUND');
    if (giftCode.uses >= giftCode.max_uses) throw redeemError('REDEEM_EXHAUSTED');
    const dup = await client.query(
      'SELECT 1 FROM code_redemptions WHERE code = $1 AND user_id = $2',
      [code, userId]
    );
    if (dup.rows.length > 0) throw redeemError('REDEEM_ALREADY');

    const srow = await client.query(
      'SELECT state_json FROM player_state WHERE user_id = $1',
      [userId]
    );
    let blob = null;
    if (srow.rows.length > 0) {
      try {
        const parsed = JSON.parse(srow.rows[0].state_json);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) blob = parsed;
      } catch {
        // fall through to default blob
      }
    }
    if (!blob) blob = defaultBlobFn();
    blob = grantFn(giftCode, blob) || blob;
    const sanitized = sanitizeStateBlob(blob);
    await upsertState(client, userId, sanitized.ok ? sanitized.state : blob);

    await client.query('UPDATE gift_codes SET uses = uses + 1 WHERE code = $1', [code]);
    await client.query(
      'INSERT INTO code_redemptions (code, user_id, redeemed_at) VALUES ($1, $2, $3)',
      [code, userId, Date.now()]
    );
    await client.query('COMMIT');
    return giftCode.gear_set;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors; the original error is what matters
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  buildPoolConfig,
  migrate,
  closePool,
  getUserByUsername,
  getUserById,
  createUser,
  createUserWithRole,
  setUserRole,
  ownerExists,
  getPlayerCount,
  getUsernamesByRole,
  getStateRow,
  saveState,
  getLeaderboardRows,
  getGiftCode,
  createGiftCode,
  incrementCodeUses,
  listGiftCodes,
  getCodeCount,
  hasRedeemed,
  addRedemption,
  redeemGiftCode,
  createGuild,
  getGuildByName,
  getMyGuild,
  getGuildRoster,
  joinGuild,
  leaveGuild,
  isInGuild,
};

// ---------- guilds ----------
function guildError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

/**
 * Create a guild and make the creator its leader.
 * Throws errors with .code: GUILD_NAME_TAKEN | GUILD_ALREADY_IN
 */
async function createGuild(name, tag, ownerUsername) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inGuild = await client.query(
      'SELECT 1 FROM guild_members WHERE LOWER(username) = LOWER($1)',
      [ownerUsername]
    );
    if (inGuild.rows.length > 0) throw guildError('GUILD_ALREADY_IN');
    const taken = await client.query(
      'SELECT 1 FROM guilds WHERE LOWER(name) = LOWER($1)',
      [name]
    );
    if (taken.rows.length > 0) throw guildError('GUILD_NAME_TAKEN');
    const { rows } = await client.query(
      'INSERT INTO guilds (name, tag, owner_username) VALUES ($1, $2, $3) RETURNING *',
      [name, tag, ownerUsername]
    );
    await client.query(
      "INSERT INTO guild_members (guild_id, username, rank) VALUES ($1, $2, 'leader')",
      [rows[0].id, ownerUsername]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors; the original error is what matters
    }
    throw err;
  } finally {
    client.release();
  }
}

async function getGuildByName(name) {
  const { rows } = await pool.query(
    'SELECT * FROM guilds WHERE LOWER(name) = LOWER($1)',
    [name]
  );
  return rows[0] || null;
}

/** The guild a player belongs to, with their rank as my_rank. Null if none. */
async function getMyGuild(username) {
  const { rows } = await pool.query(
    `SELECT g.*, m.rank AS my_rank
     FROM guild_members m
     JOIN guilds g ON g.id = m.guild_id
     WHERE LOWER(m.username) = LOWER($1)`,
    [username]
  );
  return rows[0] || null;
}

/** Roster ordered by join date (earliest first). */
async function getGuildRoster(guildId) {
  const { rows } = await pool.query(
    'SELECT username, rank, joined_at FROM guild_members WHERE guild_id = $1 ORDER BY joined_at ASC',
    [guildId]
  );
  return rows;
}

/** Throws errors with .code: GUILD_ALREADY_IN */
async function joinGuild(guildId, username) {
  const inGuild = await pool.query(
    'SELECT 1 FROM guild_members WHERE LOWER(username) = LOWER($1)',
    [username]
  );
  if (inGuild.rows.length > 0) throw guildError('GUILD_ALREADY_IN');
  await pool.query(
    "INSERT INTO guild_members (guild_id, username, rank) VALUES ($1, $2, 'member')",
    [guildId, username]
  );
}

/**
 * Leave the current guild. If the leader leaves and members remain, the
 * earliest-joined remaining member is promoted to leader. If the last
 * member leaves, the guild is deleted.
 * Throws errors with .code: GUILD_NOT_IN
 * Returns { guildDeleted, guildName }.
 */
async function leaveGuild(username) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT m.guild_id, m.rank, g.name
       FROM guild_members m
       JOIN guilds g ON g.id = m.guild_id
       WHERE LOWER(m.username) = LOWER($1)`,
      [username]
    );
    const mem = rows[0] || null;
    if (!mem) throw guildError('GUILD_NOT_IN');
    const others = await client.query(
      'SELECT username FROM guild_members WHERE guild_id = $1 AND LOWER(username) <> LOWER($2) ORDER BY joined_at ASC',
      [mem.guild_id, username]
    );
    await client.query(
      'DELETE FROM guild_members WHERE guild_id = $1 AND LOWER(username) = LOWER($2)',
      [mem.guild_id, username]
    );
    let guildDeleted = false;
    if (others.rows.length === 0) {
      await client.query('DELETE FROM guilds WHERE id = $1', [mem.guild_id]);
      guildDeleted = true;
    } else if (mem.rank === 'leader') {
      await client.query(
        "UPDATE guild_members SET rank = 'leader' WHERE guild_id = $1 AND LOWER(username) = LOWER($2)",
        [mem.guild_id, others.rows[0].username]
      );
    }
    await client.query('COMMIT');
    return { guildDeleted, guildName: mem.name };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors; the original error is what matters
    }
    throw err;
  } finally {
    client.release();
  }
}

async function isInGuild(username) {
  const { rows } = await pool.query(
    'SELECT 1 FROM guild_members WHERE LOWER(username) = LOWER($1)',
    [username]
  );
  return rows.length > 0;
}
