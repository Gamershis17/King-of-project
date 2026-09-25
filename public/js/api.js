// ============================================================
// api.js — thin fetch wrapper over the contract HTTP API.
// All calls use credentials:'same-origin' and JSON.
// ============================================================

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function request(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options });
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const message = (data && (data.error || data.message)) ||
      `Request failed (HTTP ${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const post = (path, body) =>
  request(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body || {}) });

export const api = {
  // Auth
  register: (username, password) => post('/api/auth/register', { username, password }),
  login: (username, password) => post('/api/auth/login', { username, password }),
  logout: () => post('/api/auth/logout', {}),
  me: () => request('/api/auth/me'),

  // Server status (public — maintenance flag + message)
  status: () => request('/api/status'),

  // Public server settings (tunables like goldCap)
  getSettings: () => request('/api/settings'),

  // Player state
  getState: () => request('/api/state'),
  saveState: (state) => post('/api/state', { state }),
  // Best-effort save during page unload (sendBeacon includes same-origin cookies).
  saveStateBeacon: (state) => {
    try {
      const blob = new Blob([JSON.stringify({ state })], { type: 'application/json' });
      return navigator.sendBeacon('/api/state', blob);
    } catch {
      return false;
    }
  },

  // Leaderboard (no auth required)
  leaderboard: () => request('/api/leaderboard'),

  // Gift codes
  redeem: (code) => post('/api/redeem', { code }),

  // GM console (role owner|gm; role mgmt owner-only)
  gmOverview: () => request('/api/gm/overview'),
  gmGrant: (username, kind, extra) => post('/api/gm/grant', { username, kind, ...(extra || {}) }),
  gmGrantTitle: (username, titleId) => post('/api/gm/grant-title', { username, titleId }),
  gmSetBadge: (username, badge) => post('/api/gm/badge', { username, badge }),
  gmInfGold: (username, enabled) => post('/api/gm/inf-gold', { username, enabled }),
  gmSetSettings: (goldCap) => post('/api/gm/settings', { goldCap }),
  gmSetStage: (username, stage) => post('/api/gm/set-stage', { username, stage }),
  gmHeal: (username) => post('/api/gm/heal', { username }),
  gmReset: (username) => post('/api/gm/reset', { username }),
  gmCodes: () => request('/api/gm/codes'),
  gmCreateCode: (set, maxUses) => post('/api/gm/codes', { set, maxUses }),
  gmRoster: () => request('/api/gm/roster'),
  gmRosterUpdate: (username, action) => post('/api/gm/roster', { username, action }),
  // Player management (owner|admin)
  gmTitle: (username, title) => post('/api/gm/title', { username, title }),
  gmStage: (username, stage) => post('/api/gm/stage', { username, stage }),
  gmBan: (username) => post('/api/gm/ban', { username }),
  gmUnban: (username) => post('/api/gm/unban', { username }),
  gmResetPlayer: (username) => post('/api/gm/reset-player', { username }),
  // Moderation (owner|admin|moderator)
  gmBroadcast: (message) => post('/api/gm/broadcast', { message }),
  gmPlayers: (search, limit) =>
    request('/api/gm/players?search=' + encodeURIComponent(search || '') + '&limit=' + (limit || 50)),
  // Public broadcast feed
  latestBroadcast: () => request('/api/broadcasts/latest'),
  setRole: (username, role) => post('/api/roles', { username, role }),
};
