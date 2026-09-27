// ============================================================
// guild.js — guild UI (create / join / roster / leave).
//
// Wiring (done by the parent, e.g. in the More tab):
//   import { renderGuildSection } from './guild.js';
//   renderGuildSection(document.getElementById('guild-section'), api);
//
// `api` may expose get(path)/post(path, body) helpers (like api.js), or
// be omitted entirely — this module falls back to same-origin fetch.
// ============================================================
import { Audio } from './audio.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

async function gget(api, path) {
  if (api && typeof api.get === 'function') return api.get(path);
  const res = await fetchWithTimeout(path, { credentials: 'same-origin' });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

async function gpost(api, path, body) {
  if (api && typeof api.post === 'function') return api.post(path, body);
  const res = await fetchWithTimeout(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

/**
 * fetch() with a timeout. The game is hosted on a free tier that cold-starts,
 * so without this a sleeping backend leaves the guild panel stuck on
 * "Loading guild…" indefinitely. On timeout the caller gets an AbortError,
 * which refresh() turns into a friendly message + Retry button.
 */
async function fetchWithTimeout(path, options = {}, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(path, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Reserved for future guild wiring (e.g. chat polling). Currently a no-op. */
export async function initGuild(api) {
  void api;
}

const STYLE = `
.guild-wrap { font-family: inherit; color: #e8e2f5; }
.guild-title { color: #e8b33c; font-weight: 700; font-size: 17px; margin: 0 0 8px; }
.guild-sub { color: #9d8cc7; font-size: 13px; margin: 0 0 10px; }
.guild-row { display: flex; gap: 8px; margin-bottom: 8px; }
.guild-input {
  flex: 1; min-width: 0;
  background: #0e0a1a; color: #e8e2f5;
  border: 1px solid #4a3573; border-radius: 8px;
  padding: 9px 10px; font-size: 14px;
}
.guild-input:focus { outline: none; border-color: #e8b33c; }
.guild-input.short { flex: 0 0 84px; }
/* Buttons now use the shared .btn / .btn.small classes from style.css. */
.guild-error {
  background: rgba(160, 40, 40, .18); border: 1px solid #a03a3a;
  color: #ffb3b3; border-radius: 8px; padding: 8px 10px;
  font-size: 13px; margin-bottom: 8px;
}
.guild-ok {
  background: rgba(60, 140, 60, .15); border: 1px solid #3f7d3f;
  color: #b5e6b5; border-radius: 8px; padding: 8px 10px;
  font-size: 13px; margin-bottom: 8px;
}
.guild-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; }
.guild-name { color: #e8b33c; font-weight: 800; font-size: 20px; margin: 0; }
.guild-tag {
  color: #0e0a1a; background: #e8b33c; font-weight: 800; font-size: 12px;
  border-radius: 6px; padding: 2px 8px;
}
.guild-meta { color: #9d8cc7; font-size: 12px; margin-bottom: 10px; }
.guild-roster { list-style: none; margin: 0 0 10px; padding: 0; }
.guild-roster li {
  display: flex; justify-content: space-between; align-items: center;
  padding: 7px 10px; border-radius: 8px; font-size: 14px;
}
.guild-roster li:nth-child(odd) { background: rgba(122, 90, 200, .08); }
.rank-pill {
  font-size: 11px; font-weight: 800; text-transform: uppercase;
  border-radius: 6px; padding: 2px 8px; letter-spacing: .5px;
}
.rank-pill.leader { background: #e8b33c; color: #0e0a1a; }
.rank-pill.member { background: #3a2d5c; color: #c9bdf0; }
.guild-loading { color: #9d8cc7; font-size: 14px; padding: 12px 0; }
`;

function ensureStyle(container) {
  if (container.querySelector('style[data-guild]')) return;
  const st = document.createElement('style');
  st.setAttribute('data-guild', '');
  st.textContent = STYLE;
  container.appendChild(st);
}

function rankPill(rank) {
  const r = rank === 'leader' ? 'leader' : 'member';
  return `<span class="rank-pill ${r}">${esc(r)}</span>`;
}

export function renderGuildSection(container, api) {
  if (!container) return;
  // Clear the static "Loading…" placeholder from index.html so it can't
  // linger above the panel.
  container.innerHTML = '';
  ensureStyle(container);
  const wrap = document.createElement('div');
  wrap.className = 'guild-wrap';
  container.appendChild(wrap);

  function note(html, cls) {
    const el = wrap.querySelector('.guild-note');
    if (el) el.remove();
    if (!html) return;
    const div = document.createElement('div');
    div.className = `guild-note ${cls}`;
    div.innerHTML = html;
    wrap.prepend(div);
  }

  async function refresh() {
    wrap.innerHTML = '<div class="guild-loading">Loading guild…</div>';
    let data;
    try {
      data = await gget(api, '/api/guilds/mine');
    } catch (err) {
      const msg = err && err.name === 'AbortError'
        ? 'The server is taking too long to respond (it may be waking up). Please try again.'
        : esc(err.message);
      wrap.innerHTML =
        `<div class="guild-error">${msg}</div>` +
        '<button class="btn small" data-act="retry">Retry</button>';
      wrap.querySelector('[data-act="retry"]').addEventListener('click', refresh);
      return;
    }
    if (data.guild) renderMember(data.guild, data.members || []);
    else renderGuest();
  }

  function renderGuest() {
    wrap.innerHTML = `
      <div class="card">
        <h3 class="guild-title">⚔️ Create a guild</h3>
        <p class="guild-sub">Found your own guild. You become its leader.</p>
        <div class="guild-row">
          <input class="guild-input" id="g-create-name" maxlength="20" placeholder="Guild name (3-20 chars)" autocomplete="off">
          <input class="guild-input short" id="g-create-tag" maxlength="4" placeholder="TAG" autocomplete="off">
          <button class="btn small gold" data-act="create">Create</button>
        </div>
      </div>
      <div class="card">
        <h3 class="guild-title">🛡️ Join a guild</h3>
        <p class="guild-sub">Enter the exact guild name to join.</p>
        <div class="guild-row">
          <input class="guild-input" id="g-join-name" maxlength="20" placeholder="Guild name" autocomplete="off">
          <button class="btn small" data-act="join">Join</button>
        </div>
      </div>`;

    wrap.querySelector('[data-act="create"]').addEventListener('click', async () => {
      note('', '');
      const name = wrap.querySelector('#g-create-name').value;
      const tag = wrap.querySelector('#g-create-tag').value;
      try {
        const res = await gpost(api, '/api/guilds', { name, tag });
        note(`Guild <b>${esc(res.guild.name)}</b> created!`, 'guild-ok');
        try { Audio.play('guild'); } catch { /* ignore */ }
        await refresh();
      } catch (err) {
        note(esc(err.message), 'guild-error');
      }
    });

    const doJoin = async () => {
      note('', '');
      const name = wrap.querySelector('#g-join-name').value;
      try {
        const res = await gpost(api, '/api/guilds/join', { name });
        note(`Joined <b>${esc(res.guild.name)}</b>!`, 'guild-ok');
        try { Audio.play('guild'); } catch { /* ignore */ }
        await refresh();
      } catch (err) {
        note(esc(err.message), 'guild-error');
      }
    };
    wrap.querySelector('[data-act="join"]').addEventListener('click', doJoin);
    wrap.querySelector('#g-join-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });
  }

  function renderMember(guild, members) {
    const rows = members
      .map((m) => `<li><span>${esc(m.username)}</span>${rankPill(m.rank)}</li>`)
      .join('');
    wrap.innerHTML = `
      <div class="card">
        <div class="guild-head">
          <h3 class="guild-name">${esc(guild.name)}</h3>
          <span class="guild-tag">[${esc(guild.tag)}]</span>
        </div>
        <div class="guild-meta">${members.length} member${members.length === 1 ? '' : 's'} · you are ${esc(guild.myRank || 'member')}</div>
        <ul class="guild-roster">${rows}</ul>
        <button class="btn small danger" data-act="leave">Leave guild</button>
      </div>`;

    wrap.querySelector('[data-act="leave"]').addEventListener('click', async () => {
      const lastOne = members.length === 1;
      const msg = lastOne
        ? `Leave and disband "${guild.name}"?`
        : `Leave "${guild.name}"?${guild.myRank === 'leader' ? ' Leadership passes to the longest-standing member.' : ''}`;
      if (!window.confirm(msg)) return;
      try {
        const res = await gpost(api, '/api/guilds/leave', {});
        note(
          res.guildDeleted
            ? `Guild <b>${esc(res.guildName)}</b> disbanded.`
            : `You left <b>${esc(res.guildName)}</b>.`,
          'guild-ok'
        );
        try { Audio.play('guild'); } catch { /* ignore */ }
        await refresh();
      } catch (err) {
        note(esc(err.message), 'guild-error');
      }
    });
  }

  refresh();
}
