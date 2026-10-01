'use strict';

/**
 * Staff social page (/social.html) — owner/admin only:
 *   GET    /api/social/posts       — feed, newest first (limit 50)
 *   POST   /api/social/posts       — new post: { body, media[] }
 *   DELETE /api/social/posts/:id   — author or owner can delete
 *   GET    /api/social/profile     — own staff profile (auto-created)
 *   PUT    /api/social/profile     — { display_name, bio, avatar }
 *
 * Pictures are stored as data URLs (client resizes before upload).
 * Videos are not accepted yet — the media[] array shape leaves room for them.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireRole, asyncHandler } = require('./auth');
const { pool } = require('./db');

const adminPlus = requireRole('owner', 'admin');
const router = express.Router();

const MAX_BODY = 2000;
const MAX_MEDIA = 4;
const MAX_MEDIA_BYTES = 1200 * 1024;   // ~1.2MB decoded per picture
const MAX_AVATAR_BYTES = 400 * 1024;   // ~400KB decoded avatar
const MAX_STATUS = 60;
const ACCENTS = ['gold', 'purple', 'blue', 'green', 'red'];
const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function mediaBytes(dataUrl) {
  const b64 = dataUrl.split(',')[1] || '';
  return Math.floor(b64.length * 3 / 4);
}

function cleanImage(dataUrl, maxBytes) {
  if (typeof dataUrl !== 'string' || !dataUrl) return '';
  if (!IMG_RE.test(dataUrl)) return null;      // null = rejected
  if (mediaBytes(dataUrl) > maxBytes) return null;
  return dataUrl;
}

function parseMediaList(arr) {
  if (arr == null) return [];
  if (!Array.isArray(arr)) return null;
  if (arr.length > MAX_MEDIA) return null;
  const out = [];
  for (const m of arr) {
    const ok = cleanImage(m, MAX_MEDIA_BYTES);
    if (ok === null) return null;
    if (ok) out.push(ok);
  }
  return out;
}

async function getProfile(userId, username) {
  let r = await pool.query('SELECT user_id, username, display_name, bio, avatar, status, accent FROM staff_profiles WHERE user_id = $1', [userId]);
  if (!r.rows.length) {
    const now = Date.now();
    r = await pool.query(
      `INSERT INTO staff_profiles (user_id, username, display_name, bio, avatar, status, accent, updated_at)
       VALUES ($1, $2, $2, '', '', '', 'gold', $3)
       RETURNING user_id, username, display_name, bio, avatar, status, accent`,
      [userId, username, now]
    );
  }
  return r.rows[0];
}

// Posting spam protection: 20 posts/hour per staff member.
const postLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => (req.user && req.user.id ? `social:${req.user.id}` : req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many posts. Try again later.' },
});

// ---------- feed ----------
router.get('/social/posts', adminPlus, asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT id, username, display_name, avatar, accent, role, body, media, created_at
     FROM social_posts ORDER BY created_at DESC LIMIT 50`
  );
  res.json({
    ok: true,
    posts: r.rows.map((p) => ({
      id: p.id,
      username: p.username,
      display_name: p.display_name,
      avatar: p.avatar,
      accent: p.accent,
      role: p.role,
      body: p.body,
      media: JSON.parse(p.media || '[]'),
      created_at: p.created_at,
    })),
  });
}));

router.post('/social/posts', adminPlus, postLimiter, asyncHandler(async (req, res) => {
  const body = String((req.body && req.body.body) || '').slice(0, MAX_BODY).trim();
  const media = parseMediaList(req.body && req.body.media);
  if (!body && (!media || !media.length)) {
    return res.status(400).json({ error: 'Write something or add a picture.' });
  }
  if (media === null) {
    return res.status(400).json({ error: 'Pictures must be JPEG/PNG/WebP and fit the size limit.' });
  }
  const prof = await getProfile(req.user.id, req.user.username);
  const now = Date.now();
  const r = await pool.query(
    `INSERT INTO social_posts (user_id, username, display_name, avatar, accent, role, body, media, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, created_at`,
    [req.user.id, req.user.username, prof.display_name, prof.avatar, prof.accent,
     req.user.role, body, JSON.stringify(media || []), now]
  );
  res.json({ ok: true, id: r.rows[0].id, created_at: r.rows[0].created_at });
}));

router.delete('/social/posts/:id', adminPlus, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Bad post id.' });
  const r = await pool.query('SELECT user_id FROM social_posts WHERE id = $1', [id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Post not found.' });
  const isOwner = req.user.role === 'owner';
  const isAuthor = r.rows[0].user_id === req.user.id;
  if (!isOwner && !isAuthor) return res.status(403).json({ error: 'Only the author or owner can delete this.' });
  await pool.query('DELETE FROM social_posts WHERE id = $1', [id]);
  res.json({ ok: true });
}));

// ---------- profiles ----------
router.get('/social/profile', adminPlus, asyncHandler(async (req, res) => {
  const prof = await getProfile(req.user.id, req.user.username);
  res.json({ ok: true, profile: prof });
}));

router.put('/social/profile', adminPlus, asyncHandler(async (req, res) => {
  const displayName = String((req.body && req.body.display_name) || '').slice(0, 40).trim();
  const bio = String((req.body && req.body.bio) || '').slice(0, 200).trim();
  const status = String((req.body && req.body.status) || '').slice(0, MAX_STATUS).trim();
  const accent = ACCENTS.includes(req.body && req.body.accent) ? req.body.accent : 'gold';
  let avatar;
  if (req.body && req.body.avatar !== undefined && req.body.avatar !== null) {
    if (req.body.avatar === '') {
      avatar = ''; // explicit clear
    } else {
      const ok = cleanImage(req.body.avatar, MAX_AVATAR_BYTES);
      if (ok === null) {
        return res.status(400).json({ error: 'Avatar must be a JPEG/PNG/WebP picture within the size limit.' });
      }
      avatar = ok;
    }
  } else {
    // Avatar omitted (settings saved without picking a new picture): keep the existing one.
    const existing = await getProfile(req.user.id, req.user.username);
    avatar = existing.avatar || '';
  }
  const now = Date.now();
  await pool.query(
    `INSERT INTO staff_profiles (user_id, username, display_name, bio, avatar, status, accent, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name, bio = EXCLUDED.bio,
       avatar = EXCLUDED.avatar, status = EXCLUDED.status,
       accent = EXCLUDED.accent, updated_at = EXCLUDED.updated_at`,
    [req.user.id, req.user.username, displayName || req.user.username, bio, avatar, status, accent, now]
  );
  res.json({ ok: true });
}));

module.exports = { socialRouter: router };
