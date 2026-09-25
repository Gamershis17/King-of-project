'use strict';

/**
 * Auth routes: POST /api/auth/register, /login, /logout, GET /api/auth/me.
 * Also exports requireAuth and requireRole(role...) middleware.
 * All database access is async (PostgreSQL).
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const {
  getUserByUsername,
  getUserById,
  createUser,
} = require('./db');
const { validateUsername, validatePassword } = require('./validation');

const BCRYPT_ROUNDS = 10;
const router = express.Router();

// Brute-force protection on top of the general /api/auth limiter in
// server.js: 10 FAILED logins per 15 minutes per IP. Successful logins
// don't count (skipSuccessfulRequests), so real players are unaffected.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many failed login attempts. Try again in 15 minutes.' },
});

// Mass-registration protection: 10 new accounts per hour per IP.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registrations from this address. Try again later.' },
});

function publicUser(user) {
  return { username: user.username, role: user.role };
}

/** Wrap an async route/middleware so rejections go to Express error handling. */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ---------- middleware ----------
async function requireAuth(req, res, next) {
  try {
    const userId = req.session && req.session.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not signed in.' });
    }
    const user = await getUserById(userId);
    if (!user) {
      // Account deleted while a session was active.
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Not signed in.' });
    }
    if (user.banned) {
      // Ban takes effect immediately, even on pre-existing sessions.
      req.session.destroy(() => {});
      return res.status(403).json({ error: 'This account has been banned.' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Require the signed-in user to hold one of the given roles. */
function requireRole(...roles) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden: insufficient role.' });
      }
      next();
    });
  };
}

// ---------- routes ----------
router.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};

    const usernameError = validateUsername(username);
    if (usernameError) return res.status(400).json({ error: usernameError });
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const cleanUsername = String(username).trim();
    if (await getUserByUsername(cleanUsername)) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    const user = await createUser(cleanUsername, passwordHash);

    // Fresh session id on register, same as login (session fixation).
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Session error.' });
      req.session.userId = user.id;
      res.status(201).json({ user: publicUser(user) });
    });
  })
);

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const user = await getUserByUsername(username.trim());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      // Same message either way: don't reveal which part failed.
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    if (user.banned) {
      return res.status(403).json({ error: 'This account has been banned.' });
    }
    // Fresh session id on login to prevent session fixation.
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Session error.' });
      req.session.userId = user.id;
      res.json({ user: publicUser(user) });
    });
  })
);

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed.' });
    res.clearCookie('connect.sid', { path: '/' });
    res.json({ ok: true });
  });
});

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const userId = req.session && req.session.userId;
    if (!userId) return res.status(401).json({ error: 'Not signed in.' });
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    res.json({ user: publicUser(user) });
  })
);

module.exports = {
  authRouter: router,
  requireAuth,
  requireRole,
  asyncHandler,
};
