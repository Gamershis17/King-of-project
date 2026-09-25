'use strict';

/**
 * King of Project — Express server entry point (PostgreSQL backend).
 *
 * Boot order: connect -> run schema migrations -> seed owner -> listen.
 * The process exits(1) if the database is unreachable, so a failed
 * migration never leaves the server running in a broken state.
 */

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const createSessionStore = require('./src/sessionStore');
const {
  pool,
  migrate,
  closePool,
  getUserByUsername,
  createUserWithRole,
  ownerExists,
} = require('./src/db');
const { authRouter } = require('./src/auth');
const { gameRouter } = require('./src/gameApi');
const { gmRouter } = require('./src/gmApi');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

// --- security / proxy ---
app.set('trust proxy', 1); // behind Render's HTTPS terminator
app.use(helmet());
app.disable('x-powered-by');

// --- body parsing ---
app.use(express.json({ limit: '1mb' }));

// --- session (PostgreSQL-backed via connect-pg-simple) ---
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (IS_PROD) {
    // Fail closed: a predictable session secret in production would let an
    // attacker forge session cookies for any account, including the owner.
    console.error(
      '[fatal] SESSION_SECRET is not set. Refusing to boot in production.'
    );
    process.exit(1);
  }
  sessionSecret = 'dev-secret-change-me';
  console.warn(
    '[warn] SESSION_SECRET is not set; using an insecure default. ' +
      'Set SESSION_SECRET in production.'
  );
}
app.use(
  session({
    store: createSessionStore(session),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD, // secure only behind HTTPS in production
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

// --- rate limit auth routes: 20 req/min per IP ---
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests. Try again in a minute.' },
});
app.use('/api/auth/', authLimiter);

// --- routes ---
app.use('/api/auth', authRouter);
app.use('/api', gameRouter);
app.use('/api', gmRouter);

// --- static frontend ---
app.use(express.static(path.join(__dirname, 'public')));

// --- 404 JSON handler (API + unknown paths) ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// --- error handler ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Body too large.' });
  }
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: 'Internal server error.' });
});

// --- owner seeding ---
async function seedOwnerIfNeeded() {
  if (await ownerExists()) {
    return { seeded: false, reason: 'owner already exists' };
  }
  const username = process.env.OWNER_USERNAME;
  const password = process.env.OWNER_PASSWORD;
  if (!username || !password) {
    return { seeded: false, reason: 'OWNER_USERNAME/OWNER_PASSWORD not set' };
  }
  const hash = bcrypt.hashSync(password, 10);
  await createUserWithRole(username.trim(), hash, 'owner');
  // NEVER log the password — only the username.
  return { seeded: true, username: username.trim() };
}

async function main() {
  // Fail fast if Postgres is unreachable or migrations break.
  await migrate();
  console.log('[db] schema ready');

  const ownerResult = await seedOwnerIfNeeded();

  const server = app.listen(PORT, () => {
    console.log('==============================================');
    console.log('  King of Project — server running (PostgreSQL)');
    console.log(`  Port:        ${PORT}`);
    console.log(`  Environment: ${NODE_ENV}`);
    console.log(
      `  Owner:       ${
        ownerResult.seeded
          ? `seeded as "${ownerResult.username}"`
          : `not seeded (${ownerResult.reason})`
      }`
    );
    console.log('==============================================');
  });

  // Clean shutdown: stop accepting, then drain the pg pool.
  const shutdown = (signal) => {
    console.log(`[shutdown] received ${signal}, closing...`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[fatal] failed to start:', err.message);
  if (!process.env.DATABASE_URL) {
    console.error(
      '[fatal] DATABASE_URL is not set and the default local database ' +
        '(postgres://localhost:5432/king_of_project) is unreachable. ' +
        'Set DATABASE_URL to your Postgres connection string (see README).'
    );
  }
  closePool()
    .catch(() => {})
    .finally(() => process.exit(1));
});
