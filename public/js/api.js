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
  gmCodes: () => request('/api/gm/codes'),
  gmCreateCode: (set, maxUses) => post('/api/gm/codes', { set, maxUses }),
  gmRoster: () => request('/api/gm/roster'),
  gmRosterUpdate: (username, action) => post('/api/gm/roster', { username, action }),
  setRole: (username, role) => post('/api/roles', { username, role }),
};
