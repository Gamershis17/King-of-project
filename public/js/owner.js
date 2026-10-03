(function() {
  const $ = (id) => document.getElementById(id);
  const api = async (path, opts) => {
    const r = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
    return r.json().then(j => ({ ok: r.ok, j }));
  };
  // Clock
  setInterval(() => { const c = $('owner-clock'); if (c) c.textContent = new Date().toLocaleString(); }, 1000);
  // Tabs
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    $('pane-' + b.dataset.tab).classList.remove('hidden');
  }));
  // Login
  $('login-btn').addEventListener('click', async () => {
    $('login-err').textContent = '';
    const { ok, j } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('login-user').value.trim(), password: $('login-pass').value }) });
    if (!ok || !j.user) { $('login-err').textContent = (j && j.error) || 'Login failed.'; return; }
    // Verify owner role
    const me = await api('/api/auth/me');
    const user = me.j && (me.j.user || me.j);
    if (!me.ok || !user || user.role !== 'owner') {
      $('login-err').textContent = '⛔ Owner only. Your role: ' + ((user && user.role) || 'unknown');
      await api('/api/auth/logout', { method: 'POST' });
      return;
    }
    $('login-pane').classList.add('hidden');
    $('owner-pane').classList.remove('hidden');
    $('owner-who').textContent = 'Signed in as ' + user.username + ' (owner)';
    loadAll();
  });
  async function loadAll() { loadRoster(); loadLive(); checkMaint(); setInterval(loadRoster, 30000); setInterval(loadLive, 15000); }
  async function loadRoster() {
    const box = $('owner-roster');
    try {
      const { ok, j } = await api('/api/gm/roster-live');
      if (!ok || !j.ok) throw 0;
      const fmtGold = (g) => g >= 1e33 ? (g/1e33).toFixed(1)+'Dc' : g >= 1e12 ? (g/1e12).toFixed(1)+'T' : g >= 1e9 ? (g/1e9).toFixed(1)+'B' : g >= 1e6 ? (g/1e6).toFixed(1)+'M' : g >= 1e3 ? (g/1e3).toFixed(1)+'K' : String(g);
      const fmtTime = (s) => { const h = Math.floor(s/3600), m = Math.floor(s%3600/60); return h > 0 ? h+'h '+m+'m' : m+'m'; };
      box.innerHTML = j.players.map(p =>
        `<div class="roster-row"><span class="${p.online ? 'online' : 'offline'}">${p.online ? '🟢' : '🔴'}</span>` +
        `<span class="nm">${esc(p.username)}</span>` +
        `<span class="meta">Lv ${p.level} · Stg ${p.stage} · 🗼${p.towerFloor} · 💰${fmtGold(p.gold)}</span>` +
        `<span class="meta">⏱️${fmtTime(p.playTime)} · 👑${p.bosses}</span>` +
        `<span class="meta">${p.online ? 'now' : new Date(p.lastSeen).toLocaleString()}</span></div>`).join('') || '<p style="color:#888">No players.</p>';
    } catch { box.innerHTML = '<p style="color:#f66">Failed to load.</p>'; }
  }
  async function loadLive() {
    const box = $('owner-live');
    try {
      const { ok, j } = await api('/api/gm/snapshots');
      if (!ok || !j.ok) throw 0;
      const snaps = Object.entries(j.snapshots || {});
      box.innerHTML = snaps.length ? snaps.map(([u, s]) =>
        `<div class="live-row"><span class="nm">${esc(u)}</span> <span class="act">${esc(s.action)}</span><br>` +
        `<span class="det">${esc(s.detail)}</span> <span class="ts">${new Date(s.ts).toLocaleTimeString()}</span></div>`).join('')
        : '<p style="color:#888">No active players.</p>';
    } catch { box.innerHTML = '<p style="color:#f66">Failed to load.</p>'; }
  }
  async function checkMaint() {
    try {
      const { ok, j } = await api('/api/status');
      const on = ok && j.maintenance;
      const st = $('maint-status');
      st.textContent = on ? '🔴 MAINTENANCE MODE' : '🟢 ONLINE';
      st.className = 'maint-status ' + (on ? 'on' : 'off');
    } catch {}
  }
  $('maint-on').addEventListener('click', async () => {
    const msg = $('maint-msg').value.trim() || 'Down for maintenance';
    if (!confirm('Take the game DOWN?')) return;
    await api('/api/gm/maintenance', { method: 'POST', body: JSON.stringify({ on: true, message: msg }) });
    checkMaint();
  });
  $('maint-off').addEventListener('click', async () => {
    if (!confirm('Bring the game back UP?')) return;
    await api('/api/gm/maintenance', { method: 'POST', body: JSON.stringify({ on: false }) });
    checkMaint();
  });
  // Powers
  $('pow-broadcast-btn').addEventListener('click', async () => {
    const msg = $('pow-broadcast').value.trim();
    if (!msg) return;
    const { ok, j } = await api('/api/gm/broadcast', { method: 'POST', body: JSON.stringify({ message: msg }) });
    $('powers-err').textContent = ok ? '✅ Sent!' : '❌ ' + ((j && j.error) || 'failed');
    if (ok) $('pow-broadcast').value = '';
  });
  $('pow-gold-btn').addEventListener('click', async () => {
    const u = $('pow-user').value.trim(), amt = Math.floor(Number($('pow-gold').value));
    if (!u || !amt) { $('powers-err').textContent = 'Enter username and amount.'; return; }
    const { ok, j } = await api('/api/gm/set-gold', { method: 'POST', body: JSON.stringify({ username: u, amount: amt }) });
    $('powers-err').textContent = ok ? `✅ Gave ${amt} gold to ${u}` : '❌ ' + ((j && j.error) || 'failed');
  });
  // OP gear
  $('op-forge').addEventListener('click', async () => {
    $('op-err').textContent = '';
    const username = $('op-user').value.trim(), name = $('op-name').value.trim();
    const stats = {};
    [['op-atk','attack'],['op-hp','maxHp'],['op-def','defense'],['op-crit','critChance'],['op-ls','lifesteal'],['op-spd','attackSpeed']].forEach(([id,k]) => {
      const v = Number($(id).value); if (Number.isFinite(v) && v !== 0) stats[k] = v;
    });
    if (!username || !name) { $('op-err').textContent = 'Enter username and item name.'; return; }
    if (!Object.keys(stats).length) { $('op-err').textContent = 'Enter at least one stat.'; return; }
    const { ok, j } = await api('/api/gm/create-op-gear', { method: 'POST', body: JSON.stringify({ username, name, slot: $('op-slot').value, rarity: $('op-rarity').value, stats }) });
    $('op-err').textContent = ok ? `✅ Forged "${name}" for ${username}!` : '❌ ' + ((j && j.error) || 'failed');
    $('op-err').style.color = ok ? '#4f4' : '#f66';
  });
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
})();
