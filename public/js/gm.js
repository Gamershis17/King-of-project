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

// Human-readable description of a gift code's reward.
function describeReward(kind, amount, set) {
  if (kind === 'gold') return `💰 ${formatNum(Number(amount) || 0)} gold`;
  if (kind === 'stars') return `⭐ ${formatNum(Number(amount) || 0)} stars`;
  return (PRIVILEGED_SETS[set] || {}).name || set || 'gear';
}

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
    const canTarget = gm || admin; // roles that act on a specific player
    const num = (v) => (v == null ? '—' : formatNum(v));
    const setOptions = SET_IDS.map(id => {
      const locked = id === 'sovereign' && !isOwner;
      return `<option value="${id}" ${locked ? 'disabled' : ''}>${esc(PRIVILEGED_SETS[id].name)}${locked ? ' (owner only)' : ''}</option>`;
    }).join('');
    const titleOptions = TITLES.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    const badgeOptions = `<option value="">— none —</option>` + BADGES.map(b => `<option value="${b.id}">${b.emoji} ${esc(b.name)}</option>`).join('');
    return `
      <div class="gm-cards">
        <div class="gm-card"><div class="gm-num">${num(ov.playerCount)}</div><div class="muted small">players</div></div>
        <div class="gm-card"><div class="gm-num">${num(ov.codeCount)}</div><div class="muted small">gift codes</div></div>
        <div class="gm-card"><div class="gm-num">${esc(ov.role)}</div><div class="muted small">your role</div></div>
      </div>

      ${canTarget ? `
      <div class="card gm-target" style="position:sticky;top:0;z-index:5">
        <div class="row" style="align-items:flex-end">
          <label class="fld" style="flex:1"><span>🎯 Target player</span>
            <input id="gm-target-user" placeholder="player name" autocomplete="off"></label>
          <button id="gm-target-clear" class="btn small ghost">Clear</button>
        </div>
        <p class="muted small" style="margin:0.25rem 0 0">Every action below applies to this player. It stays filled until you clear it.</p>
      </div>
      ` : ''}

      ${gm ? `
      <div class="card"><h3>🎁 Grants</h3>
        <h4 class="gm-sub">Currency &amp; gear</h4>
        <div class="row">
          <label class="fld"><span>Kind</span>
            <select id="gm-grant-kind">
              <option value="stars">⭐ Stars</option>
              <option value="gold">💰 Gold</option>
              <option value="levels">⬆️ Levels</option>
              <option value="xp">✨ XP</option>
              <option value="gear">👑 Gear set</option>
              <option value="ore">⛏️ Ore</option>
            </select></label>
          <label class="fld" id="gm-grant-amount-wrap"><span id="gm-grant-amount-label">Amount (1–100000)</span>
            <input id="gm-grant-amount" type="number" min="1" max="1000000" value="100"></label>
          <label class="fld hidden" id="gm-grant-set-wrap"><span>Gear set</span>
            <select id="gm-grant-set">${setOptions}</select></label>
          <label class="fld hidden" id="gm-grant-ore-wrap"><span>Ore type</span>
            <select id="gm-grant-ore">
              <option value="copper">🟤 Copper</option>
              <option value="iron">⚙️ Iron</option>
              <option value="silver">⚪ Silver</option>
              <option value="gold">🟡 Gold Ore</option>
              <option value="mithril">🔷 Mithril</option>
              <option value="adamant">🟣 Adamant</option>
              <option value="galaxy">🌌 Galaxy Shard</option>
              <option value="supergalaxy">💜 Super Galaxy Core</option>
            </select></label>
        </div>
        <button id="gm-grant-btn" class="btn gold wide">Grant</button>
        <p class="muted small">Gear grants add the full 5-piece set to the player's inventory. Sovereign set is owner-only.</p>
        <h4 class="gm-sub">Titles, badges &amp; pets</h4>
        <div class="row">
          <label class="fld"><span>Title</span><select id="gm-grant-title">${titleOptions}</select></label>
          <button id="gm-grant-title-btn" class="btn small" style="align-self:flex-end">👑 Grant title</button>
        </div>
        <div class="row">
          <label class="fld"><span>Creator badge</span><select id="gm-grant-badge">${badgeOptions}</select></label>
          <button id="gm-grant-badge-btn" class="btn small" style="align-self:flex-end">▶️ Set badge</button>
        </div>
        <div class="row">
          <label class="fld"><span>Pet eggs (1–99)</span>
            <input id="gm-grant-pet-amount" type="number" min="1" max="99" value="1"></label>
          <button id="gm-grant-pet-btn" class="btn small" style="align-self:flex-end">🐾 Grant eggs</button>
          <label class="fld"><span>Rebirth count (0–999)</span>
            <input id="gm-set-rebirth-count" type="number" min="0" max="999" value="0"></label>
          <button id="gm-set-rebirth-btn" class="btn small" style="align-self:flex-end">🔄 Set rebirths</button>
        </div>
      </div>
      ` : ''}

      ${(gm || admin) ? `
      <div class="card"><h3>🛠️ Player</h3>
        <div class="row">
          <label class="fld"><span>Set stage (1–10000)</span>
            <input id="gm-player-stage" type="number" min="1" max="10000" value="1"></label>
          <button id="gm-player-stage-btn" class="btn small" style="align-self:flex-end">🗺️ Set stage</button>
          ${(!gm && admin) ? `
          <label class="fld"><span>Title</span><select id="gm-player-title">${titleOptions}</select></label>
          <button id="gm-player-title-btn" class="btn small" style="align-self:flex-end">👑 Grant title</button>` : ''}
        </div>
        <div class="row" style="margin-top:0.6rem">
          ${gm ? `<button id="gm-player-heal-btn" class="btn small">💚 Heal</button>` : ''}
          ${admin ? `
          <button id="gm-player-ban-btn" class="btn small danger">🔨 Ban</button>
          <button id="gm-player-unban-btn" class="btn small">🔓 Unban</button>
          <button id="gm-player-kick-btn" class="btn small danger">👢 Kick</button>` : ''}
          <button id="gm-player-reset-btn" class="btn small danger">♻️ Reset player</button>
        </div>
        <p class="muted small">${admin ? 'Banned players cannot log in. Kick force-logs them out immediately (they may sign back in). ' : ''}Reset wipes progress back to a fresh hero (keeps account &amp; role).</p>
      </div>
      ` : ''}

      ${gm ? `
      <div class="card"><h3>🎟️ Gift codes</h3>
        <div class="row">
          <label class="fld"><span>Reward</span>
            <select id="gm-code-kind">
              <option value="gear">👑 Gear set</option>
              <option value="gold">💰 Gold</option>
              <option value="stars">⭐ Stars</option>
            </select></label>
          <label class="fld" id="gm-code-set-wrap"><span>Set</span><select id="gm-code-set">${setOptions}</select></label>
          <label class="fld hidden" id="gm-code-amount-wrap"><span id="gm-code-amount-label">Gold amount</span>
            <input id="gm-code-amount" type="number" min="1" value="10000"></label>
          <label class="fld"><span>Max uses</span><input id="gm-code-uses" type="number" min="1" max="10000" value="10"></label>
        </div>
        <button id="gm-code-create" class="btn wide">Create code</button>
        <div id="gm-new-code" class="new-code hidden"></div>
        <div id="gm-code-list" class="code-list"></div>
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

      ${gm ? `
      <div class="card"><h3>👥 Staff</h3>
        <h4 class="gm-sub">Admin roster</h4>
        <p class="muted small">Admins are entitled to the Warden Arsenal (in-game status, no console).</p>
        <div class="row">
          <button id="gm-admin-add" class="btn small">Add target as admin</button>
        </div>
        <div id="gm-admin-list" class="name-list"></div>
        <h4 class="gm-sub">Game masters</h4>
        <div id="gm-gm-list" class="name-list"></div>
        ${isOwner ? `
        <h4 class="gm-sub">Role management <span class="muted small">(owner only)</span></h4>
        <div class="row">
          <select id="gm-role-select">
            <option value="gm">gm</option>
            <option value="admin">admin</option>
            <option value="moderator">moderator</option>
            <option value="player">player</option>
          </select>
          <button id="gm-role-set" class="btn small gold">Set target's role</button>
        </div>
        <p class="muted small">gm: full console. admin: Warden gear entitlement + player management. moderator: broadcast + player lookup. player: default.</p>` : ''}
      </div>
      ` : ''}

      ${isOwner ? `
      <div class="card"><h3>⚙️ Server <span class="muted small">(owner only)</span></h3>
        <h4 class="gm-sub">Maintenance mode</h4>
        <div class="row">
          <label class="fld"><span>Message shown to players</span>
            <input id="gm-maint-msg" placeholder="Back soon…" maxlength="500" autocomplete="off"></label>
        </div>
        <div class="row">
          <button id="gm-maint-on" class="btn small danger">🛠️ Turn ON</button>
          <button id="gm-maint-off" class="btn small">Turn OFF</button>
          <span class="muted small" style="align-self:center">Status: <b id="gm-maint-status">…</b></span>
        </div>
        <h4 class="gm-sub">Infinite gold</h4>
        <div class="row">
          <button id="gm-infgold-on" class="btn small gold">Enable ∞ for target</button>
          <button id="gm-infgold-off" class="btn small">Disable for target</button>
        </div>
        <p class="muted small">Purchases never deduct gold and the HUD shows ∞. Survives rebirth. Only the owner can grant it.</p>
        <h4 class="gm-sub">Gold cap</h4>
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
    const isGm = canGm(this.me.role);

    // ---- single target player for every action ----
    const targetUser = () => {
      const el = $('gm-target-user');
      const u = el ? el.value.trim() : '';
      if (!u) UI.toast('Pick a target player above first.', 'error');
      return u;
    };
    on('gm-target-clear', 'click', () => { $('gm-target-user').value = ''; });

    // The client hot-reloads its live game state after a self-targeted
    // command so the change shows up immediately instead of on next login.
    const hotReloadIfSelf = async (username, res) => {
      if (res && res.state && this.me &&
          username.toLowerCase() === String(this.me.username).toLowerCase() &&
          UI.handlers.onExternalState) {
        UI.handlers.onExternalState(res.state);
      }
    };

    // ---- grant kind UI sync ----
    const kindSel = $('gm-grant-kind');
    if (kindSel) {
      const amountLabel = $('gm-grant-amount-label');
      const amountInput = $('gm-grant-amount');
      const syncKindUI = () => {
        const kind = kindSel.value;
        const isGear = kind === 'gear';
        const isOre = kind === 'ore';
        $('gm-grant-amount-wrap').classList.toggle('hidden', isGear);
        $('gm-grant-set-wrap').classList.toggle('hidden', !isGear);
        $('gm-grant-ore-wrap').classList.toggle('hidden', !isOre);
        if (kind === 'gold') { amountLabel.textContent = 'Amount (1–1000000)'; amountInput.max = '1000000'; }
        else if (kind === 'levels') { amountLabel.textContent = 'Levels (1–100)'; amountInput.max = '100'; }
        else if (kind === 'xp') { amountLabel.textContent = 'XP (1–1000000)'; amountInput.max = '1000000'; }
        else if (kind === 'ore') { amountLabel.textContent = 'Ore (1–1000000000)'; amountInput.max = '1000000000'; }
        else { amountLabel.textContent = 'Amount (1–100000)'; amountInput.max = '100000'; }
      };
      kindSel.addEventListener('change', syncKindUI);
      syncKindUI();
    }

    // ---- currency / gear grant ----
    on('gm-grant-btn', 'click', async () => {
      const username = targetUser();
      if (!username) return;
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
        } else if (kind === 'ore') {
          const amount = Math.floor(Number($('gm-grant-amount').value));
          if (!Number.isFinite(amount) || amount < 1 || amount > 1000000000) {
            return UI.toast('Ore amount must be 1–1000000000.', 'error');
          }
          const ore = $('gm-grant-ore').value;
          res = await api.gmGrant(username, 'ore', { ore, amount });
          UI.toast(`Granted ⛏️${formatNum(amount)} ${ore} to ${username}.`, 'success');
        } else {
          const set = $('gm-grant-set').value;
          res = await api.gmGrant(username, 'gear', { set });
          UI.toast(`Granted ${PRIVILEGED_SETS[set].name} to ${username}.`, 'success');
        }
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Grant failed.', 'error');
      }
    });

    // ---- title / badge (gm) ----
    on('gm-grant-title-btn', 'click', async () => {
      const username = targetUser();
      if (!username) return;
      const titleId = $('gm-grant-title').value;
      try {
        const res = await api.gmGrantTitle(username, titleId);
        const t = TITLES.find(x => x.id === titleId);
        UI.toast(`👑 Granted title "${t ? t.name : titleId}" to ${username}.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Grant title failed.', 'error');
      }
    });

    on('gm-grant-badge-btn', 'click', async () => {
      const username = targetUser();
      if (!username) return;
      const badge = $('gm-grant-badge').value;
      try {
        const res = await api.gmSetBadge(username, badge);
        const b = BADGES.find(x => x.id === badge);
        UI.toast(badge ? `${b.emoji} Set badge "${b.name}" on ${username}.` : `Badge cleared for ${username}.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Set badge failed.', 'error');
      }
    });

    // ---- pet eggs (gm) ----
    on('gm-grant-pet-btn', 'click', async () => {
      const username = targetUser();
      if (!username) return;
      const amount = Math.floor(Number($('gm-grant-pet-amount').value));
      if (!Number.isFinite(amount) || amount < 1 || amount > 99) {
        return UI.toast('Egg amount must be 1–99.', 'error');
      }
      try {
        const res = await api.gmGrantPet(username, amount);
        UI.toast(`🐾 Granted ${amount} pet egg${amount === 1 ? '' : 's'} to ${username} (now ${res.eggs}).`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Grant pet eggs failed.', 'error');
      }
    });

    // ---- rebirth count (gm) ----
    on('gm-set-rebirth-btn', 'click', async () => {
      const username = targetUser();
      if (!username) return;
      const count = Math.floor(Number($('gm-set-rebirth-count').value));
      if (!Number.isFinite(count) || count < 0 || count > 999) {
        return UI.toast('Rebirth count must be 0–999.', 'error');
      }
      try {
        const res = await api.gmSetRebirth(username, count);
        UI.toast(`🔄 ${username}'s rebirth count set to ${count}.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Set rebirth count failed.', 'error');
      }
    });

    // ---- player section (role-appropriate endpoints) ----
    // GMs use the gm-tier routes; admins use the admin-tier mirrors.
    const stageApi = isGm ? api.gmSetStage : api.gmStage;
    const resetApi = isGm ? api.gmReset : api.gmResetPlayer;

    on('gm-player-stage-btn', 'click', async () => {
      const username = targetUser();
      if (!username) return;
      const stage = Math.floor(Number($('gm-player-stage').value));
      if (!Number.isFinite(stage) || stage < 1 || stage > 10000) {
        return UI.toast('Stage must be 1–10000.', 'error');
      }
      try {
        const res = await stageApi(username, stage);
        UI.toast(`🗺️ ${username} moved to stage ${stage}.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Set stage failed.', 'error');
      }
    });

    on('gm-player-title-btn', 'click', async () => {
      const username = targetUser();
      if (!username) return;
      const title = $('gm-player-title').value;
      try {
        const res = await api.gmTitle(username, title);
        const t = TITLES.find(x => x.id === title);
        UI.toast(`👑 Granted title "${t ? t.name : title}" to ${username}.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Grant title failed.', 'error');
      }
    });

    on('gm-player-heal-btn', 'click', async () => {
      const username = targetUser();
      if (!username) return;
      try {
        const res = await api.gmHeal(username);
        UI.toast(`💚 ${username} healed.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Heal failed.', 'error');
      }
    });

    const confirmDestructive = (title, html, confirmLabel) =>
      UI.confirm(title, html, confirmLabel);

    on('gm-player-ban-btn', 'click', async () => {
      const username = targetUser();
      if (!username) return;
      const ok = await confirmDestructive('🔨 Ban player?',
        `<p>Ban <b>${esc(username)}</b> from logging in?</p><p class="muted">They stay banned until unbanned.</p>`, 'Ban');
      if (!ok) return;
      try {
        await api.gmBan(username);
        UI.toast(`🔨 ${username} banned.`, 'success');
      } catch (e) {
        UI.toast(e.message || 'Ban failed.', 'error');
      }
    });

    on('gm-player-unban-btn', 'click', async () => {
      const username = targetUser();
      if (!username) return;
      try {
        await api.gmUnban(username);
        UI.toast(`🔓 ${username} unbanned.`, 'success');
      } catch (e) {
        UI.toast(e.message || 'Unban failed.', 'error');
      }
    });

    on('gm-player-kick-btn', 'click', async () => {
      const username = targetUser();
      if (!username) return;
      const ok = await confirmDestructive('👢 Kick player?',
        `<p>Force <b>${esc(username)}</b> to sign in again right now?</p><p class="muted">Unlike a ban, they can log straight back in.</p>`, 'Kick');
      if (!ok) return;
      try {
        await api.gmKick(username);
        UI.toast(`👢 ${username} kicked.`, 'success');
      } catch (e) {
        UI.toast(e.message || 'Kick failed.', 'error');
      }
    });

    on('gm-player-reset-btn', 'click', async () => {
      const username = targetUser();
      if (!username) return;
      const ok = await confirmDestructive('♻️ Reset player?',
        `<p>Wipe <b>${esc(username)}</b>'s progress back to a fresh hero?</p><p class="muted">Keeps their account and role. This cannot be undone.</p>`, 'Reset player');
      if (!ok) return;
      try {
        const res = await resetApi(username);
        UI.toast(`♻️ ${username}'s progress was reset.`, 'success');
        await hotReloadIfSelf(username, res);
      } catch (e) {
        UI.toast(e.message || 'Reset failed.', 'error');
      }
    });

    // ---- gift codes ----
    const codeKindSel = $('gm-code-kind');
    if (codeKindSel) {
      const syncCodeUI = () => {
        const kind = codeKindSel.value;
        const isGear = kind === 'gear';
        $('gm-code-set-wrap').classList.toggle('hidden', !isGear);
        $('gm-code-amount-wrap').classList.toggle('hidden', isGear);
        if (!isGear) {
          $('gm-code-amount-label').textContent = kind === 'gold' ? 'Gold amount (1–1T)' : 'Star amount (1–100000)';
        }
      };
      codeKindSel.addEventListener('change', syncCodeUI);
      syncCodeUI();
    }

    on('gm-code-create', 'click', async () => {
      const maxUses = Math.floor(Number($('gm-code-uses').value)) || 1;
      const rewardKind = codeKindSel.value;
      const opts = { maxUses };
      if (rewardKind === 'gear') {
        opts.set = $('gm-code-set').value;
      } else {
        const amount = Math.floor(Number($('gm-code-amount').value));
        if (!Number.isFinite(amount) || amount < 1) {
          return UI.toast('Enter a reward amount of at least 1.', 'error');
        }
        opts.amount = amount;
      }
      try {
        const { code, rewardKind: kind, rewardAmount, set } = await api.gmCreateCode(rewardKind, opts);
        const box = $('gm-new-code');
        box.classList.remove('hidden');
        box.innerHTML = `<span class="muted small">New code (${esc(describeReward(kind, rewardAmount, set))}, ${maxUses} uses):</span>
                         <div class="code-big">${esc(code)}</div>`;
        this.refreshCodes(root);
        UI.toast('Gift code created.', 'success');
      } catch (e) {
        UI.toast(e.message || 'Could not create code.', 'error');
      }
    });

    // ---- moderation (owner/admin/gm/moderator) ----
    on('gm-bc-send', 'click', async () => {
      const message = $('gm-bc-msg').value.trim();
      if (!message) return UI.toast('Enter a broadcast message.', 'error');
      const ok = await confirmDestructive('📣 Send broadcast?',
        `<p>Send to <b>all players</b>:</p><p>"${esc(message)}"</p>`, 'Send');
      if (!ok) return;
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
          <div class="name-row" data-username="${esc(p.username)}" title="Set as target"><span>${(CLASSES[p.playerClass] || {}).emoji || ''}${(SPECS[p.spec] || {}).emoji || ''} ${esc(p.username)}</span>
            <span class="muted small">${esc(p.role)} · Lv ${p.level} · stage ${p.stage}</span></div>`).join('');
      } catch (e) {
        list.innerHTML = `<p class="error small">Couldn't load players.</p>`;
      }
    };
    on('gm-pl-search-btn', 'click', loadPlayers);
    if ($('gm-player-list')) loadPlayers();
    // Clicking a player row picks them as the target for every action below.
    // Guarded so re-renders never stack duplicate listeners.
    const plList = $('gm-player-list');
    if (plList && !plList.dataset.pickBound) {
      plList.dataset.pickBound = '1';
      plList.addEventListener('click', (e) => {
        const row = e.target && e.target.closest ? e.target.closest('.name-row[data-username]') : null;
        if (!row) return;
        const t = $('gm-target-user');
        if (t) t.value = row.dataset.username;
        UI.toast(`Target: ${row.dataset.username}`, 'info');
      });
    }

    // ---- staff ----
    on('gm-admin-add', 'click', async () => {
      const username = targetUser();
      if (!username) return;
      try {
        await api.gmRosterUpdate(username, 'add-admin');
        this.refreshRoster(root);
        UI.toast(`${username} added as admin.`, 'success');
      } catch (e) {
        UI.toast(e.message || 'Roster update failed.', 'error');
      }
    });

    on('gm-role-set', 'click', async () => {
      const username = targetUser();
      if (!username) return;
      const role = $('gm-role-select').value;
      const ok = await confirmDestructive('Set role',
        `Set <b>${esc(username)}</b> to <b>${esc(role)}</b>?`, 'Set role');
      if (!ok) return;
      try {
        await api.setRole(username, role);
        this.refreshRoster(root);
        UI.toast(`${username} is now ${role}.`, 'success');
      } catch (e) {
        UI.toast(e.message || 'Role change failed.', 'error');
      }
    });

    // ---- server (owner only) ----
    const refreshMaintStatus = async () => {
      const el = $('gm-maint-status');
      if (!el) return;
      try {
        const s = await api.status();
        el.textContent = s.maintenance ? `ON${s.message ? ' — ' + s.message : ''}` : 'OFF';
      } catch {
        el.textContent = 'unknown';
      }
    };
    refreshMaintStatus();

    const setMaintenance = async (enabled) => {
      const message = $('gm-maint-msg').value.trim();
      const ok = await confirmDestructive(enabled ? '🛠️ Enable maintenance?' : 'Turn off maintenance?',
        enabled
          ? `<p>Put the game into maintenance mode? Players will see a maintenance screen${message ? `: "${esc(message)}"` : '.'}</p>`
          : '<p>Take the game out of maintenance mode?</p>',
        enabled ? 'Turn ON' : 'Turn OFF');
      if (!ok) return;
      try {
        await api.gmMaintenance(enabled, message);
        if (enabled) $('gm-maint-msg').value = '';
        refreshMaintStatus();
        UI.toast(enabled ? '🛠️ Maintenance mode ON.' : 'Maintenance mode OFF.', 'success');
      } catch (e) {
        UI.toast(e.message || 'Maintenance update failed.', 'error');
      }
    };
    on('gm-maint-on', 'click', () => setMaintenance(true));
    on('gm-maint-off', 'click', () => setMaintenance(false));

    // ♾️ Infinite gold toggle (owner only). Hot-reloads the operator's own
    // game state so the ∞ HUD appears immediately on a self-grant.
    const infGoldToggle = async (enabled) => {
      const username = targetUser();
      if (!username) return;
      const ok = await confirmDestructive(enabled ? 'Enable infinite gold' : 'Disable infinite gold',
        enabled
          ? `Give <b>${esc(username)}</b> infinite gold? Purchases will never deduct gold.`
          : `Take infinite gold away from <b>${esc(username)}</b>?`,
        enabled ? 'Enable ∞' : 'Disable');
      if (!ok) return;
      try {
        const res = await api.gmInfGold(username, enabled);
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
      list.innerHTML = arr.map(c => {
        const reward = describeReward(c.reward_kind, c.reward_amount, c.gear_set);
        return `
        <div class="code-row">
          <code>${esc(c.code)}</code>
          <span class="muted small">${esc(reward)}</span>
          <span class="muted small">${c.uses}/${c.max_uses} used</span>
        </div>`;
      }).join('');
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
