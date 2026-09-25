// ============================================================
// gm.js — GM console UI. Only opened for staff roles.
// ============================================================
import { api } from './api.js';
import { UI, esc, formatNum } from './ui.js';
import { PRIVILEGED_SETS, TITLES, BADGES, CLASSES, SPECS } from './engine.js';

const SET_IDS = Object.keys(PRIVILEGED_SETS);

// Staff tiers for the console. Server re-checks every route; this only
// decides which cards to render.
const canGm = (role) => role === 'owner' || role === 'gm';          // grant endpoints
const canAdmin = (role) => role === 'owner' || role === 'admin';     // player-mgmt endpoints
const canMod = (role) => canAdmin(role) || role === 'moderator';     // moderation endpoints

export const GM = {
  me: null,

  open(me) {
    this.me = me;
    const role = (me && me.role) || 'player';
    if (!canGm(role) && !canMod(role)) {
      UI.toast('GM console is for staff only.', 'error');
      return;
    }
    UI.showView('gm');
    this.render();
  },

  async render() {
    const root = document.getElementById('gm-content');
    root.innerHTML = '<p class="muted">Loading console…</p>';
    // /gm/overview is gm|owner only; admins/moderators get a slim header.
    let ov;
    try {
      ov = await api.gmOverview();
    } catch (e) {
      ov = { role: this.me.role, playerCount: null, codeCount: null };
    }
    try {
      root.innerHTML = this.template(ov);
      this.bind(root);
      if (canGm(this.me.role)) {
        await Promise.all([this.refreshCodes(root), this.refreshRoster(root)]);
      }
    } catch (e) {
      root.innerHTML = `<p class="error">Couldn't load GM console: ${esc(e.message)}</p>`;
    }
  },

  template(ov) {
    const role = this.me.role;
    const isOwner = role === 'owner';
    const gm = canGm(role);
    const admin = canAdmin(role);
    const mod = canMod(role);
    const num = (v) => (v == null ? '—' : formatNum(v));
    const setOptions = SET_IDS.map(id => {
      const locked = id === 'sovereign' && !isOwner;
      return `<option value="${id}" ${locked ? 'disabled' : ''}>${esc(PRIVILEGED_SETS[id].name)}${locked ? ' (owner only)' : ''}</option>`;
    }).join('');
    const titleOptions = TITLES.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    return `
      <div class="gm-cards">
        <div class="gm-card"><div class="gm-num">${num(ov.playerCount)}</div><div class="muted small">players</div></div>
        <div class="gm-card"><div class="gm-num">${num(ov.codeCount)}</div><div class="muted small">gift codes</div></div>
        <div class="gm-card"><div class="gm-num">${esc(ov.role)}</div><div class="muted small">your role</div></div>
      </div>

      ${gm ? `
      <div class="card"><h3>🎁 Grant to player</h3>
        <label class="fld"><span>Username</span><input id="gm-grant-user" placeholder="player name" autocomplete="off"></label>
        <div class="row">
          <label class="fld"><span>Kind</span>
            <select id="gm-grant-kind">
              <option value="stars">⭐ Stars</option>
              <option value="gold">💰 Gold</option>
              <option value="levels">⬆️ Levels</option>
              <option value="xp">✨ XP</option>
              <option value="gear">👑 Gear set</option>
            </select></label>
          <label class="fld" id="gm-grant-amount-wrap"><span id="gm-grant-amount-label">Amount (1–100000)</span>
            <input id="gm-grant-amount" type="number" min="1" max="1000000" value="100"></label>
          <label class="fld hidden" id="gm-grant-set-wrap"><span>Gear set</span>
            <select id="gm-grant-set">${setOptions}</select></label>
        </div>
        <button id="gm-grant-btn" class="btn gold wide">Grant</button>
        <p class="muted small">Gear grants add the full 5-piece set to the player's inventory. Sovereign set is owner-only.</p>
      </div>
      ` : ''}

      ${gm ? `
      <div class="card"><h3>⚡ Quick commands</h3>
        <label class="fld"><span>Username</span><input id="gm-cmd-user" placeholder="player name" autocomplete="off"></label>
        <div class="row">
          <label class="fld"><span>Grant title</span>
            <select id="gm-cmd-title">${TITLES.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
          <label class="fld"><span>Set stage (1–10000)</span>
            <input id="gm-cmd-stage" type="number" min="1" max="10000" value="1"></label>
          <label class="fld"><span>Creator badge</span>
            <select id="gm-cmd-badge"><option value="">— none —</option>${BADGES.map(b => `<option value="${b.id}">${b.emoji} ${esc(b.name)}</option>`).join('')}</select></label>
        </div>
        <div class="row" style="margin-top:0.6rem">
          <button id="gm-cmd-title-btn" class="btn small">👑 Grant title</button>
          <button id="gm-cmd-badge-btn" class="btn small">▶️ Set badge</button>
          <button id="gm-cmd-stage-btn" class="btn small">🗺️ Set stage</button>
          <button id="gm-cmd-heal-btn" class="btn small">💚 Heal</button>
          <button id="gm-cmd-reset-btn" class="btn small danger">♻️ Reset player</button>
        </div>
        <p class="muted small">Reset wipes a player's progress back to a fresh hero (keeps account &amp; role).</p>
      </div>
      ` : ''}

      ${gm ? `
      <div class="card"><h3>🎟️ Gift codes</h3>
        <div class="row">
          <label class="fld"><span>Set</span><select id="gm-code-set">${setOptions}</select></label>
          <label class="fld"><span>Max uses</span><input id="gm-code-uses" type="number" min="1" max="10000" value="10"></label>
        </div>
        <button id="gm-code-create" class="btn wide">Create code</button>
        <div id="gm-new-code" class="new-code hidden"></div>
        <div id="gm-code-list" class="code-list"></div>
      </div>
      ` : ''}

      ${gm ? `
      <div class="card"><h3>🛡️ Admin roster</h3>
        <p class="muted small">Admins are entitled to the Warden Arsenal (in-game status, no console).</p>
        <div class="row">
          <input id="gm-admin-user" placeholder="username" autocomplete="off">
          <button id="gm-admin-add" class="btn small">Add admin</button>
        </div>
        <div id="gm-admin-list" class="name-list"></div>
        <h4 class="gm-sub">Game masters</h4>
        <div id="gm-gm-list" class="name-list"></div>
      </div>
      ` : ''}

      ${admin ? `
      <div class="card"><h3>🛠️ Player management <span class="muted small">(owner/admin)</span></h3>
        <label class="fld"><span>Username</span><input id="gm-pm-user" placeholder="player name" autocomplete="off"></label>
        <div class="row">
          <label class="fld"><span>Grant title</span>
            <select id="gm-pm-title">${titleOptions}</select></label>
          <label class="fld"><span>Set stage (1–10000)</span>
            <input id="gm-pm-stage" type="number" min="1" max="10000" value="1"></label>
        </div>
        <div class="row" style="margin-top:0.6rem">
          <button id="gm-pm-title-btn" class="btn small">👑 Grant title</button>
          <button id="gm-pm-stage-btn" class="btn small">🗺️ Set stage</button>
          <button id="gm-pm-ban-btn" class="btn small danger">🔨 Ban</button>
          <button id="gm-pm-unban-btn" class="btn small">🔓 Unban</button>
          <button id="gm-pm-reset-btn" class="btn small danger">♻️ Reset save</button>
        </div>
        <p class="muted small">Reset save wipes progress back to a fresh hero (keeps account &amp; role). Banned players cannot log in.</p>
      </div>
      ` : ''}

      ${mod ? `
      <div class="card"><h3>📣 Moderation</h3>
        <label class="fld"><span>Broadcast message (1–500 chars, seen by all players)</span>
          <input id="gm-bc-msg" placeholder="Announcement…" maxlength="500" autocomplete="off"></label>
        <button id="gm-bc-send" class="btn gold wide">Send broadcast</button>
        <h4 class="gm-sub">Players</h4>
        <div class="row">
          <input id="gm-pl-search" placeholder="search username" autocomplete="off">
          <button id="gm-pl-search-btn" class="btn small">Search</button>
        </div>
        <div id="gm-player-list" class="name-list"></div>
      </div>
      ` : ''}

      ${isOwner ? `
      <div class="card"><h3>👑 Role management <span class="muted small">(owner only)</span></h3>
        <div class="row">
          <input id="gm-role-user" placeholder="username" autocomplete="off">
          <select id="gm-role-select">
            <option value="gm">gm</option>
            <option value="admin">admin</option>
            <option value="moderator">moderator</option>
            <option value="player">player</option>
          </select>
          <button id="gm-role-set" class="btn small gold">Set role</button>
        </div>
        <p class="muted small">gm: full console. admin: Warden gear entitlement + player management. moderator: broadcast + player lookup. player: default.</p>
      </div>

      <div class="card"><h3>♾️ Infinite gold <span class="muted small">(owner only)</span></h3>
        <div class="row">
          <input id="gm-infgold-user" placeholder="username" autocomplete="off">
          <button id="gm-infgold-on" class="btn small gold">Enable ∞</button>
          <button id="gm-infgold-off" class="btn small">Disable</button>
        </div>
        <p class="muted small">Purchases never deduct gold and the HUD shows ∞. Survives prestige. Only the owner can grant it.</p>
      </div>

      <div class="card"><h3>⚙️ Server settings <span class="muted small">(owner only)</span></h3>
        <div class="row">
          <input id="gm-goldcap" type="number" min="1000" step="100" placeholder="9000" autocomplete="off" inputmode="numeric">
          <button id="gm-goldcap-save" class="btn small gold">Save</button>
        </div>
        <p class="muted small">Player gold cap, in trillions (T). Current: <span id="gm-goldcap-current">…</span>. The infinite-gold perk bypasses it.</p>
      </div>` : ''}`;
  },

  bind(root) {
    const $ = (id) => root.querySelector('#' + id);
    // Cards render per role tier; elements for other tiers are absent.
    const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };
    const kindSel = $('gm-grant-kind');
    if (kindSel) {
    const amountLabel = $('gm-grant-amount-label');
    const amountInput = $('gm-grant-amount');
    const syncKindUI = () => {
      const kind = kindSel.value;
      const isGear = kind === 'gear';
      $('gm-grant-amount-wrap').classList.toggle('hidden', isGear);
      $('gm-grant-set-wrap').classList.toggle('hidden', !isGear);
      if (kind === 'gold') { amountLabel.textContent = 'Amount (1–1000000)'; amountInput.max = '1000000'; }
      else if (kind === 'levels') { amountLabel.textContent = 'Levels (1–100)'; amountInput.max = '100'; }
      else if (kind === 'xp') { amountLabel.textContent = 'XP (1–1000000)'; amountInput.max = '1000000'; }
      else { amountLabel.textContent = 'Amount (1–100000)'; amountInput.max = '100000'; }
    };
    kindSel.addEventListener('change', syncKindUI);
    syncKindUI();
    }

    on('gm-grant-btn', 'click', async () => {
      const username = $('gm-grant-user').value.trim();
      if (!username) return UI.toast('Enter a username.', 'error');
      const kind = kindSel.value;
      try {
        // Save the operator's live progress first so the grant applies on top of it,
        // otherwise the next autosave would overwrite the grant with stale state.
        try { if (UI.handlers.onSaveState) await UI.handlers.onSaveState(); } catch { /* ignore */ }
        let res = null;
        if (kind === 'stars') {
          const amount = Math.floor(Number($('gm-grant-amount').value));
          if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
            return UI.toast('Amount must be 1–100000.', 'error');
          }
          res = await api.gmGrant(username, 'stars', { amount });
          UI.toast(`Granted ⭐${formatNum(amount)} to ${username}.`, 'success');
        } else if (kind === 'gold') {
          const amount = Math.floor(Number($('gm-grant-amount').value));
          if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) {
            return UI.toast('Amount must be 1–1000000.', 'error');
          }
          res = await api.gmGrant(username, 'gold', { amount });
          UI.toast(`Granted 💰${formatNum(amount)} to ${username}.`, 'success');
        } else if (kind === 'levels') {
          const amount = Math.floor(Number($('gm-grant-amount').value));
          if (!Number.isFinite(amount) || amount < 1 || amount > 100) {
            return UI.toast('Levels must be 1–100.', 'error');
          }
          res = await api.gmGrant(username, 'levels', { amount });
          UI.toast(`Granted ⬆️${amount} levels to ${username}.`, 'success');
        } else if (kind === 'xp') {
          const amount = Math.floor(Number($('gm-grant-amount').value));
          if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) {
            return UI.toast('XP must be 1–1000000.', 'error');
          }
          res = await api.gmGrant(username, 'xp', { amount });
          UI.toast(`Granted ✨${formatNum(amount)} XP to ${username}.`, 'success');
        } else {
          const set = $('gm-grant-set').value;
          res = await api.gmGrant(username, 'gear', { set });
          UI.toast(`Granted ${PRIVILEGED_SETS[set].name} to ${username}.`, 'success');
        }
        $('gm-grant-user').value = '';
        // Grant targeted the logged-in operator: hot-reload their live game
        // state so the grant shows up immediately instead of on next login.
        if (res && res.state && this.me &&
            username.toLowerCase() === String(this.me.username).toLowerCase() &&
            UI.handlers.onExternalState) {
          UI.handlers.onExternalState(res.state);
        }
      } catch (e) {
        UI.toast(e.message || 'Grant failed.', 'error');
      }
    });

    on('gm-code-create', 'click', async () => {
      const set = $('gm-code-set').value;
      const maxUses = Math.floor(Number($('gm-code-uses').value)) || 1;
      try {
        const { code } = await api.gmCreateCode(set, maxUses);
        const box = $('gm-new-code');
        box.classList.remove('hidden');
        box.innerHTML = `<span class="muted small">New code (${esc(PRIVILEGED_SETS[set].name)}, ${maxUses} uses):</span>
                         <div class="code-big">${esc(code)}</div>`;
        this.refreshCodes(root);
        UI.toast('Gift code created.', 'success');
      } catch (e) {
        UI.toast(e.message || 'Could not create code.', 'error');
      }
    });

    // ---- quick commands ----
    const cmdUser = () => {
      const u = $('gm-cmd-user').value.trim();
      if (!u) UI.toast('Enter a username for the command.', 'error');
      return u;
    };
    const hotReloadIfSelf = async (username, res) => {
      if (res && res.state && this.me &&
          username.toLowerCase() === String(this.me.username).toLowerCase() &&
          UI.handlers.onExternalState) {
        UI.handlers.onExternalState(res.state);
      }
    };

    on('gm-cmd-title-btn', 'click', async () => {
      const username = cmdUser();
      if (!username) return;
      const titleId = $('gm-cmd-title').value;
      try {
        const res = await api.gmGrantTitle(username, titleId);
        const t = TITLES.find(x => x.id === titleId);
        UI.toast(`👑 Granted title "${t ? t.name : titleId}" to ${username}.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Grant title failed.', 'error');
      }
    });

    on('gm-cmd-badge-btn', 'click', async () => {
      const username = cmdUser();
      if (!username) return;
      const badge = $('gm-cmd-badge').value;
      try {
        const res = await api.gmSetBadge(username, badge);
        const b = BADGES.find(x => x.id === badge);
        UI.toast(badge ? `${b.emoji} Set badge "${b.name}" on ${username}.` : `Badge cleared for ${username}.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Set badge failed.', 'error');
      }
    });

    on('gm-cmd-stage-btn', 'click', async () => {
      const username = cmdUser();
      if (!username) return;
      const stage = Math.floor(Number($('gm-cmd-stage').value));
      if (!Number.isFinite(stage) || stage < 1 || stage > 10000) {
        return UI.toast('Stage must be 1–10000.', 'error');
      }
      try {
        const res = await api.gmSetStage(username, stage);
        UI.toast(`🗺️ ${username} moved to stage ${stage}.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Set stage failed.', 'error');
      }
    });

    on('gm-cmd-heal-btn', 'click', async () => {
      const username = cmdUser();
      if (!username) return;
      try {
        const res = await api.gmHeal(username);
        UI.toast(`💚 ${username} healed.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Heal failed.', 'error');
      }
    });

    on('gm-cmd-reset-btn', 'click', async () => {
      const username = cmdUser();
      if (!username) return;
      const ok = await UI.confirm(
        '♻️ Reset player?',
        `<p>Wipe <b>${esc(username)}</b>'s progress back to a fresh hero?</p>
         <p class="muted">Keeps their account and role. This cannot be undone.</p>`,
        'Reset player'
      );
      if (!ok) return;
      try {
        const res = await api.gmReset(username);
        UI.toast(`♻️ ${username}'s progress was reset.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Reset failed.', 'error');
      }
    });

    // ---- player management (owner/admin) ----
    const pmUser = () => {
      const u = $('gm-pm-user').value.trim();
      if (!u) UI.toast('Enter a username for the command.', 'error');
      return u;
    };

    on('gm-pm-title-btn', 'click', async () => {
      const username = pmUser();
      if (!username) return;
      const title = $('gm-pm-title').value;
      try {
        const res = await api.gmTitle(username, title);
        const t = TITLES.find(x => x.id === title);
        UI.toast(`👑 Granted title "${t ? t.name : title}" to ${username}.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Grant title failed.', 'error');
      }
    });

    on('gm-pm-stage-btn', 'click', async () => {
      const username = pmUser();
      if (!username) return;
      const stage = Math.floor(Number($('gm-pm-stage').value));
      if (!Number.isFinite(stage) || stage < 1 || stage > 10000) {
        return UI.toast('Stage must be 1–10000.', 'error');
      }
      try {
        const res = await api.gmStage(username, stage);
        UI.toast(`🗺️ ${username} moved to stage ${stage}.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Set stage failed.', 'error');
      }
    });

    on('gm-pm-ban-btn', 'click', async () => {
      const username = pmUser();
      if (!username) return;
      const ok = await UI.confirm('🔨 Ban player?', `<p>Ban <b>${esc(username)}</b> from logging in?</p>`, 'Ban');
      if (!ok) return;
      try {
        await api.gmBan(username);
        UI.toast(`🔨 ${username} banned.`, 'success');
      } catch (e) {
        UI.toast(e.message || 'Ban failed.', 'error');
      }
    });

    on('gm-pm-unban-btn', 'click', async () => {
      const username = pmUser();
      if (!username) return;
      try {
        await api.gmUnban(username);
        UI.toast(`🔓 ${username} unbanned.`, 'success');
      } catch (e) {
        UI.toast(e.message || 'Unban failed.', 'error');
      }
    });

    on('gm-pm-reset-btn', 'click', async () => {
      const username = pmUser();
      if (!username) return;
      const ok = await UI.confirm(
        '♻️ Reset player save?',
        `<p>Wipe <b>${esc(username)}</b>'s progress back to a fresh hero?</p>
         <p class="muted">Keeps their account and role. This cannot be undone.</p>`,
        'Reset save'
      );
      if (!ok) return;
      try {
        const res = await api.gmResetPlayer(username);
        UI.toast(`♻️ ${username}'s save was reset.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Reset failed.', 'error');
      }
    });

    // ---- moderation (owner/admin/moderator) ----
    on('gm-bc-send', 'click', async () => {
      const message = $('gm-bc-msg').value.trim();
      if (!message) return UI.toast('Enter a broadcast message.', 'error');
      try {
        await api.gmBroadcast(message);
        $('gm-bc-msg').value = '';
        UI.toast('📣 Broadcast sent.', 'success');
      } catch (e) {
        UI.toast(e.message || 'Broadcast failed.', 'error');
      }
    });

    const loadPlayers = async () => {
      const search = $('gm-pl-search').value.trim();
      const list = $('gm-player-list');
      list.innerHTML = '<p class="muted small">Loading…</p>';
      try {
        const { players = [] } = await api.gmPlayers(search, 50);
        if (!players.length) { list.innerHTML = '<p class="muted small">No players found.</p>'; return; }
        list.innerHTML = players.map(p => `
          <div class="name-row"><span>${(CLASSES[p.playerClass] || {}).emoji || ''}${(SPECS[p.spec] || {}).emoji || ''} ${esc(p.username)}</span>
            <span class="muted small">${esc(p.role)} · Lv ${p.level} · stage ${p.stage}</span></div>`).join('');
      } catch (e) {
        list.innerHTML = `<p class="error small">Couldn't load players.</p>`;
      }
    };
    on('gm-pl-search-btn', 'click', loadPlayers);
    if ($('gm-player-list')) loadPlayers();

    on('gm-admin-add', 'click', async () => {
      const username = $('gm-admin-user').value.trim();
      if (!username) return UI.toast('Enter a username.', 'error');      try {
        await api.gmRosterUpdate(username, 'add-admin');
        $('gm-admin-user').value = '';
        this.refreshRoster(root);
        UI.toast(`${username} added as admin.`, 'success');
      } catch (e) {
        UI.toast(e.message || 'Roster update failed.', 'error');
      }
    });

    const roleBtn = $('gm-role-set');
    if (roleBtn) {
      roleBtn.addEventListener('click', async () => {
        const username = $('gm-role-user').value.trim();
        const role = $('gm-role-select').value;
        if (!username) return UI.toast('Enter a username.', 'error');
        const ok = await UI.confirm('Set role', `Set <b>${esc(username)}</b> to <b>${esc(role)}</b>?`);
        if (!ok) return;
        try {
          await api.setRole(username, role);
          $('gm-role-user').value = '';
          this.refreshRoster(root);
          UI.toast(`${username} is now ${role}.`, 'success');
        } catch (e) {
          UI.toast(e.message || 'Role change failed.', 'error');
        }
      });
    }

    // ♾️ Infinite gold toggle (owner only). Hot-reloads the operator's own
    // game state so the ∞ HUD appears immediately on a self-grant.
    const infGoldToggle = async (enabled) => {
      const username = $('gm-infgold-user').value.trim();
      if (!username) return UI.toast('Enter a username.', 'error');
      const ok = await UI.confirm(
        enabled ? 'Enable infinite gold' : 'Disable infinite gold',
        enabled
          ? `Give <b>${esc(username)}</b> infinite gold? Purchases will never deduct gold.`
          : `Take infinite gold away from <b>${esc(username)}</b>?`
      );
      if (!ok) return;
      try {
        const res = await api.gmInfGold(username, enabled);
        $('gm-infgold-user').value = '';
        await hotReloadIfSelf(username, res);
        UI.toast(enabled ? `♾️ ${username} now has infinite gold.` : `Infinite gold removed from ${username}.`, 'success');
      } catch (e) {
        UI.toast(e.message || 'Infinite-gold update failed.', 'error');
      }
    };
    on('gm-infgold-on', 'click', () => infGoldToggle(true));
    on('gm-infgold-off', 'click', () => infGoldToggle(false));

    // ⚙️ Server settings: gold cap (owner only). Card only renders for owner.
    if ($('gm-goldcap')) {
      const capText = (cap) => `${formatNum(cap)} (${Math.round(cap / 1e12)}T)`;
      api.getSettings().then(sj => {
        if (sj && Number.isFinite(sj.goldCap)) {
          $('gm-goldcap-current').textContent = capText(sj.goldCap);
          $('gm-goldcap').placeholder = String(Math.round(sj.goldCap / 1e12));
        }
      }).catch(() => { /* leave the "…" placeholder */ });
      on('gm-goldcap-save', 'click', async () => {
        const t = Number($('gm-goldcap').value);
        if (!Number.isFinite(t) || t < 1000) return UI.toast('Enter a cap in trillions (min 1000T).', 'error');
        try {
          const res = await api.gmSetSettings(t * 1e12);
          $('gm-goldcap').value = '';
          if (res && Number.isFinite(res.goldCap)) {
            $('gm-goldcap-current').textContent = capText(res.goldCap);
            $('gm-goldcap').placeholder = String(Math.round(res.goldCap / 1e12));
          }
          UI.toast(`⚙️ Gold cap set to ${t}T.`, 'success');
        } catch (e) {
          UI.toast(e.message || 'Settings update failed.', 'error');
        }
      });
    }
  },

  async refreshCodes(root) {
    const list = root.querySelector('#gm-code-list');
    try {
      const codes = await api.gmCodes();
      const arr = Array.isArray(codes) ? codes : (codes.codes || []);
      if (!arr.length) { list.innerHTML = '<p class="muted small">No codes yet.</p>'; return; }
      list.innerHTML = arr.map(c => `
        <div class="code-row">
          <code>${esc(c.code)}</code>
          <span class="muted small">${esc(PRIVILEGED_SETS[c.gear_set]?.name || c.gear_set)}</span>
          <span class="muted small">${c.uses}/${c.max_uses} used</span>
        </div>`).join('');
    } catch (e) {
      list.innerHTML = `<p class="error small">Couldn't load codes.</p>`;
    }
  },

  async refreshRoster(root) {
    const adminList = root.querySelector('#gm-admin-list');
    const gmList = root.querySelector('#gm-gm-list');
    try {
      const { admins = [], gms = [] } = await api.gmRoster();
      adminList.innerHTML = admins.length ? admins.map(u => `
        <div class="name-row"><span>${esc(u)}</span>
          <button class="btn small ghost" data-remove-admin="${esc(u)}">Remove</button></div>`).join('')
        : '<p class="muted small">No admins.</p>';
      gmList.innerHTML = gms.length ? gms.map(u => `<div class="name-row"><span>${esc(u)}</span></div>`).join('')
        : '<p class="muted small">No GMs.</p>';
      adminList.querySelectorAll('[data-remove-admin]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const username = btn.dataset.removeAdmin;
          const ok = await UI.confirm('Remove admin', `Remove <b>${esc(username)}</b> from the admin roster?`);
          if (!ok) return;
          try {
            await api.gmRosterUpdate(username, 'remove-admin');
            this.refreshRoster(root);
            UI.toast(`${username} removed from admins.`, 'success');
          } catch (e) {
            UI.toast(e.message || 'Roster update failed.', 'error');
          }
        });
      });
    } catch (e) {
      adminList.innerHTML = '<p class="error small">Couldn\'t load roster.</p>';
    }
  },
};
