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
  // Login (click or Enter)
  const doLogin = async () => {
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
  };
  $('login-btn').addEventListener('click', doLogin);
  $('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('login-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  async function loadAll() {
    loadRoster(); checkMaint();
    setInterval(loadRoster, 30000);
    initMultipliers();
    initPlayerModal();
    initProgression();
    initGearFactory();
    initGiveTools();
  }
  // Give tools (quick grants + clear bags)
  function initGiveTools() {
    const err = $('give-err');
    const getUser = () => (($('give-user') || {}).value || '').trim();
    const showErr = (msg, ok) => {
      err.style.color = ok ? '#4f4' : '#f66';
      err.textContent = msg;
    };
    const needUser = () => {
      const u = getUser();
      if (!u) { showErr('❌ Enter a target username.'); return null; }
      return u;
    };
    const bind = (id, fn) => {
      const btn = $(id);
      if (btn && !btn.dataset.wired) { btn.dataset.wired = '1'; btn.addEventListener('click', fn); }
    };
    bind('give-gold-btn', async () => {
      const u = needUser(); if (!u) return;
      const amt = parseInt(($('give-gold') || {}).value) || 0;
      if (amt <= 0) { showErr('❌ Enter a gold amount.'); return; }
      try {
        const { ok, j } = await api('/api/gm/set-gold', { method: 'POST', body: JSON.stringify({ username: u, amount: amt }) });
        if (!ok || !j.ok) throw new Error((j && j.error) || 'failed');
        showErr(`✅ Gave ${amt.toLocaleString()} gold to ${u}`, true);
        logAudit(`Give gold: ${amt} → ${u}`);
      } catch (e) { showErr('❌ ' + e.message); }
    });
    bind('give-rebirth-btn', async () => {
      const u = needUser(); if (!u) return;
      const amt = parseInt(($('give-rebirth') || {}).value) || 0;
      if (amt <= 0) { showErr('❌ Enter a token amount.'); return; }
      try {
        const { ok, j } = await api('/api/gm/set-rebirth', { method: 'POST', body: JSON.stringify({ username: u, count: amt }) });
        if (!ok || !j.ok) throw new Error((j && j.error) || 'failed');
        showErr(`✅ Gave ${amt} rebirth tokens to ${u}`, true);
        logAudit(`Give tokens: ${amt} → ${u}`);
      } catch (e) { showErr('❌ ' + e.message); }
    });
    bind('give-buff-btn', async () => {
      const u = needUser(); if (!u) return;
      try {
        for (const type of ['damage', 'xp', 'gold']) {
          await api('/api/gm/grant-buff', { method: 'POST', body: JSON.stringify({ username: u, buffType: type, value: 50, duration: 3600 }) });
        }
        showErr(`✅ +50% damage/XP/gold (1h) → ${u}`, true);
        logAudit(`Buffs granted → ${u}`);
      } catch (e) { showErr('❌ ' + e.message); }
    });
    bind('give-heal-btn', async () => {
      const u = needUser(); if (!u) return;
      try {
        const { ok, j } = await api('/api/gm/heal', { method: 'POST', body: JSON.stringify({ username: u }) });
        if (!ok || !j.ok) throw new Error((j && j.error) || 'failed');
        showErr(`✅ Healed ${u}`, true);
        logAudit(`Heal → ${u}`);
      } catch (e) { showErr('❌ ' + e.message); }
    });
    bind('give-clear-btn', async () => {
      const u = needUser(); if (!u) return;
      if (!confirm(`Clear ${u}'s bags? (keeps equipped items)`)) return;
      try {
        const { ok, j } = await api('/api/gm/clear-bags', { method: 'POST', body: JSON.stringify({ username: u }) });
        if (!ok || !j.ok) throw new Error((j && j.error) || 'failed');
        showErr(`✅ Cleared ${u}'s bags`, true);
        logAudit(`Clear bags → ${u}`);
      } catch (e) { showErr('❌ ' + e.message); }
    });
  }
  // Live progression overrides
  function initProgression() {
    const btn = $('prog-apply');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      const err = $('prog-err');
      err.textContent = '';
      const username = ($('prog-user') || {}).value.trim();
      if (!username) { err.textContent = '❌ Enter a target username.'; return; }
      const level = ($('prog-level') || {}).value.trim();
      const xp = ($('prog-xp') || {}).value.trim();
      const stage = ($('prog-stage') || {}).value.trim();
      const tower = ($('prog-tower') || {}).value.trim();
      if (!level && !xp && !stage && !tower) { err.textContent = '⚠️ Enter at least one value.'; return; }
      const ops = [];
      try {
        if (level) {
          const { ok, j } = await api('/api/gm/set-level', { method: 'POST', body: JSON.stringify({ username, level: parseInt(level) }) });
          if (!ok || !j.ok) throw new Error('Level: ' + ((j && j.error) || 'failed'));
          ops.push('Lv ' + level);
        }
        if (xp) {
          const { ok, j } = await api('/api/gm/set-xp', { method: 'POST', body: JSON.stringify({ username, amount: parseInt(xp) }) });
          if (!ok || !j.ok) throw new Error('XP: ' + ((j && j.error) || 'failed'));
          ops.push('+' + xp + ' XP');
        }
        if (stage) {
          const { ok, j } = await api('/api/gm/set-stage', { method: 'POST', body: JSON.stringify({ username, stage: parseInt(stage) }) });
          if (!ok || !j.ok) throw new Error('Stage: ' + ((j && j.error) || 'failed'));
          ops.push('Stage ' + stage);
        }
        if (tower) {
          const { ok, j } = await api('/api/gm/set-tower', { method: 'POST', body: JSON.stringify({ username, floor: parseInt(tower) }) });
          if (!ok || !j.ok) throw new Error('Tower: ' + ((j && j.error) || 'failed'));
          ops.push('Tower ' + tower);
        }
        err.style.color = '#4f4';
        err.textContent = `✅ Applied to ${username}: ${ops.join(' · ')}`;
        logAudit(`Progression: ${ops.join(', ')} → ${username}`);
        loadRoster();
      } catch (e) { err.style.color = '#f66'; err.textContent = '❌ ' + e.message; }
    });
  }
  // Custom gear factory
  function initGearFactory() {
    const btn = $('gear-forge');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      const err = $('gear-err');
      err.textContent = '';
      const username = ($('gear-user') || {}).value.trim();
      const slot = ($('gear-slot') || {}).value;
      const name = ($('gear-name') || {}).value.trim();
      const atk = parseInt(($('gear-atk') || {}).value) || 0;
      const def = parseInt(($('gear-def') || {}).value) || 0;
      if (!username) { err.textContent = '❌ Enter a target username.'; return; }
      if (!name) { err.textContent = '❌ Enter a custom item name.'; return; }
      try {
        const { ok, j } = await api('/api/gm/create-op-gear', {
          method: 'POST',
          body: JSON.stringify({ username, name, slot, rarity: 'mythic', stats: { atk, def } }),
        });
        if (!ok || !j.ok) throw new Error((j && j.error) || 'failed');
        err.style.color = '#4f4';
        err.textContent = `✅ Forged "${name}" → ${username}`;
        logAudit(`Custom gear: "${name}" (${slot}) → ${username}`);
      } catch (e) { err.style.color = '#f66'; err.textContent = '❌ ' + e.message; }
    });
  }
  // Player snapshots for inspector
  // Audit log helper (local console logging)
  function logAudit(msg) {
    try { console.log('[owner]', new Date().toLocaleTimeString(), msg); } catch {}
  }
  // Economy multipliers
  function initMultipliers() {
    const pairs = [['xp'], ['gold'], ['drop']];
    pairs.forEach(([name]) => {
      const slider = $('mult-' + name + '-slider');
      const num = $('mult-' + name);
      if (slider && num) {
        slider.addEventListener('input', () => { num.value = slider.value; });
        num.addEventListener('input', () => { slider.value = num.value; });
      }
    });
    // Load current values
    api('/api/settings').then(({ ok, j }) => {
      if (!ok || !j) return;
      try {
        const buff = j.event_buff ? JSON.parse(j.event_buff) : null;
        if (buff) {
          if ($('mult-xp')) { $('mult-xp').value = buff.xpMult || 1; $('mult-xp-slider').value = buff.xpMult || 1; }
          if ($('mult-gold')) { $('mult-gold').value = buff.goldMult || 1; $('mult-gold-slider').value = buff.goldMult || 1; }
          if (buff.dropMult && $('mult-drop')) { $('mult-drop').value = buff.dropMult; $('mult-drop-slider').value = buff.dropMult; }
        }
      } catch {}
    });
    const applyBtn = $('mult-apply');
    if (applyBtn && !applyBtn.dataset.wired) {
      applyBtn.dataset.wired = '1';
      applyBtn.addEventListener('click', async () => {
        const err = $('mult-err');
        err.textContent = '';
        const xpMult = parseFloat($('mult-xp').value) || 1;
        const goldMult = parseFloat($('mult-gold').value) || 1;
        const dropMult = parseFloat($('mult-drop').value) || 1;
        const hours = parseInt($('mult-hours').value) || 0;
        try {
          const { ok, j } = await api('/api/gm/event-buff', {
            method: 'POST',
            body: JSON.stringify({ xpMult, goldMult, dropMult, hours, label: 'Owner Dashboard' }),
          });
          if (!ok || !j.ok) throw new Error((j && j.error) || 'Failed');
          err.style.color = '#4f4';
          err.textContent = hours === 0 ? '✅ Multipliers cleared.' : `✅ Set to ${xpMult}x XP / ${goldMult}x Gold / ${dropMult}x Drop for ${hours}h.`;
          logAudit(`Multipliers adjusted: ${xpMult}x XP, ${goldMult}x Gold, ${dropMult}x Drop`);
        } catch (e) { err.style.color = '#f66'; err.textContent = '❌ ' + e.message; }
      });
    }
  }
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
        `<span class="meta">${p.online ? 'now' : new Date(p.lastSeen).toLocaleString()}</span>` +
        `<select data-role-for="${esc(p.username)}" data-uid="${p.id}" style="background:#111;color:#fff;border:1px solid #555;border-radius:4px;padding:2px 4px;font-size:11px">` +
        ['player','tester','moderator','admin','gm'].map(r => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${r}</option>`).join('') +
        `</select></div>`).join('') || '<p style="color:#888">No players.</p>';
      // Wire role change handlers
      box.querySelectorAll('select[data-uid]').forEach(sel => {
        sel.addEventListener('change', async (e) => {
          e.stopPropagation();
          const username = sel.dataset.roleFor;
          const role = sel.value;
          if (!confirm(`Set ${username}'s role to ${role}?`)) { loadRoster(); return; }
          try {
            const { ok, j } = await api('/api/roles', { method: 'POST', body: JSON.stringify({ username, role }) });
            if (!ok || !j.ok) throw new Error(j.error || 'Failed');
            alert('Role updated!');
          } catch (e) { alert('Error: ' + e.message); loadRoster(); }
        });
        // Don't open modal when clicking the dropdown
        sel.addEventListener('click', (e) => e.stopPropagation());
      });
      // Wire roster row clicks to open tactical modal
      box.querySelectorAll('.roster-row').forEach(row => {
        row.addEventListener('click', () => {
          const sel = row.querySelector('select[data-role-for]');
          const username = sel ? sel.dataset.roleFor : null;
          if (username) openPlayerModal(username);
        });
      });
    } catch { box.innerHTML = '<p style="color:#f66">Failed to load.</p>'; }
  }
  // Tactical player edit modal
  let modalPlayer = '';
  function openPlayerModal(username) {
    modalPlayer = username;
    $('modal-player-name').textContent = 'Target: ' + username;
    $('modal-gold').value = ''; $('modal-level').value = '';
    $('modal-stage').value = ''; $('modal-rebirth').value = '';
    $('modal-err').textContent = '';
    $('player-edit-modal').classList.add('open');
  }
  function closePlayerModal() {
    $('player-edit-modal').classList.remove('open');
    modalPlayer = '';
  }
  function initPlayerModal() {
    const closeBtn = $('modal-close');
    if (closeBtn && !closeBtn.dataset.wired) {
      closeBtn.dataset.wired = '1';
      closeBtn.addEventListener('click', closePlayerModal);
    }
    // Close on backdrop click
    const modal = $('player-edit-modal');
    if (modal && !modal.dataset.wired) {
      modal.dataset.wired = '1';
      modal.addEventListener('click', (e) => { if (e.target === modal) closePlayerModal(); });
    }
    // Close on Escape
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePlayerModal(); });
    // Apply modifications
    const applyBtn = $('modal-apply');
    if (applyBtn && !applyBtn.dataset.wired) {
      applyBtn.dataset.wired = '1';
      applyBtn.addEventListener('click', async () => {
        const err = $('modal-err');
        err.textContent = '';
        if (!modalPlayer) { err.textContent = '❌ No player selected.'; return; }
        const ops = [];
        const gold = $('modal-gold').value.trim();
        const level = $('modal-level').value.trim();
        const stage = $('modal-stage').value.trim();
        const rebirth = $('modal-rebirth').value.trim();
        try {
          if (gold) {
            const { ok, j } = await api('/api/gm/set-gold', { method: 'POST', body: JSON.stringify({ username: modalPlayer, gold: parseInt(gold) }) });
            if (!ok || !j.ok) throw new Error('Gold: ' + ((j && j.error) || 'failed'));
            ops.push('gold');
          }
          if (level) {
            const { ok, j } = await api('/api/gm/set-level', { method: 'POST', body: JSON.stringify({ username: modalPlayer, level: parseInt(level) }) });
            if (!ok || !j.ok) throw new Error('Level: ' + ((j && j.error) || 'failed'));
            ops.push('level');
          }
          if (stage) {
            const { ok, j } = await api('/api/gm/set-stage', { method: 'POST', body: JSON.stringify({ username: modalPlayer, stage: parseInt(stage) }) });
            if (!ok || !j.ok) throw new Error('Stage: ' + ((j && j.error) || 'failed'));
            ops.push('stage');
          }
          if (rebirth) {
            const { ok, j } = await api('/api/gm/set-rebirth', { method: 'POST', body: JSON.stringify({ username: modalPlayer, count: parseInt(rebirth) }) });
            if (!ok || !j.ok) throw new Error('Rebirth: ' + ((j && j.error) || 'failed'));
            ops.push('rebirth');
          }
          err.style.color = '#4f4';
          err.textContent = ops.length ? `✅ Applied: ${ops.join(', ')}` : '⚠️ No values entered.';
          logAudit(`Player edit: ${ops.join(', ') || 'no-op'} → ${modalPlayer}`);
          loadRoster();
        } catch (e) { err.style.color = '#f66'; err.textContent = '❌ ' + e.message; }
      });
    }
    // Quick actions
    const quickBuff = $('modal-buff-btn');
    if (quickBuff && !quickBuff.dataset.wired) {
      quickBuff.dataset.wired = '1';
      quickBuff.addEventListener('click', async () => {
        if (!modalPlayer) return;
        const err = $('modal-err');
        try {
          const { ok, j } = await api('/api/gm/grant-buff', { method: 'POST', body: JSON.stringify({ username: modalPlayer, buffType: 'damage', value: 50, duration: 300 }) });
          if (!ok || !j.ok) throw new Error((j && j.error) || 'failed');
          err.style.color = '#4f4'; err.textContent = '✅ +50% damage buff (5min) injected.';
          logAudit(`Buff injected → ${modalPlayer}`);
        } catch (e) { err.style.color = '#f66'; err.textContent = '❌ ' + e.message; }
      });
    }
    const quickGear = $('modal-gear-btn');
    if (quickGear && !quickGear.dataset.wired) {
      quickGear.dataset.wired = '1';
      quickGear.addEventListener('click', async () => {
        if (!modalPlayer) return;
        const err = $('modal-err');
        try {
          const { ok, j } = await api('/api/gm/give-gear-set', { method: 'POST', body: JSON.stringify({ username: modalPlayer, setId: 'sovereign' }) });
          if (!ok || !j.ok) throw new Error((j && j.error) || 'failed');
          err.style.color = '#4f4'; err.textContent = '✅ Sovereign gear set granted.';
          logAudit(`Gear granted → ${modalPlayer}`);
        } catch (e) { err.style.color = '#f66'; err.textContent = '❌ ' + e.message; }
      });
    }
    const quickHeal = $('modal-heal-btn');
    if (quickHeal && !quickHeal.dataset.wired) {
      quickHeal.dataset.wired = '1';
      quickHeal.addEventListener('click', async () => {
        if (!modalPlayer) return;
        const err = $('modal-err');
        try {
          const { ok, j } = await api('/api/gm/heal', { method: 'POST', body: JSON.stringify({ username: modalPlayer }) });
          if (!ok || !j.ok) throw new Error((j && j.error) || 'failed');
          err.style.color = '#4f4'; err.textContent = '✅ Health fully restored.';
          logAudit(`Heal → ${modalPlayer}`);
        } catch (e) { err.style.color = '#f66'; err.textContent = '❌ ' + e.message; }
      });
    }
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
  $('pow-level-btn').addEventListener('click', async () => {
    const u = $('pow-user').value.trim(), lvl = Math.floor(Number($('pow-level').value));
    if (!u || !lvl) { $('powers-err').textContent = 'Enter username and level.'; return; }
    const { ok, j } = await api('/api/gm/set-level', { method: 'POST', body: JSON.stringify({ username: u, level: lvl }) });
    $('powers-err').textContent = ok ? `✅ Set ${u} to level ${lvl}` : '❌ ' + ((j && j.error) || 'failed');
  });
  $('pow-xp-btn').addEventListener('click', async () => {
    const u = $('pow-user').value.trim(), xp = Math.floor(Number($('pow-xp').value));
    if (!u || !xp) { $('powers-err').textContent = 'Enter username and XP.'; return; }
    const { ok, j } = await api('/api/gm/set-xp', { method: 'POST', body: JSON.stringify({ username: u, amount: xp }) });
    $('powers-err').textContent = ok ? `✅ Gave ${xp} XP to ${u}` : '❌ ' + ((j && j.error) || 'failed');
  });
  $('pow-stage-btn').addEventListener('click', async () => {
    const u = $('pow-user').value.trim(), stage = Math.floor(Number($('pow-stage').value));
    if (!u || !stage) { $('powers-err').textContent = 'Enter username and stage.'; return; }
    const { ok, j } = await api('/api/gm/set-stage', { method: 'POST', body: JSON.stringify({ username: u, stage }) });
    $('powers-err').textContent = ok ? `✅ Set ${u} to stage ${stage}` : '❌ ' + ((j && j.error) || 'failed');
  });
  $('pow-tower-btn').addEventListener('click', async () => {
    const u = $('pow-user').value.trim(), floor = Math.floor(Number($('pow-tower').value));
    if (!u || !floor) { $('powers-err').textContent = 'Enter username and floor.'; return; }
    const { ok, j } = await api('/api/gm/set-tower', { method: 'POST', body: JSON.stringify({ username: u, floor }) });
    $('powers-err').textContent = ok ? `✅ Set ${u} to tower floor ${floor}` : '❌ ' + ((j && j.error) || 'failed');
  });
  $('pow-clear-btn').addEventListener('click', async () => {
    const u = $('pow-user').value.trim();
    if (!u) { $('powers-err').textContent = 'Enter username.'; return; }
    if (!confirm(`Clear ${u}'s bags? (Keeps equipped + unsellable)`)) return;
    const { ok, j } = await api('/api/gm/clear-bags', { method: 'POST', body: JSON.stringify({ username: u }) });
    $('powers-err').textContent = ok ? `✅ Cleared ${j.cleared} items from ${u}'s bags` : '❌ ' + ((j && j.error) || 'failed');
  });
  $('pow-gear-btn').addEventListener('click', async () => {
    const u = $('pow-gear-user').value.trim(), setId = $('pow-gear-set').value;
    if (!u) { $('powers-err').textContent = 'Enter username.'; return; }
    const { ok, j } = await api('/api/gm/give-gear-set', { method: 'POST', body: JSON.stringify({ username: u, setId }) });
    $('powers-err').textContent = ok ? `✅ Gave ${setId} set (${j.granted.length} pieces) to ${u}` : '❌ ' + ((j && j.error) || 'failed');
  });
  $('pow-buff-btn').addEventListener('click', async () => {
    const u = $('pow-buff-user').value.trim(), buffType = $('pow-buff-type').value;
    const value = Number($('pow-buff-val').value) || 0, duration = Number($('pow-buff-dur').value) || 30;
    if (!u) { $('powers-err').textContent = 'Enter username.'; return; }
    const { ok, j } = await api('/api/gm/grant-buff', { method: 'POST', body: JSON.stringify({ username: u, buffType, value, duration }) });
    $('powers-err').textContent = ok ? `✅ ${j.buff.name} → ${u}${j.live ? ' [LIVE!]' : ' (offline, applies on login)'}` : '❌ ' + ((j && j.error) || 'failed');
  });
  // Buffs tab (dedicated)
  $('buff-grant-btn').addEventListener('click', async () => {
    const u = $('buff-user').value.trim(), buffType = $('buff-type').value;
    const value = Number($('buff-val').value) || 0, duration = Number($('buff-dur').value) || 30;
    if (!u) { $('buffs-err').textContent = 'Enter username.'; return; }
    const { ok, j } = await api('/api/gm/grant-buff', { method: 'POST', body: JSON.stringify({ username: u, buffType, value, duration }) });
    $('buffs-err').textContent = ok ? `✅ ${j.buff.name} → ${u}${j.live ? ' [LIVE!]' : ' (offline, applies on login)'}` : '❌ ' + ((j && j.error) || 'failed');
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
