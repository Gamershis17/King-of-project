// ============================================================
// ui.js — all DOM rendering for Throne of Shadows.
// engine.js stays DOM-free; this file owns the DOM.
// app.js wires behavior via UI.handlers.
// ============================================================
import * as Engine from './engine.js?v=20260930m';
import { Audio } from './audio.js?v=20260930m';

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
const DISCORD_URL = 'https://discord.gg/mMeUhKBh6j'; // community Discord server invite
const YOUTUBE_URL = 'https://www.youtube.com/@ThroneofShadows-q9f'; // official YouTube channel
const TIKTOK_URL = 'https://www.tiktok.com/@throneofshadowsofficial'; // official TikTok

export function formatNum(n) {
  n = Math.floor(Number(n) || 0);
  if (n < 1000) return String(n);
  const units = ['K', 'M', 'B', 'T', 'Q', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
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
  settings: { damageNumbers: true, reduceMotion: false, performanceMode: false, bgFps: 30, bgHd: false },
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
    { id: 'void-tide',   name: 'Void Tide',   css: 'radial-gradient(circle at 50% 40%, #1d1040, #060310 72%)', animated: true },
    { id: 'throne-storm', name: 'Throne Storm', css: 'radial-gradient(circle at 50% 30%, #2a0d16, #080304 72%)', animated: true },
    { id: 'inferno-flare', name: 'Inferno Flare', css: 'radial-gradient(circle at 50% 50%, #5e1f0d, #0d0503 72%)', animated: true },
    { id: 'cinder-storm',  name: 'Cinder Storm',  css: 'radial-gradient(circle at 50% 50%, #4a1508, #0c0603 72%)', animated: true },
    { id: 'phoenix-ash',   name: 'Phoenix Ash',   css: 'radial-gradient(circle at 50% 60%, #4a3208, #0d0a04 72%)', animated: true },
    { id: 'frostfall', name: 'Frostfall', css: "url('img/bg/frostfall.jpg') center/cover", photo: 'img/bg/frostfall.jpg', animated: true },
    { id: 'starfall',  name: 'Starfall',  css: "url('img/bg/starfall.jpg') center/cover",  photo: 'img/bg/starfall.jpg',  animated: true },
    { id: 'bloodmoon', name: 'Blood Moon', css: "url('img/bg/bloodmoon.jpg') center/cover", photo: 'img/bg/bloodmoon.jpg', animated: true },
    { id: 'nightsky', name: 'Night Sky', css: "url('img/bg/nightsky.jpg') center/cover", photo: 'img/bg/nightsky.jpg', animated: true },
    { id: 'sunset',   name: 'Sunset',    css: "url('img/bg/sunset.jpg') center/cover",   photo: 'img/bg/sunset.jpg',   animated: true },
    { id: 'woods',    name: 'Woods',     css: "url('img/bg/woods.jpg') center/cover",     photo: 'img/bg/woods.jpg',     animated: true },
    { id: 'water',    name: 'Water',     css: "url('img/bg/water.jpg') center/cover",     photo: 'img/bg/water.jpg',     animated: true },
    { id: 'autumn-dusk',  name: '🍂 Autumn Dusk', css: "url('img/bg/autumn-dusk.jpg') center/cover", photo: 'img/bg/autumn-dusk.jpg', animated: true },
    { id: 'winter-night', name: '❄️ Winter Night', css: "url('img/bg/winter-night.jpg') center/cover", photo: 'img/bg/winter-night.jpg', animated: true },
    { id: 'hallows-eve',  name: '🎃 Hallow\'s Eve', css: "url('img/bg/hallows-eve.jpg') center/cover", photo: 'img/bg/hallows-eve.jpg', animated: true },
    { id: 'new-year',     name: '🎆 New Year', css: "url('img/bg/new-year.jpg') center/cover", photo: 'img/bg/new-year.jpg', animated: true },
    { id: 'summer-tide',  name: '☀️ Summer Tide', css: "url('img/bg/summer-tide.jpg') center/cover", photo: 'img/bg/summer-tide.jpg', animated: true },
    { id: 'spring-bloom', name: '🌸 Spring Bloom', css: "url('img/bg/spring-bloom.jpg') center/cover", photo: 'img/bg/spring-bloom.jpg', animated: true },
    { id: 'class-hunter', name: "🏹 Hunter's Dawn", css: "url('img/bg/class-hunter.jpg') center/cover", photo: 'img/bg/class-hunter.jpg', animated: true },
    { id: 'class-warrior', name: "⚔️ Warrior's Stand", css: "url('img/bg/class-warrior.jpg') center/cover", photo: 'img/bg/class-warrior.jpg', animated: true },
    { id: 'class-mage', name: '🔮 Mage Spire', css: "url('img/bg/class-mage.jpg') center/cover", photo: 'img/bg/class-mage.jpg', animated: true },
    { id: 'class-assassin', name: "🗡️ Assassin's Night", css: "url('img/bg/class-assassin.jpg') center/cover", photo: 'img/bg/class-assassin.jpg', animated: true },
    { id: 'class-necromancer', name: '💀 Necropolis', css: "url('img/bg/class-necromancer.jpg') center/cover", photo: 'img/bg/class-necromancer.jpg', animated: true },
    { id: 'class-berserker', name: '🪓 Bloodrage Field', css: "url('img/bg/class-berserker.jpg') center/cover", photo: 'img/bg/class-berserker.jpg', animated: true },
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
  BG_ANIMATED: ['shadow-eyes', 'orbs', 'ember-drift', 'void-tide', 'throne-storm',
    'inferno-flare', 'cinder-storm', 'phoenix-ash', 'frostfall', 'starfall', 'bloodmoon',
    'nightsky', 'sunset', 'woods', 'water',
    'autumn-dusk', 'winter-night', 'hallows-eve', 'new-year', 'summer-tide', 'spring-bloom',
    'class-hunter', 'class-warrior', 'class-mage', 'class-assassin', 'class-necromancer', 'class-berserker'],

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
    document.body.classList.toggle('perf', !!this.settings.performanceMode);
    // OS reduced-motion auto-enables the visual parts of Performance mode
    // even when the toggle is off (body.os-reduced shares the perf CSS).
    const osReduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.body.classList.toggle('os-reduced', !!osReduced());
    try {
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
        document.body.classList.toggle('os-reduced', !!e.matches);
        if (this._bg && this._bg.scene) this.setBgScene(this._bg.scene, this._bg.opts);
      });
    } catch { /* older browsers: static check above is enough */ }

    const ids = [
      'hud-emoji', 'hud-username', 'hud-role', 'hud-race', 'hud-gold', 'hud-stars',
      'hud-stage', 'hud-level', 'hud-xpfill', 'hud-xptext', 'save-indicator',
      'mode-switch', 'enemy-card', 'enemy-sprite', 'enemy-name', 'enemy-stage',
      'boss-badge', 'enemy-hpfill', 'enemy-hptext', 'enemy-atk', 'float-layer',
      'dead-overlay', 'hero-hpfill', 'hero-hptext', 'hero-stats', 'dungeon-chips',
      'tap-btn', 'skill-row', 'combo-meter', 'rebirth-box', 'rebirth-btn',
      'rebirth-note', 'combat-log', 'loadout-strip', 'upgrade-list', 'gear-shop', 'inventory-grid', 'inv-count', 'set-progress',
      'quest-daily', 'quest-weekly', 'quest-guide', 'quest-class', 'quest-mastery',
      'party-slots', 'recruit-list', 'lb-body', 'lb-refresh', 'lb-cats', 'lb-note', 'profile-card',
      'stats-card', 'titles-list',
      'mp-party-card', 'mp-join-card', 'mp-join-code', 'mp-join-btn', 'mp-refresh',
      'ranks-subtabs', 'friends-panel', 'friend-req-badge', 'lb-board-view',
      'redeem-input', 'redeem-btn', 'gm-entry-card', 'gm-open-btn',
      'set-dmgnums', 'set-motion', 'set-perf', 'set-sfx', 'set-music', 'set-music-track', 'set-follow-world', 'set-notif-level', 'set-notif-death',
      'set-notif-loot', 'set-notif-quest', 'logout-btn', 'modal-root', 'toast-root',
      'race-grid', 'class-grid', 'pet-grid', 'spec-grid', 'gm-back', 'meter-rows', 'total-dps',
      'share-btn', 'changelog-btn', 'changelog-badge', 'changelog-hud', 'changelog-badge-hud',
      'balance-log-btn', 'balance-log-badge', 'balance-log-hud', 'balance-log-badge-hud',
      'friends-hud', 'friend-req-badge-hud', 'social-hud', 'discord-login',
      'inn-btn', 'leave-inn-btn', 'inn-hpfill', 'inn-hptext', 'inn-status', 'inn-glow',
      'mine-rock', 'mine-btn', 'mine-find', 'ore-grid', 'forge-section',
      'mine-pickaxe', 'mine-stats',
      'pause-pill',
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
    // Mining shop: buy buttons (data-action="buy-pickaxe").
    listen('mining-shop', 'click', (e) => {
      const btn = e.target.closest('button[data-action="buy-pickaxe"]');
      if (!btn || btn.disabled) return;
      if (this.handlers.onPickaxeUpgrade) this.handlers.onPickaxeUpgrade();
    });
    listen('upgrade-list', 'click', (e) => {
      const btn = e.target.closest('button[data-upgrade]');
      if (!btn) return;
      this.handlers.onUpgrade && this.handlers.onUpgrade(btn.dataset.upgrade);
    });

    // Party: delegated recruit/dismiss actions
    listen('tab-party', 'click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const h = this.handlers;
      if (btn.dataset.action === 'recruit' && h.onRecruit) h.onRecruit(btn.dataset.id);
      if (btn.dataset.action === 'dismiss' && h.onDismiss) h.onDismiss(btn.dataset.id);
      if (btn.dataset.action === 'levelup' && h.onLevelUpCompanion) h.onLevelUpCompanion(btn.dataset.id);
      // Multiplayer party actions
      if (btn.dataset.action === 'mp-create' && h.onMpCreate) h.onMpCreate();
      if (btn.dataset.action === 'mp-leave' && h.onMpLeave) h.onMpLeave();
      if (btn.dataset.action === 'mp-disband' && h.onMpDisband) h.onMpDisband();
      if (btn.dataset.action === 'mp-copy' && h.onMpCopy) h.onMpCopy();
      if (btn.dataset.action === 'mp-kick' && h.onMpKick) h.onMpKick(btn.dataset.id);
      if (btn.dataset.action === 'mp-join' && h.onMpJoin) {
        const input = document.getElementById('mp-join-code');
        h.onMpJoin(input ? input.value : '');
      }
    });
    // Token shop
    listen('tab-tokenshop', 'click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'buy-token' && this.handlers.onBuyTokenItem) {
        this.handlers.onBuyTokenItem(btn.dataset.id);
      }
    });
    // Pets tab: delegated pet + breeding actions
    listen('tab-pets', 'click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const h = this.handlers;
      if (btn.dataset.action === 'hatch-pet' && h.onHatchPet) h.onHatchPet(btn.dataset.tier || 'wild');
      if (btn.dataset.action === 'feed-pet' && h.onFeedPet) h.onFeedPet(btn.dataset.id);
      if (btn.dataset.action === 'set-active-pet' && h.onSetActivePet) h.onSetActivePet(btn.dataset.id);
      if (btn.dataset.action === 'set-second-pet' && h.onSetSecondPet) h.onSetSecondPet(btn.dataset.id);
      if (btn.dataset.action === 'remove-second-pet' && h.onRemoveSecondPet) h.onRemoveSecondPet();
      if (btn.dataset.action === 'buy-egg' && h.onBuyEgg) h.onBuyEgg(btn.dataset.tier);
      if (btn.dataset.action === 'breed-select') this._toggleBreedSelect(btn.dataset.id);
      if (btn.dataset.action === 'combine-select') this._toggleCombineSelect(btn.dataset.id);
      if (btn.dataset.action === 'do-breed' && h.onBreedPets) h.onBreedPets();
      if (btn.dataset.action === 'do-combine' && h.onCombinePets) h.onCombinePets();
      // Sell pet: two-step confirm. First tap arms the button ("Tap again to
      // confirm"); the second tap (within 6s) fires the sale.
      if (btn.dataset.action === 'sell-pet' && h.onSellPet) {
        if (btn.dataset.armed === '1') {
          delete btn.dataset.armed;
          btn.classList.remove('armed');
          h.onSellPet(btn.dataset.id);
        } else {
          btn.dataset.armed = '1';
          btn.classList.add('armed');
          const label = btn.querySelector('.sell-label');
          if (label) label.textContent = 'Tap again to confirm';
          clearTimeout(btn._sellTimer);
          btn._sellTimer = setTimeout(() => {
            delete btn.dataset.armed;
            btn.classList.remove('armed');
            const l = btn.querySelector('.sell-label');
            if (l && btn.isConnected) l.textContent = btn.dataset.sellText || 'Sell';
          }, 6000);
        }
      }
    });
    // Multiplayer party: manual refresh
    listen('mp-refresh', 'click', () => {
      this.handlers.onMpRefresh && this.handlers.onMpRefresh();
    });

    // Ranks refresh
    listen('lb-refresh', 'click', () => {
      this.handlers.onTab && this.handlers.onTab('ranks', true);
    });

    // Leaderboard category pills (Heroes / Guilds)
    listen('lb-cats', 'click', (e) => {
      const btn = e.target.closest('button[data-lbcat]');
      if (!btn || btn.disabled) return;
      this.setRanksCategory(btn.dataset.lbcat);
      this.handlers.onRanksCategory && this.handlers.onRanksCategory(btn.dataset.lbcat);
    });

    // Ranks: ranking pills (delegated, null-safe).
    // Ranking pills use data-by so they never collide with the Heroes/Guilds pills above.
    listen('lb-cats', 'click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button[data-by]') : null;
      if (!btn || !btn.dataset || !btn.dataset.by) return;
      this.setLbCategory(btn.dataset.by);
    });

    // Ranks: leaderboard rows are clickable → player inspect
    listen('lb-body', 'click', (e) => {
      const row = e.target.closest('.lb-row[data-username]');
      if (!row || !row.dataset.username) return;
      this.handlers.onInspect && this.handlers.onInspect(row.dataset.username);
    });

    // Ranks sub-tabs (Board / Friends)
    listen('ranks-subtabs', 'click', (e) => {
      const btn = e.target.closest('button[data-subtab]');
      if (!btn) return;
      this.handlers.onRanksSubtab && this.handlers.onRanksSubtab(btn.dataset.subtab);
    });

    // Friends: delegated friend actions, shared by the Ranks-tab panel and
    // the HUD friends modal. The add-friend input is looked up inside the
    // button's own container so panel and modal never clash.
    const friendAction = (e) => {
      const btn = e.target.closest('button[data-friend]');
      if (!btn || btn.disabled) return;
      const h = this.handlers;
      const action = btn.dataset.friend;
      const uname = btn.dataset.username;
      if (action === 'send') {
        const scope = btn.closest('.modal-body, #friends-panel') || document;
        const input = scope.querySelector('.friend-input');
        const name = input ? input.value.trim() : '';
        if (!name) { this.toast('Type a username first.', 'info'); return; }
        h.onFriendSend && h.onFriendSend(name);
      }
      else if (action === 'accept' && uname && h.onFriendAccept) h.onFriendAccept(uname);
      else if (action === 'decline' && uname && h.onFriendDecline) h.onFriendDecline(uname);
      else if (action === 'cancel' && uname && h.onFriendRemove) h.onFriendRemove(uname);
      else if (action === 'inspect' && uname && h.onInspect) h.onInspect(uname);
      else if (action === 'compare' && uname && h.onInspectCompare) h.onInspectCompare(uname);
      else if (action === 'remove' && uname && h.onFriendRemove) h.onFriendRemove(uname);
      else if (action === 'upgrade' && h.onUpgradeAccount) h.onUpgradeAccount();
    };
    listen('friends-panel', 'click', friendAction);
    // Modal root: same actions inside the HUD friends modal.
    if (this.els['modal-root']) this.els['modal-root'].addEventListener('click', friendAction);
    // Enter key in any add-friend box sends the request.
    const friendKey = (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('friend-input') && e.key === 'Enter') {
        const name = e.target.value.trim();
        if (!name) return;
        this.handlers.onFriendSend && this.handlers.onFriendSend(name);
      }
    };
    listen('friends-panel', 'keydown', friendKey);
    if (this.els['modal-root']) this.els['modal-root'].addEventListener('keydown', friendKey);
    // HUD friends button (top bar 👥 icon).
    listen('friends-hud', 'click', () => { this.openFriendsModal(); });

    // Discord login button — open the community server invite in a new tab.
    const openDiscord = () => { try { window.open(DISCORD_URL, '_blank', 'noopener'); } catch (e) {} };
    listen('discord-login', 'click', openDiscord);
    // Social hub button — popup with Discord (live) + coming-soon social slots.
    listen('social-hud', 'click', () => { this.openSocialHub(openDiscord); });

    // Settings tab: delegated talent / profession buttons
    listen('tab-settings', 'click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || btn.disabled) return;      const h = this.handlers;
      if (btn.dataset.action === 'talent' && h.onTalent) h.onTalent(btn.dataset.id);
      if (btn.dataset.action === 'prof' && h.onProfession) h.onProfession(btn.dataset.id);
      if (btn.dataset.action === 'title' && h.onTitle) h.onTitle(btn.dataset.id);
      if (btn.dataset.action === 'titles-list' && h.onTitlesList) h.onTitlesList();
    });

    // Titles tab: tap an unlocked title to equip it
    listen('tab-titles', 'click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button.title-row') : null;
      if (!btn || !btn.dataset || !btn.dataset.id) return;
      if (this.handlers && this.handlers.onTitle) this.handlers.onTitle(btn.dataset.id);
    });

    // Country picker (stats tab) — delegated change
    listen('tab-stats', 'change', (e) => {
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
    listen('changelog-hud', 'click', () => {
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
    if (this.els['set-perf']) this.els['set-perf'].checked = !!this.settings.performanceMode;
    listen('set-perf', 'change', (e) => {
      this.saveSetting('performanceMode', e.target.checked);
      this.applyPerfMode();
    });
    // Audio prefs live on the game state (per player / guest save), not in
    // localStorage — app.js syncs the checkboxes via applyAudioPrefs().
    listen('set-sfx', 'change', (e) => this.handlers.onSfx && this.handlers.onSfx(e.target.checked));
    listen('set-music', 'change', (e) => this.handlers.onMusic && this.handlers.onMusic(e.target.checked));
    // Music track picker + world-follow toggle (Settings).
    listen('set-music-track', 'change', (e) => this.handlers.onMusicTrack && this.handlers.onMusicTrack(e.target.value));
    listen('set-follow-world', 'change', (e) => this.handlers.onFollowWorld && this.handlers.onFollowWorld(e.target.checked));
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

    // Background frame-rate segmented control (Settings → 30/60 FPS).
    const fpsSeg = document.getElementById('bg-fps-seg');
    if (fpsSeg) {
      fpsSeg.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => {
          this.saveSetting('bgFps', b.dataset.bgfps === '60' ? 60 : 30);
          this._syncBgQualitySegs();
        });
      });
    }
    // Background detail segmented control (Settings → SD/HD backing resolution).
    const hdSeg = document.getElementById('bg-hd-seg');
    if (hdSeg) {
      hdSeg.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => {
          this.saveSetting('bgHd', b.dataset.bghd === '1');
          this._syncBgQualitySegs();
          // Re-fit the canvas so the new DPR cap takes effect immediately.
          if (this._bg && this._bg.fit) this._bg.fit();
        });
      });
    }
    this._syncBgQualitySegs();

    // Custom button / background pickers (Settings)
    this._renderStylePickers();
    this._renderBattleBgPicker();
    this._renderNameStylePickers(this._settingsState || null);

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

  // Performance mode (anti-lag): visual-only. Game logic/tick rate untouched.
  // Applies the body.perf class (flattened CSS) and re-renders the ambient
  // background as a single static frame (no rAF loop) via _bgReduced().
  applyPerfMode() {
    const on = !!this.settings.performanceMode;
    document.body.classList.toggle('perf', on);
    this._dmgAcc = null;
    // Re-render the ambient scene (animated loop vs. static frame).
    if (this._bg && this._bg.scene) this.setBgScene(this._bg.scene, this._bg.opts);
  },

  // True when the perf visuals should apply: user toggle OR the OS
  // prefers-reduced-motion setting (which auto-enables the visual parts).
  _perfVisual() {
    return !!this.settings.performanceMode ||
      (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
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
    if (name !== 'quests') { this._stopQuestCountdowns(); this._stopQuestSync(); }
    if (name !== 'tokenshop') this._stopTokenCountdown();
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
  toast(msg, kind = 'info', ms = 2600, cls = '') {
    const root = this.els['toast-root'];
    if (!root) return;
    // Dock toasts just under the sticky HUD so they never cover tab content.
    const hud = document.getElementById('hud');
    if (hud) root.style.top = (hud.getBoundingClientRect().height + 10) + 'px';
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
    el.className = 'toast toast-' + kind + (cls ? ' ' + cls : '');
    el.innerHTML = '<span class="toast-msg"></span>';
    el.querySelector('.toast-msg').textContent = msg;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const timer = this._toastTimer(el, ms);
    this._lastToast = { text: msg, el, count: 1, time: now, timer };
    while (root.children.length > 4) root.firstChild.remove();
  },

  // Title-unlock toast: subtle gold glow only (kept readable, no rainbow).
  titleToast(name) {
    this.toast(`👑 New title unlocked: ${name}!`, 'success', 2600, 'toast-title');
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

  // Syncs the Settings music track picker + world-follow checkbox to the save.
  syncMusicPrefs(p) {
    const sel = this.els['set-music-track'];
    if (sel) {
      const names = (Audio.MUSIC_TRACK_NAMES) || {};
      const ids = Audio.MUSIC_TRACKS || [];
      sel.innerHTML = ids.map((id) => `<option value="${id}">${esc(names[id] || id)}</option>`).join('');
      sel.value = (p && p.track) || ids[0] || '';
    }
    const fw = this.els['set-follow-world'];
    if (fw) fw.checked = !p || p.followWorld !== false;
  },

  // ---------------- pause-while-browsing ----------------
  // True while any full-screen modal (boss intro, changelog, confirms…)
  // sits on top of the game. Null-safe: never throws during boot.
  anyModalOpen() {
    const root = this.els['modal-root'];
    return !!(root && root.children && root.children.length);
  },

  // Shows/hides the global "PAUSED — world frozen" pill. Called by app.js
  // on pause transitions only.
  setPaused(on) {
    const el = this.els['pause-pill'] || document.getElementById('pause-pill');
    if (el) el.classList.toggle('hidden', !on);
  },

  // Social hub popup: Discord (live) + slots for future social profiles.
  openSocialHub(openDiscord) {
    const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
    const ICONS = {
      discord: 'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z',
      youtube: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
      tiktok: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
    };
    const row = (brand, name, sub, live, id) => `
      <button class="social-row${live ? '' : ' soon'}"${id ? ` id="${id}"` : ''} data-name="${name}" data-live="${live ? 1 : 0}">
        <span class="social-ico ${brand}">${svg(ICONS[brand])}</span>
        <span class="social-meta"><b>${name}</b><i>${sub}</i></span>
        ${live ? '<span class="social-go">Open</span>' : '<span class="social-soon-tag">Soon</span>'}
      </button>`;
    this.modal({
      title: 'Follow Throne of Shadows',
      html: row('discord', 'Discord', 'Chat with the community', true, 'social-discord')
        + row('tiktok', 'TikTok', '@throneofshadowsofficial', true, 'social-tiktok'),
      buttons: [{ label: 'Close' }],
    });
    const dBtn = document.getElementById('social-discord');
    if (dBtn) dBtn.addEventListener('click', () => { openDiscord(); });
    // YouTube row hidden for now (re-add with YOUTUBE_URL when the channel is ready).
    const tBtn = document.getElementById('social-tiktok');
    if (tBtn) tBtn.addEventListener('click', () => { try { window.open(TIKTOK_URL, '_blank', 'noopener'); } catch (e) {} });
    const root = document.getElementById('modal-root');
    if (root) root.querySelectorAll('.social-row.soon').forEach((b) => {
      b.addEventListener('click', () => { this.toast(`${b.dataset.name} is coming soon!`); });
    });
  },

  // ---------------- character sheet ----------------
  // WoW-style paper-doll: gear slots flank the hero portrait, grouped stat
  // sections below, active companion tucked under the portrait.
  // Hover a slot (desktop) or long-press it (~550ms, mobile) to see that item's stats.
  openCharacter(state, username) {
    const E = Engine;
    const stats = E.computeStats(state);
    const cls = (E.CLASSES && E.CLASSES[state.playerClass]) || {};
    const heroName = username || 'You';
    const hp = Math.max(0, Math.ceil((state.hero && state.hero.hp) || 0));
    const maxHp = Math.max(1, Math.round(stats.maxHp || 1));

    const gearBySlot = {};
    for (const slot of (E.SLOTS || [])) {
      const id = state.equipped && state.equipped[slot];
      if (!id) continue;
      gearBySlot[slot] = id === E.GALAXY_EQUIP_ID
        ? E.galaxyItemFor(state, slot)
        : (state.inventory || []).find(i => i.id === id) || null;
    }

    const slotHTML = (slot) => {
      const info = (E.SLOT_INFO || {})[slot] || {};
      const item = gearBySlot[slot];
      if (!item) {
        return `<div class="paper-slot empty" data-slot="${slot}">`
          + `<div class="paper-emoji">${info.emoji || '▫️'}</div>`
          + `<div class="paper-slot-label">${esc(info.name || slot)}</div>`
          + `<div class="paper-slot-label">Empty</div></div>`;
      }
      const rar = (E.RARITY_BY_ID && E.RARITY_BY_ID[item.rarity]) || {};
      return `<div class="paper-slot r-${esc(item.rarity || 'common')}" data-slot="${slot}" tabindex="0" role="button" aria-label="${esc(item.name)}">`
        + `<div class="paper-emoji">${info.emoji || '🎒'}</div>`
        + `<div class="paper-slot-label">${esc(info.name || slot)}</div>`
        + `<div class="paper-slot-label" style="color:${esc(rar.color || '#ccc')}">${esc(item.rarity)}</div></div>`;
    };

    const tipFor = (slot) => {
      const info = (E.SLOT_INFO || {})[slot] || {};
      const item = gearBySlot[slot];
      if (!item) {
        return `<div class="tip-name" style="color:#9a8f7d">${esc(info.name || slot)}</div>`
          + `<div class="tip-sub">No item equipped.</div>`;
      }
      const rar = (E.RARITY_BY_ID && E.RARITY_BY_ID[item.rarity]) || {};
      const rows = Object.entries(item.stats || {}).map(([k, v]) =>
        `<div class="tip-stat"><span class="k">${esc((E.STAT_LABELS || {})[k] || k)}</span>`
        + `<span class="v">+${esc(formatStatVal(k, v))}</span></div>`).join('');
      return `<div class="tip-name" style="color:${esc(rar.color || '#e8e0cf')}">${esc(item.name)}${item.enchant ? ' +' + item.enchant : ''}</div>`
        + `<div class="tip-sub">${esc(info.name || slot)} · ${esc(item.rarity || '')}</div>`
        + rows
        + (item.setName ? `<div class="tip-set">Set: ${esc(item.setName)}</div>` : '');
    };

    const statCell = (k) => {
      const label = ((E.STAT_LABELS || {})[k] || k).replace(' %', '');
      return `<span><span class="k">${esc(label)}</span> <span class="v">${esc(formatStatVal(k, stats[k] || 0))}</span></span>`;
    };
    const section = (title, keys) =>
      `<div class="char-sec-title">${title}</div><div class="char-stat-grid">${keys.map(statCell).join('')}</div>`;

    const pets = (state.pets && state.pets.collection) || [];
    const active = pets.find(p => p.uid === (state.pets && state.pets.activeUid));
    let petHTML = `<div class="paper-pet"><span class="pet-emoji">🐾</span><span>No companion</span></div>`;
    if (active) {
      const sp = (E.petSpeciesOf && E.petSpeciesOf(active)) || {};
      const pr = (E.RARITY_BY_ID && E.RARITY_BY_ID[sp.rarity]) || {};
      const pc = pr.color || '#4da3ff';
      petHTML = `<div class="paper-pet"><span class="pet-emoji" style="filter:drop-shadow(0 0 8px ${esc(pc)})">${esc(sp.emoji || '🐾')}</span>`
        + `<span>${esc(sp.name || 'Pet')}<br><span style="color:${esc(pc)}">Lv ${active.level || 1}</span></span></div>`;
    }

    const leftSlots = ['helmet', 'weapon', 'trinket'];
    const rightSlots = ['armor', 'boots'];
    this.modal({
      title: 'Character',
      wide: true,
      html: `<div class="char-sheet">`
        + `<div class="paper-doll">`
        + `<div class="paper-col">${leftSlots.map(slotHTML).join('')}</div>`
        + `<div class="paper-center">`
        + `<div class="paper-portrait">${esc(cls.emoji || '🦸')}</div>`
        + `<div class="paper-name">${esc(heroName)}</div>`
        + `<div class="paper-sub">Level ${state.level || 1} ${esc(cls.name || '')}</div>`
        + `<div class="paper-hpbar"><div style="width:${Math.min(100, (hp / maxHp) * 100)}%"></div></div>`
        + `<div class="paper-hptext">❤️ ${formatNum(hp)} / ${formatNum(maxHp)}</div>`
        + petHTML
        + `</div>`
        + `<div class="paper-col">${rightSlots.map(slotHTML).join('')}</div>`
        + `</div>`
        + section('OFFENSE', ['attack', 'critChance', 'critDamage', 'attackSpeed', 'lifesteal'])
        + section('DEFENSE', ['defense', 'maxHp', 'dodge', 'parry'])
        + section('GAINS', ['xpBonus', 'goldBonus'])
        + `<div class="gear-tip hidden" id="gear-tip"></div>`
        + `</div>`,
      buttons: [{ label: 'Close' }],
    });

    // Tooltip wiring: hover on desktop, long-press on touch.
    const rootEl = document.getElementById('modal-root');
    const sheet = rootEl && rootEl.querySelector('.char-sheet');
    const tip = rootEl && rootEl.querySelector('#gear-tip');
    if (!sheet || !tip) return;
    let pressTimer = null;
    const showTip = (slotEl) => {
      tip.innerHTML = tipFor(slotEl.dataset.slot);
      tip.classList.remove('hidden');
      const sr = sheet.getBoundingClientRect();
      const r = slotEl.getBoundingClientRect();
      tip.style.transform = 'translate(0px,0px)';
      const tw = tip.offsetWidth || 200, th = tip.offsetHeight || 120;
      let x = r.right - sr.left + 8;
      let y = r.top - sr.top - 4;
      if (x + tw > sr.width - 4) x = r.left - sr.left - tw - 8;
      if (y + th > sr.height - 4) y = Math.max(4, sr.height - th - 4);
      tip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(0, y)}px)`;
    };
    const hideTip = () => tip.classList.add('hidden');
    sheet.querySelectorAll('.paper-slot').forEach(slotEl => {
      slotEl.addEventListener('mouseenter', () => showTip(slotEl));
      slotEl.addEventListener('mouseleave', hideTip);
      slotEl.addEventListener('focus', () => showTip(slotEl));
      slotEl.addEventListener('blur', hideTip);
      slotEl.addEventListener('contextmenu', e => e.preventDefault());
      slotEl.addEventListener('touchstart', () => {
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = setTimeout(() => { pressTimer = null; showTip(slotEl); }, 550);
      }, { passive: true });
      const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
      slotEl.addEventListener('touchmove', () => { cancelPress(); hideTip(); }, { passive: true });
      slotEl.addEventListener('touchend', cancelPress, { passive: true });
      slotEl.addEventListener('touchcancel', cancelPress, { passive: true });
    });
    sheet.addEventListener('click', (e) => { if (!e.target.closest('.paper-slot')) hideTip(); });
  },

  // ---------------- modals ----------------
  // buttons: [{label, cls, onClick(close)}]; returns close fn.
  modal({ title, html, buttons, dismissable = true, wide = false, onClose = null }) {
    const root = this.els['modal-root'];
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal${wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true">
        <h2 class="modal-title">${esc(title)}</h2>
        <div class="modal-body">${html}</div>
        <div class="modal-actions"></div>
      </div>`;
    const actions = overlay.querySelector('.modal-actions');
    // Every close path funnels through here so onClose always fires once.
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      overlay.remove();
      if (onClose) { try { onClose(); } catch { /* ignore */ } }
    };
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

  // Level-up popups never stack: if one is already showing, later level-ups
  // queue up and display one at a time as each modal closes.
  _levelUpOpen: false,
  _levelUpQueue: [],
  levelUpModal(levels) {
    if (!levels || !levels.length) return;
    if (this._levelUpOpen) { this._levelUpQueue.push(levels.slice()); return; }
    this._levelUpOpen = true;
    const last = levels[levels.length - 1];
    try { Audio.play('levelup'); } catch { /* ignore */ }
    this.modal({
      title: '⬆️ Level up!',
      html: `<p class="big">You reached <b>level ${last}</b>${levels.length > 1 ? ` <span class="muted">(+${levels.length - 1} more)</span>` : ''}!</p>
             <p class="muted">+3 Attack · +25 Max HP · +2 Defense per level<br>Hero healed for 25% max HP.</p>`,
      buttons: [{ label: 'Nice!', cls: 'gold' }],
      onClose: () => {
        this._levelUpOpen = false;
        const next = this._levelUpQueue.shift();
        if (next && next.length) this.levelUpModal(next);
      },
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
      <div class="race-trait">${esc(sp.flavor || Engine.rarityName(sp.rarity))}</div>
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
        <div class="race-trait">${esc(sp.flavor || Engine.rarityName(sp.rarity))}</div>
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
        `<span class="muted">Rebirths so far: ${state.rebirthCount || 0} · 🌀 Tokens: <b>${state.rebirthTokens || 0}</b> ` +
        `(spend in the 🌀 Token Shop).<br>` +
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
    const world = Engine.worldForStage(enemy.stage);
    e['enemy-sprite'].textContent = enemy.radiant ? '🌟' : enemy.emoji;
    e['enemy-name'].textContent = enemy.radiant ? `Radiant ${enemy.name}` : enemy.name;
    e['enemy-card'].classList.toggle('radiant', !!enemy.radiant);
    // Raid waves show the wave counter instead of the stage.
    e['enemy-stage'].textContent = enemy.raidWave
      ? `🌀 Raid — Wave ${enemy.raidWave}`
      : `Stage ${enemy.stage} · ${world.emoji} ${world.name}`;
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
    // Kill streak: boosts loot drop chance (+1% per 25, max +10%). Resets on death.
    const streak = Math.max(0, Math.floor(state.streak || 0));
    const streakBonus = Engine.streakDropBonus(streak);
    const streakChip = streak >= 5
      ? `<span class="buff-chip" title="Kill streak: +${streakBonus}% loot drop chance (max +10% at 250). Dies with you.">🔥 ${streak} streak +${streakBonus}% loot</span>` : '';
    this.els['hero-stats'].innerHTML = `
      <span>⚔️ ${formatNum(stats.attack)}</span>
      <span>🛡️ ${formatNum(stats.defense)}</span>
      <span>💥 ${Engine.round1(stats.critChance)}%</span>
      <span>🥾 ${Engine.round1(stats.dodge)}%</span>
      ${rested}
      ${petChip}
      ${bondChip}
      ${streakChip}
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

  floatText(text, kind = 'dmg', raw = null) {
    // Battle SFX ride on the same dispatch as the damage numbers, so every
    // hit/crit/hurt/dodge/parry/skill tick gets its sound from one place.
    // (Plays even when damage numbers are hidden — the setting is visual.)
    try {
      const snd = { dmg: 'hit', crit: 'crit', hurt: 'hurt', dodge: 'dodge', parry: 'parry', skill: 'skill' }[kind];
      if (snd) Audio.play(snd);
    } catch { /* audio must never break rendering */ }
    if (!this.settings.damageNumbers && (kind === 'dmg' || kind === 'crit')) return;
    const layer = this.els['float-layer'];
    const perf = this._perfVisual();
    // Perf mode: merge rapid plain-damage ticks into one rolling number so a
    // flurry of hits costs a single DOM node instead of dozens.
    if (perf && kind === 'dmg' && typeof raw === 'number' && isFinite(raw)) {
      const now = performance.now();
      const acc = this._dmgAcc;
      if (acc && acc.el.isConnected && now - acc.t < 220) {
        acc.total += raw; acc.t = now; acc.n++;
        acc.el.textContent = formatNum(acc.total);
        return;
      }
    }
    const el = document.createElement('div');
    el.className = 'float-txt float-' + kind;
    el.textContent = text;
    el.style.left = (20 + Math.random() * 60) + '%';
    el.style.setProperty('--tilt', (Math.random() * 16 - 8).toFixed(1) + 'deg');
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
    while (layer.children.length > (perf ? 8 : 12)) layer.firstChild.remove();
    if (perf && kind === 'dmg' && typeof raw === 'number' && isFinite(raw)) {
      this._dmgAcc = { el, t: performance.now(), total: raw, n: 1 };
    }
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

  // Marks the active Background frame-rate / detail buttons in Settings.
  _syncBgQualitySegs() {
    const fps = this._bgFpsTarget();
    const seg = document.getElementById('bg-fps-seg');
    if (seg) seg.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('active', (b.dataset.bgfps === '60') === (fps === 60)));
    const hd = document.getElementById('bg-hd-seg');
    if (hd) hd.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('active', (b.dataset.bghd === '1') === !!this.settings.bgHd));
  },

  // Background frame-rate target: 60 only when explicitly chosen, else 30.
  _bgFpsTarget() {
    return this.settings.bgFps === 60 ? 60 : 30;
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

  // ---------------- battle background ----------------
  // Which scene plays behind battle: the current realm's ambient scene,
  // the player's own picked background, or a plain dark backdrop.
  BATTLE_BG: [
    { id: 'world', icon: '🌍', name: 'Realm scene', desc: 'Battle shows your current realm\u2019s animated background.' },
    { id: 'mystyle', icon: '🖼️', name: 'My background', desc: 'Battle uses the background you picked in Settings.' },
    { id: 'off', icon: '🌑', name: 'Off', desc: 'Plain dark background, no animation.' },
  ],
  // Builds the Settings battle-background option cards.
  _renderBattleBgPicker() {
    const el = document.getElementById('battle-bg-picker');
    if (!el) return;
    el.innerHTML = this.BATTLE_BG.map((o) =>
      `<button type="button" class="opt-card" role="radio" data-bbg="${o.id}" aria-label="${o.name}: ${o.desc}">` +
      `<span class="oico">${o.icon}</span><span class="otxt"><span class="oname">${o.name}</span>` +
      `<span class="odesc">${o.desc}</span></span></button>`
    ).join('');
    el.querySelectorAll('.opt-card').forEach((b) => {
      b.addEventListener('click', () => { if (this.handlers.onBattleBg) this.handlers.onBattleBg(b.dataset.bbg); });
    });
  },
  // Marks the active battle-background card.
  syncBattleBg(cur) {
    const el = document.getElementById('battle-bg-picker');
    if (!el) return;
    el.querySelectorAll('.opt-card').forEach((b) => {
      const on = b.dataset.bbg === cur;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  },

  // ---------------- player name styles ----------------
  // Cosmetic name colors + animated text effects. Stored top-level on
  // state as nameColor (hex) / nameFx (id). The server also serves other
  // players' styles on leaderboard entries, party/guild rosters, guild
  // chat, friends, and inspect payloads, so their names render styled
  // everywhere — pass the entry object straight into nameHtml.
  NAME_COLOR_DEFAULT: '#ffd76a',
  NAME_COLORS: [
    { id: '#ffd76a', name: 'Gold' },
    { id: '#ffffff', name: 'White' },
    { id: '#ff5b5b', name: 'Red' },
    { id: '#ff9f43', name: 'Orange' },
    { id: '#5bff8f', name: 'Green' },
    { id: '#5bd7ff', name: 'Cyan' },
    { id: '#b78bff', name: 'Violet' },
    { id: '#ff8bd1', name: 'Pink' },
  ],
  NAME_FX: [
    { id: 'none', name: 'None' },
    { id: 'fire', name: '🔥 Fire' },
    { id: 'neon', name: '💡 Neon' },
    { id: 'rainbow', name: '🌈 Rainbow' },
    { id: 'shine', name: '✨ Shine' },
    { id: 'galaxy', name: '🌌 Galaxy' },
    { id: 'ice', name: '🧊 Ice' },
    { id: 'lightning', name: '⚡ Lightning' },
    { id: 'shadow', name: '🌑 Shadow' },
    { id: 'glitch', name: '👾 Glitch' },
    { id: 'falling-leaves', name: '🍂 Falling Leaves' },
    { id: 'harvest-ember', name: '🌾 Harvest Ember' },
    { id: 'autumn-mist', name: '🌫️ Autumn Mist' },
    { id: 'snowfall', name: '❄️ Snowfall' },
    { id: 'aurora', name: '🌠 Aurora' },
    { id: 'frostbite', name: '🧊 Frostbite' },
    { id: 'tidal', name: '🌊 Tidal' },
    { id: 'sunscorched', name: '☀️ Sunscorched' },
    { id: 'wildfire', name: '🔥 Wildfire' },
    { id: 'fireworks', name: '🎆 Fireworks' },
    { id: 'champagne', name: '🍾 Champagne' },
    { id: 'midnight', name: '🌃 Midnight' },
  ],
  // Rarest titles: these cycle rainbow in the Titles tab / profile.
  RAINBOW_TITLES: ['ever-reborn', 'true-capped', 'worldforger'],

  // Staff titles get their own animated tier style (title-staff-gm/admin/owner)
  // instead of the generic gold glow. The three flagship titles get unique
  // per-title animations. Returns '' for non-staff titles.
  staffTitleCls(id) {
    if (id === 'gm-gamemaster') return 'title-gm-gamemaster';
    if (id === 'gm-stormjudge') return 'title-gm-stormjudge';
    if (id === 'owner-shadowking') return 'title-owner-shadowking';
    const t = (Engine.STAFF_TITLES || []).find(x => x.id === id);
    if (!t) return '';
    return t.staffRole === 'owner' ? 'title-staff-owner'
         : t.staffRole === 'admin' ? 'title-staff-admin' : 'title-staff-gm';
  },

  // Returns the local player's display name, HTML-escaped and wrapped
  // in a styled span when a custom color/effect is set. `state` is the
  // LOCAL player's state; pass null/{} for the default plain name.
  nameHtml(name, state) {
    const safe = esc(name);
    const color = /^#[0-9a-fA-F]{6}$/.test(state && state.nameColor) ? state.nameColor : this.NAME_COLOR_DEFAULT;
    const fxIds = this._allFxIds || (this._allFxIds = [...this.NAME_FX.map(f => f.id), ...Engine.TOKEN_NAME_FX.map(f => f.id), ...(Engine.STAFF_NAME_FX || []).map(f => f.id)]);
    const fx = fxIds.includes(state && state.nameFx) && state.nameFx !== 'none' ? state.nameFx : 'none';
    if (fx === 'none' && color.toLowerCase() === this.NAME_COLOR_DEFAULT) return safe;
    return `<span class="pname${fx === 'none' ? '' : ' fx-' + fx}" style="--namec:${color}">${safe}</span>`;
  },

  // Builds the Settings name-color swatches + custom color input + effect buttons.
  _renderNameStylePickers(state) {
    this._fxPickerState = state || null;
    const cel = document.getElementById('name-color-picker');
    if (cel) {
      cel.innerHTML = this.NAME_COLORS.map((c) =>
        `<button type="button" class="swatch" data-color="${c.id}" title="${c.name}" aria-label="${c.name} name color">` +
        `<span class="dot" style="background:${c.id}"></span><span class="lbl">${c.name}</span></button>`
      ).join('');
      cel.querySelectorAll('.swatch').forEach((b) => {
        b.addEventListener('click', () => { if (this.handlers.onNameColor) this.handlers.onNameColor(b.dataset.color); });
      });
    }
    const custom = document.getElementById('name-color-custom');
    if (custom) {
      custom.addEventListener('input', () => { if (this.handlers.onNameColor) this.handlers.onNameColor(custom.value); });
    }
    const fel = document.getElementById('name-fx-picker');
    if (fel) {
      const st = this._fxPickerState || null;
      const unlocked = st ? Engine.ensureFxUnlocked(st) : Engine.BASE_NAME_FX_IDS;
      const all = [
        ...this.NAME_FX,
        ...Engine.TOKEN_NAME_FX.map(f => ({ ...f, token: true })),
        ...(Engine.STAFF_NAME_FX || []).map(f => ({ ...f, staff: true })),
      ];
      fel.innerHTML = all.map((f) => {
        const locked = (f.token || f.staff) && !unlocked.includes(f.id);
        const lockNote = f.staff ? 'Staff only' : 'Token Shop exclusive';
        return `<button type="button" class="btn fx-btn${locked ? ' fx-locked' : ''}" data-fx="${f.id}"${locked ? ` title="${lockNote}"` : ''}>${locked ? '🔒 ' : ''}${f.name}</button>`;
      }).join('');
      fel.querySelectorAll('.fx-btn').forEach((b) => {
        b.addEventListener('click', () => { if (this.handlers.onNameFx) this.handlers.onNameFx(b.dataset.fx); });
      });
    }
  },

  // Marks the active name color swatch / effect button after a change or on load.
  syncNameStyle(color, fx) {
    const cel = document.getElementById('name-color-picker');
    if (cel) cel.querySelectorAll('.swatch').forEach((b) =>
      b.classList.toggle('active', (b.dataset.color || '').toLowerCase() === String(color || '').toLowerCase()));
    const custom = document.getElementById('name-color-custom');
    if (custom && /^#[0-9a-fA-F]{6}$/.test(color || '')) custom.value = color;
    const fel = document.getElementById('name-fx-picker');
    if (fel) fel.querySelectorAll('.fx-btn').forEach((b) => b.classList.toggle('active', b.dataset.fx === fx));
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
      // Backing-store resolution cap comes from Settings detail (SD/HD):
      // SD caps at 1.5x — at 2x a 4K screen pushes 4x the pixels per frame
      // for soft glow sprites nobody can tell apart. HD raises the cap to
      // 2x for visibly sharper scenes on retina/4K displays (costs fill rate).
      const cap = this.settings.bgHd ? 2 : 1.5;
      const dpr = Math.min(cap, window.devicePixelRatio || 1);
      cv.width = Math.max(2, Math.floor(innerWidth * dpr));
      cv.height = Math.max(2, Math.floor(innerHeight * dpr));
      this._bg.dpr = dpr;
      this._bg.grad = null;
      if (this._bg.scene) this._buildBgScene(this._bg.scene, this._bg.opts);
    };
    this._bg.fit = fit; // re-run when the SD/HD setting changes
    addEventListener('resize', fit);
    fit();
    document.addEventListener('visibilitychange', () => {
      if (!this._bg || !this._bg.scene || this._bgReduced()) return;
      if (document.hidden) this._stopBgLoop();
      else this._startBgLoop();
    });
  },
  _bgReduced() {
    return !!this.settings.reduceMotion || !!this.settings.performanceMode ||
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
    B.seasonCfg = null;
    B.photoImg = null;
    const _st = (this.BG_STYLES || []).find((s) => s.id === id);
    if (_st && _st.photo) { const _im = new Image(); _im.src = _st.photo; B.photoImg = _im; }
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
    } else if (id === 'void-tide') {
      // The Void Abyss: slow violet rift-wisps drifting sideways + faint stars.
      B.sprites.rift = ['#7c3aed', '#4c1d95', '#a855f7'].map((c) => this._glowSprite(c));
      B.stars = [];
      for (let i = 0; i < 14; i++) {
        B.parts.push({
          x: R(0, W), y: R(0.05, 0.95) * H, r: R(50, 130) * dpr,
          vx: R(-7, 7) * dpr, si: (Math.random() * 3) | 0,
          ph: R(0, 6.28), ps: R(0.25, 0.6), a: R(0.10, 0.22),
        });
      }
      for (let i = 0; i < 46; i++) {
        B.stars.push({ x: R(0, W), y: R(0, H), r: R(0.6, 1.8) * dpr, ph: R(0, 6.28), ps: R(0.5, 1.4) });
      }
      B.grad = this._vGrad(['#08040f', '#150b2a', '#08040f']);
    } else if (id === 'throne-storm') {
      // Throne of Shadows: drifting shadow shards, rising violet embers,
      // and an occasional lightning flicker across the dark.
      B.sprites.shard = ['#dc2626', '#7c3aed', '#991b1b'].map((c) => this._glowSprite(c));
      for (let i = 0; i < 24; i++) {
        B.parts.push({
          kind: 'shard',
          x: R(0, W), y: R(0, H), r: R(18, 60) * dpr,
          vx: R(-12, 12) * dpr, vy: R(-10, 4) * dpr,
          si: (Math.random() * 3) | 0, rot: R(0, 6.28), vr: R(-0.4, 0.4),
          ph: R(0, 6.28), ps: R(0.4, 1.0), a: R(0.08, 0.18),
        });
      }
      for (let i = 0; i < 26; i++) {
        const e = this._newEmber(W, H, true);
        e.kind = 'ember'; e.a = Math.min(1, e.a * 0.8);
        B.parts.push(e);
      }
      B.flashAt = 0; B.flashUntil = 0; B.bolt = null;
      B.grad = this._vGrad(['#0c0408', '#220a12', '#0c0408']);
    } else if (id === 'inferno-flare') {
      // Swirling fire vortex: embers orbit a hot core, faster near the middle.
      B.sprites.flare = ['#ff6b35', '#f7c548', '#ef4444', '#ff9f1c'].map((c) => this._glowSprite(c));
      const cx = W / 2, cy = H / 2, maxR = Math.min(W, H) * 0.48;
      B.cx = cx; B.cy = cy;
      for (let i = 0; i < 52; i++) {
        const rr = R(0.12, 1) * maxR;
        B.parts.push({
          ang: R(0, 6.28), r: rr,
          // inner particles whirl faster (vortex feel)
          va: R(0.5, 1.4) * (maxR / Math.max(rr, maxR * 0.12)) * 0.55,
          s: R(3, 7) * dpr, si: (Math.random() * 4) | 0,
          a: R(0.45, 0.95), ph: R(0, 6.28),
        });
      }
      B.grad = this._vGrad(['#160704', '#33110a', '#160704']);
    } else if (id === 'cinder-storm') {
      // Wind-blown burning cinders streaking sideways with gusty jitter.
      B.sprites.cinder = ['#ff8c42', '#ffd23f', '#ff3b3b'].map((c) => this._glowSprite(c));
      for (let i = 0; i < 60; i++) {
        B.parts.push({
          x: R(0, W), y: R(0, H),
          s: R(2, 5) * dpr, vx: R(60, 170) * dpr,
          sway: R(14, 42) * dpr, ph: R(0, 6.28), fs: R(1.5, 3.5),
          si: (Math.random() * 3) | 0, a: R(0.4, 0.9),
        });
      }
      B.grad = this._vGrad(['#120603', '#2b0e05', '#120603']);
    } else if (id === 'phoenix-ash') {
      // Golden embers rise slowly; every few seconds one erupts in a soft
      // glow burst that expands and fades.
      B.sprites.ash = ['#ffd63f', '#f59e0b', '#fff7cc'].map((c) => this._glowSprite(c));
      for (let i = 0; i < 38; i++) {
        const e = this._newEmber(W, H, true);
        e.s = Math.min(e.s, 4 * dpr);
        e.vy = e.vy * 0.55;
        e.si = (Math.random() * 3) | 0;
        B.parts.push(e);
      }
      B.bursts = [];
      for (let i = 0; i < 7; i++) {
        B.bursts.push({
          x: R(0.1, 0.9) * W, y: R(0.15, 0.85) * H,
          r0: R(6, 14) * dpr, r1: R(46, 90) * dpr,
          si: (Math.random() * 3) | 0,
          t0: R(0, 5200), period: R(2600, 6200),
        });
      }
      B.grad = this._vGrad(['#100b04', '#2b2008', '#100b04']);
    } else if (id === 'frostfall') {
      // Frostfall: soft snow drifting down on a cold breeze, with a few
      // glinting ice shards suspended in the air.
      B.sprites.snow = ['#e0f2fe', '#bae6fd', '#7dd3fc'].map((c) => this._glowSprite(c));
      for (let i = 0; i < 70; i++) {
        B.parts.push({
          kind: 'flake',
          x: R(0, W), y: R(0, H), r: R(1.5, 4.5) * dpr,
          vy: R(14, 46) * dpr, sway: R(10, 30) * dpr, ph: R(0, 6.28), fs: R(0.6, 1.6),
          si: (Math.random() * 3) | 0, a: R(0.35, 0.8),
        });
      }
      for (let i = 0; i < 8; i++) {
        B.parts.push({
          kind: 'shard',
          x: R(0.05, 0.95) * W, y: R(0.05, 0.95) * H, r: R(10, 26) * dpr,
          rot: R(0, 6.28), vr: R(-0.25, 0.25), ph: R(0, 6.28), ps: R(0.5, 1.2),
          si: (Math.random() * 3) | 0, a: R(0.25, 0.5),
        });
      }
      B.grad = this._vGrad(['#0a1420', '#16283e', '#0a1420']);
    } else if (id === 'starfall') {
      // Starfall: a deep twinkling starfield; every few seconds meteors
      // streak diagonally with glowing trails.
      B.sprites.meteor = ['#e9e4ff', '#c4b5fd', '#93c5fd'].map((c) => this._glowSprite(c));
      B.stars = [];
      for (let i = 0; i < 90; i++) {
        B.stars.push({ x: R(0, W), y: R(0, H), r: R(0.6, 2) * dpr, ph: R(0, 6.28), ps: R(0.4, 1.2) });
      }
      B.meteors = [];
      for (let i = 0; i < 3; i++) {
        B.meteors.push({
          t0: R(0, 6000), period: R(3500, 8000), dur: R(700, 1100),
          x0: R(0.3, 1) * W, y0: R(0, 0.4) * H, len: R(120, 260) * dpr,
          si: (Math.random() * 3) | 0,
        });
      }
      B.grad = this._vGrad(['#080514', '#141033', '#080514']);
    } else if (id === 'bloodmoon') {
      // Blood Moon: a huge red moon hangs over drifting fog banks and slow
      // red ash motes rising through the gloom.
      B.sprites.moon = this._glowSprite('#ef4444');
      B.sprites.fog = ['#7f1d1d', '#991b1b', '#450a0a'].map((c) => this._glowSprite(c));
      B.moonR = Math.min(W, H) * 0.16;
      B.moonX = W * 0.72; B.moonY = H * 0.24;
      for (let i = 0; i < 10; i++) {
        B.parts.push({
          kind: 'fog',
          x: R(0, W), y: R(0.35, 1) * H, r: R(90, 200) * dpr,
          vx: R(-10, 10) * dpr, si: (Math.random() * 3) | 0,
          ph: R(0, 6.28), ps: R(0.2, 0.5), a: R(0.10, 0.20),
        });
      }
      for (let i = 0; i < 30; i++) {
        const e = this._newEmber(W, H, true);
        e.kind = 'ash'; e.si = 0; e.vy = e.vy * 0.4; e.a = Math.min(1, e.a * 0.6);
        B.parts.push(e);
      }
      B.grad = this._vGrad(['#12060a', '#2b0d14', '#12060a']);
    } else if (id === 'nightsky') {
      // Night Sky: crescent moon, twinkling stars, slow-drifting night clouds.
      B.sprites.moon = this._glowSprite('#e8edff');
      B.sprites.cloud = ['#1a2340', '#232f55', '#141b33'].map((c) => this._glowSprite(c));
      B.nightMoon = { x: W * 0.76, y: H * 0.22, r: Math.min(W, H) * 0.055 };
      B.stars = [];
      for (let i = 0; i < 100; i++) {
        B.stars.push({ x: R(0, W), y: R(0, H), r: R(0.6, 2) * dpr, ph: R(0, 6.28), ps: R(0.4, 1.2) });
      }
      for (let i = 0; i < 8; i++) {
        B.parts.push({
          x: R(0, W), y: R(0.05, 0.6) * H, r: R(70, 150) * dpr,
          vx: R(-8, 8) * dpr, si: (Math.random() * 3) | 0,
          ph: R(0, 6.28), ps: R(0.2, 0.5), a: R(0.12, 0.24),
        });
      }
      B.grad = this._vGrad(['#04060f', '#0c1430', '#04060f']);
    } else if (id === 'sunset') {
      // Sunset: a low glowing sun on a warm horizon, tinted drifting
      // clouds, and distant birds crossing the sky.
      B.sprites.sun = this._glowSprite('#ffb347');
      B.sprites.scloud = ['#ff9f5e', '#e05a4e', '#c65a1e'].map((c) => this._glowSprite(c));
      B.sun = { x: W * 0.5, y: H * 0.60, r: Math.min(W, H) * 0.062 };
      for (let i = 0; i < 10; i++) {
        B.parts.push({
          kind: 'cloud',
          x: R(0, W), y: R(0.1, 0.7) * H, r: R(70, 160) * dpr,
          vx: R(6, 18) * dpr, si: (Math.random() * 3) | 0,
          ph: R(0, 6.28), ps: R(0.2, 0.5), a: R(0.14, 0.26),
        });
      }
      for (let i = 0; i < 6; i++) {
        B.parts.push({
          kind: 'bird',
          x: R(0, W), y: R(0.12, 0.42) * H, s: R(7, 12) * dpr,
          vx: R(-26, -12) * dpr, ph: R(0, 6.28), fs: R(4, 7),
        });
      }
      B.grad = this._vGrad(['#1a0b26', '#5e1f2e', '#c65a1e']);
    } else if (id === 'woods') {
      // Woods: layered pine silhouettes, wandering fireflies, low mist.
      B.sprites.fly = ['#d9f99d', '#bef264', '#fde68a'].map((c) => this._glowSprite(c));
      B.sprites.mist = ['#3f4a42', '#2c352c'].map((c) => this._glowSprite(c));
      const layerCols = ['#0a1410', '#0d1a12', '#122417'];
      B.trees = [];
      for (let l = 0; l < 3; l++) {
        const n = 9 - l * 2, baseH = H * (0.34 - l * 0.05);
        for (let i = 0; i < n; i++) {
          B.trees.push({
            x: (i + R(0.1, 0.9)) / n * W, w: R(50, 90) * dpr * (1 - l * 0.15),
            h: baseH * R(0.75, 1.15), col: layerCols[l], layer: l,
          });
        }
      }
      for (let i = 0; i < 26; i++) {
        B.parts.push({
          kind: 'fly',
          x: R(0, W), y: R(0.45, 0.95) * H, s: R(2, 4) * dpr,
          si: (Math.random() * 3) | 0, ph: R(0, 6.28), ps: R(0.8, 1.8),
          wx: R(10, 30) * dpr, wy: R(8, 22) * dpr, fs: R(0.5, 1.1), a: R(0.5, 0.9),
        });
      }
      for (let i = 0; i < 6; i++) {
        B.parts.push({
          kind: 'mist',
          x: R(0, W), y: R(0.68, 0.98) * H, r: R(90, 180) * dpr,
          vx: R(-10, 10) * dpr, si: (Math.random() * 2) | 0,
          ph: R(0, 6.28), ps: R(0.2, 0.5), a: R(0.10, 0.20),
        });
      }
      B.grad = this._vGrad(['#060a08', '#0d1a12', '#060a08']);
    } else if (id === 'water') {
      // Water: a moonlit lake — shimmering reflection glints, slow wave
      // lines, and mist on the surface.
      B.sprites.wmoon = this._glowSprite('#cfe4ff');
      B.sprites.wmist = ['#2a3a4d', '#1c2836'].map((c) => this._glowSprite(c));
      B.waterMoon = { x: W * 0.5, y: H * 0.18, r: Math.min(W, H) * 0.048 };
      for (let i = 0; i < 44; i++) {
        B.parts.push({
          kind: 'glint',
          x: W * 0.5 + R(-0.22, 0.22) * W, y: R(0.36, 0.96) * H,
          w: R(24, 80) * dpr, ph: R(0, 6.28), ps: R(0.6, 1.6), a: R(0.15, 0.45),
        });
      }
      for (let i = 0; i < 7; i++) {
        B.parts.push({
          kind: 'wave',
          y: R(0.34, 0.96) * H, vx: R(-9, 9) * dpr,
          ph: R(0, 6.28), ps: R(0.4, 0.9), a: R(0.10, 0.22),
        });
      }
      for (let i = 0; i < 5; i++) {
        B.parts.push({
          kind: 'wmist',
          x: R(0, W), y: R(0.6, 0.95) * H, r: R(90, 170) * dpr,
          vx: R(-8, 8) * dpr, si: (Math.random() * 2) | 0,
          ph: R(0, 6.28), ps: R(0.2, 0.45), a: R(0.10, 0.18),
        });
      }
      B.grad = this._vGrad(['#050a12', '#0d2233', '#050a12']);
    } else if (id === 'autumn-dusk' || id === 'winter-night' || id === 'hallows-eve' ||
               id === 'new-year' || id === 'summer-tide' || id === 'spring-bloom' ||
               id === 'class-hunter' || id === 'class-warrior' || id === 'class-mage' ||
               id === 'class-assassin' || id === 'class-necromancer' || id === 'class-berserker') {
      // Seasonal + class scenes: themed drifting motes over a dark seasonal gradient.
      // dir: 'down' falls (leaves/snow/petals), 'up' rises (embers/sparkles),
      // 'drift' floats sideways (pollen/bubbles).
      const cfg = {
        'autumn-dusk': { colors: ['#ea8228', '#b43c14', '#f7c548'], grad: ['#140b06', '#2a1408', '#140b06'], dir: 'down', n: 46, spd: [26, 60], sway: [26, 60], size: [2.5, 5.5] },
        'winter-night': { colors: ['#e0f2fe', '#7dd3fc', '#ffffff'], grad: ['#060c14', '#0e2233', '#060c14'], dir: 'down', n: 70, spd: [18, 42], sway: [14, 34], size: [1.6, 3.6] },
        'hallows-eve': { colors: ['#a855f7', '#f97316', '#7c3aed'], grad: ['#12060f', '#241031', '#12060f'], dir: 'up', n: 50, spd: [14, 34], sway: [8, 26], size: [2, 5] },
        'new-year': { colors: ['#ffd63f', '#fff7cc', '#f59e0b'], grad: ['#0d0a04', '#241a08', '#0d0a04'], dir: 'up', n: 55, spd: [30, 70], sway: [6, 18], size: [1.8, 4.2] },
        'summer-tide': { colors: ['#2dd4bf', '#38bdf8', '#a5f3fc'], grad: ['#061014', '#0c2a30', '#061014'], dir: 'drift', n: 40, spd: [8, 20], sway: [10, 26], size: [2, 4.5] },
        'spring-bloom': { colors: ['#4ade80', '#f472b6', '#fbcfe8'], grad: ['#0a120c', '#142a1a', '#0a120c'], dir: 'down', n: 48, spd: [20, 46], sway: [30, 70], size: [2.2, 5] },
        'class-hunter': { colors: ['#a3e635', '#4ade80', '#fde68a'], grad: ['#0a120c', '#1a2a12', '#0a120c'], dir: 'drift', n: 42, spd: [10, 24], sway: [24, 60], size: [2, 4.5] },
        'class-warrior': { colors: ['#f97316', '#ef4444', '#fbbf24'], grad: ['#140806', '#2a1408', '#140806'], dir: 'up', n: 52, spd: [22, 55], sway: [10, 30], size: [2, 5] },
        'class-mage': { colors: ['#a855f7', '#c084fc', '#22d3ee'], grad: ['#0e0a1a', '#1e1440', '#0e0a1a'], dir: 'up', n: 50, spd: [12, 32], sway: [14, 40], size: [1.8, 4.2] },
        'class-assassin': { colors: ['#60a5fa', '#38bdf8', '#a5b4fc'], grad: ['#060a14', '#0e1a33', '#060a14'], dir: 'drift', n: 38, spd: [8, 18], sway: [12, 30], size: [1.8, 4] },
        'class-necromancer': { colors: ['#4ade80', '#22c55e', '#a7f3d0'], grad: ['#08120c', '#0f2a18', '#08120c'], dir: 'up', n: 48, spd: [10, 28], sway: [16, 44], size: [2, 4.6] },
        'class-berserker': { colors: ['#ef4444', '#f97316', '#fecaca'], grad: ['#140606', '#2a0f08', '#140606'], dir: 'up', n: 60, spd: [30, 70], sway: [8, 24], size: [2.2, 5.2] },
      }[id];
      B.sprites.season = cfg.colors.map((c) => this._glowSprite(c));
      B.seasonCfg = cfg;
      for (let i = 0; i < cfg.n; i++) B.parts.push(this._newSeasonal(W, H, true, cfg));
      B.grad = this._vGrad(cfg.grad);
    }
  },
  _newSeasonal(W, H, anywhere, cfg) {
    const R = (a, b) => a + Math.random() * (b - a);
    const dpr = (this._bg && this._bg.dpr) || 1;
    return {
      x: R(0, W),
      y: anywhere ? R(0, H) : (cfg.dir === 'down' ? -R(0, 40) : H + R(0, 40)),
      s: R(cfg.size[0], cfg.size[1]) * dpr,
      vy: R(cfg.spd[0], cfg.spd[1]) * dpr,
      vx: cfg.dir === 'drift' ? R(cfg.spd[0], cfg.spd[1]) * dpr * (Math.random() < 0.5 ? -1 : 1) : 0,
      sway: R(cfg.sway[0], cfg.sway[1]) * dpr,
      ph: R(0, 6.28), fs: R(0.6, 1.6),
      si: (Math.random() * cfg.colors.length) | 0,
      a: R(0.45, 0.95),
    };
  },
  // Photorealistic scenes: slow Ken Burns drift over the generated art,
  // with a soft vignette so game UI stays readable. Static when isStatic.
  _drawBgPhoto(t, isStatic) {
    const B = this._bg, ctx = B.ctx, cv = B.cv, W = cv.width, H = cv.height;
    const img = B.photoImg, iw = img.naturalWidth, ih = img.naturalHeight;
    const secs = t / 1000;
    let zoom = 1.10, px = 0.5, py = 0.5;
    if (!isStatic) {
      zoom = 1.10 + 0.045 * Math.sin(secs * 0.11);
      px = 0.5 + 0.055 * Math.sin(secs * 0.09 + 1.3);
      py = 0.5 + 0.055 * Math.cos(secs * 0.07 + 0.5);
    }
    const s = Math.max(W / iw, H / ih) * zoom;
    const dw = iw * s, dh = ih * s;
    ctx.drawImage(img, px * (W - dw), py * (H - dh), dw, dh);
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  },
  _drawBgFrame(t, isStatic) {
    const B = this._bg;
    if (!B || !B.scene) return;
    const { ctx, cv } = B, W = cv.width, H = cv.height, dpr = B.dpr || 1;
    if (B.grad) ctx.drawImage(B.grad, 0, 0, W, H);
    else { ctx.fillStyle = B.scene === 'shadow-eyes' ? '#050308' : '#0a0812'; ctx.fillRect(0, 0, W, H); }
    if (B.photoImg && B.photoImg.complete && B.photoImg.naturalWidth) {
      this._drawBgPhoto(t, isStatic);
    } else if (B.scene === 'shadow-eyes') {
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
    } else if (B.scene === 'void-tide') {
      // Faint twinkling stars behind slow-drifting violet rifts.
      for (const s of (B.stars || [])) {
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(t / 1000 * s.ps + s.ph));
        ctx.globalAlpha = 0.5 * tw;
        ctx.fillStyle = '#e9e4ff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.2832);
        ctx.fill();
      }
      for (const p of B.parts) {
        if (!isStatic) {
          p.x += p.vx * B.dt;
          const m = p.r * 2;
          if (p.x < -m) p.x = W + m; else if (p.x > W + m) p.x = -m;
        }
        const breathe = 0.7 + 0.3 * Math.sin(t / 1000 * p.ps + p.ph);
        const d = p.r * 2 * breathe;
        ctx.globalAlpha = p.a * breathe;
        ctx.drawImage(B.sprites.rift[p.si], p.x - d / 2, p.y - d / 2, d, d);
      }
    } else if (B.scene === 'throne-storm') {
      // Lightning: every 7–14s a bolt cracks and the gloom flashes.
      if (!isStatic) {
        if (!B.flashAt || t >= B.flashAt) {
          B.flashUntil = t + 260;
          B.flashAt = t + 7000 + Math.random() * 7000;
          const bx = Math.random() * W;
          const segs = [];
          let y = -20, x = bx;
          while (y < H * 0.75) { y += 40 + Math.random() * 60; x += (Math.random() - 0.5) * 90; segs.push([x, y]); }
          B.bolt = { x0: bx, segs };
        }
      }
      if (B.bolt && t < B.flashUntil) {
        const k = 1 - (t - (B.flashUntil - 260)) / 260; // 1 → 0 decay
        ctx.globalAlpha = 0.10 * k;
        ctx.fillStyle = '#c4b5fd';
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.75 * k;
        ctx.strokeStyle = '#e9d5ff';
        ctx.lineWidth = 2.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(B.bolt.x0, -20);
        for (const [sx, sy] of B.bolt.segs) ctx.lineTo(sx, sy);
        ctx.stroke();
      }
      for (const p of B.parts) {
        if (p.kind === 'ember') {
          if (!isStatic) {
            p.y -= p.vy * B.dt;
            p.x += Math.sin(t / 1000 * p.fs + p.ph) * p.sway * B.dt;
            if (p.y < -12) Object.assign(p, this._newEmber(W, H, false), { kind: 'ember' });
          }
          const fade = Math.min(1, Math.max(0, (H - p.y) / (H * 0.3))) * Math.min(1, Math.max(0, (p.y + 12) / 60));
          if (fade <= 0.02) continue;
          const d = p.s * 5;
          ctx.globalAlpha = p.a * fade;
          ctx.drawImage(B.sprites.shard[p.si], p.x - d / 2, p.y - d / 2, d, d);
        } else {
          if (!isStatic) {
            p.x += p.vx * B.dt; p.y += p.vy * B.dt; p.rot += p.vr * B.dt;
            const m = p.r * 2;
            if (p.x < -m) p.x = W + m; else if (p.x > W + m) p.x = -m;
            if (p.y < -m) p.y = H + m; else if (p.y > H + m) p.y = -m;
          }
          const breathe = 0.75 + 0.25 * Math.sin(t / 1000 * p.ps + p.ph);
          const d = p.r * 2 * breathe;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = p.a * breathe;
          ctx.drawImage(B.sprites.shard[p.si], -d / 2, -d / 2, d, d);
          ctx.restore();
        }
      }
    } else if (B.scene === 'inferno-flare') {
      // Swirling fire vortex: embers orbit a hot core, inner ones faster.
      const cx = B.cx || W / 2, cy = B.cy || H / 2;
      for (const p of B.parts) {
        if (!isStatic) {
          p.ang += p.va * B.dt;
          if (p.ang > 6.2832) p.ang -= 6.2832;
        }
        const px = cx + Math.cos(p.ang) * p.r;
        const py = cy + Math.sin(p.ang) * p.r * 0.82;
        const flick = 0.8 + 0.2 * Math.sin(t / 130 + p.ph);
        const d = p.s * 5.5 * flick;
        ctx.globalAlpha = p.a * flick;
        ctx.drawImage(B.sprites.flare[p.si], px - d / 2, py - d / 2, d, d);
      }
      // Hot core glow pulsing at the center.
      const pulse = isStatic ? 0.5 : 0.5 + 0.18 * Math.sin(t / 900);
      const cd = Math.min(W, H) * 0.34 * (1 + pulse * 0.2);
      ctx.globalAlpha = 0.35 + pulse * 0.25;
      ctx.drawImage(B.sprites.flare[1], cx - cd / 2, cy - cd / 2, cd, cd);
    } else if (B.scene === 'cinder-storm') {
      // Wind-blown burning cinders streaking sideways with gusty jitter.
      for (const p of B.parts) {
        if (!isStatic) {
          const gust = 1 + 0.55 * Math.sin(t / 1700 + p.ph);
          p.x += p.vx * gust * B.dt;
          p.y += Math.cos(t / 900 * p.fs + p.ph) * p.sway * B.dt;
          const m = p.s * 3;
          if (p.x > W + m) { p.x = -m; p.y = Math.random() * H; }
          else if (p.y < -m) p.y = H + m;
          else if (p.y > H + m) p.y = -m;
        }
        const streak = isStatic ? 1 : 1 + 0.4 * Math.sin(t / 1700 + p.ph);
        const d = p.s * 4.5;
        ctx.globalAlpha = p.a;
        ctx.drawImage(B.sprites.cinder[p.si], p.x - d * streak / 2, p.y - d / 2, d * streak, d);
      }
    } else if (B.scene === 'phoenix-ash') {
      // Golden embers rise; every few seconds one erupts in a soft glow burst.
      for (const p of B.parts) {
        if (!isStatic) {
          p.y -= p.vy * B.dt;
          p.x += Math.sin(t / 1000 * p.fs + p.ph) * p.sway * B.dt;
          if (p.y < -12) Object.assign(p, this._newEmber(W, H, false), { si: (Math.random() * 3) | 0 });
        }
        const fade = Math.min(1, Math.max(0, (H - p.y) / (H * 0.3))) * Math.min(1, Math.max(0, (p.y + 12) / 60));
        if (fade <= 0.02) continue;
        const d = p.s * 5;
        ctx.globalAlpha = p.a * fade;
        ctx.drawImage(B.sprites.ash[p.si], p.x - d / 2, p.y - d / 2, d, d);
      }
      for (const b of B.bursts) {
        let phase = ((t - b.t0) % b.period) / 1200; // 1.2s burst, rest quiet
        if (phase < 0) phase += b.period / 1200;
        if (phase >= 1) continue;
        const rr = b.r0 + (b.r1 - b.r0) * phase;
        ctx.globalAlpha = 0.5 * (1 - phase);
        ctx.drawImage(B.sprites.ash[b.si], b.x - rr / 2, b.y - rr / 2, rr, rr);
      }
    } else if (B.scene === 'frostfall') {
      // Soft snow drifting down on a breeze; ice shards glint as they turn.
      for (const p of B.parts) {
        if (p.kind === 'flake') {
          if (!isStatic) {
            p.y += p.vy * B.dt;
            p.x += Math.sin(t / 1000 * p.fs + p.ph) * p.sway * B.dt;
            if (p.y > H + 8) { p.y = -8; p.x = Math.random() * W; }
          }
          ctx.globalAlpha = p.a;
          const fd = p.r * 5;
          ctx.drawImage(B.sprites.snow[p.si], p.x - fd / 2, p.y - fd / 2, fd, fd);
        } else {
          if (!isStatic) p.rot += p.vr * B.dt;
          const tw = 0.6 + 0.4 * Math.sin(t / 1000 * p.ps + p.ph);
          const sd = p.r * 2 * tw;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = p.a * tw;
          ctx.drawImage(B.sprites.snow[p.si], -sd / 2, -sd / 2, sd, sd);
          ctx.restore();
        }
      }
    } else if (B.scene === 'starfall') {
      // Twinkling starfield with periodic diagonal meteors.
      for (const s of (B.stars || [])) {
        const tw = 0.3 + 0.7 * Math.abs(Math.sin(t / 1000 * s.ps + s.ph));
        ctx.globalAlpha = 0.6 * tw;
        ctx.fillStyle = '#e9e4ff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.2832);
        ctx.fill();
      }
      for (const m of (B.meteors || [])) {
        let phase = ((t - m.t0) % m.period) / m.dur;
        if (phase < 0) phase += m.period / m.dur;
        if (phase >= 1) continue;
        const mx = m.x0 - phase * m.len * 2.2;
        const my = m.y0 + phase * m.len * 1.1;
        const tx = mx + m.len, ty = my - m.len * 0.5;
        const trail = ctx.createLinearGradient(mx, my, tx, ty);
        trail.addColorStop(0, 'rgba(233,228,255,0.9)');
        trail.addColorStop(1, 'rgba(233,228,255,0)');
        ctx.globalAlpha = 0.8 * (1 - phase);
        ctx.strokeStyle = trail;
        ctx.lineWidth = 2.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.globalAlpha = 0.9 * (1 - phase);
        const hd = 26 * dpr;
        ctx.drawImage(B.sprites.meteor[m.si], mx - hd / 2, my - hd / 2, hd, hd);
      }
    } else if (B.scene === 'bloodmoon') {
      // The moon hangs huge and red; fog banks drift below, ash rises.
      const mr = B.moonR, mx = B.moonX, my = B.moonY;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(B.sprites.moon, mx - mr * 3, my - mr * 3, mr * 6, mr * 6);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#dc2626';
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath(); ctx.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.35, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.arc(mx + mr * 0.25, my + mr * 0.3, mr * 0.22, 0, 6.2832); ctx.fill();
      for (const p of B.parts) {
        if (p.kind === 'fog') {
          if (!isStatic) {
            p.x += p.vx * B.dt;
            const m = p.r * 2;
            if (p.x < -m) p.x = W + m; else if (p.x > W + m) p.x = -m;
          }
          const breathe = 0.7 + 0.3 * Math.sin(t / 1000 * p.ps + p.ph);
          const fd = p.r * 2 * breathe;
          ctx.globalAlpha = p.a * breathe;
          ctx.drawImage(B.sprites.fog[p.si], p.x - fd / 2, p.y - fd / 2, fd, fd);
        } else {
          if (!isStatic) {
            p.y -= p.vy * B.dt;
            p.x += Math.sin(t / 1000 * p.fs + p.ph) * p.sway * B.dt;
            if (p.y < -12) Object.assign(p, this._newEmber(W, H, false), { kind: 'ash', si: 0, a: 0.5 });
          }
          const fade = Math.min(1, Math.max(0, (H - p.y) / (H * 0.3)));
          if (fade <= 0.02) continue;
          ctx.globalAlpha = p.a * fade;
          const ad = p.s * 5;
          ctx.drawImage(B.sprites.moon, p.x - ad / 2, p.y - ad / 2, ad, ad);
        }
      }
    } else if (B.scene === 'nightsky') {
      // Crescent moon, twinkling stars, drifting night clouds.
      const m = B.nightMoon;
      ctx.globalAlpha = 0.45;
      ctx.drawImage(B.sprites.moon, m.x - m.r * 3, m.y - m.r * 3, m.r * 6, m.r * 6);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#e8edff';
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0a1230';
      ctx.beginPath(); ctx.arc(m.x + m.r * 0.45, m.y - m.r * 0.25, m.r * 0.85, 0, 6.2832); ctx.fill();
      for (const s of (B.stars || [])) {
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(t / 1000 * s.ps + s.ph));
        ctx.globalAlpha = 0.55 * tw;
        ctx.fillStyle = '#dfe8ff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.2832);
        ctx.fill();
      }
      for (const p of B.parts) {
        if (!isStatic) {
          p.x += p.vx * B.dt;
          const mm = p.r * 2;
          if (p.x < -mm) p.x = W + mm; else if (p.x > W + mm) p.x = -mm;
        }
        const breathe = 0.7 + 0.3 * Math.sin(t / 1000 * p.ps + p.ph);
        const cd = p.r * 2 * breathe;
        ctx.globalAlpha = p.a * breathe;
        ctx.drawImage(B.sprites.cloud[p.si], p.x - cd / 2, p.y - cd / 2, cd, cd);
      }
    } else if (B.scene === 'sunset') {
      // Low sun with a warm pulse, tinted clouds, distant birds.
      const sn = B.sun;
      const pulse = 0.9 + 0.1 * Math.sin(t / 1400);
      ctx.globalAlpha = 0.55 * pulse;
      ctx.drawImage(B.sprites.sun, sn.x - sn.r * 3.4, sn.y - sn.r * 3.4, sn.r * 6.8, sn.r * 6.8);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath(); ctx.arc(sn.x, sn.y, sn.r, 0, 6.2832); ctx.fill();
      for (const p of B.parts) {
        if (p.kind === 'cloud') {
          if (!isStatic) {
            p.x += p.vx * B.dt;
            const mm = p.r * 2;
            if (p.x > W + mm) p.x = -mm;
          }
          const breathe = 0.7 + 0.3 * Math.sin(t / 1000 * p.ps + p.ph);
          const cd = p.r * 2 * breathe;
          ctx.globalAlpha = p.a * breathe;
          ctx.drawImage(B.sprites.scloud[p.si], p.x - cd / 2, p.y - cd / 2, cd, cd);
        } else {
          if (!isStatic) {
            p.x += p.vx * B.dt;
            if (p.x < -30) { p.x = W + 30; p.y = Math.random() * H * 0.3 + H * 0.12; }
          }
          const flap = Math.sin(t / 1000 * p.fs + p.ph) * p.s * 0.5;
          ctx.globalAlpha = 0.75;
          ctx.strokeStyle = '#2a1420';
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          ctx.moveTo(p.x - p.s, p.y - flap);
          ctx.lineTo(p.x, p.y);
          ctx.lineTo(p.x + p.s, p.y - flap);
          ctx.stroke();
        }
      }
    } else if (B.scene === 'woods') {
      // Layered pine silhouettes (back to front), wandering fireflies, mist.
      for (const tr of (B.trees || [])) {
        const base = H + 4, top = base - tr.h, hw = tr.w / 2;
        ctx.globalAlpha = 1;
        ctx.fillStyle = tr.col;
        ctx.fillRect(tr.x - tr.w * 0.06, base - tr.h * 0.22, tr.w * 0.12, tr.h * 0.22);
        for (let ti = 0; ti < 3; ti++) {
          const ty = top + ti * tr.h * 0.26, twd = hw * (1 - ti * 0.24);
          ctx.beginPath();
          ctx.moveTo(tr.x - twd, ty + tr.h * 0.30);
          ctx.lineTo(tr.x, ty);
          ctx.lineTo(tr.x + twd, ty + tr.h * 0.30);
          ctx.closePath(); ctx.fill();
        }
      }
      for (const p of B.parts) {
        if (p.kind === 'fly') {
          const fx = p.x + Math.sin(t / 1000 * p.fs + p.ph) * p.wx;
          const fy = p.y + Math.cos(t / 1000 * p.fs * 0.8 + p.ph) * p.wy;
          const tw = 0.4 + 0.6 * Math.abs(Math.sin(t / 1000 * p.ps + p.ph));
          const fd = p.s * 5 * tw;
          ctx.globalAlpha = p.a * tw;
          ctx.drawImage(B.sprites.fly[p.si], fx - fd / 2, fy - fd / 2, fd, fd);
        } else {
          if (!isStatic) {
            p.x += p.vx * B.dt;
            const mm = p.r * 2;
            if (p.x < -mm) p.x = W + mm; else if (p.x > W + mm) p.x = -mm;
          }
          const breathe = 0.7 + 0.3 * Math.sin(t / 1000 * p.ps + p.ph);
          const md = p.r * 2 * breathe;
          ctx.globalAlpha = p.a * breathe;
          ctx.drawImage(B.sprites.mist[p.si], p.x - md / 2, p.y - md / 2, md, md);
        }
      }
    } else if (B.scene === 'water') {
      // Moonlit lake: glowing moon, shimmering reflection, slow waves, mist.
      const wm = B.waterMoon;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(B.sprites.wmoon, wm.x - wm.r * 3, wm.y - wm.r * 3, wm.r * 6, wm.r * 6);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#e6f0ff';
      ctx.beginPath(); ctx.arc(wm.x, wm.y, wm.r, 0, 6.2832); ctx.fill();
      for (const p of B.parts) {
        if (p.kind === 'glint') {
          const tw = 0.3 + 0.7 * Math.abs(Math.sin(t / 1000 * p.ps + p.ph));
          ctx.globalAlpha = p.a * tw;
          ctx.fillStyle = '#bcd7ff';
          ctx.fillRect(p.x - p.w / 2, p.y, p.w, 2.2 * dpr);
        } else if (p.kind === 'wave') {
          const off = Math.sin(t / 1000 * p.ps + p.ph) * 14 * dpr;
          ctx.globalAlpha = p.a;
          ctx.strokeStyle = '#3d5a76';
          ctx.lineWidth = 1.6 * dpr;
          ctx.beginPath();
          for (let wx = -20; wx <= W + 20; wx += 40 * dpr) {
            const wy = p.y + Math.sin((wx + off) / (90 * dpr) + p.ph) * 5 * dpr;
            if (wx === -20) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
          }
          ctx.stroke();
        } else {
          if (!isStatic) {
            p.x += p.vx * B.dt;
            const mm = p.r * 2;
            if (p.x < -mm) p.x = W + mm; else if (p.x > W + mm) p.x = -mm;
          }
          const breathe = 0.7 + 0.3 * Math.sin(t / 1000 * p.ps + p.ph);
          const md = p.r * 2 * breathe;
          ctx.globalAlpha = p.a * breathe;
          ctx.drawImage(B.sprites.wmist[p.si], p.x - md / 2, p.y - md / 2, md, md);
        }
      }
    }
    // Seasonal scenes: themed motes (leaves, snow, embers, sparkles,
    // pollen, petals) drifting over the scene. Runs as its own `if` (not
    // else-if) so the motes layer on top of the painted backdrop photo.
    if (B.seasonCfg) {
      const cfg = B.seasonCfg;
      for (const p of B.parts) {
        if (!isStatic) {
          if (cfg.dir === 'down') p.y += p.vy * B.dt;
          else if (cfg.dir === 'up') p.y -= p.vy * B.dt;
          else { p.x += p.vx * B.dt; p.y += Math.sin(t / 1000 * p.fs + p.ph) * p.sway * 0.4 * B.dt; }
          p.x += Math.sin(t / 1000 * p.fs + p.ph) * p.sway * B.dt;
          const m = 20 * dpr;
          if (cfg.dir === 'drift') {
            if (p.x < -m) { p.x = W + m; } else if (p.x > W + m) { p.x = -m; }
          } else {
            const outY = cfg.dir === 'down' ? p.y > H + m : p.y < -m;
            if (outY || p.x < -m || p.x > W + m) Object.assign(p, this._newSeasonal(W, H, false, cfg));
          }
        }
        const edge = cfg.dir === 'down'
          ? Math.min(1, Math.max(0, (H - p.y) / (H * 0.25))) * Math.min(1, Math.max(0, (p.y + 20) / 80))
          : Math.min(1, Math.max(0, (H - p.y) / (H * 0.3))) * Math.min(1, Math.max(0, (p.y + 12) / 60));
        if (edge <= 0.02) continue;
        const tw = 0.75 + 0.25 * Math.sin(t / 1000 * p.fs * 1.7 + p.ph);
        const d = p.s * 5;
        ctx.globalAlpha = p.a * edge * tw;
        ctx.drawImage(B.sprites.season[p.si], p.x - d / 2, p.y - d / 2, d, d);
      }
    }
    ctx.globalAlpha = 1;
  },
  _startBgLoop() {
    this._stopBgLoop();
    const B = this._bg;
    if (!B || !B.scene) return;
    B.last = performance.now();
    // Ambient background frame rate comes from Settings (30/60 FPS): drifting
    // particles look identical at half the frame rate, and 30 halves the fill
    // cost of the full-viewport canvas. B.dt carries the accumulated time so
    // motion speed stays correct at either rate. Also feeds the FPS watchdog.
    let acc = 0;
    const step = (now) => {
      B.raf = requestAnimationFrame(step);
      const rawDt = Math.min(0.25, Math.max(0, (now - B.last) / 1000));
      B.last = now;
      this._bgFpsWatch(rawDt);
      acc += rawDt;
      if (acc < 1 / this._bgFpsTarget()) return;
      B.dt = Math.min(0.06, acc);
      acc = 0;
      this._drawBgFrame(now, false);
    };
    B.raf = requestAnimationFrame(step);
  },
  // Watches real frame pacing: if the main thread sustains under ~40fps for
  // a while, suggest Performance mode once (it freezes the bg to a static
  // frame). Never auto-enables — the player decides.
  _bgFpsWatch(dt) {
    if (this.settings.performanceMode || this._perfSuggested) return;
    const fps = dt > 0 ? 1 / dt : 60;
    this._fpsEma = this._fpsEma == null ? fps : this._fpsEma * 0.95 + fps * 0.05;
    const now = performance.now();
    if (this._fpsEma < 40) {
      if (!this._fpsLowSince) this._fpsLowSince = now;
      else if (now - this._fpsLowSince > 5000) {
        this._perfSuggested = true;
        this._fpsLowSince = 0;
        this.toast('Low FPS detected — try Performance mode in Settings for a smoother game.', 'info', 6000);
      }
    } else {
      this._fpsLowSince = 0;
    }
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

  // snapshot: {rows: [{key,label,dps,total,pct}], totalDps, stale?}
  renderMeter(snapshot) {
    const rowsEl = this.els['meter-rows'];
    if (!rowsEl) return;
    // Stale = showing the last fight's numbers (e.g. after a one-tap kill).
    const liveEl = document.getElementById('meter-live');
    if (liveEl) {
      liveEl.classList.toggle('stale', !!snapshot.stale);
      liveEl.innerHTML = snapshot.stale ? '⏮ LAST FIGHT' : '<span class="live-dot"></span>LIVE';
    }
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
    const roleKind = (c && c.roleKind) || (Engine.companionRole && Engine.companionRole(c)) || 'dps';
    const roleLabel = ((Engine.COMPANION_ROLES || {})[roleKind] || {}).label || roleKind;
    const roleBadge = `<span class="role-badge role-${roleKind}">${roleLabel}</span>`;
    if (mini) {
      return `
      <div class="portrait" style="background:linear-gradient(135deg,hsl(${hue},45%,38%),hsl(${(hue + 40) % 360},50%,24%))">${esc(initial)}</div>
      <div class="member-name">${esc(c.name)}</div>
      <div class="member-role">${esc(c.role || 'Companion')} ${roleBadge}</div>
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
          <div class="member-role">${esc(c.role || 'Companion')} ${roleBadge} · <span class="tier-badge ${tierCls}">${esc(tier)}</span></div>
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
            <div class="shop-rarity" style="color:${rc}">${esc(Engine.rarityName(entry.rarity))} · ${esc(slotName)}</div>
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
        <div class="item-sub">${esc(Engine.rarityName(item.rarity))} · ${esc(Engine.SLOT_INFO[item.slot]?.name || item.slot)}</div>
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
    // --- Mining Shop: all pickaxe tiers, buy in order ---
    const mshop = document.getElementById('mining-shop');
    if (mshop) {
      const cur = m.pickaxe || 0;
      mshop.innerHTML = E.PICKAXE_TIERS.map((t, i) => {
        const owned = i <= cur;
        const isNext = i === cur + 1;
        const costParts = [];
        for (const [k, n] of Object.entries(t.cost || {})) {
          if (k === 'gold') { costParts.push(`💰 ${formatNum(n)}`); continue; }
          const od = E.ORE_BY_ID[k];
          costParts.push(`${(od && od.emoji) || ''} ${formatNum(n)}`);
        }
        const btn = owned
          ? `<button class="btn small ghost" disabled>✔ Owned</button>`
          : isNext
            ? `<button class="btn small gold" data-action="buy-pickaxe" data-tier="${i}">Buy ⛏️</button>`
            : `<button class="btn small" disabled title="Buy the previous tier first">🔒</button>`;
        return `<div class="shop-card${owned ? ' owned' : ''}${i > cur + 1 ? ' locked' : ''}">
          <div class="shop-emoji">${t.emoji}</div>
          <div class="shop-name">${esc(t.name)}</div>
          <div class="muted small">×${t.mult} tap damage</div>
          ${owned ? '' : `<div class="muted small">${costParts.join(' + ')}</div>`}
          <div style="margin-top:8px">${btn}</div>
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
      return `<div class="card quest-card" data-qcard="${period}:${entry.id}">
        <div class="quest-top"><span>${def.emoji} <b>${esc(def.name)}</b></span>${status}</div>
        <div class="muted small">${esc(def.desc(target))}</div>
        ${lockedHint ? `<div class="muted small">🔒 ${esc(lockedHint)}</div>` : ''}
        <div class="quest-bar"><div class="quest-fill" data-qfill style="width:${pct}%"></div></div>
        <div class="quest-meta">
          <span class="muted small" data-qtxt>${formatNum(Math.min(progress, target))} / ${formatNum(target)}</span>
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
          const skillHint = def.requiresSkill && !(state.skills || []).includes(def.requiresSkill)
            ? `Requires ${Engine.SKILLS[def.requiresSkill].name} (Lv ${Engine.SKILLS[def.requiresSkill].unlockLevel})` : null;
          const chainHint = Engine.storyQuestLockedReason(state, def);
          const lockedHint = skillHint || chainHint;
          return cardHtml('story', entry, progress, target, complete, def, rw, lockedHint);
        }).join('');
    };
    renderList('daily', 'quest-daily', '☀️ Daily quests', 'quest-daily-cd');
    renderList('weekly', 'quest-weekly', '📅 Weekly quests', 'quest-weekly-cd');
    renderStoryList('guide', 'quest-guide', '🧭 New Adventurer Guide', 'one-time · step by step');
    renderStoryList('class', 'quest-class', '🔮 Class questline', 'mages only · one-time');
    renderStoryList('mastery', 'quest-mastery', '🎯 Skill mastery', 'one-time');
    // Start (and immediately populate) the live reset countdowns now that
    // the header spans exist.
    this._startQuestCountdowns();
    // Sync progress immediately on open (no stale "0 / N" flash) and keep it
    // ticking while the tab is visible so counters never look frozen.
    this._syncQuestProgress(state, true);
    this._startQuestSync(state);
  },

  // Live quest progress sync. Recomputes every visible quest card's bar and
  // counter in place (no re-render, no scroll jump) and toasts the moment a
  // quest flips to complete. `seed` just records current state without
  // toasting (used right after a fresh render).
  _questSyncTimer: null,
  _questSeenComplete: null,
  _stateProvider: null,
  setStateProvider(fn) { this._stateProvider = fn; },
  _getState() { return this._stateProvider ? this._stateProvider() : null; },
  _startQuestSync(state) {
    this._stopQuestSync();
    this._questSyncTimer = setInterval(() => {
      if (this.activeTab !== 'quests') return;
      const s = this._getState();
      if (!s) return;
      this._syncQuestProgress(s, false);
    }, 2000);
  },
  _stopQuestSync() {
    if (this._questSyncTimer) { clearInterval(this._questSyncTimer); this._questSyncTimer = null; }
  },
  _syncQuestProgress(state, seed) {
    if (!this._questSeenComplete) this._questSeenComplete = new Set();
    const seen = this._questSeenComplete;
    const check = (period, entry, progress, target, complete, def) => {
      const key = `${period}:${entry.id}`;
      const card = document.querySelector(`[data-qcard="${CSS.escape(key)}"]`);
      if (card) {
        const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
        const fill = card.querySelector('[data-qfill]');
        const txt = card.querySelector('[data-qtxt]');
        if (fill) fill.style.width = pct + '%';
        if (txt) txt.textContent = `${formatNum(Math.min(progress, target))} / ${formatNum(target)}`;
      }
      if (complete && !entry.claimed && !seen.has(key)) {
        seen.add(key);
        if (!seed && def) {
          this.notify('quest', `📜 Quest complete: ${def.name} — claim your reward!`, 'success');
          // Re-render so the Claim button appears without reopening the tab.
          try { this.renderQuests(state); } catch { /* ignore */ }
        }
      }
    };
    Engine.ensureQuests(state);
    Engine.ensureStoryQuests(state);
    for (const period of ['daily', 'weekly']) {
      const list = period === 'weekly' ? state.quests.weekly : state.quests.daily;
      for (const entry of (list || [])) {
        const { progress, target, complete, def } = Engine.questProgress(state, entry);
        if (def) check(period, entry, progress, target, complete, def);
      }
    }
    for (const entry of (state.quests.story || [])) {
      const { progress, target, complete, def } = Engine.storyQuestProgress(state, entry);
      if (def) check('story', entry, progress, target, complete, def);
    }
  },

  // ---------------- party ----------------
  // ---------------- multiplayer party ----------------
  // Server-side invite-code party. mp is the GET /api/party view (or null).
  // ctx: { username, isGuest, ownNpcCount }. Self is matched by username
  // (the client knows its own; no id exposure needed for this).
  renderMpParty(mp, ctx, state) {
    const card = this.els['mp-party-card'];
    if (!card) return;
    const joinCard = this.els['mp-join-card'];
    ctx = ctx || {};
    if (ctx.isGuest) {
      card.innerHTML = `
        <h3>🎉 Multiplayer party</h3>
        <p class="muted">Parties need an account — guest sessions are solo-only. Create an account to team up with friends.</p>`;
      if (joinCard) joinCard.classList.add('hidden');
      return;
    }
    if (joinCard) joinCard.classList.remove('hidden');
    if (!mp) {
      card.innerHTML = `
        <h3>🎉 Multiplayer party</h3>
        <p class="muted">Team up with friends: <b>+8% XP</b> and <b>+5% gold</b> per other
        <b>online</b> member (up to 4 total). Your NPC allies add <b>+4% XP</b> each.</p>
        <button class="btn gold" data-action="mp-create">🎉 Create party</button>`;
      return;
    }
    const me = String(ctx.username || '');
    // Server sends a FLAT roster: humans (isNpc:false) + NPC allies
    // (isNpc:true, with ownerUsername). Group NPCs under their owner.
    const rows = Array.isArray(mp.members) ? mp.members : [];
    const humans = rows.filter(m => !m.isNpc);
    const npcsByOwner = {};
    for (const n of rows) {
      if (!n.isNpc) continue;
      const k = String(n.ownerUsername || '');
      (npcsByOwner[k] = npcsByOwner[k] || []).push(n);
    }
    // Bonuses are computed server-side from DB truth (mp.bonuses). Fall back
    // to a local estimate only if the field is missing.
    const b = mp.bonuses || {};
    const othersOnline = Number.isFinite(b.onlineOtherHumans)
      ? b.onlineOtherHumans
      : humans.filter(m => m.online && String(m.username) !== me).length;
    const activeNpcs = Number.isFinite(b.activeNpcs)
      ? b.activeNpcs
      : (npcsByOwner[me] || []).length;
    const xpPct = Number.isFinite(b.xpPct) ? b.xpPct : othersOnline * 8 + activeNpcs * 4;
    const goldPct = Number.isFinite(b.goldPct) ? b.goldPct : othersOnline * 5;
    const isLeader = String(mp.leaderUsername) === me;
    // Flat roster: humans and NPC allies share the 4 slots, rendered in
    // roster order. Humans get full cards, NPCs get compact ally cards.
    const slots = [];
    const roster = rows.slice(0, 4);
    for (let i = 0; i < 4; i++) {
      const m = roster[i];
      if (!m) {
        slots.push(`<div class="mp-member empty"><div class="empty-slot-inner"><span class="empty-plus">＋</span><span>Open slot</span></div></div>`);
        continue;
      }
      if (m.isNpc) {
        slots.push(`
          <div class="mp-member mp-npc">
            <div class="mp-avatar">${esc(m.emoji || '🛡️')}</div>
            <div class="mp-info">
              <div class="mp-name">${esc(m.name)} <span class="muted small">Lv ${m.level}</span></div>
              <div class="muted small">NPC ally · ${esc(m.ownerUsername || '')}${m.online ? '' : ' · owner offline'}</div>
            </div>
          </div>`);
        continue;
      }
      const race = (Engine.RACES && Engine.RACES[m.race]) || {};
      const cls = (Engine.CLASSES && Engine.CLASSES[m.playerClass]) || {};
      const dot = m.online ? '🟢' : '⚪';
      const crown = m.isLeader ? ' 👑' : '';
      const flag = (Engine.countryFlag && Engine.countryFlag(m.country)) || '';
      const title = m.activeTitle ? `<div class="mp-title">${esc(Engine.titleName(m.activeTitle))}</div>` : '';
      const mIsMe = String(m.username) === me;
      const kick = (isLeader && !mIsMe)
        ? `<button class="btn small ghost icon-btn" data-action="mp-kick" data-id="${m.userId}" title="Kick ${esc(m.username)}">✕</button>`
        : '';
      slots.push(`
        <div class="mp-member">
          <div class="mp-avatar">${race.emoji || '🛡️'}</div>
          <div class="mp-info">
            <div class="mp-name">${dot} ${this.nameHtml(m.username, mIsMe ? state : m)}${flag ? ' ' + flag : ''}${crown}</div>
            ${title}
            <div class="muted small">Lv ${m.level} · Stage ${m.stage}${cls.name ? ' · ' + esc(cls.name) : ''}${m.online ? '' : ' · offline'}</div>
          </div>
          ${kick}
        </div>`);
    }
    card.innerHTML = `
      <div class="mp-head">
        <div class="mp-code-row"><span class="muted">Invite code</span>
          <b class="mp-code">${esc(mp.code)}</b>
          <button class="btn small ghost" data-action="mp-copy" title="Copy invite code">📋 Copy</button>
        </div>
        <div class="mp-bonus">✨ +${xpPct}% XP · 💰 +${goldPct}% gold
          <span class="muted small">(${othersOnline} online member${othersOnline === 1 ? '' : 's'} + ${activeNpcs} NPC)</span>
        </div>
      </div>
      <div class="mp-members">${slots.join('')}</div>
      <div class="mp-controls">
        <button class="btn small ghost" data-action="mp-leave">🚪 Leave party</button>
        ${isLeader ? `<button class="btn small danger" data-action="mp-disband">💥 Disband</button>` : ''}
      </div>`;
  },

  renderParty(state, ctx) {
    this.renderMpParty((ctx && ctx.mpParty) || null, ctx, state);
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
      const roleKind = (Engine.companionRole && Engine.companionRole(r)) || 'dps';
      const roleLabel = ((Engine.COMPANION_ROLES || {})[roleKind] || {}).label || roleKind;
      const roleBadge = `<span class="role-badge role-${roleKind}">${roleLabel}</span>`;
      const row = document.createElement('div');
      row.className = 'recruit-row recruit-' + tier;
      row.innerHTML = `
        <div class="recruit-info"><span class="comp-emoji">${r.emoji}</span>
          <div><div class="comp-name">${esc(r.name)} ${tierBadge} ${roleBadge}</div>
          <div class="muted small">⚔️${r.atk} 🛡️${r.def} ❤️${r.hp} · scales with your level</div></div></div>
        <button class="btn small" data-action="recruit" data-id="${r.id}" ${disabled ? 'disabled' : ''}>
          ${owned ? '✔' : `💰 ${formatNum(r.cost)}`} ${reason && !owned ? `<span class="muted small">${reason}</span>` : ''}
        </button>`;
      list.appendChild(row);
    }
    void ownedIds;
  },

  // ---------------- pets ----------------
  // Pets live in their own 🐾 Pets tab: the Pet Shop (tiered eggs for gold),
  // your collection, and the Breeding Den. Wild eggs drop from bosses (15%).
  // All hatching is instant from here.
  _breedSel: [],
  _combineSel: [],
  _toggleBreedSelect(uid) {
    const i = this._breedSel.indexOf(uid);
    if (i >= 0) this._breedSel.splice(i, 1);
    else if (this._breedSel.length < 2) this._breedSel.push(uid);
    else { this._breedSel.shift(); this._breedSel.push(uid); }
    this._refreshBreedPanel();
  },
  _toggleCombineSelect(uid) {
    const i = this._combineSel.indexOf(uid);
    if (i >= 0) this._combineSel.splice(i, 1);
    else if (this._combineSel.length < 3) this._combineSel.push(uid);
    this._refreshBreedPanel();
  },
  _petChip(uid) {
    const st = this._breedState;
    const pet = st && st.collection.find(x => x.uid === uid);
    if (!pet) return '<span class="muted">—</span>';
    const sp = Engine.petSpeciesOf(pet);
    return `<span>${sp.emoji} ${esc(sp.name)} <span class="muted small">Lv ${pet.level}</span></span>`;
  },
  _refreshBreedPanel() {
    const st = this._breedState;
    if (!st) return;
    const breedBox = document.getElementById('breed-picks');
    const combBox = document.getElementById('combine-picks');
    if (breedBox) {
      const [a, b] = this._breedSel;
      const cost = (a && b) ? 5000 * (Math.max(1, (st.collection.find(x => x.uid === a) || {}).level || 1) + Math.max(1, (st.collection.find(x => x.uid === b) || {}).level || 1)) : 0;
      breedBox.innerHTML = `
        <div class="breed-slots">${this._petChip(a)}<span class="muted">+</span>${this._petChip(b)}</div>
        <div class="row-between" style="margin-top:8px">
          <span class="muted small">${a && b ? `Cost: 💰${formatNum(cost)}` : 'Tap 💕 on two pets to pick parents'}</span>
          <button class="btn small success" data-action="do-breed" ${a && b ? '' : 'disabled'}>💕 Breed</button>
        </div>`;
    }
    if (combBox) {
      const picks = this._combineSel;
      const rarities = picks.map(u => { const pet = st.collection.find(x => x.uid === u); return pet ? Engine.petSpeciesOf(pet).rarity : null; });
      const sameRarity = picks.length === 3 && new Set(rarities).size === 1;
      const topRarity = sameRarity && rarities[0] === 'celestial';
      combBox.innerHTML = `
        <div class="breed-slots">${picks.map(u => this._petChip(u)).join('<span class="muted">+</span>') || '<span class="muted">—</span>'}</div>
        <div class="row-between" style="margin-top:8px">
          <span class="muted small">${picks.length < 3 ? 'Tap 🔀 on three pets of the same rarity' : topRarity ? 'Already max rarity!' : sameRarity ? `→ next rarity up, keeps highest level` : '⚠️ All three must share a rarity'}</span>
          <button class="btn small success" data-action="do-combine" ${sameRarity && !topRarity ? '' : 'disabled'}>🔀 Combine</button>
        </div>`;
    }
    // Highlight selected cards.
    document.querySelectorAll('#tab-pets .pet-card').forEach(card => {
      const id = card.dataset.petUid;
      card.classList.toggle('breed-pick', this._breedSel.includes(id));
      card.classList.toggle('combine-pick', this._combineSel.includes(id));
    });
  },
  renderPetsTab(state) {
    const panel = document.getElementById('pets-section');
    if (!panel) return;
    panel.innerHTML = '';
    this._breedSel = [];
    this._combineSel = [];
    const p = Engine.ensurePets(state);
    this._breedState = p;
    // --- Pet Shop ---
    const shop = document.createElement('div');
    shop.className = 'pet-shop';
    const cards = Engine.SHOP_EGG_TIERS
      .filter(tier => Engine.EGG_TIERS[tier].price != null) // token-only eggs live in the Token Shop
      .map(tier => {
      const t = Engine.EGG_TIERS[tier];
      const owned = p.shopEggs[tier] || 0;
      const afford = state.infGold === true || state.gold >= t.price;
      const priceLabel = state.infGold === true ? '∞ FREE' : `💰 ${formatNum(t.price)}`;
      return `
        <div class="shop-card">
          <div class="shop-emoji">${t.emoji}</div>
          <div class="shop-name">${esc(t.name)}${tier === 'stray' ? ' <span class="quest-tag ready">STARTER</span>' : ''}</div>
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

    // --- Coming-soon teasers (visible, locked, not obtainable) ---
    if (Engine.PET_TEASERS && Engine.PET_TEASERS.length) {
      const teasers = document.createElement('div');
      teasers.className = 'pet-teasers';
      teasers.innerHTML = `
        <div class="shop-head"><span class="shop-title">🔮 Coming Soon</span>
          <span class="muted small">not yet obtainable</span></div>
        <div class="shop-grid">` + Engine.PET_TEASERS.map(t => `
          <div class="shop-card teaser-card">
            <div class="shop-emoji teaser-emoji">${t.emoji}</div>
            <div class="shop-name">${esc(t.name)}</div>
            <div class="muted small shop-desc">${esc(t.desc)}</div>
            <span class="teaser-badge">🔒 COMING SOON</span>
          </div>`).join('') + `</div>`;
      panel.appendChild(teasers);
    }

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
        ? `🔗 Bond active: +${formatNum(pb.atk)} ATK / +${formatNum(pb.def)} DEF / +${formatNum(pb.hp)} HP${bondNote}`
        : `🔗 Bond: +${formatNum(pb.atk)} ATK / +${formatNum(pb.def)} DEF / +${formatNum(pb.hp)} HP (applies when active)`;
      const row = document.createElement('div');
      row.className = 'pet-card' + (active ? ' active' : '');
      row.dataset.petUid = pet.uid;
      const badge = isPrimary ? '<span class="pet-active">ACTIVE</span>'
        : isSecond ? '<span class="pet-active">2ND PET</span>' : '';
      const setActiveBtn = isPrimary ? '' : `<button class="btn small ghost" data-action="set-active-pet" data-id="${esc(pet.uid)}">Set active</button>`;
      const secondBtn = !isHunter || isPrimary ? '' : isSecond
        ? `<button class="btn small ghost" data-action="remove-second-pet" data-id="${esc(pet.uid)}">Remove 2nd</button>`
        : `<button class="btn small ghost" data-action="set-second-pet" data-id="${esc(pet.uid)}">Set as 2nd</button>`;
      const sellPrice = Engine.petSellPrice(pet);
      const sellLabel = `Sell · 💰${formatNum(sellPrice)}`;
      const sellBtn = Engine.canSellPet(pet)
        ? `<button class="btn small ghost sell-btn" data-action="sell-pet" data-id="${esc(pet.uid)}" data-sell-text="${esc(sellLabel)}" title="Sell this pet for gold"><span class="sell-label">${esc(sellLabel)}</span></button>`
        : `<span class="muted small" title="This pet is special and cannot be sold">🔒 unsellable</span>`;
      const feedBtn = `<button class="btn small" data-action="feed-pet" data-id="${esc(pet.uid)}" ${pet.hunger >= 100 ? 'disabled' : ''}>🍖 Feed (💰${formatNum(cost)})</button>`;
      const breedBtn = `<button class="btn small ghost" data-action="breed-select" data-id="${esc(pet.uid)}" title="Select for breeding">💕</button>`;
      const combineBtn = sp.unsellable ? '' : `<button class="btn small ghost" data-action="combine-select" data-id="${esc(pet.uid)}" title="Select for combining">🔀</button>`;
      const petBtns = [feedBtn, setActiveBtn, secondBtn, breedBtn, combineBtn, sellBtn].filter(Boolean);
      const petBtnRow = petBtns.join('<span class="btn-sep" aria-hidden="true">|</span>');
      row.innerHTML = `
        <div class="pet-head"><span class="pet-emoji">${sp.emoji}</span>
          <div><div class="comp-name">${esc(sp.name)} <span class="muted small">Lv ${pet.level}</span></div>
          <div class="muted small">${esc(Engine.rarityName(sp.rarity))} · strikes every 4s</div></div>
          ${badge}
        </div>
        <div class="muted small">📊 ${formatNum(ps.atk)} ATK · ${formatNum(ps.def)} DEF · ${formatNum(ps.hp)} HP</div>
        <div class="muted small">${bondText}</div>
        <div class="pet-hunger"><div class="bar hunger"><div class="fill" style="width:${hungerPct}%"></div></div>
          <span class="muted small">🍖 ${hungerPct}% ${hungerLabel}</span></div>
        <div class="row pet-actions">
          ${petBtnRow}
        </div>`;
      list.appendChild(row);
    }
    panel.appendChild(list);

    // --- Breeding Den ---
    const den = document.createElement('div');
    den.className = 'breeding-den';
    den.innerHTML = `
      <h2>💕 Breeding Den</h2>
      <p class="muted small" style="margin:4px 0">Breed two pets for a gold fee — the egg hatches a Lv 1 pet (45/45% parent species, 10% mutation of the higher rarity). Combine <b>three pets of the same rarity</b> into one pet of the next rarity up — keeps the highest level. Celestial pets are max rarity.</p>
      <h3>Breed</h3>
      <div id="breed-picks" class="breed-box"></div>
      <h3>Combine</h3>
      <div id="combine-picks" class="breed-box"></div>`;
    panel.appendChild(den);
    this._refreshBreedPanel();
  },

  // ---------------- token shop ----------------
  // 🌀 Rebirth Token Shop: rotating 24h stock, permanent purchases.
  _tokenTimer: null,
  _startTokenCountdown() {
    this._stopTokenCountdown();
    this._tickTokenCountdown();
    this._tokenTimer = setInterval(() => this._tickTokenCountdown(), 1000);
  },
  _stopTokenCountdown() {
    if (this._tokenTimer) { clearInterval(this._tokenTimer); this._tokenTimer = null; }
  },
  _tickTokenCountdown() {
    const el = document.getElementById('token-countdown');
    if (!el || !this._tokenStock) return;
    let ms = this._tokenStock.windowEnd - Date.now();
    if (ms <= 0) {
      // Rotation landed: refresh the stock silently if we're still here.
      if (this.activeTab === 'tokenshop' && this._tokenState) this.renderTokenShop(this._tokenState);
      return;
    }
    const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
    el.textContent = `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  },
  _tokenShopCard(state, item) {
    let title, desc, owned = false;
    if (item.kind === 'title') {
      const t = Engine.TITLES.find(x => x.id === item.ref) || {};
      title = t.name || item.ref; desc = t.desc || '';
      owned = (state.titlesUnlocked || []).includes(item.ref);
    } else if (item.kind === 'fx') {
      const f = Engine.TOKEN_NAME_FX.find(x => x.id === item.ref) || {};
      title = f.name || item.ref; desc = 'Name effect — equip it in Settings → Name Style.';
      owned = Engine.fxIsUnlocked(state, item.ref);
    } else {
      title = item.name; desc = item.desc || '';
    }
    const afford = (state.rebirthTokens || 0) >= item.cost;
    const btn = owned
      ? `<button class="btn small ghost" disabled>✔ Owned</button>`
      : `<button class="btn small ${afford ? 'success' : ''}" data-action="buy-token" data-id="${item.id}" ${afford ? '' : 'disabled'}>🌀 ${item.cost} token${item.cost > 1 ? 's' : ''}</button>`;
    return `<div class="shop-card${owned ? ' owned' : ''}">
      <div class="shop-name">${esc(title)}${item.staple ? ' <span class="quest-tag ready">STAPLE</span>' : ''}</div>
      <div class="muted small">${esc(desc)}</div>
      <div style="margin-top:8px">${btn}</div>
    </div>`;
  },
  renderTokenShop(state) {
    this._tokenState = state;
    Engine.ensureFxUnlocked(state);
    const stock = Engine.tokenShopStock(Date.now());
    this._tokenStock = stock;
    const bal = document.getElementById('token-balance');
    if (bal) bal.innerHTML = `🌀 <b>${formatNum(state.rebirthTokens || 0)}</b> token${(state.rebirthTokens || 0) === 1 ? '' : 's'}`;
    const grid = document.getElementById('token-shop-grid');
    if (grid) grid.innerHTML = stock.items.map(item => this._tokenShopCard(state, item)).join('');
    this._startTokenCountdown();
  },

  // ---------------- ranks ----------------
  // Active leaderboard category: 'heroes' | 'guilds'. The active pill is
  // synced whenever a category is rendered.
  ranksCategory: 'heroes',
  setRanksCategory(cat) {
    this.ranksCategory = cat === 'guilds' ? 'guilds' : 'heroes';
    const cats = this.els['lb-cats'];
    if (cats) {
      cats.querySelectorAll('button[data-lbcat]').forEach((b) => {
        const active = b.dataset.lbcat === this.ranksCategory;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }
    // Ranking pills + All/Friends filter are hero-specific: hide them on the Guilds view.
    const heroOnly = this.ranksCategory === 'heroes';
    $$('#lb-cats button[data-by]').forEach((b) => b.classList.toggle('hidden', !heroOnly));
    const filters = this.els['lb-filters'];
    if (filters) filters.classList.toggle('hidden', !heroOnly);
    return this.ranksCategory;
  },
  // Leaderboard ranking categories: label, chip icon and how to read the value off
  // an entry. Guild tag renders only when the server sends one (never crashes).
  LB_CATS: {
    level:    { emoji: '🎖️', label: 'Level',    fmt: (en) => en.level },
    stage:    { emoji: '🗺️', label: 'Stage',    fmt: (en) => en.stage },
    bosses:   { emoji: '👑', label: 'Bosses',   fmt: (en) => formatNum(en.bossesKilled) },
    kills:    { emoji: '⚔️', label: 'Kills',    fmt: (en) => formatNum(en.kills || 0) },
    depth:    { emoji: '⛏️', label: 'Depth',    fmt: (en) => (en.depth || 0) },
    titles:   { emoji: '🏵️', label: 'Titles',   fmt: (en) => (en.titles || 0) },
    rebirths: { emoji: '🌀', label: 'Rebirths', fmt: (en) => (en.rebirth > 0 ? en.rebirth : '—') },
  },
  lbCategory: 'level',

  setLbCategory(by) {
    if (!this.LB_CATS[by]) return;
    this.lbCategory = by;
    $$('#lb-cats button[data-by]').forEach(b => b.classList.toggle('active', b.dataset.by === by));
    if (this.handlers.onLbCategory) this.handlers.onLbCategory(by);
  },

  renderRanks(entries, meUsername, by, meState) {
    this.setRanksCategory('heroes');
    const cat = this.LB_CATS[by] || this.LB_CATS[this.lbCategory] || this.LB_CATS.level;
    const note = this.els['lb-note'];
    if (note) note.textContent = `Top heroes by ${cat.label.toLowerCase()}.`;
    const body = this.els['lb-body'];
    if (!body) return;
    body.innerHTML = '';
    if (!entries.length) {
      body.innerHTML = '<div class="lb-empty muted center">No heroes yet.</div>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    entries.forEach((en, i) => {
      const row = document.createElement('div');
      row.className = 'lb-row lb-clickable' + (i < 3 ? ' lb-top' + (i + 1) : '');
      row.dataset.username = en.username || '';
      row.title = 'Inspect ' + (en.username || '');
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
      const guildTag = en.guildTag
        ? `<span class="lb-guildtag" title="Guild: ${esc(en.guildTag)}">[${esc(en.guildTag)}]</span> ` : '';
      const rankHtml = medals[i]
        ? `<div class="lb-rank lb-medal" aria-label="rank ${i + 1}">${medals[i]}</div>`
        : `<div class="lb-rank">${i + 1}</div>`;
      row.innerHTML = `
        ${rankHtml}
        <div class="lb-avatar" aria-hidden="true">${race.emoji || '❓'}</div>
        <div class="lb-identity">
          <div class="lb-name">${flag ? flag + ' ' : ''}${badgeHtml}${clsHtml}${specHtml}${guildTag}${this.nameHtml(en.username, isMe ? meState : en)}${isMe ? '<span class="lb-you">YOU</span>' : ''}</div>
          ${title}
        </div>
        <div class="lb-chips">
          <span class="lb-chip lb-chip-cat"><b>${cat.emoji}</b>${cat.fmt(en)}</span>
          <span class="lb-chip"><b>Lv</b>${en.level}</span>
          <span class="lb-chip"><b>Stage</b>${en.stage}</span>
          <span class="lb-chip"><b>⚔️</b>${formatNum(en.power || 0)}</span>
          <span class="lb-chip"><b>👑</b>${en.bossesKilled}</span>
          <span class="lb-chip"><b>🌀</b>${en.rebirth > 0 ? en.rebirth : '—'}</span>
        </div>`;
      body.appendChild(row);
    });
  },

  // Guild leaderboard: ranks guilds by level, then total member power,
  // then member count (see server getGuildRankings).
  renderGuildRanks(guilds) {
    this.setRanksCategory('guilds');
    const note = this.els['lb-note'];
    if (note) note.textContent = 'Guilds ranked by guild level → total member power → member count.';
    const body = this.els['lb-body'];
    body.innerHTML = '';
    if (!guilds || !guilds.length) {
      body.innerHTML = '<div class="lb-empty muted center">No guilds yet. Found one in the 🏰 Guild tab!</div>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    guilds.forEach((g, i) => {
      const row = document.createElement('div');
      row.className = 'lb-row guild-row' + (i < 3 ? ' lb-top' + (i + 1) : '');
      const rankHtml = medals[i]
        ? `<div class="lb-rank lb-medal" aria-label="rank ${i + 1}">${medals[i]}</div>`
        : `<div class="lb-rank">${i + 1}</div>`;
      row.innerHTML = `
        ${rankHtml}
        <div class="lb-avatar" aria-hidden="true">🏰</div>
        <div class="lb-identity">
          <div class="lb-name"><span class="lb-guildtag guild-row-tag">[${esc(g.tag)}]</span> ${esc(g.name)}</div>
          <div class="lb-title">Lv ${g.level} guild · ${g.memberCount} member${g.memberCount === 1 ? '' : 's'}</div>
        </div>
        <div class="lb-chips">
          <span class="lb-chip"><b>Lv</b>${g.level}</span>
          <span class="lb-chip"><b>👥</b>${g.memberCount}</span>
          <span class="lb-chip"><b>⚔️</b>${formatNum(g.totalPower || 0)}</span>
        </div>`;
      body.appendChild(row);
    });
  },

  // ---------------- settings ----------------

  // ---------------- friends ----------------
  // Ranks sub-tab: friends list, requests, and the add-by-username box.
  // `data` is the /api/friends payload (or null while loading); `isGuest`
  // shows the account-upgrade prompt instead.
  // Shared friends markup used by both the Ranks-tab panel and the HUD
  // friends modal. `data` is the /friends payload ({friends, incoming,
  // outgoing}); friends sort online-first.
  friendsHtml(data, isGuest) {
    if (isGuest) {
      return `
        <div class="card friends-guest">
          <h3>👥 Friends</h3>
          <p class="muted">Friends need an account — your progress carries over.</p>
          <button class="btn gold" data-friend="upgrade">✨ Create free account</button>
        </div>`;
    }
    if (!data) return '<div class="muted center">Loading friends…</div>';
    const onlineDot = (on) => `<span class="online-dot${on ? ' on' : ''}" title="${on ? 'Online' : 'Offline'}"></span>`;
    const incoming = (data.incoming || []).map((u) => `
      <div class="friend-row req">
        ${onlineDot(false)}
        <span class="friend-name">${this.nameHtml(u.username, u)}${u.title ? ` <span class="friend-title">👑 ${esc(Engine.titleName(u.title))}</span>` : ''}</span>
        <span class="muted small">wants to be friends</span>
        <span class="friend-actions">
          <button class="btn small gold" data-friend="accept" data-username="${esc(u.username)}">✓ Accept</button>
          <button class="btn small ghost" data-friend="decline" data-username="${esc(u.username)}">✕</button>
        </span>
      </div>`).join('');
    const outgoing = (data.outgoing || []).map((u) => `
      <div class="friend-row req">
        ${onlineDot(false)}
        <span class="friend-name">${this.nameHtml(u.username, u)}${u.title ? ` <span class="friend-title">👑 ${esc(Engine.titleName(u.title))}</span>` : ''}</span>
        <span class="muted small">request sent</span>
        <span class="friend-actions">
          <button class="btn small ghost" data-friend="cancel" data-username="${esc(u.username)}">Cancel</button>
        </span>
      </div>`).join('');
    const sorted = (data.friends || []).slice().sort((a, b) => Number(!!b.online) - Number(!!a.online));
    const friends = sorted.map((f) => {
      const cls = f.playerClass && UI_CLASS_EMOJI[f.playerClass] ? UI_CLASS_EMOJI[f.playerClass] + ' ' : '';
      return `
      <div class="friend-row" data-username="${esc(f.username)}">
        ${onlineDot(!!f.online)}
        <span class="friend-name">${cls}${this.nameHtml(f.username, f)}${f.title ? ` <span class="friend-title">👑 ${esc(Engine.titleName(f.title))}</span>` : ''}</span>
        <span class="muted small">Lv ${f.level} · Stage ${f.stage}</span>
        <span class="friend-actions">
          <button class="btn small" data-friend="inspect" data-username="${esc(f.username)}">🔍</button>
          <button class="btn small ghost" data-friend="compare" data-username="${esc(f.username)}" title="Compare with me">⚖️</button>
          <button class="btn small ghost" data-friend="remove" data-username="${esc(f.username)}" title="Remove friend">🗑️</button>
        </span>
      </div>`;
    }).join('');
    return `
      <div class="card friends-add">
        <h3>➕ Add friend</h3>
        <div class="friend-add-row">
          <input class="friend-input" placeholder="Exact username…" maxlength="20" autocomplete="off">
          <button class="btn gold" data-friend="send">Send request</button>
        </div>
        <p class="muted small">Usernames are exact — ask your friend for theirs.</p>
      </div>
      ${incoming || outgoing ? `<div class="card"><h3>📨 Requests</h3>${incoming}${outgoing}</div>` : ''}
      <div class="card">
        <h3>👥 Friends (${(data.friends || []).length})</h3>
        ${friends || '<p class="muted">No friends yet — add someone above.</p>'}
      </div>`;
  },

  renderFriends(data, isGuest) {
    const panel = this.els['friends-panel'];
    if (!panel) return;
    panel.innerHTML = this.friendsHtml(data, isGuest);
  },

  // Opens the HUD friends modal (👥 top-bar button). Content is filled by
  // showFriendsModal once the payload arrives.
  openFriendsModal() {
    if (this._friendsModalOpen) return;
    this._friendsModalOpen = true;
    this._friendsModalBody = null;
    this.modal({
      title: '👥 Friends',
      html: '<div class="muted center">Loading friends…</div>',
      buttons: [{ label: 'Close', cls: 'gold' }],
      wide: true,
      onClose: () => { this._friendsModalOpen = false; this._friendsModalBody = null; },
    });
    const overlays = this.els['modal-root'] ? this.els['modal-root'].querySelectorAll('.modal-overlay') : [];
    const last = overlays[overlays.length - 1];
    if (last) this._friendsModalBody = last.querySelector('.modal-body');
    if (this.handlers.onOpenFriends) this.handlers.onOpenFriends();
  },

  // Fill / refresh the open friends modal. No-op when it isn't open.
  showFriendsModal(data, isGuest) {
    if (!this._friendsModalOpen || !this._friendsModalBody) return;
    this._friendsModalBody.innerHTML = this.friendsHtml(data, isGuest);
  },

  setFriendBadge(count) {
    const n = count > 0 ? (count > 9 ? '9+' : String(count)) : '';
    const sub = this.els['friend-req-badge'];
    if (sub) {
      sub.textContent = n;
      sub.classList.toggle('hidden', !n);
    }
    const hud = this.els['friend-req-badge-hud'];
    if (hud) {
      hud.textContent = n;
      hud.classList.toggle('hidden', !n);
    }
  },

  switchRanksSubtab(which) {
    const tabs = this.els['ranks-subtabs'];
    if (tabs) {
      tabs.querySelectorAll('.subtab').forEach((t) => {
        t.classList.toggle('active', t.dataset.subtab === which);
      });
    }
    const board = this.els['lb-board-view'] || this.els['lb-body'];
    const panel = this.els['friends-panel'];
    if (board) board.classList.toggle('hidden', which !== 'board');
    if (panel) panel.classList.toggle('hidden', which !== 'friends');
  },

  // ---------------- player inspect ----------------
  // Opens the full character sheet for any player (from the leaderboard or a
  // friend row). `meState` powers the "Compare with me" side-by-side view.
  async openInspect(username, meState, autoCompare = false) {
    if (!username) return;
    const h = this.handlers;
    if (h.onInspectLoading) h.onInspectLoading(true);
    try {
      const data = await h.onFetchInspect(username);
      if (!data) throw new Error('no data');
      this.showInspect(data, meState, autoCompare);
    } catch (e) {
      this.toast('Could not load that hero.', 'error');
    } finally {
      if (h.onInspectLoading) h.onInspectLoading(false);
    }
  },

  showInspect(d, meState, autoCompare = false) {
    const h = this.handlers;
    const raceEmoji = (d.race && d.race.emoji) || '❓';
    const clsLine = [d.playerClass && d.playerClass.emoji, d.playerClass && d.playerClass.name,
      d.spec && d.spec.emoji, d.spec && d.spec.name].filter(Boolean).join(' ');
    const tiles = [
      { icon: '⚔️', label: 'Power', val: formatNum(d.power) },
      { icon: '🌀', label: 'Raid Wave', val: String(d.bestRaidWave) },
      { icon: '💀', label: 'Kills', val: formatNum(d.kills) },
      { icon: '🏰', label: 'Stage', val: String(d.stage) },
    ].map((t) => `
      <div class="inspect-tile">
        <div class="inspect-tile-icon">${t.icon}</div>
        <div class="inspect-tile-label">${t.label}</div>
        <div class="inspect-tile-val">${esc(t.val)}</div>
      </div>`).join('');

    const gearHtml = (d.gear || []).map((g) => {
      if (!g.item) {
        return `<div class="inspect-gear empty"><span class="inspect-slot-name">${esc(g.slot)}</span><span class="muted small">— empty —</span></div>`;
      }
      const it = g.item;
      const statChips = Object.entries(it.stats || {}).slice(0, 4).map(([k, v]) =>
        `<span class="gear-stat">${STAT_EMOJI[k] || '•'}+${formatStatVal(k, v)}</span>`).join(' ');
      return `
        <div class="inspect-gear rarity-${esc(it.rarity)}">
          <span class="inspect-slot-name">${esc(g.slot)}</span>
          <b>${esc(it.name)}</b>
          ${it.enchant > 0 ? `<span class="enchant-tag">+${it.enchant}</span>` : ''}
          <span class="rarity-tag">${esc(it.rarity)}</span>
          <div class="gear-stats">${statChips}</div>
        </div>`;
    }).join('');

    const petHtml = (d.pets && d.pets.length)
      ? d.pets.map((p) => `<div class="inspect-pet"><span class="pet-emoji">${esc(p.emoji)}</span><span>${esc(p.name)}</span><span class="muted small">Lv ${p.level}</span></div>`).join('')
      : '<p class="muted small">No active pets.</p>';

    const statRows = d.stats ? Object.entries(Engine.STAT_LABELS).map(([k, label]) => {
      const v = d.stats[k];
      if (v == null) return '';
      return `<div class="inspect-stat-row"><span>${label}</span><b>${formatStatVal(k, v)}</b></div>`;
    }).join('') : '';

    const guildHtml = d.guild
      ? `<div class="inspect-guild">🏰 <b>${esc(d.guild.name)}</b> <span class="muted">[${esc(d.guild.tag)}]</span></div>`
      : `<div class="inspect-guild muted">No guild</div>`;

    const onlineHtml = d.online
      ? '<span class="online-dot on"></span> <span class="online-label on">Online</span>'
      : '<span class="online-dot"></span> <span class="online-label muted">Offline</span>';

    let friendBtn = '';
    if (d.relation === 'self') {
      friendBtn = '<button class="btn ghost" disabled>This is you</button>';
    } else if (d.relation === 'friends') {
      friendBtn = `<button class="btn ghost" data-inspect="unfriend" data-username="${esc(d.username)}">✓ Friends — Remove</button>`;
    } else if (d.relation === 'outgoing') {
      friendBtn = `<button class="btn ghost" data-inspect="unfriend" data-username="${esc(d.username)}">Request sent — Cancel</button>`;
    } else if (d.relation === 'incoming') {
      friendBtn = `<button class="btn gold" data-inspect="accept" data-username="${esc(d.username)}">Accept request</button>`;
    } else {
      friendBtn = `<button class="btn gold" data-inspect="add" data-username="${esc(d.username)}">➕ Add Friend</button>`;
    }

    const html = `
      <div class="inspect-sheet">
        <div class="inspect-head">
          <div class="inspect-avatar">${raceEmoji}</div>
          <div class="inspect-id">
            <div class="inspect-name">${this.nameHtml(d.username, d.relation === 'self' ? meState : d)}</div>
            <div class="inspect-lv">⚔️ Lv ${d.level}</div>
            <div class="inspect-class">${esc(clsLine || '—')}</div>
            ${d.title ? `<div class="inspect-title">👑 ${esc(d.title)}</div>` : ''}
            <div class="inspect-online">${onlineHtml}</div>
          </div>
        </div>
        <div class="inspect-tiles">${tiles}</div>
        ${guildHtml}
        <h4 class="inspect-h">🛡️ Equipped</h4>
        <div class="inspect-gear-list">${gearHtml}</div>
        <h4 class="inspect-h">📊 Stats</h4>
        <div class="inspect-stats">${statRows}</div>
        <h4 class="inspect-h">🐾 Pets</h4>
        <div class="inspect-pets">${petHtml}</div>
        <div class="inspect-compare hidden" id="inspect-compare"></div>
        <div class="inspect-actions">
          <button class="btn" data-inspect="compare">⚖️ Compare with me</button>
          ${friendBtn}
        </div>
      </div>`;

    const close = this.modal({
      title: '🔍 Player Inspect',
      html,
      buttons: [{ label: 'Close' }],
      wide: true,
    });

    // Wire the inspect-modal buttons (delegated on the overlay).
    const overlay = document.querySelector('#modal-root .modal-overlay:last-child');
    if (overlay) {
      overlay.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-inspect]');
        if (!btn || btn.disabled) return;
        const action = btn.dataset.inspect;
        const uname = btn.dataset.username || d.username;
        try {
          if (action === 'add' && h.onFriendAdd) {
            await h.onFriendAdd(uname);
            close(); this.openInspect(uname, meState, autoCompare);
          } else if (action === 'accept' && h.onFriendAccept) {
            await h.onFriendAccept(uname);
            close(); this.openInspect(uname, meState, autoCompare);
          } else if (action === 'unfriend' && h.onFriendRemove) {
            await h.onFriendRemove(uname, { confirm: false });
            close(); this.openInspect(uname, meState, autoCompare);
          } else if (action === 'compare') {
            this.renderCompare($('#inspect-compare'), d, meState);
          }
        } catch (err) {
          this.toast(err && err.message ? err.message : 'Action failed.', 'error');
        }
      });
      // "Quick compare" entry point opens the sheet with comparison expanded.
      if (autoCompare) this.renderCompare($('#inspect-compare'), d, meState);
    }
  },

  // Side-by-side stat comparison: you vs the inspected hero.
  renderCompare(box, them, meState) {
    if (!box) return;
    box.classList.remove('hidden');
    if (!meState) {
      box.innerHTML = '<p class="muted">Sign in to compare.</p>';
      return;
    }
    let mine;
    try { mine = Engine.computeStats(meState); } catch { mine = null; }
    if (!mine || !them.stats) {
      box.innerHTML = '<p class="muted">Stats unavailable.</p>';
      return;
    }
    const rows = [['power', 'Power', Math.round(mine.attack), them.power]];
    for (const [k, label] of Object.entries(Engine.STAT_LABELS)) {
      const mv = mine[k];
      const tv = them.stats[k];
      if (mv == null || tv == null) continue;
      rows.push([k, label, mv, tv]);
    }
    const fmt = (k, v) => (k === 'power' ? formatNum(v) : formatStatVal(k, v));
    const html = rows.map(([k, label, mv, tv]) => {
      const diff = Math.round((mv - tv) * 100) / 100;
      const cls = diff > 0 ? 'delta-up' : diff < 0 ? 'delta-down' : 'delta-even';
      const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
      const diffStr = (k === 'power' || ['attack', 'defense', 'maxHp'].includes(k))
        ? sign + formatNum(Math.abs(diff)) : sign + (Math.round(Math.abs(diff) * 10) / 10);
      return `
        <div class="compare-row">
          <span class="compare-label">${esc(label)}</span>
          <span class="compare-you">${fmt(k, mv)}</span>
          <span class="compare-them">${fmt(k, tv)}</span>
          <span class="compare-delta ${cls}">${diff === 0 ? '—' : diffStr}</span>
        </div>`;
    }).join('');
    box.innerHTML = `
      <h4 class="inspect-h">⚖️ You vs ${this.nameHtml(them.username, them)}</h4>
      <div class="compare-head compare-row">
        <span class="compare-label"></span><span class="compare-you"><b>You</b></span>
        <span class="compare-them"><b>${this.nameHtml(them.username, them)}</b></span><span class="compare-delta"></span>
      </div>${html}`;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  renderMore(state, user) {
    const role = (user && user.role) || 'player';
    this.role = role; // remembered for role-aware changelog filtering
    this._settingsState = state || null; // for the name-fx lock picker
    this._renderNameStylePickers(state); // refresh token-fx lock badges
    const canGM = role === 'owner' || role === 'gm' || role === 'admin' || role === 'moderator';
    this.els['gm-entry-card'].classList.toggle('hidden', !canGM);
    // Staff tab in the main nav: visible to staff only, opens the GM console.
    const staffBtn = document.getElementById('tabbtn-staff');
    if (staffBtn) staffBtn.classList.toggle('hidden', !canGM);
    this.els['profile-card'].innerHTML = `
      ${this.masteryCard(state)}
      ${this.professionsCard(state)}
      ${this.achievementsCard(state)}`;
    this.checkChangelogBadge();
    this.checkBalanceBadge();
  },

  // ---------------- stats tab ----------------
  renderStats(state, user) {
    const race = Engine.RACES[state.race] || {};
    const cls = Engine.CLASSES[state.playerClass] || {};
    const spec = Engine.SPECS[state.spec] || {};
    const role = (user && user.role) || 'player';
    const setCount = (state.inventory || []).filter(i => i.set).length;
    const badge = state.badge ? Engine.badgeDef(state.badge) : null;
    const countryOpts = `<option value="">— no flag —</option>` + Engine.COUNTRIES.map(c =>
      `<option value="${c.code}"${state.country === c.code ? ' selected' : ''}>${Engine.countryFlag(c.code)} ${esc(c.name)}</option>`).join('');
    this.els['stats-card'].innerHTML = `
      <div class="profile-head">
        <div class="profile-emoji">${race.emoji || '❓'}</div>
        <div>
          <div class="profile-name">${state.country ? Engine.countryFlag(state.country) + ' ' : ''}${badge ? badge.emoji + ' ' : ''}${this.nameHtml(user ? user.username : '—', state)}</div>
          <div class="profile-title-row">
            <div class="profile-title ${this.staffTitleCls(state.activeTitle) || (this.RAINBOW_TITLES.includes(state.activeTitle) ? 'title-rainbow' : 'title-glow')}">${esc(Engine.titleName(state.activeTitle))}</div>
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
      </div>`;
  },

  // ---------------- titles browser ----------------
  // Scrollable modal listing every title. Unlocked titles equip on tap via
  // the same onTitle code path as the profile chips; the modal closes after
  // the equip so the re-rendered profile shows the new active title.
  // ---------------- titles tab ----------------
  // Shared row builder: unlocked titles equip on tap, locked ones show hints.
  titleRowsHtml(state) {
    const s = state || {};
    const unlocked = new Set(s.titlesUnlocked || ['wanderer']);
    return Engine.TITLES.map(t => {
      const has = unlocked.has(t.id);
      const active = s.activeTitle === t.id;
      const rowCls = 'title-row' + (has ? ' unlocked' : ' locked') + (active ? ' active' : '');
      // Unlocked titles get a subtle gold glow; the 3 rarest cycle rainbow; staff tiers get their own animation.
      const glowCls = has ? (this.staffTitleCls(t.id) || (this.RAINBOW_TITLES.includes(t.id) ? 'title-rainbow' : 'title-glow')) : '';
      const nameHtml = (has && active ? '👑 ' : has ? '' : '🔒 ') + esc(t.name);
      return has
        ? `<button class="${rowCls}" data-id="${t.id}"><span class="title-row-name ${glowCls}">${nameHtml}</span><span class="title-row-desc">${esc(t.desc)}</span></button>`
        : `<div class="${rowCls}"><span class="title-row-name ${glowCls}">${nameHtml}</span><span class="title-row-desc">${esc(t.desc)}</span></div>`;
    }).join('');
  },

  renderTitles(state) {
    if (this.els['titles-list']) this.els['titles-list'].innerHTML = this.titleRowsHtml(state);
  },

  showTitlesModal(state) {
    const rows = this.titleRowsHtml(state);
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
    const badges = [this.els['changelog-badge'], this.els['changelog-badge-hud']].filter(Boolean);
    if (!badges.length) return;
    this.fetchChangelog()
      .then(log => {
        if (!Array.isArray(log) || !log.length) return;
        const latest = String(log[0].date || '');
        let seen = null;
        try { seen = localStorage.getItem('kop-changelog-seen'); } catch { /* ignore */ }
        badges.forEach(b => b.classList.toggle('hidden', !latest || seen === latest));
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
      title: '📰 Patch Notes',
      html: `<div class="cl-log">${html}</div>`,
      buttons: [{ label: 'Close', cls: 'gold' }],
    });
    try { localStorage.setItem('kop-changelog-seen', String(log[0].date || '')); } catch { /* ignore */ }
    ['changelog-badge', 'changelog-badge-hud'].forEach(id => {
      if (this.els[id]) this.els[id].classList.add('hidden');
    });
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
    const url = 'https://throne-of-shadows.onrender.com';
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
