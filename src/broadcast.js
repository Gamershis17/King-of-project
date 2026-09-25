'use strict';

/**
 * Broadcast announcements.
 *
 * Owns its own `broadcasts` table (created lazily on first use) so the
 * game schema in src/schema.sql / src/db.js stays untouched.
 *
 *   broadcasts(id SERIAL PK, message TEXT, created_by TEXT,
 *              created_at TIMESTAMPTZ DEFAULT now())
 */

const { pool } = require('./db');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS broadcasts (
      id SERIAL PRIMARY KEY,
      message TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
}

async function addBroadcast(message, createdBy) {
  await ensureTable();
  const { rows } = await pool.query(
    'INSERT INTO broadcasts (message, created_by) VALUES ($1, $2) RETURNING id, message, created_by, created_at',
    [message, createdBy]
  );
  return rows[0];
}

async function latestBroadcast() {
  await ensureTable();
  const { rows } = await pool.query(
    'SELECT id, message, created_by, created_at FROM broadcasts ORDER BY id DESC LIMIT 1'
  );
  return rows[0] || null;
}

module.exports = { addBroadcast, latestBroadcast };
