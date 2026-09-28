// ============================================================
// ui.js — all DOM rendering for Throne of Shadows.
// engine.js stays DOM-free; this file owns the DOM.
// app.js wires behavior via UI.handlers.
// ============================================================
import * as Engine from './engine.js';
import { Audio } from './audio.js';

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

// Forward-compat emoji for the (unlaunched) class/spec system on leaderboard
// entries. Local maps, guarded by existence — entries without playerClass/spec
// render exactly as before.
const UI_CLASS_EMOJI = { hunter: '🏹', warrior: '⚔️', mage: '🔮', assassin: '🌙' };
const UI_SPEC_EMOJI = { tank: '🛡️', dps: '⚔️', healer: '💚', classic: '📜' };

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

  // Player customization presets (Settings → Buttons / Background).
  // `css` is the swatch preview; the real styling lives in style.css
  // under body[data-btnstyle="..."] / body[data-bgstyle="..."].
  BTN_STYLES: [
    { id: 'default', name: 'Arcane Purple', css: 'linear-gradient(135deg,#9a6ff7,#5b3ba8)' },
    { id: 'ocean',   name: 'Ocean Blue',    css: 'linear-gradient(135deg,#6cb8f5,#1d4fa3)' },
    { id: 'crimson', name: 'Crimson',       css: 'linear-gradient(135deg,#f06666,#7f1d1d)' },
    { id: 'emerald', name: 'Emerald',       css: 'linear-gradient(135deg,#5eeaa8,#065f46)' },
    { id: 'gold',    name: 'Royal Gold',    css: 'linear-gradient(135deg,#ffd97a,#7a560e)' },
    { id: 'mono',    name: 'Shadow Mono',   css: 'linear-gradient(135deg,#9aa0b4,#2e313c)' },
  ],
  BG_STYLES: [
    { id: 'default',   name: 'Default Dark',  css: '#12101a' },
    { id: 'deepspace', name: 'Deep Space',    css: 'radial-gradient(circle at 30% 25%, #3b2a7a, #0d0a18 72%)' },
    { id: 'crimson',   name: 'Crimson Night', css: 'radial-gradient(circle at 30% 25%, #5e1f2a, #150b0e 72%)' },
    { id: 'emerald',   name: 'Emerald Depths',css: 'radial-gradient(circle at 30% 25%, #14503c, #08120e 72%)' },
    { id: 'midnight',  name: 'Midnight Blue', css: 'radial-gradient(circle at 30% 25%, #1d3a6e, #080d18 72%)' },
    { id: 'shadow-eyes', name: 'Shadow Eyes', css: 'radial-gradient(circle at 50% 45%, #2a1540, #050308 70%)', animated: true },
    { id: 'orbs',        name: 'Orbs',        css: 'radial-gradient(circle at 30% 30%, #3b2a7a, #0a0812 75%)', animated: true },
    { id: 'ember-drift', name: 'Ember Drift', css: 'radial-gradient(circle at 50% 100%, #5e1f1a, #0d0505 75%)', animated: true },
  ],
  // Animated-scene options (persisted in state.settings).
  EYE_COLORS: [
    { id: 'violet', name: 'Violet',    color: '#a855f7' },
    { id: 'ember',  name: 'Ember Red', color: '#ef4444' },
    { id: 'gold',   name: 'Gold',      color: '#ffd63f' },
  ],
  ORB_PALETTES: [
    { id: 'violet-haze', name: 'Violet Haze', colors: ['#a855f7', '#7c3aed', '#22d3ee'] },
    { id: 'ember',       name: 'Ember',       colors: ['#ef4444', '#f97316', '#fbbf24'] },
    { id: 'frost',       name: 'Frost',       colors: ['#7dd3fc', '#38bdf8', '#e0f2fe'] },
    { id: 'toxic',       name: 'Toxic',       colors: ['#4ade80', '#a3e635', '#bef264'] },
    { id: 'royal-gold',  name: 'Royal Gold',  colors: ['#ffd63f', '#f59e0b', '#fff7cc'] },
  ],
  DEFAULT_ORB_COLORS: ['#a855f7', '#7c3aed', '#22d3ee'],
  BG_ANIMATED: ['shadow-eyes', 'orbs', 'ember-drift'],

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
      'tap-btn', 'skill-row', 'combo-meter', 'rebirth-box', 'rebirth-btn',
      'rebirth-note', 'combat-log', 'loadout-strip', 'upgrade-list', 'gear-shop', 'inventory-grid', 'inv-count', 'set-progress',
      'quest-daily', 'quest-weekly', 'quest-class', 'quest-mastery',
      'party-slots', 'recruit-list', 'pets-panel', 'lb-body', 'lb-refresh', 'profile-card',
      'redeem-input', 'redeem-btn', 'gm-entry-card', 'gm-open-btn',
      'set-dmgnums', 'set-motion', 'set-sfx', 'set-music', 'set-notif-level', 'set-notif-death',
      'set-notif-loot', 'set-notif-quest', 'logout-btn', 'modal-root', 'toast-root',
      'race-grid', 'class-grid', 'pet-grid', 'spec-grid', 'gm-back', 'meter-rows', 'total-dps',
      'share-btn', 'changelog-btn', 'changelog-badge',
      'balance-log-btn', 'balance-log-badge', 'balance-log-hud', 'balance-log-badge-hud',
      'inn-btn', 'leave-inn-btn', 'inn-hpfill', 'inn-hptext', 'inn-status', 'inn-glow',
      'mine-rock', 'mine-btn', 'mine-find', 'ore-grid', 'forge-section',
      'mine-pickaxe', 'mine-stats',
    ];
    for (const id of ids) this.els[id] = document.getElementById(id);

    // Null-safe listener wiring: a single missing element (e.g. stale cached
    // JS paired with newer HTML after a deploy) must never brick the boot.
    const listen = (id, evt, fn) => {
      const el = this.els[id] || document.getElementById(id);
      if (el) el.addEventListener(evt, fn);
    };

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
    listen('tap-btn', 'pointerdown', (e) => {
      e.preventDefault();
      this.handlers.onTap && this.handlers.onTap();
    });
    listen('skill-row', 'click', (e) => {
      const btn = e.target.closest('button[data-skill]');
      if (!btn || btn.disabled) return;
      this.handlers.onSkill && this.handlers.onSkill(btn.dataset.skill);
    });
    listen('tab-quests', 'click', (e) => {
      const btn = e.target.closest('button[data-claim]');
      if (!btn || btn.disabled) return;
      const [period, id] = btn.dataset.claim.split(':');
      this.handlers.onClaimQuest && this.handlers.onClaimQuest(period, id);
    });
    listen('rebirth-btn', 'click', () => {
      this.handlers.onRebirth && this.handlers.onRebirth();
    });

    // Inn (AFK safe zone)
    listen('inn-btn', 'click', () => {
      this.handlers.onEnterInn && this.handlers.onEnterInn();
    });
    listen('leave-inn-btn', 'click', () => {
      this.handlers.onLeaveInn && this.handlers.onLeaveInn();
    });
    // Pause the inn glow when the tab is hidden; resume when visible.
    document.addEventListener('visibilitychange', () => {
      try {
        if (document.hidden) this._pauseInnGlow();
        else if (this.activeTab === 'inn') this._resumeInnGlow();
      } catch { /* ignore */ }
    });

    // Gear: delegated equip/sell/upgrade/shop
    listen('inventory-grid', 'click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.closest('.item-card').dataset.id;
      const h = this.handlers;
      if (btn.dataset.action === 'equip' && h.onEquip) h.onEquip(id);
      if (btn.dataset.action === 'sell' && h.onSell) h.onSell(id);
      if (btn.dataset.action === 'enchant' && h.onEnchant) h.onEnchant(id);
    });
    listen('tab-gear', 'click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || btn.disabled) return;
      const h = this.handlers;
      if (btn.dataset.action === 'buy-gear' && h.onBuyGear) h.onBuyGear(btn.dataset.id);
      if (btn.dataset.action === 'goto-petshop' && h.onGotoPetShop) h.onGotoPetShop();
      if (btn.dataset.action === 'forge-tier' && h.onForgeTier) h.onForgeTier(btn.dataset.slot, btn.dataset.tier);
      if (btn.dataset.action === 'forge-stat' && h.onForgeStat) h.onForgeStat(btn.dataset.slot, btn.dataset.stat);
      if (btn.dataset.action === 'forge-craft' && h.onForgeCraft) h.onForgeCraft(btn.dataset.slot);
      if (btn.dataset.action === 'galaxy-equip' && h.onGalaxyEquip) h.onGalaxyEquip(btn.dataset.slot);
      if (btn.dataset.action === 'galaxy-unequip' && h.onGalaxyUnequip) h.onGalaxyUnequip(btn.dataset.slot);
    });
    // Mine: tap the rock
    listen('mine-btn', 'click', () => {
      if (this.handlers.onMine) this.handlers.onMine();
    });
    // Mine: pickaxe upgrade (button is re-rendered inside the card, so the
    // listener lives on the card container and delegates).
    listen('mine-pickaxe', 'click', (e) => {
      const btn = e.target.closest('#mine-pickaxe-btn');
      if (!btn || btn.disabled) return;
      if (this.handlers.onPickaxeUpgrade) this.handlers.onPickaxeUpgrade();
    });
    listen('upgrade-list', 'click', (e) => {
      const btn = e.target.closest('button[data-upgrade]');
      if (!btn) return;
      this.handlers.onUpgrade && this.handlers.onUpgrade(btn.dataset.upgrade);
    });

    // Party: delegated recruit/dismiss/pet actions
    listen('tab-party', 'click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const h = this.handlers;
      if (btn.dataset.action === 'recruit' && h.onRecruit) h.onRecruit(btn.dataset.id);
      if (btn.dataset.action === 'dismiss' && h.onDismiss) h.onDismiss(btn.dataset.id);
      if (btn.dataset.action === 'levelup' && h.onLevelUpCompanion) h.onLevelUpCompanion(btn.dataset.id);
      if (btn.dataset.action === 'hatch-pet' && h.onHatchPet) h.onHatchPet(btn.dataset.tier || 'wild');
      if (btn.dataset.action === 'feed-pet' && h.onFeedPet) h.onFeedPet(btn.dataset.id);
      if (btn.dataset.action === 'set-active-pet' && h.onSetActivePet) h.onSetActivePet(btn.dataset.id);
      if (btn.dataset.action === 'set-second-pet' && h.onSetSecondPet) h.onSetSecondPet(btn.dataset.id);
      if (btn.dataset.action === 'remove-second-pet' && h.onRemoveSecondPet) h.onRemoveSecondPet();
      if (btn.dataset.action === 'buy-egg' && h.onBuyEgg) h.onBuyEgg(btn.dataset.tier);
    });

    // Ranks refresh
    listen('lb-refresh', 'click', () => {
      this.handlers.onTab && this.handlers.onTab('ranks', true);
    });

    // More tab: delegated talent / profession / title buttons
    listen('tab-more', 'click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || btn.disabled) return;      const h = this.handlers;
      if (btn.dataset.action === 'talent' && h.onTalent) h.onTalent(btn.dataset.id);
      if (btn.dataset.action === 'prof' && h.onProfession) h.onProfession(btn.dataset.id);
      if (btn.dataset.action === 'title' && h.onTitle) h.onTitle(btn.dataset.id);
      if (btn.dataset.action === 'titles-list' && h.onTitlesList) h.onTitlesList();
    });

    // Country picker (profile) — delegated change
    listen('tab-more', 'change', (e) => {
      if (e.target && e.target.id === 'country-select' && this.handlers.onCountry) {
        this.handlers.onCountry(e.target.value);
      }
    });

    // Share + update log (More tab)
    listen('share-btn', 'click', () => {
      this.handlers.onShare && this.handlers.onShare();
    });
    listen('changelog-btn', 'click', () => {
      this.handlers.onChangelog && this.handlers.onChangelog();
    });
    listen('balance-log-btn', 'click', () => {
      this.openBalanceLog();
    });
    listen('balance-log-hud', 'click', () => {
      this.openBalanceLog();
    });

    // More tab
    listen('redeem-btn', 'click', () => {
      this.handlers.onRedeem && this.handlers.onRedeem();
    });
    listen('redeem-input', 'keydown', (e) => {
      if (e.key === 'Enter') this.handlers.onRedeem && this.handlers.onRedeem();
    });
    listen('gm-open-btn', 'click', () => {
      this.handlers.onOpenGM && this.handlers.onOpenGM();
    });
    listen('logout-btn', 'click', () => {
      this.handlers.onLogout && this.handlers.onLogout();
    });
    if (this.els['set-dmgnums']) this.els['set-dmgnums'].checked = !!this.settings.damageNumbers;
    if (this.els['set-motion']) this.els['set-motion'].checked = !!this.settings.reduceMotion;
    listen('set-dmgnums', 'change', (e) => this.saveSetting('damageNumbers', e.target.checked));
    listen('set-motion', 'change', (e) => {
      this.saveSetting('reduceMotion', e.target.checked);
      document.body.classList.toggle('reduce-motion', e.target.checked);
      // Re-render the ambient scene (animated vs. static frame).
      if (this._bg && this._bg.scene) this.setBgScene(this._bg.scene, this._bg.opts);
    });
    // Audio prefs live on the game state (per player / guest save), not in
    // localStorage — app.js syncs the checkboxes via applyAudioPrefs().
    listen('set-sfx', 'change', (e) => this.handlers.onSfx && this.handlers.onSfx(e.target.checked));
    listen('set-music', 'change', (e) => this.handlers.onMusic && this.handlers.onMusic(e.target.checked));
    // Notification toggles (Settings → Notifications): delegate to the app,
    // which persists them on the game state save.
    for (const cat of ['level', 'death', 'loot', 'quest']) {
      listen('set-notif-' + cat, 'change', (e) => {
        this.handlers.onNotifPref && this.handlers.onNotifPref(cat, e.target.checked);
      });
    }
    // UI style segmented control (More → Settings)
    const seg = document.getElementById('ui-style-seg');
    if (seg) {
      seg.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => this.handlers.onUiStyle && this.handlers.onUiStyle(b.dataset.uistyle));
      });
    }
    this.setUiStyleSeg(document.body.dataset.uistyle === 'classic' ? 'classic' : 'modern');

    // Custom button / background pickers (Settings)
    this._renderStylePickers();

    // Ambient animated background canvas (null-safe: hidden if absent)
    this.initBgCanvas();

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
    if (name !== 'quests') this._stopQuestCountdowns();
    // Leaving the inn by any route (e.g. tab bar) stops its glow loop;
    // enterInn() restarts it after switching to the inn tab.
    if (name !== 'inn') this.stopInnGlow();
    try { Audio.play('tab'); } catch { /* ignore */ }
    $$('#tabbar .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('#tab-content .tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
    this.handlers.onTab && this.handlers.onTab(name);
  },

  // ---------------- Inn (AFK safe zone) ----------------

  // Refresh the inn HP bar + status while resting.
  renderInn(s, stats) {
    try {
      const hp = Math.max(0, Math.round(s.hero.hp));
      const max = Math.max(1, Math.round(stats.maxHp));
      const fill = this.els['inn-hpfill'];
      const text = this.els['inn-hptext'];
      if (fill) fill.style.width = Math.min(100, (hp / max) * 100) + '%';
      if (text) text.textContent = `${hp} / ${max} HP`;
      const st = this.els['inn-status'];
      if (st) st.textContent = hp >= max ? '✨ Fully rested!' : '💤 Resting… (+2% HP/s)';
    } catch { /* ignore */ }
  },

  // Fireplace/lantern flicker overlay on the inn scene.
  // Cheap (~8fps canvas, few radial gradients), paused when the tab is
  // hidden, and a single static frame under reduced motion.
  startInnGlow() {
    try {
      const cv = this.els['inn-glow'] || document.getElementById('inn-glow');
      if (!cv) return;
      this.stopInnGlow();
      const reduced = document.body.classList.contains('reduce-motion');
      const draw = () => {
        try {
          const r = cv.getBoundingClientRect();
          if (r.width < 2 || document.hidden) return;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          cv.width = Math.round(r.width * dpr);
          cv.height = Math.round(r.height * dpr);
          const ctx = cv.getContext('2d');
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, r.width, r.height);
          const t = performance.now() / 1000;
          const flick = reduced ? 1
            : 0.80 + 0.14 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1.7) + 0.06 * Math.sin(t * 13.7);
          // Fireplace glow, lower-left; lantern glows, upper-middle.
          const spots = [
            { x: 0.16, y: 0.82, rad: 0.42, c: '255,150,60', a: 0.34 },
            { x: 0.50, y: 0.22, rad: 0.22, c: '255,190,110', a: 0.22 },
            { x: 0.66, y: 0.30, rad: 0.18, c: '255,190,110', a: 0.18 },
          ];
          for (const sp of spots) {
            const rad = sp.rad * Math.max(r.width, r.height);
            const g = ctx.createRadialGradient(
              r.width * sp.x, r.height * sp.y, 0,
              r.width * sp.x, r.height * sp.y, rad);
            g.addColorStop(0, `rgba(${sp.c},${(sp.a * flick).toFixed(3)})`);
            g.addColorStop(1, `rgba(${sp.c},0)`);
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, r.width, r.height);
          }
        } catch { /* ignore */ }
      };
      draw();
      if (!reduced) this._innGlowTimer = setInterval(draw, 120);
      this._innGlowPaused = false;
    } catch { /* ignore */ }
  },

  stopInnGlow() {
    try {
      if (this._innGlowTimer) { clearInterval(this._innGlowTimer); this._innGlowTimer = null; }
      this._innGlowPaused = false;
    } catch { /* ignore */ }
  },

  _pauseInnGlow() {
    try {
      if (this._innGlowTimer) { clearInterval(this._innGlowTimer); this._innGlowTimer = null; this._innGlowPaused = true; }
    } catch { /* ignore */ }
  },

  _resumeInnGlow() {
    try {
      if (this._innGlowPaused && !document.body.classList.contains('reduce-motion')) {
        this._innGlowPaused = false;
        this.startInnGlow();
      }
    } catch { /* ignore */ }
  },

  // ---------------- toasts ----------------
  toast(msg, kind = 'info', ms = 2600) {
    const root = this.els['toast-root'];
    if (!root) return;
    const now = Date.now();
    // Anti-spam: an identical toast within ~4s bumps a counter on the
    // existing toast instead of stacking a duplicate.
    const last = this._lastToast;
    if (last && last.text === msg && now - last.time < 4000 && last.el.isConnected) {
      last.count += 1;
      last.time = now;
      last.el.querySelector('.toast-msg').textContent = `${msg} (×${last.count})`;
      clearTimeout(last.timer);
      last.timer = this._toastTimer(last.el, ms);
      return;
    }
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.innerHTML = '<span class="toast-msg"></span>';
    el.querySelector('.toast-msg').textContent = msg;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const timer = this._toastTimer(el, ms);
    this._lastToast = { text: msg, el, count: 1, time: now, timer };
    while (root.children.length > 4) root.firstChild.remove();
  },

  _toastTimer(el, ms) {
    return setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, ms);
  },

  // Notification preferences (Settings → Notifications). The app registers a
  // provider that reads the current save's prefs; categories: level, death,
  // loot, quest. When a category is off, its toasts are suppressed entirely.
  setNotifPrefsProvider(fn) { this._notifPrefsProvider = fn; },
  _notifPrefs() {
    try { return (this._notifPrefsProvider && this._notifPrefsProvider()) || {}; }
    catch { return {}; }
  },
  notify(cat, msg, kind = 'info', ms = 2600) {
    if (this._notifPrefs()[cat] === false) return;
    this.toast(msg, kind, ms);
  },

  // Syncs the Settings → Notifications checkboxes to the save's prefs.
  syncNotifSettings(prefs) {
    const p = prefs || {};
    for (const cat of ['level', 'death', 'loot', 'quest']) {
      const el = this.els['set-notif-' + cat];
      if (el) el.checked = p[cat] !== false;
    }
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
    try { Audio.play('levelup'); } catch { /* ignore */ }
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
  // Row of active skill buttons (unlocked + next locked). Re-render on
  // unlock; per-tick cooldown state is handled by updateBattle().
  renderSkillRow(state) {
    const row = this.els['skill-row'];
    if (!row) return;
    row.innerHTML = '';
    for (const id of Engine.SKILL_ORDER) {
      const def = Engine.SKILLS[id];
      if (!def) continue;
      const unlocked = (state.skills || []).includes(id);
      const b = document.createElement('button');
      b.className = 'skill-btn' + (unlocked ? '' : ' locked');
      if (unlocked) b.dataset.skill = id;
      else b.dataset.locked = '1';
      b.disabled = !unlocked;
      b.title = unlocked ? def.desc : `Unlocks at level ${def.unlockLevel}`;
      const mast = unlocked ? Engine.skillMastery(state, id) : null;
      const mastBadge = mast
        ? `<span class="mastery-badge" title="Mastery ${mast.level}: +${Math.round(mast.pct * 100)}% effectiveness · ${mast.uses}/${mast.nextAt} casts to next level">M${mast.level}</span>`
        : '';
      b.innerHTML = `<span class="sk-emoji">${def.emoji}</span>` +
        `<span class="sk-name">${esc(def.name)}</span>` +
        (unlocked ? mastBadge : `<span class="lv-tag">🔒 Lv ${def.unlockLevel}</span>`) +
        `<span class="skill-cd"></span>`;
      row.appendChild(b);
    }
  },

  renderBattle(state) {
    this.setMode(state.mode);
    this.renderSkillRow(state);
    const showRebirth = state.level >= Engine.MAX_LEVEL;
    this.els['rebirth-box'].classList.toggle('hidden', !showRebirth);
    if (showRebirth) {
      const nextMult = Engine.rebirthXpMult ? Engine.rebirthXpMult((state.rebirthCount || 0) + 1) : 1;
      this.els['rebirth-note'].innerHTML =
        `Return to <b class="gold-text">level 1</b> — everything else stays (stage, gold, gear, pets, titles).<br>` +
        `<span class="muted">Rebirths so far: ${state.rebirthCount || 0}. ` +
        `Next climb: XP requirements ×${nextMult.toFixed(2)}.</span>`;
    }
    this.updateHeroPanel(state, Engine.computeStats(state), null);
  },

  setMode(mode) {
    $$('#mode-switch .mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const tapBtn = this.els['tap-btn'];
    tapBtn.classList.toggle('hidden', mode !== 'clicker');
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
    // per-skill cooldowns
    if (battle && battle.skillCDs && e['skill-row']) {
      const now = Date.now();
      e['skill-row'].querySelectorAll('button[data-skill]').forEach(btn => {
        const remain = Math.max(0, (battle.skillCDs[btn.dataset.skill] || 0) - now);
        btn.disabled = remain > 0;
        btn.classList.toggle('cooling', remain > 0);
        const cd = btn.querySelector('.skill-cd');
        if (cd) cd.textContent = remain > 0 ? `(${(remain / 1000).toFixed(0)}s)` : '';
        // Keep the mastery badge fresh as casts accumulate.
        const mb = btn.querySelector('.mastery-badge');
        if (mb && state) {
          const m = Engine.skillMastery(state, btn.dataset.skill);
          mb.textContent = `M${m.level}`;
          mb.title = `Mastery ${m.level}: +${Math.round(m.pct * 100)}% effectiveness · ${m.uses}/${m.nextAt} casts to next level`;
        }
      });
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
    // Active pets fight beside the hero — show their faces next to the stats.
    const pets = Engine.activePets(state);
    const petChip = pets.length
      ? `<span class="buff-chip" title="${pets.map(pt => { const s2 = Engine.petSpeciesOf(pt); return `${s2.name} Lv ${pt.level} — strikes every 4s`; }).join(' + ')}">${pets.map(pt => `${Engine.petSpeciesOf(pt).emoji} Lv ${pt.level}`).join(' ')}</span>` : '';
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
    // Battle SFX ride on the same dispatch as the damage numbers, so every
    // hit/crit/hurt/dodge/parry/skill tick gets its sound from one place.
    // (Plays even when damage numbers are hidden — the setting is visual.)
    try {
      const snd = { dmg: 'hit', crit: 'crit', hurt: 'hurt', dodge: 'dodge', parry: 'parry', skill: 'skill' }[kind];
      if (snd) Audio.play(snd);
    } catch { /* audio must never break rendering */ }
    if (!this.settings.damageNumbers && (kind === 'dmg' || kind === 'crit')) return;
    const layer = this.els['float-layer'];
    const el = document.createElement('div');
    el.className = 'float-txt float-' + kind;
    el.textContent = text;
    el.style.left = (20 + Math.random() * 60) + '%';
    el.style.setProperty('--tilt', (Math.random() * 16 - 8).toFixed(1) + 'deg');
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

  // Builds the Settings swatch pickers for button/background styles.
  _renderStylePickers() {
    const mk = (list, elId, handler) => {
      const el = document.getElementById(elId);
      if (!el) return;
      el.innerHTML = list.map((p) =>
        `<button type="button" class="swatch" data-style="${p.id}" title="${p.name}" aria-label="${p.name}">` +
        `<span class="dot" style="background:${p.css}"></span><span class="lbl">${p.name}</span></button>`
      ).join('');
      el.querySelectorAll('.swatch').forEach((b) => {
        b.addEventListener('click', () => { if (this.handlers[handler]) this.handlers[handler](b.dataset.style); });
      });
    };
    mk(this.BTN_STYLES, 'btn-style-picker', 'onBtnStyle');
    mk(this.BG_STYLES, 'bg-style-picker', 'onBgStyle');
  },

  // Marks the active swatches after a style change or on load.
  syncCustomStyles(btnStyle, bgStyle) {
    const mark = (elId, cur) => {
      const el = document.getElementById(elId);
      if (!el) return;
      el.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', b.dataset.style === cur));
    };
    mark('btn-style-picker', btnStyle || 'default');
    mark('bg-style-picker', bgStyle || 'default');
  },

  // ---------------- animated background scenes ----------------
  // Single fixed canvas behind all content; one scene at a time.
  // Cheap particle counts, pre-rendered glow sprites, dt-clamped motion,
  // paused when the tab is hidden, static frame under reduced motion.
  initBgCanvas() {
    const cv = document.getElementById('bg-canvas');
    if (!cv) return;
    this._bg = { cv, ctx: cv.getContext('2d'), scene: null, parts: [], sprites: {}, raf: 0, last: 0, dt: 0, grad: null, opts: {} };
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(2, Math.floor(innerWidth * dpr));
      cv.height = Math.max(2, Math.floor(innerHeight * dpr));
      this._bg.dpr = dpr;
      this._bg.grad = null;
      if (this._bg.scene) this._buildBgScene(this._bg.scene, this._bg.opts);
    };
    addEventListener('resize', fit);
    fit();
    document.addEventListener('visibilitychange', () => {
      if (!this._bg || !this._bg.scene || this._bgReduced()) return;
      if (document.hidden) this._stopBgLoop();
      else this._startBgLoop();
    });
  },
  _bgReduced() {
    return !!this.settings.reduceMotion ||
      (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  },
  _glowSprite(color) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.28, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return c;
  },
  _vGrad(stops) {
    const B = this._bg;
    const c = document.createElement('canvas');
    c.width = 2; c.height = Math.max(2, B.cv.height);
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, c.height);
    stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
    x.fillStyle = g;
    x.fillRect(0, 0, 2, c.height);
    return c;
  },
  _newEmber(W, H, anywhere) {
    const R = (a, b) => a + Math.random() * (b - a);
    const dpr = (this._bg && this._bg.dpr) || 1;
    return {
      x: R(0, W), y: anywhere ? R(0, H) : H + R(0, 40),
      s: R(2, 5) * dpr, vy: R(14, 34) * dpr,
      sway: R(8, 26) * dpr, ph: R(0, 6.28), fs: R(0.6, 1.6),
      si: (Math.random() * 3) | 0, a: R(0.5, 1),
    };
  },
  _buildBgScene(id, opts) {
    const B = this._bg;
    const W = B.cv.width, H = B.cv.height, dpr = B.dpr || 1;
    const R = (a, b) => a + Math.random() * (b - a);
    B.scene = id; B.parts = []; B.sprites = {}; B.grad = null;
    if (id === 'shadow-eyes') {
      const col = (this.EYE_COLORS.find((c) => c.id === (opts.eyeColor || 'violet')) || this.EYE_COLORS[0]).color;
      B.sprites.eye = this._glowSprite(col);
      const n = W > H ? 15 : 10;
      for (let i = 0; i < n; i++) {
        B.parts.push({
          x: R(0.07, 0.93) * W, y: R(0.09, 0.91) * H,
          s: R(9, 20) * dpr, cyc: R(6000, 11000), off: R(0, 11000),
        });
      }
    } else if (id === 'orbs') {
      const cols = (opts.orbColors && opts.orbColors.length === 3) ? opts.orbColors : this.DEFAULT_ORB_COLORS;
      B.sprites.orb = cols.map((c) => this._glowSprite(c));
      for (let i = 0; i < 16; i++) {
        B.parts.push({
          x: R(0, W), y: R(0, H), r: R(16, 52) * dpr,
          vx: R(-9, 9) * dpr, vy: R(-7, 7) * dpr,
          si: i % 3, col: cols[i % 3], ph: R(0, 6.28), ps: R(0.4, 1.1),
        });
      }
      B.grad = this._vGrad(['#0a0812', '#151126', '#0a0812']);
    } else if (id === 'ember-drift') {
      B.sprites.emb = ['#ff6b35', '#f7c548', '#ef4444'].map((c) => this._glowSprite(c));
      for (let i = 0; i < 55; i++) B.parts.push(this._newEmber(W, H, true));
      B.grad = this._vGrad(['#0d0505', '#200b08', '#0d0505']);
    }
  },
  _drawBgFrame(t, isStatic) {
    const B = this._bg;
    if (!B || !B.scene) return;
    const { ctx, cv } = B, W = cv.width, H = cv.height;
    if (B.grad) ctx.drawImage(B.grad, 0, 0, W, H);
    else { ctx.fillStyle = B.scene === 'shadow-eyes' ? '#050308' : '#0a0812'; ctx.fillRect(0, 0, W, H); }
    if (B.scene === 'shadow-eyes') {
      for (const p of B.parts) {
        const ph = (((t + p.off) % p.cyc) + p.cyc) % p.cyc / p.cyc;
        let a = ph < 0.22 ? ph / 0.22 : ph < 0.62 ? 1 : Math.max(0, 1 - (ph - 0.62) / 0.38);
        a = a * a * (3 - 2 * a); // smoothstep fade
        if (a <= 0.02) continue;
        const d = p.s * 2.8, gap = p.s * 1.1;
        ctx.globalAlpha = a * 0.9;
        ctx.drawImage(B.sprites.eye, p.x - gap - d / 2, p.y - d / 2, d, d);
        ctx.drawImage(B.sprites.eye, p.x + gap - d / 2, p.y - d / 2, d, d);
      }
    } else if (B.scene === 'orbs') {
      for (const p of B.parts) {
        if (!isStatic) {
          p.x += p.vx * B.dt; p.y += p.vy * B.dt;
          const m = p.r * 3;
          if (p.x < -m) p.x = W + m; else if (p.x > W + m) p.x = -m;
          if (p.y < -m) p.y = H + m; else if (p.y > H + m) p.y = -m;
        }
        const pulse = Math.sin(t / 1000 * p.ps + p.ph);
        const d = p.r * 4;
        ctx.globalAlpha = 0.30 + 0.14 * pulse;
        ctx.drawImage(B.sprites.orb[p.si], p.x - d / 2, p.y - d / 2, d, d);
        ctx.globalAlpha = 0.50 + 0.18 * pulse;
        ctx.fillStyle = p.col;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.42, 0, 6.2832);
        ctx.fill();
      }
    } else if (B.scene === 'ember-drift') {
      for (const p of B.parts) {
        if (!isStatic) {
          p.y -= p.vy * B.dt;
          p.x += Math.sin(t / 1000 * p.fs + p.ph) * p.sway * B.dt;
          if (p.y < -12) Object.assign(p, this._newEmber(W, H, false));
        }
        const fade = Math.min(1, Math.max(0, (H - p.y) / (H * 0.3))) * Math.min(1, Math.max(0, (p.y + 12) / 60));
        if (fade <= 0.02) continue;
        const d = p.s * 5;
        ctx.globalAlpha = p.a * fade;
        ctx.drawImage(B.sprites.emb[p.si], p.x - d / 2, p.y - d / 2, d, d);
      }
    }
    ctx.globalAlpha = 1;
  },
  _startBgLoop() {
    this._stopBgLoop();
    const B = this._bg;
    if (!B || !B.scene) return;
    B.last = performance.now();
    const step = (now) => {
      B.raf = requestAnimationFrame(step);
      B.dt = Math.min(0.05, Math.max(0, (now - B.last) / 1000));
      B.last = now;
      this._drawBgFrame(now, false);
    };
    B.raf = requestAnimationFrame(step);
  },
  _stopBgLoop() {
    if (this._bg && this._bg.raf) { cancelAnimationFrame(this._bg.raf); this._bg.raf = 0; }
  },
  // Switches the ambient scene. Non-animated ids hide the canvas.
  setBgScene(id, opts) {
    if (!this._bg) this.initBgCanvas();
    if (!this._bg) return;
    opts = opts || {};
    if (!this.BG_ANIMATED.includes(id)) {
      this._bg.scene = null;
      this._stopBgLoop();
      this._bg.ctx.clearRect(0, 0, this._bg.cv.width, this._bg.cv.height);
      return;
    }
    this._bg.opts = { eyeColor: opts.eyeColor, orbColors: opts.orbColors };
    this._buildBgScene(id, this._bg.opts);
    if (this._bgReduced()) { this._stopBgLoop(); this._drawBgFrame(1200, true); }
    else this._startBgLoop();
  },

  // Conditional scene options in Settings (visible only for the matching scene).
  renderBgAnimOpts(bgStyle, settings) {
    const row = document.getElementById('bg-anim-row');
    const box = document.getElementById('bg-anim-opts');
    const label = document.getElementById('bg-anim-label');
    if (!row || !box) return;
    const st = settings || {};
    if (bgStyle === 'shadow-eyes') {
      row.classList.remove('hidden');
      if (label) label.textContent = '👁️ Eye color';
      const cur = st.eyeColor || 'violet';
      box.innerHTML = this.EYE_COLORS.map((c) =>
        `<button type="button" class="swatch${c.id === cur ? ' active' : ''}" data-eye="${c.id}" title="${c.name}" aria-label="${c.name}">` +
        `<span class="dot" style="background:${c.color};box-shadow:0 0 10px ${c.color}"></span><span class="lbl">${c.name}</span></button>`
      ).join('');
      box.querySelectorAll('[data-eye]').forEach((b) => {
        b.addEventListener('click', () => { this.handlers.onEyeColor && this.handlers.onEyeColor(b.dataset.eye); });
      });
    } else if (bgStyle === 'orbs') {
      row.classList.remove('hidden');
      if (label) label.textContent = '🔮 Orb colors';
      const cols = (st.orbColors && st.orbColors.length === 3) ? st.orbColors : this.DEFAULT_ORB_COLORS;
      box.innerHTML =
        `<div class="orb-pickers">` + cols.map((c, i) =>
          `<label class="orb-pick"><input type="color" value="${c}" data-orb="${i}" aria-label="Orb ${i + 1} color"><span>Orb ${i + 1}</span></label>`
        ).join('') + `</div>` +
        `<div class="palette-row">` + this.ORB_PALETTES.map((p) =>
          `<button type="button" class="palette-btn" data-palette="${p.id}" title="${p.name}">` +
          p.colors.map((c) => `<span class="pdot" style="background:${c}"></span>`).join('') +
          `<span class="plbl">${p.name}</span></button>`
        ).join('') + `</div>`;
      const read = () => [0, 1, 2].map((i) => box.querySelector(`[data-orb="${i}"]`).value);
      box.querySelectorAll('[data-orb]').forEach((inp) => {
        inp.addEventListener('change', () => { this.handlers.onOrbColors && this.handlers.onOrbColors(read()); });
      });
      box.querySelectorAll('[data-palette]').forEach((b) => {
        b.addEventListener('click', () => { this.handlers.onOrbPalette && this.handlers.onOrbPalette(b.dataset.palette); });
      });
    } else {
      row.classList.add('hidden');
      box.innerHTML = '';
    }
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
  // Forge UI selections (not persisted): chosen tier + picked stats per slot.
  forgeSel: {
    weapon: { tier: 'star', stats: [] },
    armor: { tier: 'star', stats: [] },
  },

  renderForge(state) {
    const el = this.els['forge-section'];
    if (!el) return;
    const E = Engine;
    el.innerHTML = ['weapon', 'armor'].map(slot => {
      const sel = this.forgeSel[slot];
      if (!E.FORGE_TIER_BY_ID[sel.tier]) sel.tier = 'star';
      sel.stats = (sel.stats || []).filter(s => E.FORGE_STATS.includes(s)).slice(0, E.MAX_FORGE_PICKS);
      const tier = E.FORGE_TIER_BY_ID[sel.tier];
      const current = E.galaxyItemFor(state, slot);
      const equipped = state.equipped && state.equipped[slot] === E.GALAXY_EQUIP_ID;
      const slotName = slot === 'weapon' ? 'Weapon' : 'Armor';
      const slotEmoji = slot === 'weapon' ? '⚔️' : '🛡️';

      const currentHtml = current ? `
        <div class="galaxy-card r-galaxy">
          <div class="galaxy-name">${esc(current.name)}</div>
          <div class="stat-chips">${Object.entries(current.stats || {}).map(([k, v]) =>
            `<span class="stat-chip">${E.FORGE_STAT_EMOJI[k] || '✨'} +${formatStatVal(k, v)} ${(E.STAT_LABELS[k] || k)}</span>`).join('')}</div>
          ${equipped
            ? `<button class="btn small" data-action="galaxy-unequip" data-slot="${slot}">Unequip</button>`
            : `<button class="btn small gold" data-action="galaxy-equip" data-slot="${slot}">Equip</button>`}
          ${equipped ? '<span class="muted small">Equipped — replaces normal ' + slotName.toLowerCase() + '.</span>' : ''}
        </div>` : `<p class="muted small">No forged ${slotName.toLowerCase()} yet.</p>`;

      const tierHtml = E.FORGE_TIERS.map(t => {
        const costParts = Object.entries(t.cost).map(([ore, n]) => {
          const have = (state.mine && state.mine.ores && state.mine.ores[ore]) || 0;
          const od = E.ORE_BY_ID[ore] || {};
          return `<span class="${have >= n ? 'cost-ok' : 'cost-lack'}">${od.emoji || ''} ${have}/${n}</span>`;
        }).join(' ');
        return `<button class="forge-tier${t.id === sel.tier ? ' picked' : ''}" data-action="forge-tier" data-slot="${slot}" data-tier="${t.id}">
          <div class="forge-tier-name">${t.emoji} ${esc(t.name)}</div>
          <div class="muted tiny">×${t.mult} stats</div>
          <div class="forge-cost">${costParts}</div>
        </button>`;
      }).join('');

      const statHtml = E.FORGE_STATS.map(s => {
        const picked = sel.stats.includes(s);
        const val = s === 'attackSpeed' ? E.round1((E.FORGE_STAT_BASE[s] || 0) * tier.mult)
          : Math.round((E.FORGE_STAT_BASE[s] || 0) * tier.mult);
        return `<button class="stat-pick${picked ? ' picked' : ''}" data-action="forge-stat" data-slot="${slot}" data-stat="${s}"
          title="${esc(E.STAT_LABELS[s] || s)}">
          ${E.FORGE_STAT_EMOJI[s] || '✨'} ${(E.STAT_LABELS[s] || s)} <b>+${formatStatVal(s, val)}</b>
        </button>`;
      }).join('');

      const afford = E.canCraft(state, sel.tier);
      const canDo = afford && sel.stats.length > 0;
      return `
      <div class="forge-panel">
        <h3>${slotEmoji} Galaxy ${slotName}</h3>
        ${currentHtml}
        <div class="forge-tier-row">${tierHtml}</div>
        <div class="muted small">Pick up to ${E.MAX_FORGE_PICKS} stats (${sel.stats.length}/${E.MAX_FORGE_PICKS}):</div>
        <div class="stat-pick-row">${statHtml}</div>
        <button class="btn gold" data-action="forge-craft" data-slot="${slot}" ${canDo ? '' : 'disabled'}>
          ${current ? '🔨 Reforge' : '🔨 Forge'} ${esc(tier.name)} ${slotName}
        </button>
        ${!afford ? '<div class="muted small">Not enough ores — go mining! ⛏️</div>' : ''}
        ${afford && !sel.stats.length ? '<div class="muted small">Pick at least 1 stat.</div>' : ''}
      </div>`;
    }).join('') + `<p class="muted small">Only <b>one</b> forged weapon and <b>one</b> forged armor can exist — reforging replaces the old one. Forged gear survives rebirth.</p>`;
  },

  renderGear(state) {
    // Galaxy Forge lives at the top of the Gear tab.
    this.renderForge(state);
    // --- Gear Shop: buy armor & weapons with gold (guaranteed rarity,
    // stage-scaled stats). Set pieces and legendary/mythic stay drop-only.
    const gs = this.els['gear-shop'];
    if (gs && Engine.GEAR_SHOP_STOCK) {
      const cards = Engine.GEAR_SHOP_STOCK.map(entry => {
        const rc = (Engine.RARITY_BY_ID[entry.rarity] || {}).color || '#9aa0a6';
        const slotName = (Engine.SLOT_INFO[entry.slot] || {}).name || entry.slot;
        const afford = state.infGold === true || state.gold >= entry.price;
        const priceLabel = state.infGold === true ? '∞ FREE' : `💰 ${formatNum(entry.price)}`;
        return `
          <div class="shop-card r-${entry.rarity}">
            <div class="shop-emoji">${entry.emoji}</div>
            <div class="shop-name">${esc(entry.name)}</div>
            <div class="muted small shop-desc">${esc(entry.desc)}</div>
            <div class="shop-rarity" style="color:${rc}">${esc(entry.rarity)} · ${esc(slotName)}</div>
            <button class="btn small" data-action="buy-gear" data-id="${entry.id}" ${afford ? '' : 'disabled'}>
              ${afford ? `Buy · ${priceLabel}` : `Need ${priceLabel}`}
            </button>
          </div>`;
      }).join('');
      gs.innerHTML = `
        <div class="shop-head">
          <span class="shop-title">🛒 Gear Shop</span>
          <span class="muted small">guaranteed rarity — set pieces stay boss-drop only</span>
          <button class="btn small ghost" data-action="goto-petshop">🐾 Pet Shop</button>
        </div>
        <div class="shop-grid">${cards}</div>`;
    }

    // loadout strip: one card per slot showing the equipped item
    const strip = this.els['loadout-strip'];
    if (strip && Engine.SLOTS) {
      strip.innerHTML = Engine.SLOTS.map(slot => {
        const id = state.equipped && state.equipped[slot];
        const item = id === Engine.GALAXY_EQUIP_ID
          ? Engine.galaxyItemFor(state, slot)
          : (id && (state.inventory || []).find(i => i.id === id));
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
      const enchLvl = Engine.enchantLevel(item);
      const enchCost = Engine.enchantCost(item);
      const enchMaxed = enchLvl >= Engine.ENCHANT_MAX;
      const enchAfford = (state.gold || 0) >= enchCost;
      card.innerHTML = `
        <div class="item-head">
          <span class="slot-emoji">${Engine.SLOT_INFO[item.slot]?.emoji || '🎒'}</span>
          <span class="item-name">${esc(item.name)}</span>
          ${isEquipped ? '<span class="equipped-tag">EQUIPPED</span>' : ''}
          ${enchLvl ? `<span class="enchant-tag" title="Enchanted +${enchLvl}: stats ×${(1 + Engine.ENCHANT_PCT * enchLvl).toFixed(2)}">+${enchLvl}</span>` : ''}
        </div>
        <div class="item-sub">${esc(item.rarity)} · ${esc(Engine.SLOT_INFO[item.slot]?.name || item.slot)}</div>
        ${setBadge}
        <div class="stat-chips">${statChips}</div>
        <div class="item-actions">
          ${isEquipped ? '' : `<button class="btn small" data-action="equip">Equip</button>`}
          <button class="btn small gold" data-action="enchant" ${enchMaxed || !enchAfford ? 'disabled' : ''}
            title="${enchMaxed ? 'Max enchant reached' : `Enchant to +${enchLvl + 1}: stats ×${(1 + Engine.ENCHANT_PCT * (enchLvl + 1)).toFixed(2)}`}">
            ⬆️ ${enchMaxed ? 'MAX' : `Enchant +${enchLvl + 1} · 💰${formatNum(enchCost)}`}</button>
          ${item.unsellable ? '' : `<button class="btn small ghost" data-action="sell">Sell +${formatNum(item.value || 1)}</button>`}
        </div>`;
      grid.appendChild(card);
    }
  },

  // ---------------- mine ----------------
  renderMine(state, findText) {
    const E = Engine;
    E.ensureMine(state);
    const m = state.mine;
    const pkCard = this.els['mine-pickaxe'];
    if (pkCard) {
      const cur = E.pickaxeTier(state);
      const cost = E.pickaxeUpgradeCost(state);
      let cardHtml;
      if (!cost) {
        // MAX tier — show a badge, no button.
        cardHtml = `
          <div class="pk-row">
            <div class="pk-cur"><span class="pk-emoji">${cur.emoji}</span>
              <div><b>${esc(cur.name)}</b><div class="muted small">×${cur.mult} tap damage</div></div>
            </div>
            <div class="pk-next"><span class="btn small gold" style="pointer-events:none">MAX</span>
              <div class="muted tiny">Strongest pickaxe forged.</div></div>
          </div>`;
      } else {
        const next = E.PICKAXE_TIERS[m.pickaxe + 1];
        const costParts = [];
        let reason = null;
        for (const [k, n] of Object.entries(cost)) {
          if (k === 'gold') continue;
          const od = E.ORE_BY_ID[k];
          const have = (m.ores && m.ores[k]) || 0;
          if (!reason && have < n) reason = `Need ${n - have} more ${(od && od.name) || k}`;
          costParts.push(`<span class="${have >= n ? 'cost-ok' : 'cost-lack'}">${(od && od.emoji) || ''} ${formatNum(n)} ${(od && od.name) || k}</span>`);
        }
        const goldCost = cost.gold || 0;
        const goldOk = state.infGold === true || (state.gold || 0) >= goldCost;
        if (!reason && !goldOk) reason = `Need ${formatNum(goldCost - (state.gold || 0))} more gold`;
        costParts.push(`<span class="${goldOk ? 'cost-ok' : 'cost-lack'}">💰 ${formatNum(goldCost)} gold</span>`);
        cardHtml = `
          <div class="pk-row">
            <div class="pk-cur"><span class="pk-emoji">${cur.emoji}</span>
              <div><b>${esc(cur.name)}</b><div class="muted small">×${cur.mult} tap damage</div></div>
            </div>
            <div class="pk-next">
              <div class="muted tiny">Next: ${next.emoji} ${esc(next.name)} ×${next.mult}</div>
              <div class="pk-cost">${costParts.join(' + ')}</div>
              ${reason
                ? `<button class="btn small" id="mine-pickaxe-btn" disabled>${esc(reason)}</button>`
                : `<button class="btn small gold" id="mine-pickaxe-btn">Upgrade ⛏️</button>`}
            </div>
          </div>`;
      }
      pkCard.innerHTML = cardHtml;
    }
    const rock = this.els['mine-rock'];
    if (rock) {
      const pct = Math.max(0, Math.min(100, (m.rockHp / m.rockMaxHp) * 100));
      const nextTier = E.ORE_TIERS.find(o => m.depth < o.unlockDepth);
      rock.innerHTML = `
        <div class="mine-depth">Depth <b>${m.depth}</b> ${m.depth >= E.MAX_MINE_DEPTH ? '<span class="muted">(max)</span>' : ''}</div>
        <div class="mine-rock-emoji">🪨</div>
        <div class="bar hp"><div class="fill" style="width:${pct}%"></div></div>
        <div class="mine-hptext muted small">${Math.max(0, Math.ceil(m.rockHp))} / ${m.rockMaxHp} HP · ⛏️ ${E.mineDamage(state)} dmg/tap</div>
        ${nextTier ? `<div class="muted tiny">Next ore: ${nextTier.emoji} ${esc(nextTier.name)} at depth ${nextTier.unlockDepth}</div>` : '<div class="muted tiny">All ore tiers unlocked!</div>'}`;
    }
    const find = this.els['mine-find'];
    if (find && findText) find.textContent = findText;
    const stats = this.els['mine-stats'];
    if (stats) {
      const fmt = (n) => Math.max(0, Math.floor(n || 0)).toLocaleString('en-US');
      stats.textContent = `Deepest: ${m.maxDepth || m.depth} · Total taps: ${fmt(m.totalTaps)} · Total ore mined: ${fmt(m.totalMined)}`;
    }
    const grid = this.els['ore-grid'];
    if (grid) {
      grid.innerHTML = E.ORE_TIERS.map(o => {
        const have = (m.ores && m.ores[o.id]) || 0;
        const locked = m.depth < o.unlockDepth;
        return `<div class="ore-card${locked ? ' locked' : ''}">
          <div class="ore-emoji">${locked ? '🔒' : o.emoji}</div>
          <div class="ore-name">${esc(o.name)}</div>
          <div class="ore-count"><b>${formatNum(have)}</b></div>
          ${locked ? `<div class="muted tiny">Depth ${o.unlockDepth}</div>` : ''}
        </div>`;
      }).join('');
    }
  },

  // ---------------- quests ----------------
  // ms until the next quest reset boundary (UTC).
  _msToNextDaily(nowMs) {
    const d = new Date(nowMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - nowMs;
  },
  _msToNextWeekly(nowMs) {
    const d = new Date(nowMs);
    // Next Monday 00:00 UTC. getUTCDay(): 0=Sun..6=Sat; (8-day)%7 = days to add.
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + ((8 - d.getUTCDay()) % 7), 0, 0, 0, 0));
    if (next.getTime() <= nowMs) next.setUTCDate(next.getUTCDate() + 7);
    return next.getTime() - nowMs;
  },
  _fmtCountdown(ms, showDays) {
    const m = Math.max(0, ms);
    const dd = Math.floor(m / 864e5);
    const hh = Math.floor((m % 864e5) / 36e5);
    const mm = Math.floor((m % 36e5) / 6e4);
    return showDays ? `Resets in ${dd}d ${hh}h` : `Resets in ${hh}h ${mm}m`;
  },
  // Refreshes the quest countdown labels in place (called on a timer while
  // the quests tab is open so the countdowns stay live).
  _tickQuestCountdowns() {
    const now = Date.now();
    const daily = document.getElementById('quest-daily-cd');
    const weekly = document.getElementById('quest-weekly-cd');
    if (daily) daily.textContent = this._fmtCountdown(this._msToNextDaily(now), false);
    if (weekly) weekly.textContent = this._fmtCountdown(this._msToNextWeekly(now), true);
  },
  _startQuestCountdowns() {
    this._stopQuestCountdowns();
    this._tickQuestCountdowns();
    this._questTimer = setInterval(() => this._tickQuestCountdowns(), 30000);
  },
  _stopQuestCountdowns() {
    if (this._questTimer) { clearInterval(this._questTimer); this._questTimer = null; }
  },

  renderQuests(state) {
    Engine.ensureQuests(state);
    Engine.ensureStoryQuests(state);
    const cardHtml = (period, entry, progress, target, complete, def, rw, lockedHint) => {
      const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
      const status = entry.claimed
        ? '<span class="quest-tag claimed">✓ Claimed</span>'
        : complete ? '<span class="quest-tag ready">Ready!</span>' : '';
      return `<div class="card quest-card">
        <div class="quest-top"><span>${def.emoji} <b>${esc(def.name)}</b></span>${status}</div>
        <div class="muted small">${esc(def.desc(target))}</div>
        ${lockedHint ? `<div class="muted small">🔒 ${esc(lockedHint)}</div>` : ''}
        <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
        <div class="quest-meta">
          <span class="muted small">${formatNum(Math.min(progress, target))} / ${formatNum(target)}</span>
          <span class="muted small">💰${formatNum(rw.gold)} ⭐${rw.stars}</span>
        </div>
        ${entry.claimed ? '' : complete
          ? `<button class="btn small gold wide" data-claim="${period}:${entry.id}">🎁 Claim reward</button>`
          : ''}
      </div>`;
    };
    const renderList = (period, elId, title, cdId) => {
      const el = this.els[elId];
      if (!el) return;
      const list = period === 'weekly' ? state.quests.weekly : state.quests.daily;
      el.innerHTML = `<div class="quest-head-row"><h3 class="quest-head">${title}</h3><span class="muted small" id="${cdId}"></span></div>` + (list || []).map((entry) => {
        const { progress, target, complete, def } = Engine.questProgress(state, entry);
        if (!def) return '';
        const rw = Engine.questRewardPreview(state, period);
        return cardHtml(period, entry, progress, target, complete, def, rw, null);
      }).join('');
    };
    // One-time story sections (class questline + mastery track). The class
    // section is hidden entirely for non-mage players.
    const renderStoryList = (group, elId, title, sub) => {
      const el = this.els[elId];
      if (!el) return;
      const defs = Engine.STORY_QUEST_DEFS.filter((d) => d.group === group && Engine.storyQuestVisible(state, d));
      if (!defs.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
      el.style.display = '';
      const rw = Engine.questRewardPreview(state, 'story');
      el.innerHTML = `<div class="quest-head-row"><h3 class="quest-head">${title}</h3><span class="muted small">${sub}</span></div>` +
        defs.map((def) => {
          const entry = (state.quests.story || []).find((e) => e.id === def.id);
          if (!entry) return '';
          const { progress, target, complete } = Engine.storyQuestProgress(state, entry);
          const lockedHint = def.requiresSkill && !(state.skills || []).includes(def.requiresSkill)
            ? `Requires ${Engine.SKILLS[def.requiresSkill].name} (Lv ${Engine.SKILLS[def.requiresSkill].unlockLevel})` : null;
          return cardHtml('story', entry, progress, target, complete, def, rw, lockedHint);
        }).join('');
    };
    renderList('daily', 'quest-daily', '☀️ Daily quests', 'quest-daily-cd');
    renderList('weekly', 'quest-weekly', '📅 Weekly quests', 'quest-weekly-cd');
    renderStoryList('class', 'quest-class', '🔮 Class questline', 'mages only · one-time');
    renderStoryList('mastery', 'quest-mastery', '🎯 Skill mastery', 'one-time');
    // Start (and immediately populate) the live reset countdowns now that
    // the header spans exist.
    this._startQuestCountdowns();
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
  // Pets UI lives in the Party tab. The Pet Shop sells tiered eggs for gold
  // (guaranteed rarity pools); wild eggs drop from bosses (15%) and hatch
  // any species. All hatching is instant from here.
  renderPets(state) {
    const panel = this.els['pets-panel'];
    panel.innerHTML = '';
    const p = Engine.ensurePets(state);

    // --- Pet Shop ---
    const shop = document.createElement('div');
    shop.className = 'pet-shop';
    const cards = Engine.SHOP_EGG_TIERS.map(tier => {
      const t = Engine.EGG_TIERS[tier];
      const owned = p.shopEggs[tier] || 0;
      const afford = state.infGold === true || state.gold >= t.price;
      const priceLabel = state.infGold === true ? '∞ FREE' : `💰 ${formatNum(t.price)}`;
      return `
        <div class="shop-card">
          <div class="shop-emoji">${t.emoji}</div>
          <div class="shop-name">${esc(t.name)}</div>
          <div class="muted small shop-desc">${esc(t.desc)}</div>
          ${owned > 0 ? `<div class="shop-owned">You own: <b>${owned}</b></div>` : ''}
          <button class="btn small" data-action="buy-egg" data-tier="${tier}" ${afford ? '' : 'disabled'}>
            ${afford ? `Buy · ${priceLabel}` : `Need ${priceLabel}`}
          </button>
        </div>`;
    }).join('');
    shop.innerHTML = `
      <div class="shop-head"><span class="shop-title">🐾 Pet Shop</span>
        <span class="muted small">guaranteed rarity — bosses can drop wild eggs too</span></div>
      <div class="shop-grid">${cards}</div>`;
    panel.appendChild(shop);

    // --- Eggs ---
    const eggRow = document.createElement('div');
    eggRow.className = 'pet-eggs';
    const wild = p.eggs;
    const tierRows = Engine.SHOP_EGG_TIERS
      .filter(tier => (p.shopEggs[tier] || 0) > 0)
      .map(tier => {
        const t = Engine.EGG_TIERS[tier];
        return `
          <div class="row-between">
            <span>${t.emoji} ${esc(t.name)}: <b>${p.shopEggs[tier]}</b></span>
            <button class="btn small success" data-action="hatch-pet" data-tier="${tier}">Hatch ${t.emoji}</button>
          </div>`;
      }).join('');
    eggRow.innerHTML = `
      <div class="row-between">
        <span>🥚 Wild eggs: <b>${wild}</b> <span class="muted small">(15% drop from bosses)</span></span>
        <button class="btn small success" data-action="hatch-pet" data-tier="wild" ${wild < 1 ? 'disabled' : ''}>Hatch 🥚</button>
      </div>${tierRows}`;
    panel.appendChild(eggRow);
    if (!p.collection.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = 'No pets yet. Buy an egg in the shop above, or slay bosses for a wild egg!';
      panel.appendChild(empty);
      return;
    }
    if (state.playerClass === 'hunter') {
      const hint = document.createElement('p');
      hint.className = 'muted small';
      hint.textContent = '🏹 Hunter perk: field a second pet — set any pet as your 2nd and both will fight.';
      panel.appendChild(hint);
    }
    const list = document.createElement('div');
    list.className = 'pet-list';
    for (const pet of p.collection) {
      const sp = Engine.petSpeciesOf(pet);
      const isPrimary = pet.uid === p.activeUid;
      const isSecond = pet.uid === p.secondUid;
      const isHunter = state.playerClass === 'hunter';
      const active = isPrimary || isSecond;
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
      const badge = isPrimary ? '<span class="pet-active">ACTIVE</span>'
        : isSecond ? '<span class="pet-active">2ND PET</span>' : '';
      const setActiveBtn = isPrimary ? '' : `<button class="btn small ghost" data-action="set-active-pet" data-id="${esc(pet.uid)}">Set active</button>`;
      const secondBtn = !isHunter || isPrimary ? '' : isSecond
        ? `<button class="btn small ghost" data-action="remove-second-pet" data-id="${esc(pet.uid)}">Remove 2nd</button>`
        : `<button class="btn small ghost" data-action="set-second-pet" data-id="${esc(pet.uid)}">Set as 2nd</button>`;
      row.innerHTML = `
        <div class="pet-head"><span class="pet-emoji">${sp.emoji}</span>
          <div><div class="comp-name">${esc(sp.name)} <span class="muted small">Lv ${pet.level}</span></div>
          <div class="muted small">${esc(sp.rarity)} · strikes every 4s</div></div>
          ${badge}
        </div>
        <div class="muted small">📊 ${ps.atk} ATK · ${ps.def} DEF · ${ps.hp} HP</div>
        <div class="muted small">${bondText}</div>
        <div class="pet-hunger"><div class="bar hunger"><div class="fill" style="width:${hungerPct}%"></div></div>
          <span class="muted small">🍖 ${hungerPct}% ${hungerLabel}</span></div>
        <div class="row">
          <button class="btn small" data-action="feed-pet" data-id="${esc(pet.uid)}" ${pet.hunger >= 100 ? 'disabled' : ''}>🍖 Feed (💰${formatNum(cost)})</button>
          ${setActiveBtn}
          ${secondBtn}
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
      body.innerHTML = '<div class="lb-empty muted center">No heroes yet.</div>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    entries.forEach((en, i) => {
      const row = document.createElement('div');
      row.className = 'lb-row' + (i < 3 ? ' lb-top' + (i + 1) : '');
      const isMe = en.username === meUsername;
      if (isMe) row.classList.add('me-row');
      const race = Engine.RACES[en.race] || {};
      const cls = Engine.CLASSES[en.playerClass] || {};
      const spec = Engine.SPECS[en.spec] || {};
      const title = en.title ? `<div class="lb-title">${esc(Engine.titleName(en.title))}</div>` : '';
      const flag = en.country ? Engine.countryFlag(en.country) : '';
      const badge = en.badge ? Engine.badgeDef(en.badge) : null;
      const badgeHtml = badge ? `<span class="lb-badge" title="${esc(badge.name)}">${badge.emoji}</span> ` : '';
      const clsHtml = en.playerClass && UI_CLASS_EMOJI[en.playerClass]
        ? `<span class="lb-class" title="${esc(en.playerClass)}">${UI_CLASS_EMOJI[en.playerClass]}</span> ` : '';
      const specHtml = en.spec && UI_SPEC_EMOJI[en.spec]
        ? `<span class="lb-class" title="${esc(en.spec)}">${UI_SPEC_EMOJI[en.spec]}</span> ` : '';
      const rankHtml = medals[i]
        ? `<div class="lb-rank lb-medal" aria-label="rank ${i + 1}">${medals[i]}</div>`
        : `<div class="lb-rank">${i + 1}</div>`;
      row.innerHTML = `
        ${rankHtml}
        <div class="lb-avatar" aria-hidden="true">${race.emoji || '❓'}</div>
        <div class="lb-identity">
          <div class="lb-name">${flag ? flag + ' ' : ''}${badgeHtml}${clsHtml}${specHtml}${esc(en.username)}${isMe ? '<span class="lb-you">YOU</span>' : ''}</div>
          ${title}
        </div>
        <div class="lb-chips">
          <span class="lb-chip"><b>Lv</b>${en.level}</span>
          <span class="lb-chip"><b>Stage</b>${en.stage}</span>
          <span class="lb-chip"><b>⚔️</b>${formatNum(en.power || 0)}</span>
          <span class="lb-chip"><b>👑</b>${en.bossesKilled}</span>
          <span class="lb-chip"><b>🌀</b>${en.rebirth > 0 ? en.rebirth : '—'}</span>
        </div>`;
      body.appendChild(row);
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
    const badge = state.badge ? Engine.badgeDef(state.badge) : null;
    const countryOpts = `<option value="">— no flag —</option>` + Engine.COUNTRIES.map(c =>
      `<option value="${c.code}"${state.country === c.code ? ' selected' : ''}>${Engine.countryFlag(c.code)} ${esc(c.name)}</option>`).join('');
    this.els['profile-card'].innerHTML = `
      <div class="profile-head">
        <div class="profile-emoji">${race.emoji || '❓'}</div>
        <div>
          <div class="profile-name">${state.country ? Engine.countryFlag(state.country) + ' ' : ''}${badge ? badge.emoji + ' ' : ''}${esc(user ? user.username : '—')}</div>
          <div class="profile-title-row">
            <div class="profile-title">${esc(Engine.titleName(state.activeTitle))}</div>
            <button class="btn small titles-btn" data-action="titles-list">🏆 Titles</button>
          </div>
          <div><span class="role-badge role-${role}">${esc(role)}</span>
          <span class="muted small">${cls.emoji ? cls.emoji + ' ' : ''}${esc(cls.name ? cls.name + ' · ' : '')}${spec.emoji ? spec.emoji + ' ' : ''}${esc(spec.name ? spec.name + ' · ' : '')}${esc(race.name || '')}</span></div>
        </div>
      </div>
      <div class="titles-block">
        <div class="muted small titles-label">🌍 Country flag <span class="muted">(shows on leaderboard)</span></div>
        <select id="country-select" class="country-select">${countryOpts}</select>
      </div>
      <div class="profile-grid">
        <div><span class="muted">Level</span><b>${state.level}</b></div>
        <div><span class="muted">Stage</span><b>${state.stage}</b></div>
        <div><span class="muted">Bosses</span><b>${state.bossesKilled}</b></div>
        <div><span class="muted">Rebirths</span><b>🌀${state.rebirthCount || 0}</b></div>
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
    this.checkBalanceBadge();
  },

  // ---------------- titles browser ----------------
  // Scrollable modal listing every title. Unlocked titles equip on tap via
  // the same onTitle code path as the profile chips; the modal closes after
  // the equip so the re-rendered profile shows the new active title.
  showTitlesModal(state) {
    const s = state || {};
    const unlocked = new Set(s.titlesUnlocked || ['wanderer']);
    const rows = Engine.TITLES.map(t => {
      const has = unlocked.has(t.id);
      const active = s.activeTitle === t.id;
      const rowCls = 'title-row' + (has ? ' unlocked' : ' locked') + (active ? ' active' : '');
      const nameHtml = (has && active ? '👑 ' : has ? '' : '🔒 ') + esc(t.name);
      return has
        ? `<button class="${rowCls}" data-id="${t.id}"><span class="title-row-name">${nameHtml}</span><span class="title-row-desc">${esc(t.desc)}</span></button>`
        : `<div class="${rowCls}"><span class="title-row-name">${nameHtml}</span><span class="title-row-desc">${esc(t.desc)}</span></div>`;
    }).join('');
    const close = this.modal({ title: '👑 Hero Titles', html: `<div class="titles-list">${rows}</div>` });
    // Null-safe: grab the overlay we just appended and delegate row taps.
    const root = this.els && this.els['modal-root'];
    const overlay = root ? root.lastElementChild : null;
    if (overlay && overlay.addEventListener) {
      overlay.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('button.title-row') : null;
        if (!btn || !btn.dataset || !btn.dataset.id) return;
        if (this.handlers && this.handlers.onTitle) this.handlers.onTitle(btn.dataset.id);
        close();
      });
    }
    return close;
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

  // Balance log: static nerf/patch notes in public/data/balance-log.json
  // (newest first). Format per entry:
  //   { version, date, title, changes: [{ system, before, after, note }] }
  async fetchBalanceLog() {
    try {
      const r = await fetch('data/balance-log.json', { cache: 'no-store' });
      // Accept status 0 as well: file:// and some WebView contexts report 0
      // for successful local loads.
      if (r.ok || r.status === 0) {
        try {
          const j = await r.json();
          if (Array.isArray(j)) return j;
        } catch { /* fall through */ }
      }
    } catch { /* ignore */ }
    return null;
  },

  // Shows the NEW badge on "Balance Log" until the player opens the latest entry.
  checkBalanceBadge() {
    const badges = [this.els['balance-log-badge'], this.els['balance-log-badge-hud']].filter(Boolean);
    if (!badges.length) return;
    this.fetchBalanceLog()
      .then(log => {
        if (!Array.isArray(log) || !log.length) return;
        const latest = String(log[0].version || '');
        let seen = null;
        try { seen = localStorage.getItem('kop-balance-seen'); } catch { /* ignore */ }
        badges.forEach(b => b.classList.toggle('hidden', !latest || seen === latest));
      })
      .catch(() => { /* offline-tolerant */ });
  },

  async openBalanceLog() {
    const log = await this.fetchBalanceLog();
    if (!Array.isArray(log) || !log.length) {
      this.toast('No balance changes logged yet.', 'info');
      return;
    }
    const html = log.map(e => `
      <div class="bl-entry">
        <div class="bl-head"><b>⚖️ ${esc(e.title || e.version || 'Balance patch')}</b>
          <span class="muted small">${e.version ? 'v' + esc(String(e.version).replace(/^v/, '')) : ''}${e.date ? ' · ' + esc(e.date) : ''}</span></div>
        ${(e.changes || []).map(c => `
          <div class="bl-change">
            <div class="bl-system">${esc(c.system || 'Change')}</div>
            <div class="bl-before"><span class="bl-tag">before</span> ${esc(c.before || '—')}</div>
            <div class="bl-after"><span class="bl-tag">after</span> ${esc(c.after || '—')}</div>
            ${c.note ? `<div class="bl-note muted small">${esc(c.note)}</div>` : ''}
          </div>`).join('')}
      </div>`).join('');
    this.modal({
      title: '⚖️ Balance Log',
      html: `<div class="bl-log">${html}</div>`,
      buttons: [{ label: 'Close', cls: 'gold' }],
    });
    try { localStorage.setItem('kop-balance-seen', String(log[0].version || '')); } catch { /* ignore */ }
    ['balance-log-badge', 'balance-log-badge-hud'].forEach(id => {
      if (this.els[id]) this.els[id].classList.add('hidden');
    });
  },

  shareGame(state, user) {
    if (!state) return;
    const name = (user && user.username) || 'a hero';
    const url = 'https://king-of-project.onrender.com';
    const shareText = `⚔️ I'm ${name} — Lv ${state.level}, Stage ${state.stage} in Throne of Shadows! Can you beat me? #ThroneOfShadows`;
    if (navigator.share) {
      navigator.share({ title: 'Throne of Shadows', text: shareText, url }).catch(() => { /* dismissed */ });
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
