// ============================================================
// ui.js — all DOM rendering for King of Project.
// engine.js stays DOM-free; this file owns the DOM.
// app.js wires behavior via UI.handlers.
// ============================================================
import * as Engine from './engine.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

// Emoji per gear stat key, used for the compact stat chips on item cards.
const STAT_EMOJI = {
  attack: '⚔️', defense: '🛡️', maxHp: '❤️',
  critChance: '💥', critDamage: '🔥',
  parry: '🤺', dodge: '💨', lifesteal: '🩸',
  attackSpeed: '⚡', regen: '💚',
  goldBonus: '💰', xpBonus: '✨',
};

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatNum(n) {
  n = Math.floor(Number(n) || 0);
  if (n < 1000) return String(n);
  const units = ['K', 'M', 'B', 'T', 'Q'];
  let u = -1, v = n;
  while (v >= 1000 && u < units.length - 1) { v /= 1000; u++; }
  return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + units[u];
}

export function formatStatVal(key, v) {
  if (key === 'attackSpeed') return Engine.round2(v).toFixed(2);
  if (['critChance', 'parry', 'dodge', 'lifesteal', 'regen'].includes(key)) {
    return String(Engine.round1(v));
  }
  return formatNum(v);
}

function formatPlayTime(sec) {
  sec = Math.floor(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

const SETTINGS_KEY = 'rpg-idle-settings';

export const UI = {
  handlers: {},
  els: {},
  settings: { damageNumbers: true, reduceMotion: false },
  activeTab: 'battle',

  // ---------------- init ----------------
  init() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) this.settings = { ...this.settings, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    // UI style theme: default to modern before login (no player state yet);
    // app.js overrides from state.uiStyle once the player is loaded.
    if (!document.body.dataset.uistyle) document.body.dataset.uistyle = 'modern';
    document.body.classList.toggle('reduce-motion', !!this.settings.reduceMotion);

    const ids = [
      'hud-emoji', 'hud-username', 'hud-role', 'hud-race', 'hud-gold', 'hud-stars',
      'hud-stage', 'hud-level', 'hud-xpfill', 'hud-xptext', 'save-indicator',
      'mode-switch', 'enemy-card', 'enemy-sprite', 'enemy-name', 'enemy-stage',
      'boss-badge', 'enemy-hpfill', 'enemy-hptext', 'enemy-atk', 'float-layer',
      'dead-overlay', 'hero-hpfill', 'hero-hptext', 'hero-stats', 'dungeon-chips',
      'tap-btn', 'skill-btn', 'skill-cd', 'combo-meter', 'prestige-box', 'prestige-btn',
      'prestige-note', 'combat-log', 'loadout-strip', 'upgrade-list', 'inventory-grid', 'inv-count', 'set-progress',
      'party-slots', 'recruit-list', 'pets-panel', 'lb-body', 'lb-refresh', 'profile-card',
      'redeem-input', 'redeem-btn', 'gm-entry-card', 'gm-open-btn',
      'set-dmgnums', 'set-motion', 'logout-btn', 'modal-root', 'toast-root',
      'race-grid', 'class-grid', 'pet-grid', 'spec-grid', 'gm-back', 'meter-rows', 'total-dps',
      'share-btn', 'changelog-btn', 'changelog-badge',
    ];
    for (const id of ids) this.els[id] = document.getElementById(id);

    // Bottom tab bar
    $$('#tabbar .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // Staff tab is a shortcut into the GM console (role-checked on open).
        if (btn.dataset.tab === 'staff') { this.handlers.onOpenGM && this.handlers.onOpenGM(); return; }
        this.showTab(btn.dataset.tab);
      });
    });

    // Battle controls
    $$('#mode-switch .mode-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handlers.onMode && this.handlers.onMode(btn.dataset.mode));
    });
    this.els['tap-btn'].addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.handlers.onTap && this.handlers.onTap();
    });
    this.els['skill-btn'].addEventListener('click', () => {
      this.handlers.onSkill && this.handlers.onSkill();
    });
    this.els['prestige-btn'].addEventListener('click', () => {
      this.handlers.onPrestige && this.handlers.onPrestige();
    });

    // Gear: delegated equip/sell/upgrade
    this.els['inventory-grid'].addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.closest('.item-card').dataset.id;
      const h = this.handlers;
      if (btn.dataset.action === 'equip' && h.onEquip) h.onEquip(id);
      if (btn.dataset.action === 'sell' && h.onSell) h.onSell(id);
    });
    this.els['upgrade-list'].addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-upgrade]');
      if (!btn) return;
      this.handlers.onUpgrade && this.handlers.onUpgrade(btn.dataset.upgrade);
    });

    // Party: delegated recruit/dismiss/pet actions
    document.getElementById('tab-party').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const h = this.handlers;
      if (btn.dataset.action === 'recruit' && h.onRecruit) h.onRecruit(btn.dataset.id);
      if (btn.dataset.action === 'dismiss' && h.onDismiss) h.onDismiss(btn.dataset.id);
      if (btn.dataset.action === 'levelup' && h.onLevelUpCompanion) h.onLevelUpCompanion(btn.dataset.id);
      if (btn.dataset.action === 'hatch-pet' && h.onHatchPet) h.onHatchPet();
      if (btn.dataset.action === 'feed-pet' && h.onFeedPet) h.onFeedPet(btn.dataset.id);
      if (btn.dataset.action === 'set-active-pet' && h.onSetActivePet) h.onSetActivePet(btn.dataset.id);
    });

    // Ranks refresh
    this.els['lb-refresh'].addEventListener('click', () => {
      this.handlers.onTab && this.handlers.onTab('ranks', true);
    });

    // More tab: delegated talent / profession / title buttons
    document.getElementById('tab-more').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || btn.disabled) return;      const h = this.handlers;
      if (btn.dataset.action === 'talent' && h.onTalent) h.onTalent(btn.dataset.id);
      if (btn.dataset.action === 'prof' && h.onProfession) h.onProfession(btn.dataset.id);
      if (btn.dataset.action === 'title' && h.onTitle) h.onTitle(btn.dataset.id);
    });

    // Country picker (profile) — delegated change
    document.getElementById('tab-more').addEventListener('change', (e) => {
      if (e.target && e.target.id === 'country-select' && this.handlers.onCountry) {
        this.handlers.onCountry(e.target.value);
      }
    });

    // Share + update log (More tab)
    this.els['share-btn'].addEventListener('click', () => {
      this.handlers.onShare && this.handlers.onShare();
    });
    this.els['changelog-btn'].addEventListener('click', () => {
      this.handlers.onChangelog && this.handlers.onChangelog();
    });

    // More tab
    this.els['redeem-btn'].addEventListener('click', () => {
      this.handlers.onRedeem && this.handlers.onRedeem();
    });
    this.els['redeem-input'].addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handlers.onRedeem && this.handlers.onRedeem();
    });
    this.els['gm-open-btn'].addEventListener('click', () => {
      this.handlers.onOpenGM && this.handlers.onOpenGM();
    });
    this.els['logout-btn'].addEventListener('click', () => {
      this.handlers.onLogout && this.handlers.onLogout();
    });
    this.els['set-dmgnums'].checked = !!this.settings.damageNumbers;
    this.els['set-motion'].checked = !!this.settings.reduceMotion;
    this.els['set-dmgnums'].addEventListener('change', (e) => this.saveSetting('damageNumbers', e.target.checked));
    this.els['set-motion'].addEventListener('change', (e) => {
      this.saveSetting('reduceMotion', e.target.checked);
      document.body.classList.toggle('reduce-motion', e.target.checked);
    });
    // UI style segmented control (More → Settings)
    const seg = document.getElementById('ui-style-seg');
    if (seg) {
      seg.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => this.handlers.onUiStyle && this.handlers.onUiStyle(b.dataset.uistyle));
      });
    }
    this.setUiStyleSeg(document.body.dataset.uistyle === 'classic' ? 'classic' : 'modern');

    // GM back button
    const gmBack = this.els['gm-back'];
    if (gmBack) gmBack.addEventListener('click', () => this.showView('app'));
  },

  saveSetting(key, val) {
    this.settings[key] = val;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
  },

  // ---------------- views & tabs ----------------
  showView(name) {
    for (const v of ['auth', 'race', 'class', 'pet', 'spec', 'app', 'gm', 'maintenance']) {
      document.getElementById('view-' + v).classList.toggle('hidden', v !== name);
    }
    window.scrollTo(0, 0);
  },

  // Maintenance screen (full view) + slim in-app banner.
  showMaintenance(message) {
    const el = document.getElementById('maintenance-message');
    if (el && message) el.textContent = message;
    this.showView('maintenance');
  },
  setMaintenanceBanner(message) {
    const el = document.getElementById('maintenance-banner');
    if (!el) return;
    if (message) {
      el.textContent = '🛠️ ' + message;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  },

  showTab(name) {
    this.activeTab = name;
    $$('#tabbar .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('#tab-content .tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
    this.handlers.onTab && this.handlers.onTab(name);
  },

  // ---------------- toasts ----------------
  toast(msg, kind = 'info', ms = 2600) {
    const root = this.els['toast-root'];
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.textContent = msg;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, ms);
    while (root.children.length > 4) root.firstChild.remove();
  },

  // ---------------- modals ----------------
  // buttons: [{label, cls, onClick(close)}]; returns close fn.
  modal({ title, html, buttons, dismissable = true }) {
    const root = this.els['modal-root'];
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2 class="modal-title">${esc(title)}</h2>
        <div class="modal-body">${html}</div>
        <div class="modal-actions"></div>
      </div>`;
    const actions = overlay.querySelector('.modal-actions');
    const close = () => overlay.remove();
    for (const b of (buttons || [{ label: 'OK' }])) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.textContent = b.label;
      btn.addEventListener('click', () => { b.onClick ? b.onClick(close) : close(); });
      actions.appendChild(btn);
    }
    if (dismissable) {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    }
    root.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    return close;
  },

  confirm(title, html, okLabel = 'Confirm') {
    return new Promise((resolve) => {
      this.modal({
        title,
        html,
        buttons: [
          { label: 'Cancel', onClick: (close) => { close(); resolve(false); } },
          { label: okLabel, cls: 'danger', onClick: (close) => { close(); resolve(true); } },
        ],
      });
    });
  },

  levelUpModal(levels) {
    const last = levels[levels.length - 1];
    this.modal({
      title: '⬆️ Level up!',
      html: `<p class="big">You reached <b>level ${last}</b>${levels.length > 1 ? ` <span class="muted">(+${levels.length - 1} more)</span>` : ''}!</p>
             <p class="muted">+3 Attack · +25 Max HP · +2 Defense per level<br>Hero healed for 25% max HP.</p>`,
      buttons: [{ label: 'Nice!', cls: 'gold' }],
    });
  },

  bossModal(enemy) {
    this.modal({
      title: '👹 Boss approaches!',
      html: `<p class="big"><b>${esc(enemy.name)}</b></p>
             <p class="muted">Stage ${enemy.stage} boss — 2.5× HP, hits 1.4× harder.<br>Bosses always drop rare+ loot and grant ⭐.</p>`,
      buttons: [{ label: '⚔️ Fight!', cls: 'danger' }],
    });
  },

  offlineModal(off, levels) {
    const hrs = Math.floor(off.minutes / 60), mins = off.minutes % 60;
    const away = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    this.modal({
      title: '🌙 While you were away…',
      html: `<p class="muted">Gone for ${away}${off.capped ? ' (capped at 8h)' : ''}.</p>
             <div class="offline-gains">
               <div>⚔️ <b>${formatNum(off.kills)}</b> battles</div>
               <div>💰 <b>+${formatNum(off.gold)}</b> gold</div>
               <div>✨ <b>+${formatNum(off.gains_xp ?? off.xp)}</b> XP</div>
               ${levels.length ? `<div>⬆️ <b>Level ${levels[levels.length - 1]}</b> reached!</div>` : ''}
             </div>`,
      buttons: [{ label: 'Claim', cls: 'gold' }],
    });
  },

  // ---------------- HUD ----------------
  updateHUD(state, user) {
    const e = this.els;
    const race = Engine.RACES[state.race] || {};
    const cls = Engine.CLASSES[state.playerClass] || {};
    const spec = Engine.SPECS[state.spec] || {};
    e['hud-emoji'].textContent = race.emoji || '❓';
    e['hud-username'].textContent = (user && user.username) || '—';
    const role = (user && user.role) || 'player';
    e['hud-role'].textContent = role;
    e['hud-role'].className = 'role-badge role-' + role;
    e['hud-race'].textContent = (cls.emoji ? cls.emoji : '') + (spec.emoji ? spec.emoji : '') + ' ' + (race.name || '');
    e['hud-gold'].textContent = state.infGold ? '∞' : formatNum(state.gold);
    e['hud-stars'].textContent = formatNum(state.stars);
    e['hud-stage'].textContent = state.stage;
    e['hud-level'].textContent = state.level;
    const pct = state.xpNext > 0 ? Math.min(100, (state.xp / state.xpNext) * 100) : 0;
    e['hud-xpfill'].style.width = pct + '%';
    e['hud-xptext'].textContent = `${formatNum(state.xp)} / ${formatNum(state.xpNext)} XP`;
  },

  setSaveIndicator(text, ok = true) {
    const el = this.els['save-indicator'];
    el.textContent = text;
    el.classList.toggle('bad', !ok);
  },

  // ---------------- race select ----------------
  renderRaceSelect(onPick) {
    const grid = this.els['race-grid'];
    grid.innerHTML = '';
    for (const [id, r] of Object.entries(Engine.RACES)) {
      const card = document.createElement('button');
      card.className = 'race-card';
      card.innerHTML = `
        <div class="race-emoji">${r.emoji}</div>
        <div class="race-name">${esc(r.name)}</div>
        <div class="race-trait">${esc(r.trait)}</div>`;
      card.addEventListener('click', () => onPick(id));
      grid.appendChild(card);
    }
  },

  // Class picker cards (character creation). Permanent choice.
  classCardHtml(id, c) {
    return `
      <div class="race-emoji">${c.emoji}</div>
      <div class="race-name">${esc(c.name)}</div>
      <div class="race-trait">${esc(c.desc)}</div>
      <div class="class-perks">${c.perks.map(p => `<div>✦ ${esc(p)}</div>`).join('')}</div>`;
  },
  renderClassSelect(onPick) {
    const grid = this.els['class-grid'];
    grid.innerHTML = '';
    for (const [id, c] of Object.entries(Engine.CLASSES)) {
      const card = document.createElement('button');
      card.className = 'race-card class-card';
      card.innerHTML = this.classCardHtml(id, c);
      card.addEventListener('click', () => onPick(id));
      grid.appendChild(card);
    }
  },

  // Specialization picker (character creation, after class). Permanent choice.
  renderSpecSelect(onPick) {
    const grid = this.els['spec-grid'];
    grid.innerHTML = '';
    for (const [id, s] of Object.entries(Engine.SPECS)) {
      const card = document.createElement('button');
      card.className = 'race-card class-card';
      card.innerHTML = this.classCardHtml(id, s);
      card.addEventListener('click', () => onPick(id));
      grid.appendChild(card);
    }
  },

  // Hunter starter-pet picker (character creation, after Hunter class). Permanent choice.
  renderPetSelect(onPick) {
    const grid = this.els['pet-grid'];
    grid.innerHTML = '';
    for (const id of Engine.HUNTER_STARTERS) {
      const sp = Engine.PET_SPECIES[id];
      if (!sp) continue;
      const card = document.createElement('button');
      card.className = 'race-card class-card';
      card.innerHTML = `
      <div class="race-emoji">${sp.emoji}</div>
      <div class="race-name">${esc(sp.name)}</div>
      <div class="race-trait">${esc(sp.flavor || sp.rarity)}</div>
      <div class="class-perks"><div>✦ ${esc(sp.style || 'A loyal beast')}</div></div>`;
      card.addEventListener('click', () => onPick(id));
      grid.appendChild(card);
    }
  },

  // One-time class + spec choice for existing players missing either.
  // Not dismissable — one tap per section, then the game continues.
  // opts.lockedClass: when the player already has a class, only spec is asked.
  // opts.needsPet: when true and the picked class is Hunter, a companion pick
  //   is added (for players with no pets yet).
  classSpecChoiceModal(onPick, opts = {}) {
    const lockedClass = opts.lockedClass && Engine.CLASSES[opts.lockedClass] ? opts.lockedClass : null;
    const needsPet = !!opts.needsPet;
    const mkCards = (defs) => Object.entries(defs).map(([id, c]) => `
      <button class="race-card class-card" data-pick="${id}">${this.classCardHtml(id, c)}</button>`).join('');
    const mkPetCards = () => Engine.HUNTER_STARTERS.map((id) => {
      const sp = Engine.PET_SPECIES[id];
      return `<button class="race-card class-card" data-pick="${id}">
        <div class="race-emoji">${sp.emoji}</div>
        <div class="race-name">${esc(sp.name)}</div>
        <div class="race-trait">${esc(sp.flavor || sp.rarity)}</div>
        <div class="class-perks"><div>✦ ${esc(sp.style || 'A loyal beast')}</div></div></button>`;
    }).join('');
    const classSection = lockedClass
      ? `<p class="muted">You are ${Engine.CLASSES[lockedClass].emoji} <b>${esc(Engine.CLASSES[lockedClass].name)}</b> — now choose your specialization.</p>`
      : `<h3 class="pick-label">⚔️ Choose your class</h3>
         <div class="race-grid class-modal-grid" data-group="class">${mkCards(Engine.CLASSES)}</div>`;
    const close = this.modal({
      title: lockedClass ? '🛡️ Choose your specialization' : '⚔️ Choose your class & specialization',
      html: `<p class="muted">Your class, specialization${needsPet ? ', and companion' : ''} are <b>permanent</b> choices.</p>${classSection}
             <h3 class="pick-label">🛡️ Choose your specialization</h3>
             <div class="race-grid class-modal-grid" data-group="spec">${mkCards(Engine.SPECS)}</div>
             <div data-pet-section class="hidden">
               <h3 class="pick-label">🐾 Choose your companion</h3>
               <div class="race-grid class-modal-grid" data-group="pet">${mkPetCards()}</div>
             </div>`,
      buttons: [],
      dismissable: false,
    });
    const overlay = this.els['modal-root'].lastElementChild;
    if (!overlay) return;
    let pickedClass = lockedClass;
    let pickedSpec = null;
    let pickedPet = null;
    const petNeeded = () => needsPet && pickedClass === 'hunter';
    const paint = () => {
      for (const grid of overlay.querySelectorAll('.class-modal-grid')) {
        const group = grid.dataset.group;
        for (const btn of grid.querySelectorAll('[data-pick]')) {
          const active = (group === 'class' && btn.dataset.pick === pickedClass) ||
                         (group === 'spec' && btn.dataset.pick === pickedSpec) ||
                         (group === 'pet' && btn.dataset.pick === pickedPet);
          btn.classList.toggle('picked', active);
        }
      }
      const petSection = overlay.querySelector('[data-pet-section]');
      if (petSection) {
        const show = petNeeded();
        petSection.classList.toggle('hidden', !show);
        if (!show) pickedPet = null;
      }
    };
    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick]');
      if (!btn) return;
      const group = btn.closest('.class-modal-grid').dataset.group;
      if (group === 'class') pickedClass = btn.dataset.pick;
      else if (group === 'spec') pickedSpec = btn.dataset.pick;
      else pickedPet = btn.dataset.pick;
      paint();
      if (pickedClass && pickedSpec && (!petNeeded() || pickedPet)) {
        close();
        onPick(pickedClass, pickedSpec, pickedPet || null);
      }
    });
    paint();
  },

  // ---------------- battle ----------------
  renderBattle(state) {
    this.setMode(state.mode);
    const showPrestige = state.level >= 70;
    this.els['prestige-box'].classList.toggle('hidden', !showPrestige);
    if (showPrestige) {
      this.els['prestige-note'].innerHTML =
        `Reset to level 1 / stage 1 for <b class="gold-text">+25% damage & gold</b> (now +${state.prestigeBonus || 0}%).<br>` +
        `<span class="muted">Keeps: privileged gear sets, ⭐ stars, lifetime stats.</span>`;
    }
    this.updateHeroPanel(state, Engine.computeStats(state), null);
  },

  setMode(mode) {
    $$('#mode-switch .mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const tapBtn = this.els['tap-btn'];
    tapBtn.classList.toggle('hidden', mode !== 'clicker');
    this.els['skill-btn'].classList.toggle('hidden', false);
  },

  setEnemy(enemy) {
    const e = this.els;
    // A fresh enemy never inherits the previous one's hit/death animation.
    e['enemy-card'].classList.remove('modern-hit', 'modern-death');
    const zone = Engine.zoneFor(enemy.stage);
    e['enemy-sprite'].textContent = enemy.emoji;
    e['enemy-name'].textContent = enemy.name;
    // Raid waves show the wave counter instead of the stage.
    e['enemy-stage'].textContent = enemy.raidWave
      ? `🌀 Raid — Wave ${enemy.raidWave}`
      : `Stage ${enemy.stage} · ${zone.emoji} ${zone.name}`;
    e['boss-badge'].classList.toggle('hidden', !enemy.boss);
    e['enemy-card'].classList.toggle('boss', !!enemy.boss);
    e['enemy-atk'].textContent = `⚔️ ${formatNum(enemy.attack)} attack`;
    this.updateEnemy(enemy);
  },

  updateEnemy(enemy) {
    const e = this.els;
    const pct = enemy.maxHp > 0 ? Math.max(0, (enemy.hp / enemy.maxHp) * 100) : 0;
    e['enemy-hpfill'].style.width = pct + '%';
    e['enemy-hptext'].textContent = `${formatNum(Math.max(0, enemy.hp))} / ${formatNum(enemy.maxHp)}`;
  },

  // Light per-tick refresh: hero bars, chips, skill cooldown.
  updateBattle(state, stats, battle) {
    const e = this.els;
    const pct = stats.maxHp > 0 ? Math.max(0, (state.hero.hp / stats.maxHp) * 100) : 0;
    e['hero-hpfill'].style.width = pct + '%';
    e['hero-hptext'].textContent = `❤️ ${formatNum(Math.max(0, Math.ceil(state.hero.hp)))} / ${formatNum(stats.maxHp)}`;
    // Low HP warning: pulse the hero HP bar red under 30%.
    const hpFrac = stats.maxHp > 0 ? state.hero.hp / stats.maxHp : 1;
    e['hero-hpfill'].parentElement.classList.toggle('hp-low', hpFrac < 0.3 && hpFrac > 0);
    if (battle && battle.enemy) this.updateEnemy(battle.enemy);
    // skill cooldown
    if (battle && battle.skillReadyAt) {
      const remain = Math.max(0, battle.skillReadyAt - Date.now());
      const btn = e['skill-btn'];
      btn.disabled = remain > 0;
      e['skill-cd'].textContent = remain > 0 ? `(${(remain / 1000).toFixed(0)}s)` : '';
    }
    this.updateHUD(state, battle ? battle.user : null);
  },

  updateHeroPanel(state, stats, battle) {
    const setLine = stats.setInfo
      ? `<div class="set-active">👑 ${esc(stats.setInfo.name)} <b>+${stats.setInfo.pct}% all stats</b></div>` : '';
    const pSet = stats.playerSetInfo;
    const pSetLine = pSet && pSet.count >= 3
      ? `<div class="set-active" title="${esc(pSet.desc)}">${pSet.emoji} ${esc(pSet.name)} <b>(${pSet.count}pc)</b></div>` : '';
    const rested = state.restedUntil && Date.now() < state.restedUntil
      ? `<span class="buff-chip" title="Well-rested: +25% XP">😴 rested</span>` : '';
    // Active pet fights beside the hero — show its face next to the stats.
    const pet = Engine.activePet(state);
    const sp = pet && Engine.petSpeciesOf(pet);
    const petChip = sp
      ? `<span class="buff-chip" title="${esc(sp.name)} Lv ${pet.level} — strikes every 4s">${sp.emoji} Lv ${pet.level}</span>` : '';
    // Pet bond contribution (flat, added after multipliers) — small chip when nonzero.
    const bond = stats.bond || { atk: 0, def: 0, hp: 0 };
    const bondChip = (bond.atk + bond.def + bond.hp) > 0
      ? `<span class="buff-chip" title="Pet bond: +${bond.atk} ATK, +${bond.def} DEF, +${bond.hp} max HP">🔗 +${bond.atk}⚔️ +${bond.def}🛡️ +${bond.hp}❤️</span>` : '';
    this.els['hero-stats'].innerHTML = `
      <span>⚔️ ${formatNum(stats.attack)}</span>
      <span>🛡️ ${formatNum(stats.defense)}</span>
      <span>💥 ${Engine.round1(stats.critChance)}%</span>
      <span>🥾 ${Engine.round1(stats.dodge)}%</span>
      ${rested}
      ${petChip}
      ${bondChip}
      ${setLine}
      ${pSetLine}`;
    // dungeon party mini-cards
    const chips = this.els['dungeon-chips'];
    if (state.mode === 'dungeon' && state.party.length) {
      chips.innerHTML = state.party.map(c =>
        `<div class="member mini${c.hp <= 0 ? ' down' : ''}" title="${esc(c.name)}">${this.memberCardHTML(c, true)}</div>`
      ).join('');
      chips.classList.remove('hidden');
    } else {
      chips.classList.add('hidden');
      chips.innerHTML = '';
    }
  },

  floatText(text, kind = 'dmg') {
    if (!this.settings.damageNumbers && (kind === 'dmg' || kind === 'crit')) return;
    const layer = this.els['float-layer'];
    const el = document.createElement('div');
    el.className = 'float-txt float-' + kind;
    el.textContent = text;
    el.style.left = (20 + Math.random() * 60) + '%';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
    while (layer.children.length > 12) layer.firstChild.remove();
  },

  // ---------------- modern theme animation hooks ----------------
  // All modern-theme motion is CSS under body[data-uistyle="modern"].
  // These hooks no-op unless the modern theme is active and motion is allowed.
  _canAnimate() {
    return document.body.dataset.uistyle !== 'classic' && !this.settings.reduceMotion;
  },

  // Syncs the Settings segmented control to the active theme.
  setUiStyleSeg(style) {
    const seg = document.getElementById('ui-style-seg');
    if (!seg) return;
    const cur = style === 'classic' ? 'classic' : 'modern';
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.uistyle === cur));
  },

  // Quick shake + white flash on the enemy card when it takes a hit.
  enemyHitFlash() {
    if (!this._canAnimate()) return;
    const card = this.els['enemy-card'];
    if (!card) return;
    card.classList.remove('modern-hit');
    void card.offsetWidth; // restart the animation
    card.classList.add('modern-hit');
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => card.classList.remove('modern-hit'), 220);
  },

  // Fade/scale-out on the enemy card when it dies. Returns true when an
  // animation will play — the caller should delay spawning the next enemy.
  enemyDeathFade() {
    if (!this._canAnimate()) return false;
    const card = this.els['enemy-card'];
    if (!card) return false;
    card.classList.remove('modern-death');
    void card.offsetWidth;
    card.classList.add('modern-death');
    return true;
  },

  combatLog(msg, kind = '') {
    const log = this.els['combat-log'];
    const line = document.createElement('div');
    line.className = 'log-line ' + kind;
    line.textContent = msg;
    log.prepend(line);
    while (log.children.length > 6) log.lastChild.remove();
  },

  setDead(show) {
    this.els['dead-overlay'].classList.toggle('hidden', !show);
    this.els['tap-btn'].disabled = show;
  },

  // Tap combo meter (clicker mode). frenzyMsLeft > 0 while frenzy is active.
  updateCombo(combo, frenzy, frenzyMsLeft = 0) {
    const el = this.els['combo-meter'];
    if (!el) return;
    if (!combo || combo < 2) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    const pct = Math.min(100, (combo / 200) * 100);
    el.innerHTML = frenzy
      ? `<div class="combo-frenzy">⚡ FRENZY ${(frenzyMsLeft / 1000).toFixed(0)}s — 2× tap damage!</div>
         <div class="combo-bar"><div style="width:${pct}%"></div></div>`
      : `<div class="combo-count">🔥 ${combo} combo <span class="muted small">(+${Math.min(combo, 200) / 2}% tap dmg)</span></div>
         <div class="combo-bar"><div style="width:${pct}%"></div></div>`;
  },

  // ---------------- damage meter ----------------
  _meterKey: null,

  // snapshot: {rows: [{key,label,dps,total,pct}], totalDps}
  renderMeter(snapshot) {
    const rowsEl = this.els['meter-rows'];
    if (!rowsEl) return;
    const key = (snapshot.rows || []).map(r => r.key).join('|');
    if (key !== this._meterKey) {
      // fighter set changed (new fight) — rebuild rows
      this._meterKey = key;
      rowsEl.innerHTML = '';
      const palette = [
        'linear-gradient(90deg,#f0b429,#c77f1a)',
        'linear-gradient(90deg,#74c0fc,#3b82c4)',
        'linear-gradient(90deg,#b197fc,#7b5fc7)',
        'linear-gradient(90deg,#63e6be,#2f9e44)',
      ];
      (snapshot.rows || []).forEach((r, i) => {
        const row = document.createElement('div');
        row.className = 'meter-row';
        row.dataset.fkey = r.key;
        row.innerHTML =
          `<div class="meter-info"><span class="meter-name">${esc(r.label)}</span>` +
          `<span class="meter-dps" data-m="dps">0 DPS</span>` +
          `<span class="meter-pct" data-m="pct">0%</span></div>` +
          `<div class="meter-track"><div class="meter-fill" data-m="bar" style="background:${palette[i % palette.length]}"></div></div>`;
        rowsEl.appendChild(row);
      });
      if (!snapshot.rows || !snapshot.rows.length) {
        rowsEl.innerHTML = '<p class="muted small center">No damage yet — the fight just started!</p>';
      }
    }
    this.els['total-dps'].textContent = formatNum(snapshot.totalDps) + ' DPS';
    for (const r of (snapshot.rows || [])) {
      const row = rowsEl.querySelector(`[data-fkey="${CSS.escape(r.key)}"]`);
      if (!row) continue;
      row.querySelector('[data-m="dps"]').textContent = formatNum(r.dps) + ' DPS';
      row.querySelector('[data-m="pct"]').textContent = Math.round(r.pct) + '%';
      row.querySelector('[data-m="bar"]').style.width = Math.min(100, r.pct) + '%';
    }
  },

  // ---------------- party cards ----------------
  // Deterministic portrait hue from a name.
  portraitHue(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  },

  memberCardHTML(c, mini = false) {
    const hue = this.portraitHue(c.name);
    const initial = (c.name || '?').trim().charAt(0).toUpperCase();
    const pct = c.maxHp > 0 ? Math.max(0, (c.hp / c.maxHp) * 100) : 0;
    if (mini) {
      return `
      <div class="portrait" style="background:linear-gradient(135deg,hsl(${hue},45%,38%),hsl(${(hue + 40) % 360},50%,24%))">${esc(initial)}</div>
      <div class="member-name">${esc(c.name)}</div>
      <div class="member-role">${esc(c.role || 'Companion')}</div>
      <div class="hpbar mini-hp"><div class="hpfill" data-comp-hp="${esc(c.id)}" style="width:${pct}%"></div></div>
      <div class="member-hptext" data-comp-hptext="${esc(c.id)}">${formatNum(Math.max(0, Math.ceil(c.hp)))} / ${formatNum(c.maxHp)}</div>`;
    }
    const tier = ((Engine.RECRUIT_BY_ID || {})[c.recruitId] || {}).tier || 'common';
    const tierCls = `tier-${String(tier).toLowerCase()}`;
    return `
      <div class="member-top">
        <div class="portrait" style="background:linear-gradient(135deg,hsl(${hue},45%,38%),hsl(${(hue + 40) % 360},50%,24%))">${esc(initial)}</div>
        <div class="member-id">
          <div class="member-name">${esc(c.name)} <span class="lvl-badge">Lv ${c.level}</span></div>
          <div class="member-role">${esc(c.role || 'Companion')} · <span class="tier-badge ${tierCls}">${esc(tier)}</span></div>
        </div>
      </div>
      <div class="hpbar mini-hp"><div class="hpfill" data-comp-hp="${esc(c.id)}" style="width:${pct}%"></div></div>
      <div class="member-hptext" data-comp-hptext="${esc(c.id)}">${formatNum(Math.max(0, Math.ceil(c.hp)))} / ${formatNum(c.maxHp)}</div>
      <div class="member-stats">⚔️ ${formatNum(c.attack)} · 🛡️ ${formatNum(c.defense)} · ❤️ ${formatNum(c.maxHp)}${c.regen ? ` · 💚 ${c.regen}/s` : ''}</div>`;
  },

  // Refreshes party HP bars in place (called on a low-frequency tick) so
  // party-tab cards and dungeon mini-cards stay live without full re-render.
  refreshPartyBars(state) {
    if (!state) return;
    for (const c of (state.party || [])) {
      const pct = c.maxHp > 0 ? Math.max(0, (c.hp / c.maxHp) * 100) : 0;
      const txt = `${formatNum(Math.max(0, Math.ceil(c.hp)))} / ${formatNum(c.maxHp)}`;
      $$(`[data-comp-hp="${CSS.escape(c.id)}"]`).forEach(el => { el.style.width = pct + '%'; });
      $$(`[data-comp-hptext="${CSS.escape(c.id)}"]`).forEach(el => { el.textContent = txt; });
    }
  },

  // ---------------- gear ----------------
  renderGear(state) {
    // loadout strip: one card per slot showing the equipped item
    const strip = this.els['loadout-strip'];
    if (strip && Engine.SLOTS) {
      strip.innerHTML = Engine.SLOTS.map(slot => {
        const id = state.equipped && state.equipped[slot];
        const item = id && (state.inventory || []).find(i => i.id === id);
        const info = (Engine.SLOT_INFO || {})[slot] || {};
        if (!item) {
          return `<div class="loadout-slot empty"><span class="loadout-emoji">${info.emoji || '▫️'}</span><span class="loadout-name muted">${info.name || slot}</span><span class="muted tiny">empty</span></div>`;
        }
        return `<div class="loadout-slot r-${item.rarity}${item.set ? ' set-item' : ''}">
          <span class="loadout-emoji">${info.emoji || '🎒'}</span>
          <span class="loadout-name" title="${esc(item.name)}">${esc(item.name)}</span>
          <span class="loadout-rarity">${esc(item.rarity)}</span>
        </div>`;
      }).join('');
    }

    // upgrades
    const ul = this.els['upgrade-list'];
    ul.innerHTML = '';
    for (const [kind, info] of Object.entries(Engine.UPGRADE_INFO)) {
      const lvl = (state.upgrades && state.upgrades[kind]) || 1;
      const cost = Engine.upgradeCost(kind, lvl);
      const afford = state.gold >= cost;
      const row = document.createElement('div');
      row.className = 'upgrade-row';
      row.innerHTML = `
        <div class="upgrade-info"><span class="upgrade-emoji">${info.emoji}</span>
          <div><div class="upgrade-name">${info.name} <b>Lv ${lvl}</b></div>
          <div class="muted small">${info.desc}</div></div></div>
        <button class="btn small ${afford ? '' : 'disabled'}" data-upgrade="${kind}" ${afford ? '' : 'disabled'}>
          💰 ${formatNum(cost)}
        </button>`;
      ul.appendChild(row);
    }

    // Earnable-set chase progress: pieces equipped of each player set.
    const prog = this.els['set-progress'];
    if (prog && Engine.PLAYER_SETS) {
      const counts = Engine.equippedPlayerSets(state);
      const rows = Object.entries(Engine.PLAYER_SETS).map(([setId, def]) => {
        const n = counts[setId] || 0;
        const bonus = n >= 5 ? ' <b class="set-bonus-on">3pc + 5pc active</b>'
          : n >= 3 ? ' <b class="set-bonus-on">3pc active</b>' : '';
        const need = n < 3 ? ` <span class="muted">(${3 - n} more for 3pc)</span>`
          : n < 5 ? ` <span class="muted">(${5 - n} more for 5pc)</span>` : '';
        return `<div class="set-prog-row${n >= 3 ? ' on' : ''}">${def.emoji} ${esc(def.name)} <b>${n}/5</b>${bonus}${need}</div>`;
      }).join('');
      prog.innerHTML = rows;
    }

    // inventory
    const grid = this.els['inventory-grid'];
    const inv = [...(state.inventory || [])].sort((a, b) =>
      (Engine.RARITY_IDX[b.rarity] ?? 0) - (Engine.RARITY_IDX[a.rarity] ?? 0));
    this.els['inv-count'].textContent = `(${inv.length})`;
    grid.innerHTML = '';
    if (!inv.length) {
      grid.innerHTML = '<p class="muted empty">No gear yet — defeat enemies to loot gear!</p>';
      return;
    }
    for (const item of inv) {
      const equippedId = state.equipped && state.equipped[item.slot];
      const isEquipped = equippedId === item.id;
      const card = document.createElement('div');
      const ps = Engine.PRIVILEGED_SETS && Engine.PRIVILEGED_SETS[item.set];
      const pSetDef = Engine.PLAYER_SETS && Engine.PLAYER_SETS[item.set];
      const auraCls = ps && ps.auraClass ? ps.auraClass : (item.set === 'sovereign' ? 'set-sovereign' : '');
      card.className = `item-card r-${item.rarity}${item.set ? ' set-item' : ''}${auraCls ? ' ' + auraCls : ''}${isEquipped ? ' equipped' : ''}`;
      card.dataset.id = item.id;
      const statChips = Object.entries(item.stats || {})
        .map(([k, v]) => {
          const e = STAT_EMOJI[k] || '✨';
          const label = Engine.STAT_LABELS[k] || k;
          return `<span class="stat-chip" title="${esc(label)}">${e} +${formatStatVal(k, v)}</span>`;
        }).join('');
      const setBadge = item.set
        ? ps
          ? `<div class="set-badge${auraCls ? ' set-badge-' + item.set : ''}">👑 ${esc(item.setName || item.set)} · full set +${ps.setBonus}%</div>`
          : pSetDef
            ? `<div class="set-badge set-badge-player" title="${esc(pSetDef.desc)}">${pSetDef.emoji} ${esc(pSetDef.name)} · earnable set</div>`
            : `<div class="set-badge">${esc(item.setName || item.set)}</div>`
        : '';
      card.innerHTML = `
        <div class="item-head">
          <span class="slot-emoji">${Engine.SLOT_INFO[item.slot]?.emoji || '🎒'}</span>
          <span class="item-name">${esc(item.name)}</span>
          ${isEquipped ? '<span class="equipped-tag">EQUIPPED</span>' : ''}
        </div>
        <div class="item-sub">${esc(item.rarity)} · ${esc(Engine.SLOT_INFO[item.slot]?.name || item.slot)}</div>
        ${setBadge}
        <div class="stat-chips">${statChips}</div>
        <div class="item-actions">
          ${isEquipped ? '' : `<button class="btn small" data-action="equip">Equip</button>`}
          ${item.unsellable ? '' : `<button class="btn small ghost" data-action="sell">Sell +${formatNum(item.value || 1)}</button>`}
        </div>`;
      grid.appendChild(card);
    }
  },

  // ---------------- party ----------------
  renderParty(state) {
    const slots = this.els['party-slots'];
    slots.innerHTML = '';
    for (let i = 0; i < Engine.MAX_PARTY; i++) {
      const c = state.party[i];
      const div = document.createElement('div');
      div.className = 'member' + (c ? '' : ' empty');
      if (c) {
        const lvlCost = Engine.companionLevelCost(c);
        div.innerHTML = `
          ${this.memberCardHTML(c)}
          <div class="member-actions">
            <button class="btn small lvl-btn" data-action="levelup" data-id="${esc(c.id)}" ${state.gold >= lvlCost ? '' : 'disabled'}>
              ⬆️ Lv ${c.level + 1} · 💰${formatNum(lvlCost)}
            </button>
            <button class="btn small ghost icon-btn" data-action="dismiss" data-id="${esc(c.id)}" title="Dismiss ${esc(c.name)}">✕</button>
          </div>`;
      } else {
        div.innerHTML = '<div class="empty-slot-inner"><span class="empty-plus">＋</span><span>Empty slot</span><span class="muted small">recruit below</span></div>';
      }
      slots.appendChild(div);
    }

    const list = this.els['recruit-list'];
    list.innerHTML = '';
    const ownedIds = new Set(state.party.map(c => c.id));
    for (const r of Engine.RECRUITS) {
      const owned = state.party.some(c => c.name === r.name);
      const full = state.party.length >= Engine.MAX_PARTY;
      const afford = state.gold >= r.cost;
      const disabled = owned || full || !afford;
      const reason = owned ? 'Recruited' : full ? 'Party full' : !afford ? 'Need 💰' : '';
      const tier = (r.tier || 'common').toLowerCase();
      const tierBadge = `<span class="tier-badge tier-${tier}">${tier}</span>`;
      const row = document.createElement('div');
      row.className = 'recruit-row recruit-' + tier;
      row.innerHTML = `
        <div class="recruit-info"><span class="comp-emoji">${r.emoji}</span>
          <div><div class="comp-name">${esc(r.name)} ${tierBadge}</div>
          <div class="muted small">⚔️${r.atk} 🛡️${r.def} ❤️${r.hp} · scales with your level</div></div></div>
        <button class="btn small" data-action="recruit" data-id="${r.id}" ${disabled ? 'disabled' : ''}>
          ${owned ? '✔' : `💰 ${formatNum(r.cost)}`} ${reason && !owned ? `<span class="muted small">${reason}</span>` : ''}
        </button>`;
      list.appendChild(row);
    }
    void ownedIds;
    this.renderPets(state);
  },

  // ---------------- pets ----------------
  // Pets UI lives in the Party tab. Species cards show level, hunger, and
  // feed/set-active actions; eggs hatch instantly from here.
  renderPets(state) {
    const panel = this.els['pets-panel'];
    panel.innerHTML = '';
    const p = Engine.ensurePets(state);
    const eggRow = document.createElement('div');
    eggRow.className = 'pet-eggs';
    eggRow.innerHTML = `
      <div class="row-between">
        <span>🥚 Pet eggs: <b>${p.eggs}</b> <span class="muted small">(bosses drop them)</span></span>
        <button class="btn small" data-action="hatch-pet" ${p.eggs < 1 ? 'disabled' : ''}>Hatch 🥚</button>
      </div>`;
    panel.appendChild(eggRow);
    if (!p.collection.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = 'No pets yet. Slay bosses for a chance at a pet egg!';
      panel.appendChild(empty);
      return;
    }
    const list = document.createElement('div');
    list.className = 'pet-list';
    for (const pet of p.collection) {
      const sp = Engine.petSpeciesOf(pet);
      const active = pet.uid === p.activeUid;
      const cost = Engine.petFeedCost(pet, state);
      const hungerPct = Math.round(pet.hunger);
      const hungerLabel = pet.hunger <= 0 ? 'hungry — sits out!' : pet.hunger <= 50 ? 'peckish (40% dmg)' : 'full power';
      const ps = Engine.petStats(pet);
      const pb = Engine.petBondFor(pet);
      const bondNote = pet.hunger <= 0 ? ' — starving, no bond' : pet.hunger <= 50 ? ' (40% — hungry)' : '';
      const bondText = active
        ? `🔗 Bond active: +${pb.atk} ATK / +${pb.def} DEF / +${pb.hp} HP${bondNote}`
        : `🔗 Bond: +${pb.atk} ATK / +${pb.def} DEF / +${pb.hp} HP (applies when active)`;
      const row = document.createElement('div');
      row.className = 'pet-card' + (active ? ' active' : '');
      row.innerHTML = `
        <div class="pet-head"><span class="pet-emoji">${sp.emoji}</span>
          <div><div class="comp-name">${esc(sp.name)} <span class="muted small">Lv ${pet.level}</span></div>
          <div class="muted small">${esc(sp.rarity)} · strikes every 4s</div></div>
          ${active ? '<span class="pet-active">ACTIVE</span>' : ''}
        </div>
        <div class="muted small">📊 ${ps.atk} ATK · ${ps.def} DEF · ${ps.hp} HP</div>
        <div class="muted small">${bondText}</div>
        <div class="pet-hunger"><div class="bar hunger"><div class="fill" style="width:${hungerPct}%"></div></div>
          <span class="muted small">🍖 ${hungerPct}% ${hungerLabel}</span></div>
        <div class="row">
          <button class="btn small" data-action="feed-pet" data-id="${esc(pet.uid)}" ${pet.hunger >= 100 ? 'disabled' : ''}>🍖 Feed (💰${formatNum(cost)})</button>
          ${active ? '' : `<button class="btn small ghost" data-action="set-active-pet" data-id="${esc(pet.uid)}">Set active</button>`}
        </div>`;
      list.appendChild(row);
    }
    panel.appendChild(list);
  },

  // ---------------- ranks ----------------
  renderRanks(entries, meUsername) {
    const body = this.els['lb-body'];
    body.innerHTML = '';
    if (!entries.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted center">No heroes yet.</td></tr>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    entries.forEach((en, i) => {
      const tr = document.createElement('tr');
      if (en.username === meUsername) tr.className = 'me-row';
      const race = Engine.RACES[en.race] || {};
      const cls = Engine.CLASSES[en.playerClass] || {};
      const spec = Engine.SPECS[en.spec] || {};
      const title = en.title ? `<div class="lb-title">${esc(Engine.titleName(en.title))}</div>` : '';
      const flag = en.country ? Engine.countryFlag(en.country) : '';
      const badge = en.badge ? Engine.badgeDef(en.badge) : null;
      const badgeHtml = badge ? `<span class="lb-badge" title="${esc(badge.name)}">${badge.emoji}</span> ` : '';
      tr.innerHTML = `
        <td>${medals[i] || (i + 1)}</td>
        <td><div class="lb-name">${flag ? flag + ' ' : ''}${badgeHtml}${cls.emoji ? cls.emoji + ' ' : ''}${spec.emoji ? spec.emoji + ' ' : ''}${race.emoji || ''} ${esc(en.username)}</div>${title}</td>
        <td>${en.level}</td>
        <td>${en.stage}</td>
        <td>${formatNum(en.power || 0)}</td>
        <td>${en.bossesKilled}</td>
        <td>${en.prestige > 0 ? '🔥' + en.prestige : '—'}</td>`;
      body.appendChild(tr);
    });
  },

  // ---------------- more ----------------
  renderMore(state, user) {
    const race = Engine.RACES[state.race] || {};
    const cls = Engine.CLASSES[state.playerClass] || {};
    const spec = Engine.SPECS[state.spec] || {};
    const role = (user && user.role) || 'player';
    this.role = role; // remembered for role-aware changelog filtering
    const canGM = role === 'owner' || role === 'gm' || role === 'admin' || role === 'moderator';
    this.els['gm-entry-card'].classList.toggle('hidden', !canGM);
    // Staff tab in the main nav: visible to staff only, opens the GM console.
    const staffBtn = document.getElementById('tabbtn-staff');
    if (staffBtn) staffBtn.classList.toggle('hidden', !canGM);
    const setCount = (state.inventory || []).filter(i => i.set).length;
    const unlocked = new Set(state.titlesUnlocked || ['wanderer']);
    const titleChips = Engine.TITLES.map(t => {
      const has = unlocked.has(t.id);
      const active = state.activeTitle === t.id;
      return has
        ? `<button class="title-chip${active ? ' active' : ''}" data-action="title" data-id="${t.id}" title="${esc(t.desc)}">${esc(t.name)}</button>`
        : `<span class="title-chip locked" title="${esc(t.desc)}">🔒 ${esc(t.name)}</span>`;
    }).join('');
    const badge = state.badge ? Engine.badgeDef(state.badge) : null;
    const countryOpts = `<option value="">— no flag —</option>` + Engine.COUNTRIES.map(c =>
      `<option value="${c.code}"${state.country === c.code ? ' selected' : ''}>${Engine.countryFlag(c.code)} ${esc(c.name)}</option>`).join('');
    this.els['profile-card'].innerHTML = `
      <div class="profile-head">
        <div class="profile-emoji">${race.emoji || '❓'}</div>
        <div>
          <div class="profile-name">${state.country ? Engine.countryFlag(state.country) + ' ' : ''}${badge ? badge.emoji + ' ' : ''}${esc(user ? user.username : '—')}</div>
          <div class="profile-title">${esc(Engine.titleName(state.activeTitle))}</div>
          <div><span class="role-badge role-${role}">${esc(role)}</span>
          <span class="muted small">${cls.emoji ? cls.emoji + ' ' : ''}${esc(cls.name ? cls.name + ' · ' : '')}${spec.emoji ? spec.emoji + ' ' : ''}${esc(spec.name ? spec.name + ' · ' : '')}${esc(race.name || '')}</span></div>
        </div>
      </div>
      <div class="titles-block">
        <div class="muted small titles-label">👑 Hero title</div>
        <div class="title-chips">${titleChips}</div>
      </div>
      <div class="titles-block">
        <div class="muted small titles-label">🌍 Country flag <span class="muted">(shows on leaderboard)</span></div>
        <select id="country-select" class="country-select">${countryOpts}</select>
      </div>
      <div class="profile-grid">
        <div><span class="muted">Level</span><b>${state.level}</b></div>
        <div><span class="muted">Stage</span><b>${state.stage}</b></div>
        <div><span class="muted">Bosses</span><b>${state.bossesKilled}</b></div>
        <div><span class="muted">Prestige</span><b>🔥${state.prestigeCount || 0} (+${state.prestigeBonus || 0}%)</b></div>
        <div><span class="muted">Kills</span><b>${formatNum(state.stats.kills)}</b></div>
        <div><span class="muted">Taps</span><b>${formatNum(state.stats.taps)}</b></div>
        <div><span class="muted">Best combo</span><b>🔥${formatNum(state.stats.maxCombo || 0)}</b></div>
        <div><span class="muted">Play time</span><b>${formatPlayTime(state.stats.playTimeSec)}</b></div>
        <div><span class="muted">Relic gear</span><b>👑 ${setCount}</b></div>
      </div>
      ${this.masteryCard(state)}
      ${this.professionsCard(state)}
      ${this.achievementsCard(state)}`;
    this.checkChangelogBadge();
  },

  // Staff viewers see every changelog item; players never see items flagged
  // "staff" (GM commands, privileged gear, staff tools).
  isStaffChangelogViewer() {
    return ['owner', 'admin', 'gm', 'moderator'].includes(this.role || 'player');
  },

  // Client-side mirror of the server's changelog filter, used only when the
  // /api/changelog endpoint is unreachable and we fall back to changelog.json.
  filterChangelog(log) {
    const isStaff = this.isStaffChangelogViewer();
    if (!Array.isArray(log)) return [];
    return log
      .filter(e => e && (isStaff || !e.staff))
      .map(e => ({
        ...e,
        changes: (e.changes || [])
          .filter(c => (typeof c === 'string') || (c && typeof c === 'object' && (isStaff || !c.staff)))
          .map(c => (typeof c === 'string' ? c : c.text)),
      }))
      .filter(e => e.changes.length);
  },

  // Role-aware changelog fetch: the server strips staff-only items for
  // players. Falls back to the static file (filtered client-side) if the
  // endpoint is unreachable.
  async fetchChangelog() {
    try {
      const r = await fetch('/api/changelog', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && Array.isArray(j.log)) return j.log;
      }
    } catch { /* fall through to static file */ }
    try {
      const r = await fetch('changelog.json', { cache: 'no-store' });
      if (r.ok) return this.filterChangelog(await r.json());
    } catch { /* ignore */ }
    return null;
  },

  // Shows the NEW badge on "What's New" when the changelog has an entry
  // newer than the player's last-seen one.
  checkChangelogBadge() {
    const badge = this.els['changelog-badge'];
    if (!badge) return;
    this.fetchChangelog()
      .then(log => {
        if (!Array.isArray(log) || !log.length) return;
        const latest = String(log[0].date || '');
        let seen = null;
        try { seen = localStorage.getItem('kop-changelog-seen'); } catch { /* ignore */ }
        badge.classList.toggle('hidden', !latest || seen === latest);
      })
      .catch(() => { /* offline-tolerant */ });
  },

  async openChangelog() {
    const log = await this.fetchChangelog();
    if (!Array.isArray(log) || !log.length) {
      this.toast('No updates logged yet.', 'info');
      return;
    }
    const html = log.map(e => `
      <div class="cl-entry">
        <div class="cl-head"><b>${esc(e.title)}</b><span class="muted small">${esc(e.date)}${e.time ? ' · ' + esc(e.time) : ''}${e.version ? ' · v' + esc(e.version) : ''}</span></div>
        <ul class="cl-list">${(e.changes || []).map(c => `<li>${esc(c)}</li>`).join('')}</ul>
      </div>`).join('');
    this.modal({
      title: '📰 Update log',
      html: `<div class="cl-log">${html}</div>`,
      buttons: [{ label: 'Close', cls: 'gold' }],
    });
    try { localStorage.setItem('kop-changelog-seen', String(log[0].date || '')); } catch { /* ignore */ }
    if (this.els['changelog-badge']) this.els['changelog-badge'].classList.add('hidden');
  },

  shareGame(state, user) {
    if (!state) return;
    const name = (user && user.username) || 'a hero';
    const url = 'https://king-of-project.onrender.com';
    const shareText = `⚔️ I'm ${name} — Lv ${state.level}, Stage ${state.stage} in King of Project! Can you beat me? #KingOfProject`;
    if (navigator.share) {
      navigator.share({ title: 'King of Project', text: shareText, url }).catch(() => { /* dismissed */ });
      return;
    }
    const full = `${shareText}\n${url}`;
    const done = () => this.toast('📣 Share text copied — paste it anywhere!', 'success');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(full).then(done, () => this.toast('Copy failed on this device.', 'error'));
    } else {
      this.toast('Sharing is not supported on this device.', 'error');
    }
  },

  masteryCard(state) {
    const m = state.mastery || { points: 0, spent: {} };
    const rows = Object.entries(Engine.TALENTS).map(([id, t]) => {
      const rank = (m.spent && m.spent[id]) || 0;
      const maxed = rank >= t.max;
      const pips = '●'.repeat(rank) + '○'.repeat(t.max - rank);
      return `<div class="talent-row">
        <div class="talent-info"><span class="talent-emoji">${t.emoji}</span>
          <div><div class="talent-name">${esc(t.name)} <span class="pips">${pips}</span></div>
          <div class="muted small">${esc(t.desc)}</div></div></div>
        <button class="btn small ${maxed || m.points < 1 ? 'disabled' : 'gold'}" data-action="talent" data-id="${id}"
          ${maxed || m.points < 1 ? 'disabled' : ''}>${maxed ? 'MAX' : '⬆️ 1 pt'}</button>
      </div>`;
    }).join('');
    return `<div class="card sub-card"><h3>🧠 Mastery <span class="muted small">(${m.points || 0} point${(m.points || 0) === 1 ? '' : 's'} — earn 1 per 10 levels)</span></h3>${rows}</div>`;
  },

  professionsCard(state) {
    const rows = Object.entries(Engine.PROFESSIONS).map(([id, p]) => {
      const lvl = (state.professions && state.professions[id]) || 1;
      const maxed = lvl >= p.max;
      const cost = maxed ? null : Engine.professionCost(lvl);
      const afford = cost != null && (state.gold || 0) >= cost;
      return `<div class="talent-row">
        <div class="talent-info"><span class="talent-emoji">${p.emoji}</span>
          <div><div class="talent-name">${esc(p.name)} <b>Lv ${lvl}</b></div>
          <div class="muted small">${esc(p.desc)}</div></div></div>
        <button class="btn small ${!maxed && afford ? '' : 'disabled'}" data-action="prof" data-id="${id}"
          ${maxed || !afford ? 'disabled' : ''}>${maxed ? 'MAX' : `💰 ${formatNum(cost)}`}</button>
      </div>`;
    }).join('');
    return `<div class="card sub-card"><h3>⚒️ Professions <span class="muted small">(leveled with gold, always active)</span></h3>${rows}</div>`;
  },

  achievementsCard(state) {
    const unlocked = new Set(state.achievements || []);
    const cards = Engine.ACHIEVEMENTS.map(a => {
      const got = unlocked.has(a.id);
      return `<div class="ach-card ${got ? '' : 'locked'}">
        <div class="ach-emoji">${a.emoji}</div>
        <div class="ach-name">${esc(a.name)}</div>
        <div class="muted small">${esc(a.desc)}</div>
        <div class="ach-reward">+${a.stars} ⭐</div>
      </div>`;
    }).join('');
    return `<div class="card sub-card"><h3>🏆 Achievements <span class="muted small">(${unlocked.size}/${Engine.ACHIEVEMENTS.length})</span></h3><div class="ach-grid">${cards}</div></div>`;
  },
};
