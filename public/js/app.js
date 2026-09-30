// ============================================================
// app.js — boot, session flow, game loops, combat wiring.
// ============================================================
import { api } from './api.js?v=20260930s';
import * as Engine from './engine.js?v=20260930s';
import { UI, esc, formatNum } from './ui.js?v=20260930s';
import { Auth } from './auth.js?v=20260930s';
import { GM } from './gm.js?v=20260930s';

import { Raid } from './raid.js?v=20260930s';
import { renderGuildSection, syncGuildPerks } from './guild.js?v=20260930s';
import { loadGuest, saveGuest, clearGuest, GUEST_ROLE } from './guest.js?v=20260930s';
import { Audio } from './audio.js?v=20260930s';

const TICK_MS = 250;
const AUTOSAVE_MS = 15000;
const ENEMY_ATTACK_S = 2.0;
const RESPAWN_MS = 3000;

const App = {
  user: null,
  state: null,
  enemy: null,
  dead: false,
  respawnAt: 0,
  heroTimer: 0,
  enemyTimer: 0,
  companionTimers: {}, // companion id -> seconds accumulated
  healerTimers: {}, // healer companion id -> seconds since last mend
  skillCDs: {}, // per-skill cooldowns, keyed by skill id
  tapCombo: 0,
  lastTapAt: 0,
  frenzyUntil: 0,
  lastZone: null,
  lastBossModalStage: 0,
  lastDeathStage: 0,
  deathStreak: 0,
  saveTimer: null,
  tickTimer: null,
  statusTimer: null,
  maintenanceMode: false,
  started: false,
  inInn: false, // AFK safe zone: session-only, resets to battle on load
  _paused: false, // pause-while-browsing: world tick frozen, pill visible
  _pauseStartedAt: 0, // wall-clock ms when the current pause began (0 = not paused)
  meter: null, // live damage meter: { startAt, fighters: {key: {label, total, samples:[{t,total}]}} }
};

// ---------------- server gate (maintenance / deploy windows) ----------------
// Returns 'maintenance' (show the maintenance screen), 'ok', or
// 'unreachable' (server still down after retries — fall through to the
// normal flow, which will surface its own "could not reach" notice).
async function serverGate() {
  for (let i = 0; i < 6; i++) {
    try {
      const st = await api.status();
      return st && st.maintenance ? 'maintenance' : 'ok';
    } catch {
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  return 'unreachable';
}

function enterMaintenanceLoop() {
  const show = async () => {
    try {
      const st = await api.status();
      if (st && !st.maintenance) { location.reload(); return; } // back up — reboot cleanly
      UI.showMaintenance(st && st.message ? st.message : null);
    } catch {
      UI.showMaintenance(null); // still down — keep the screen up
    }
  };
  show();
  setInterval(show, 30000);
}

// While playing, poll for maintenance so a mid-session window shows a
// banner and pauses autosaves instead of failing silently.
async function pollMaintenance() {
  if (!App.state) return;
  try {
    const st = await api.status();
    if (st.maintenance && !App.maintenanceMode) {
      App.maintenanceMode = true;
      UI.setMaintenanceBanner(st.message || 'Server maintenance is starting — your progress is safe, saves paused.');
    } else if (!st.maintenance && App.maintenanceMode) {
      App.maintenanceMode = false;
      UI.setMaintenanceBanner(null);
      UI.toast('Maintenance complete — saves resumed.', 'success');
      saveNow();
    }
  } catch { /* unreachable — the save-failure toast already covers outages */ }
}

// ---------------- boot ----------------
async function boot() {
  // PWA: register the service worker if supported; a failure must never break the game.
  // update() forces the version check on every load so a stale SW can never
  // linger; the SW itself reloads tabs once when a new version activates.
  try {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => { try { reg.update(); } catch (e) {} })
          .catch(() => {});
      });
    }
  } catch (e) {}
  UI.handlers = {
    onTap: doTap,
    onSkill: (id) => useSkill(id),
    onClaimQuest: doClaimQuest,
    onEnchant: doEnchant,
    onMode: setMode,
    onRebirth: doRebirth,
    onEnterInn: enterInn,
    onLeaveInn: () => leaveInn(true),
    onEquip: doEquip,
    onSell: doSell,
    onMine: doMine,
    onPickaxeUpgrade: doPickaxeUpgrade,
    onForgeTier: doForgeTier,
    onForgeStat: doForgeStat,
    onForgeCraft: doForgeCraft,
    onGalaxyEquip: doGalaxyEquip,
    onGalaxyUnequip: doGalaxyUnequip,
    onUpgrade: doUpgrade,
    onRecruit: doRecruit,
    onDismiss: doDismiss,
    onLevelUpCompanion: doLevelUpCompanion,
    onMpCreate: doMpCreate,
    onMpJoin: doMpJoin,
    onMpLeave: doMpLeave,
    onMpKick: doMpKick,
    onMpDisband: doMpDisband,
    onMpCopy: doMpCopy,
    onMpRefresh: () => { loadMpParty(); },
    onHatchPet: doHatchPet,
    onFeedPet: doFeedPet,
    onSellPet: doSellPet,
    onSetActivePet: doSetActivePet,
    onSetSecondPet: doSetSecondPet,
    onRemoveSecondPet: doRemoveSecondPet,
    onBuyEgg: doBuyEgg,
    onBreedPets: doBreedPets,
    onCombinePets: doCombinePets,
    onBuyTokenItem: doBuyTokenItem,
    onBuyGear: doBuyGear,
    onGotoPetShop: doGotoPetShop,
    onRedeem: doRedeem,
    onLogout: doLogout,
    onOpenGM: () => GM.open(App.user),
    onTalent: doTalent,
    onProfession: doProfession,
    onSaveState: () => saveNow(),
    onExternalState: applyExternalState,
    onTab: onTabSwitch,
    onRanksCategory: () => { void loadRanks(); },
    // Social: inspect + friends
    onInspect: (username) => UI.openInspect(username, App.state),
    onInspectCompare: (username) => UI.openInspect(username, App.state, true),
    onFetchInspect: (username) => api.inspectPlayer(username),
    onRanksSubtab: (which) => {
      App.ranksSubtab = which;
      UI.switchRanksSubtab(which);
      if (which === 'friends') loadFriends();
    },
    onFriendSend: async (name) => {
      try {
        const r = await api.friendRequest(name);
        UI.toast(`Friend request sent to ${r.username}.`, 'success');
        document.querySelectorAll('.friend-input').forEach((i) => { i.value = ''; });
        loadFriends();
      } catch (e) { UI.toast(e.message || 'Request failed.', 'error'); }
    },
    // HUD 👥 button: open the friends modal and fill it with live data.
    onOpenFriends: async () => {
      if (isGuest()) { UI.showFriendsModal(null, true); return; }
      try {
        const data = await api.getFriends();
        App.friends = data;
        UI.showFriendsModal(data, false);
        UI.setFriendBadge((data.incoming || []).length);
      } catch (e) {
        UI.showFriendsModal({ friends: [], incoming: [], outgoing: [] }, false);
      }
    },
    onFriendAdd: async (username) => {
      const r = await api.friendRequest(username);
      UI.toast(`Friend request sent to ${r.username}.`, 'success');
      loadFriends();
    },
    onFriendAccept: async (username) => {
      try {
        await api.friendRespond(username, true);
        UI.toast(`You are now friends with ${username}.`, 'success');
        loadFriends();
      } catch (e) { UI.toast(e.message || 'Accept failed.', 'error'); }
    },
    onFriendDecline: async (username) => {
      try {
        await api.friendRespond(username, false);
        UI.toast('Request declined.', 'info');
        loadFriends();
      } catch (e) { UI.toast(e.message || 'Decline failed.', 'error'); }
    },
    onFriendRemove: async (username, opts) => {
      const skipConfirm = opts && opts.confirm === false;
      if (!skipConfirm) {
        const ok = await UI.confirm('Remove friend?', `Remove <b>${esc(username)}</b> from your friends?`);
        if (!ok) return;
      }
      await api.removeFriend(username);
      UI.toast('Removed from friends.', 'info');
      loadFriends();
    },
    onUpgradeAccount: () => promptUpgrade('Friends'),
    onUiStyle: setUiStyle,
    onBtnStyle: setBtnStyle,
    onBgStyle: setBgStyle,
    onBattleBg: setBattleBg,
    onNameColor: setNameColor,
    onNameFx: setNameFx,
    onEyeColor: setEyeColor,
    onOrbColors: setOrbColors,
    onOrbPalette: setOrbPalette,
    onSfx: setSfx,
    onMusic: setMusic,
    onMusicTrack: setMusicTrack,
    onFollowWorld: setFollowWorld,
    onNotifPref: (cat, val) => {
      const s = App.state;
      if (!s) return;
      if (!s.settings || typeof s.settings !== 'object') s.settings = {};
      if (!s.settings.notif || typeof s.settings.notif !== 'object') s.settings.notif = {};
      s.settings.notif[cat] = !!val;
      saveNow();
    },
    onShare: () => UI.shareGame(App.state, App.user),
    onChangelog: () => UI.openChangelog(),
    onTitle: (id) => {
      const s = App.state;
      if (!s || !(s.titlesUnlocked || []).includes(id)) return;
      s.activeTitle = id;
      if (UI.activeTab === 'titles') UI.renderTitles(s);
      else UI.renderMore(s, App.user);
      UI.toast(`👑 Title set: ${Engine.titleName(id)}`, 'success');
      saveNow();
    },
    onTitlesList: () => {
      if (App.state) UI.showTitlesModal(App.state);
    },
    onLbCategory: () => { loadRanks(); },
    onCountry: (code) => {
      const s = App.state;
      if (!s) return;
      const c = String(code || '').toUpperCase();
      s.country = c && Engine.isValidCountry(c) ? c : null;
      if (UI.activeTab === 'stats') UI.renderStats(s, App.user);
      else UI.renderMore(s, App.user);
      UI.toast(c && s.country ? `🌍 Flag set: ${Engine.countryFlag(c)}` : '🌍 Flag removed.', 'success');
      saveNow();
    },
  };
  UI.init();
  Audio.init(); // registers first-gesture unlock + button click ticks
  // Notification prefs live on the save; UI.notify() reads them through this.
  UI.setNotifPrefsProvider(() => (App.state && App.state.settings && App.state.settings.notif) || {});
  // Quest live-sync reads state through this (avoids a bare global).
  UI.setStateProvider(() => App.state);

  // Bind the auth form NOW, not after the server gate: the auth screen is
  // already visible from the static HTML, and a tap before the gate finishes
  // would natively submit the form (full page reload) instead of logging in.
  Auth.init({ onAuthed: (u) => enterApp(u), onGuest: (n) => enterGuest(n) });

  // Maintenance / reachability gate: check the server before anything else.
  // Retries briefly so a deploy/restart window shows as "updating", not dead.
  const gate = await serverGate();
  if (gate === 'maintenance') { enterMaintenanceLoop(); return; }

  let user = null;
  try {
    const res = await api.me();
    user = res.user;
  } catch (e) {
    if (e.status !== 401) UI.toast('Could not reach the server.', 'error');
  }

  // Someone may already have logged in (or entered as guest) while the gate
  // was running — don't yank them back to the auth screen or boot twice.
  if (App.user) return;

  if (!user) {
    showAuthView();
  } else {
    enterApp(user);
  }
}

// The auth screen: login/register tabs plus the guest entry point.
function showAuthView() {
  UI.showView('auth');
  Auth.init({ onAuthed: (u) => enterApp(u), onGuest: (n) => enterGuest(n) });
}

const isGuest = () => App.user && App.user.role === GUEST_ROLE;

// One-off persist used outside the autosave loop (character creation,
// settings that save immediately, migration points). Guests write to
// localStorage; authed players hit /api/state.
async function persistNow() {
  if (!App.state) return;
  if (isGuest()) { saveGuest(App.user.username, App.state); return; }
  await api.saveState(App.state);
}

// "This needs an account" prompt for server-gated features in guest mode.
function promptUpgrade(feature) {
  UI.modal({
    title: '🔐 ' + feature,
    html: `<p>Guests can't use ${esc(feature)} — it's tied to an account.</p>
           <p class="muted">Create a free account and your current guest progress comes with you.</p>`,
    buttons: [
      { label: 'Not now' },
      { label: '✨ Create account', cls: 'gold', onClick: (close) => { close(); openUpgradeModal(); } },
    ],
  });
}

// Character sheet: WoW-style paper-doll. Opened by tapping the hero panel.
function openCharacterSheet() {
  if (!App.state) return;
  UI.openCharacter(App.state, (App.user && App.user.username) || 'You');
}

// Guest → account migration: register, upload the local guest save to the
// new account, clear the guest blob, and reboot into the authed session.
async function openUpgradeModal() {
  if (!isGuest()) return;
  const errId = 'upgrade-err';
  UI.modal({
    title: '✨ Create account',
    html: `
      <p class="muted small">Your guest hero (<b>${esc(App.user.username)}</b>, Lv ${App.state ? App.state.level : 1}) moves to the new account.</p>
      <div class="auth-form">
        <input id="upgrade-username" placeholder="Username (3–20, letters/numbers/_)" maxlength="20" autocomplete="username">
        <input id="upgrade-password" type="password" placeholder="Password (min 8 chars)" autocomplete="new-password">
        <input id="upgrade-password2" type="password" placeholder="Confirm password" autocomplete="new-password">
      </div>
      <div id="${errId}" class="auth-error hidden"></div>`,
    buttons: [
      { label: 'Cancel' },
      {
        label: 'Create & keep progress', cls: 'gold',
        onClick: async (close) => {
          const errBox = document.getElementById(errId);
          const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };
          const username = document.getElementById('upgrade-username').value.trim();
          const password = document.getElementById('upgrade-password').value;
          const confirm = document.getElementById('upgrade-password2').value;
          if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return showErr('Username: 3–20 chars, letters/numbers/underscore.');
          if (password.length < 8) return showErr('Password must be at least 8 characters.');
          if (password !== confirm) return showErr('Passwords do not match.');
          try {
            await api.register(username, password); // sets the session cookie
            await api.saveState(App.state);         // upload guest progress
            clearGuest();
            close();
            UI.toast('✨ Account created — progress kept!', 'success');
            setTimeout(() => location.reload(), 800); // reboot into the authed session
          } catch (e) {
            showErr(e.message || 'Registration failed.');
          }
        },
      },
    ],
  });
}

// Re-entry guard: the auth form is bound before the server gate finishes, so
// a login submitted during the gate can overlap boot's own post-gate entry.
let _enterAppActive = false;
async function enterApp(user) {
  if (_enterAppActive) return;
  if (App.user && App.state && App.user.username === user.username) return;
  _enterAppActive = true;
  try {
    let raw, lastSeenAt;
    try {
      const res = await api.getState();
      raw = res.state; lastSeenAt = res.lastSeenAt;
    } catch (e) {
      showAuthView();
      UI.toast('Session expired — please log in again.', 'error');
      return;
    }
    await enterAppWithState(user, raw, lastSeenAt);
  } finally {
    _enterAppActive = false;
  }
}

// Guest entry: no server calls at all. State comes from localStorage
// (or starts fresh); the character-creation flow is shared with authed
// players via enterAppWithState.
async function enterGuest(name) {
  const g = loadGuest();
  const user = { username: name, role: GUEST_ROLE };
  await enterAppWithState(user, g ? g.state : null, g ? g.lastSeen : null);
}

async function enterAppWithState(user, raw, lastSeenAt) {
  App.user = user;

  // Server gold cap (owner-adjustable); failure keeps the built-in default.
  // Also picks up the active server event buff (double XP/gold weekends).
  try {
    const sj = await api.getSettings();
    if (sj && Number.isFinite(sj.goldCap)) Engine.setGoldCap(sj.goldCap);
    if (sj && sj.eventBuff) Engine.setEventBuff(sj.eventBuff);
    const __ev = Engine.eventBuff();
    if (__ev) {
      const ends = new Date(__ev.endsAt).toLocaleString();
      setTimeout(() => UI.toast(`🎉 ${__ev.label}: ${__ev.xpMult}x XP + ${__ev.goldMult}x gold until ${ends}`, 'success'), 2500);
    }
  } catch { /* offline-tolerant */ }

  let state = Engine.ensureState(raw);

  // First run: no race chosen yet → race picker, then class, then (Hunter) pet, then spec.
  if (!state.race) {
    UI.showView('race');
    UI.renderRaceSelect((race) => {
      UI.showView('class');
      UI.renderClassSelect((cls) => {
        const afterClass = async (petSpecies) => {
          UI.showView('spec');
          UI.renderSpecSelect(async (spec) => {
            const ns = Engine.defaultState(race);
            ns.playerClass = cls;
            ns.spec = spec;
            if (cls === 'hunter' && petSpecies) Engine.addStarterPet(ns, petSpecies);
            App.state = ns;
            try { await persistNow(); } catch { /* offline-tolerant */ }
            startGame();
          });
        };
        if (cls === 'hunter') {
          UI.showView('pet');
          UI.renderPetSelect((speciesId) => afterClass(speciesId));
        } else {
          afterClass(null);
        }
      });
    });
    return;
  }

  // Existing player missing class or spec: one-time mandatory choice.
  // Hunters with no pets yet also pick their starter companion here.
  if (!state.playerClass || !state.spec) {
    const needsPet = (state.pets && Array.isArray(state.pets.collection) && state.pets.collection.length === 0);
    UI.classSpecChoiceModal(async (cls, spec, petSpecies) => {
      if (!state.playerClass) state.playerClass = cls;
      if (!state.spec) state.spec = spec;
      if (cls === 'hunter' && petSpecies && state.pets.collection.length === 0) {
        Engine.addStarterPet(state, petSpecies);
      }
      App.state = state;
      try { await persistNow(); } catch { /* offline-tolerant */ }
      await continueBoot(state, lastSeenAt);
    }, { lockedClass: state.playerClass, needsPet });
    return;
  }

  App.state = state;
  await continueBoot(state, lastSeenAt);
}

// Everything after race/class selection: init raid, show the app,
// apply offline earnings, start the game loop.
async function continueBoot(state, lastSeenAt) {
  Raid.init(state);
  grantStaffTitles();
  UI.showView('app');
  // Guild perks: fetch once at boot for account players (no-op for guests
  // and guildless players). Fire-and-forget; the engine defaults to zero.
  if (!isGuest()) {
    try { syncGuildPerks(api); } catch { /* offline-tolerant */ }
  }

  // Offline earnings (lastSeenAt null on brand-new accounts).
  if (lastSeenAt) {
    const off = Engine.offlineEarnings(state, lastSeenAt, Date.now());
    if (off && (off.gold > 0 || off.xp > 0)) {
      const addedGold = Engine.addGold(state, off.gold);
      const xpRes = Engine.gainXp(state, off.xp);
      await saveNow();
      UI.offlineModal({ ...off, gold: addedGold, gains_xp: xpRes.gained }, xpRes.levels);
      // Well-rested: +25% XP for 30 minutes after returning.
      state.restedUntil = Date.now() + 30 * 60 * 1000;
      announceSkillUnlocks(xpRes.skills);
      await saveNow();
    }
  }

  startGame();
}

// Staff titles + name effects: unlock the tiers matching the account's staff
// role at boot (owner → owner+admin+gm, admin → admin+gm, gm → gm).
// Idempotent; the titles/effects themselves can never auto-unlock via
// checkTitles() or the token shop.
function grantStaffTitles() {
  const s = App.state;
  const role = App.user && App.user.role;
  if (!s || !role) return;
  const tiers = role === 'owner' ? ['owner', 'admin', 'gm']
    : role === 'admin' ? ['admin', 'gm']
    : role === 'gm' ? ['gm'] : [];
  if (!tiers.length) return;
  if (!Array.isArray(s.titlesUnlocked)) s.titlesUnlocked = ['wanderer'];
  let added = 0;
  for (const t of (Engine.STAFF_TITLES || [])) {
    if (tiers.includes(t.staffRole) && !s.titlesUnlocked.includes(t.id)) {
      s.titlesUnlocked.push(t.id);
      added++;
    }
  }
  const fx = Engine.ensureFxUnlocked(s);
  for (const f of (Engine.STAFF_NAME_FX || [])) {
    if (tiers.includes(f.staffRole) && !fx.includes(f.id)) {
      fx.push(f.id);
      added++;
    }
  }
  if (added && !isGuest()) { try { saveNow(); } catch { /* offline-tolerant */ } }
}

// ---------------- UI style theme ----------------
// engine.js is owned by another agent: never read/write uiStyle there.
// Normalize here: anything that isn't 'classic' is 'modern'.
function uiStyleOf(s) {
  return (s && s.uiStyle === 'classic') ? 'classic' : 'modern';
}
function applyUiStyle() {
  const style = uiStyleOf(App.state);
  document.body.dataset.uistyle = style;
  UI.setUiStyleSeg(style);
}
function setUiStyle(style) {
  const s = App.state;
  if (!s) return;
  s.uiStyle = style === 'classic' ? 'classic' : 'modern';
  applyUiStyle();
  saveNow();
}

// ---------------- custom button/background styles ----------------
// Cosmetic player preferences stored on the save (like uiStyle).
// Unknown values normalize to 'default', which renders pixel-identical
// to the uncustomized game.
const BTN_STYLE_IDS = ['default', 'ocean', 'crimson', 'emerald', 'gold', 'mono'];
const BG_STYLE_IDS = ['default', 'deepspace', 'crimson', 'emerald', 'midnight', 'shadow-eyes', 'orbs', 'ember-drift', 'void-tide', 'throne-storm', 'inferno-flare', 'cinder-storm', 'phoenix-ash', 'frostfall', 'starfall', 'bloodmoon', 'nightsky', 'sunset', 'woods', 'water', 'autumn-dusk', 'winter-night', 'hallows-eve', 'new-year', 'summer-tide', 'spring-bloom', 'class-hunter', 'class-warrior', 'class-mage', 'class-assassin', 'class-necromancer', 'class-berserker'];
function btnStyleOf(s) {
  return (s && BTN_STYLE_IDS.includes(s.btnStyle)) ? s.btnStyle : 'default';
}
function bgStyleOf(s) {
  return (s && BG_STYLE_IDS.includes(s.bgStyle)) ? s.bgStyle : 'default';
}
function bgSceneOpts(s) {
  const st = (s && s.settings) || {};
  return {
    eyeColor: st.eyeColor || 'violet',
    orbColors: (st.orbColors && st.orbColors.length === 3) ? st.orbColors : UI.DEFAULT_ORB_COLORS,
  };
}
function applyCustomStyles() {
  document.body.dataset.btnstyle = btnStyleOf(App.state);
  const bg = bgStyleOf(App.state);
  document.body.dataset.bgstyle = bg;
  // Photo-backed scenes (painted seasonal art, starfall, …) show through the
  // login screen: the canvas carries the painting, so the auth view's own
  // opaque gradient would just hide it. The auth card keeps its dark panel.
  const st = (UI.BG_STYLES || []).find((s) => s.id === bg);
  if (st && st.photo) document.body.dataset.bgphoto = '1';
  else delete document.body.dataset.bgphoto;
  UI.syncCustomStyles(btnStyleOf(App.state), bg);
  UI.syncBattleBg(battleBgOf(App.state));
  UI.syncNameStyle(nameColorOf(App.state), nameFxOf(App.state));
  UI.setBgScene(bg, bgSceneOpts(App.state));
  UI.renderBgAnimOpts(bg, App.state && App.state.settings);
}
function setEyeColor(id) {
  const s = App.state;
  if (!s) return;
  if (!s.settings || typeof s.settings !== 'object') s.settings = {};
  if (!UI.EYE_COLORS.some((c) => c.id === id)) return;
  s.settings.eyeColor = id;
  UI.setBgScene(bgStyleOf(s), bgSceneOpts(s));
  UI.renderBgAnimOpts(bgStyleOf(s), s.settings);
  saveNow();
}
function setOrbColors(colors) {
  const s = App.state;
  if (!s) return;
  if (!s.settings || typeof s.settings !== 'object') s.settings = {};
  const clean = (colors || []).slice(0, 3).map((c) => /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#a855f7');
  while (clean.length < 3) clean.push('#a855f7');
  s.settings.orbColors = clean;
  UI.setBgScene(bgStyleOf(s), bgSceneOpts(s));
  UI.renderBgAnimOpts(bgStyleOf(s), s.settings);
  saveNow();
}
function setOrbPalette(id) {
  const p = UI.ORB_PALETTES.find((x) => x.id === id);
  if (p) setOrbColors(p.colors);
}
function setBtnStyle(id) {
  const s = App.state;
  if (!s) return;
  s.btnStyle = BTN_STYLE_IDS.includes(id) ? id : 'default';
  applyCustomStyles();
  saveNow();
}
function setBgStyle(id) {
  const s = App.state;
  if (!s) return;
  s.bgStyle = BG_STYLE_IDS.includes(id) ? id : 'default';
  applyCustomStyles();
  saveNow();
}
// Battle background choice (state.battleBg): 'world' (realm's ambient scene,
// default), 'mystyle' (the background picked in Settings), or 'off' (plain
// dark, no animated scene). Sanitized like bgStyle; tampered values fall back.
const BATTLE_BG_IDS = ['world', 'mystyle', 'off'];
function battleBgOf(s) {
  return (s && BATTLE_BG_IDS.includes(s.battleBg)) ? s.battleBg : 'world';
}
function setBattleBg(id) {
  const s = App.state;
  if (!s) return;
  s.battleBg = BATTLE_BG_IDS.includes(id) ? id : 'world';
  UI.syncBattleBg(s.battleBg);
  saveNow();
}
// ---- player name styles (cosmetic; top-level on state like bgStyle) ----
const NAME_FX_IDS = Engine.ALL_NAME_FX_IDS;
const NAME_COLOR_DEFAULT = '#ffd76a';
function nameColorOf(s) {
  const c = s && s.nameColor;
  return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : NAME_COLOR_DEFAULT;
}
function nameFxOf(s) {
  const f = s && s.nameFx;
  return NAME_FX_IDS.includes(f) ? f : 'none';
}
function setNameColor(c) {
  const s = App.state;
  if (!s) return;
  s.nameColor = /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : NAME_COLOR_DEFAULT;
  UI.syncNameStyle(nameColorOf(s), nameFxOf(s));
  saveNow();
}
function setNameFx(fx) {
  const s = App.state;
  if (!s) return;
  if (!NAME_FX_IDS.includes(fx)) fx = 'none';
  // Token-exclusive effects must be bought in the Token Shop first.
  if (fx !== 'none' && Engine.TOKEN_NAME_FX.some(f => f.id === fx) && !Engine.fxIsUnlocked(s, fx)) {
    UI.toast('🔒 Buy this effect in the 🌀 Token Shop first!', 'warn');
    return;
  }
  // Staff-exclusive effects are granted automatically by staff role at boot.
  if (fx !== 'none' && Engine.STAFF_NAME_FX.some(f => f.id === fx) && !Engine.fxIsUnlocked(s, fx)) {
    UI.toast('🔒 Staff-only effect.', 'warn');
    return;
  }
  s.nameFx = fx;
  UI.syncNameStyle(nameColorOf(s), nameFxOf(s));
  saveNow();
}

// ---------------- audio prefs ----------------
// Cosmetic player preferences stored on the save (like btnStyle), so they
// persist to the server for authed players and to localStorage for guests.
// SFX defaults ON; music defaults OFF (opt-in).
function audioOf(s) {
  const a = s && s.audio;
  const track = (a && typeof a.track === 'string' && Audio.MUSIC_TRACKS.includes(a.track)) ? a.track : 'shadow-requiem';
  return {
    sfx: !a || a.sfx !== false,
    music: !!(a && a.music),
    track,
    followWorld: !a || a.followWorld !== false, // default ON: worlds pick the music
  };
}
function applyAudioPrefs() {
  const p = audioOf(App.state);
  Audio.sync(p);
  const sfxEl = document.getElementById('set-sfx');
  const musEl = document.getElementById('set-music');
  if (sfxEl) sfxEl.checked = p.sfx;
  if (musEl) musEl.checked = p.music;
  UI.syncMusicPrefs(p);
}
function setSfx(on) {
  const s = App.state;
  if (!s) return;
  s.audio = { ...audioOf(s), sfx: !!on };
  applyAudioPrefs();
  saveNow();
}
function setMusic(on) {
  const s = App.state;
  if (!s) return;
  s.audio = { ...audioOf(s), music: !!on };
  applyAudioPrefs();
  saveNow();
}
// Music track selection. Manual picks turn off world-follow so the player's
// choice sticks; the follow-world toggle can re-enable it.
function setMusicTrack(id) {
  const s = App.state;
  if (!s || !Audio.MUSIC_TRACKS.includes(id)) return;
  s.audio = { ...audioOf(s), track: id, followWorld: false };
  applyAudioPrefs();
  saveNow();
}
function setFollowWorld(on) {
  const s = App.state;
  if (!s) return;
  s.audio = { ...audioOf(s), followWorld: !!on };
  if (on) applyWorldMusic();
  applyAudioPrefs();
  saveNow();
}
// Worlds pick the music: Void Abyss and Throne of Shadows get the Void Hymn,
// earlier worlds keep the Shadow Requiem. Only when followWorld is on.
function applyWorldMusic() {
  const s = App.state;
  if (!s || audioOf(s).followWorld === false) return;
  const world = Engine.worldForStage(s.stage);
  const track = (world.id === 'void-abyss' || world.id === 'throne-of-shadows') ? 'void-hymn' : 'shadow-requiem';
  if (audioOf(s).track !== track) {
    s.audio = { ...audioOf(s), track };
    applyAudioPrefs();
  }
}

function startGame() {
  if (App.started) return;
  App.started = true;
  applyUiStyle();
  applyCustomStyles();
  applyAudioPrefs();
  // Guest chrome: upgrade card + exit label instead of logout.
  document.getElementById('guest-upgrade-card').classList.toggle('hidden', !isGuest());
  document.getElementById('logout-btn').textContent = isGuest() ? '🚪 Exit guest session' : 'Logout';
  const upBtn = document.getElementById('guest-upgrade-btn');
  if (upBtn) upBtn.addEventListener('click', openUpgradeModal);
  // Character sheet: tap the top hero panel (.hud-id) or the battle hero
  // panel (.hero-panel). Delegated so it survives HUD re-renders.
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.hud-id, .hero-panel')) openCharacterSheet();
  });
  UI.showView('app');
  spawnEnemy();
  UI.renderBattle(App.state);
  UI.renderGear(App.state);
  renderPartyTab();
  UI.renderMore(App.state, App.user);
  UI.updateHUD(App.state, App.user);
  UI.showTab('battle');

  App.tickTimer = setInterval(tick, TICK_MS);
  App.saveTimer = setInterval(() => saveNow(), AUTOSAVE_MS);
  App.statusTimer = setInterval(() => pollMaintenance(), 60000);
  pollBroadcast();
  App.broadcastTimer = setInterval(() => pollBroadcast(), 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow(true);
    // FPS/battery: pause ambient CSS animations while the tab is hidden.
    // Purely a resource saver — nothing is visible while hidden.
    document.body.classList.toggle('tab-hidden', document.visibilityState === 'hidden');
  });
  window.addEventListener('beforeunload', () => {
    if (App.state) saveNow(true); // guest-aware: local save for guests
  });
  window.addEventListener('pagehide', () => {
    if (App.state) saveNow(true); // guest-aware: local save for guests
  });
}

// ---------------- saving ----------------
let _saving = false;
async function saveNow(beaconOnly = false) {
  if (!App.state || _saving) return;
  // Stamp leaderboard "power" (hero attack) so /api/leaderboard can show it.
  try { App.state.power = Math.round(Engine.computeStats(App.state).attack); } catch { /* leave unset */ }
  if (isGuest()) {
    // Guests never touch the server: persist locally only.
    const ok = saveGuest(App.user.username, App.state);
    if (!beaconOnly) UI.setSaveIndicator(ok ? '● saved locally' : '● local save failed', ok);
    return;
  }
  if (beaconOnly) { api.saveStateBeacon(App.state); return; }
  if (App.maintenanceMode) { UI.setSaveIndicator('● paused'); return; } // maintenance: hold saves
  _saving = true;
  UI.setSaveIndicator('… saving');
  try {
    await api.saveState(App.state);
    UI.setSaveIndicator('● saved');
  } catch (e) {
    UI.setSaveIndicator('● save failed', false);
  } finally {
    _saving = false;
  }
}

// ---------------- combat ----------------
function spawnEnemy() {
  const s = App.state;
  // Raid mode spawns scaled waves instead of stage enemies.
  App.enemy = s.mode === 'raid'
    ? (Raid.isActive() ? Raid.spawnEnemy(s) : Raid.enter(s))
    : Engine.enemyFor(s.stage, Engine.computeStats(s));
  App.enemyTimer = 0;
  App.heroTimer = 0;
  App.companionTimers = {};
  App.healerTimers = {};
  // revive downed companions on a fresh enemy
  for (const c of s.party) if (c.hp <= 0) c.hp = c.maxHp;
  UI.setEnemy(App.enemy);
  // reset the live damage meter for this fight — but keep the last fight's
  // numbers around so one-tap kills show a real DPS instead of 0.
  if (App.meter) App.lastMeter = meterSnapshot();
  App.meter = { startAt: Date.now(), fighters: {} };
  // zone change toast
  const zone = Engine.zoneFor(s.stage);
  if (App.lastZone && App.lastZone !== zone.name) {
    UI.toast(`${zone.emoji} Entered ${zone.name}`, 'info');
  }
  App.lastZone = zone.name;
  // world change: announce the new world, its tagline, and follow its music
  const world = Engine.worldForStage(s.stage);
  if (App.lastWorld && App.lastWorld !== world.id) {
    UI.toast(`${world.emoji} Entered ${world.name} — ${world.tagline}`, 'info', 6000);
    UI.combatLog(`${world.emoji} Entered ${world.name} — ${world.tagline}`, 'zone');
  }
  App.lastWorld = world.id;
  applyWorldMusic();
  UI.updateHeroPanel(s, Engine.computeStats(s), App);
  if (App.enemy.boss && App.lastBossModalStage !== s.stage) {
    App.lastBossModalStage = s.stage;
    Audio.play('raidboss');
    UI.bossModal(App.enemy);
  }
}

// ---------------- damage meter ----------------
// Session-only per-fighter damage tracking. DPS is computed from a rolling
// 10-second window of cumulative-damage samples.
const METER_WINDOW_MS = 10000;

function meterHit(key, label, dmg) {
  if (!App.meter || !(dmg > 0)) return;
  const now = Date.now();
  let f = App.meter.fighters[key];
  if (!f) f = App.meter.fighters[key] = { label, total: 0, samples: [] };
  f.total += dmg;
  f.samples.push({ t: now, total: f.total });
  const cutoff = now - METER_WINDOW_MS;
  while (f.samples.length > 2 && f.samples[0].t < cutoff) f.samples.shift();
}

// Returns {rows: [{key,label,dps,total,pct}], totalDps} for the meter UI.
function meterSnapshot() {
  const m = App.meter;
  if (!m || !Object.keys(m.fighters).length) {
    // No samples yet (fresh fight, or a one-tap kill that ended before the
    // meter ticked) — show the last fight's DPS instead of an empty 0.
    if (App.lastMeter && App.lastMeter.rows && App.lastMeter.rows.length) {
      return { rows: App.lastMeter.rows, totalDps: App.lastMeter.totalDps, stale: true };
    }
    return { rows: [], totalDps: 0 };
  }
  const now = Date.now();
  const cutoff = now - METER_WINDOW_MS;
  const rows = [];
  let totalDps = 0;
  for (const [key, f] of Object.entries(m.fighters)) {
    const s = f.samples.filter(p => p.t >= cutoff);
    const oldest = s.length ? s[0] : { t: now, total: f.total };
    const newest = s.length ? s[s.length - 1] : { t: now, total: f.total };
    const secs = Math.max(0.5, (newest.t - oldest.t) / 1000);
    const dps = (newest.total - oldest.total) / secs;
    rows.push({ key, label: f.label, dps, total: f.total });
    totalDps += dps;
  }
  rows.sort((a, b) => b.dps - a.dps);
  const top = rows.length ? rows[0].dps : 0;
  for (const r of rows) r.pct = top > 0 ? (r.dps / top) * 100 : 0;
  return { rows, totalDps };
}

function heroStrike(stats, mult = 1) {
  const { dmg, crit } = Engine.playerAttack(stats, App.enemy);
  const final = Math.max(1, Math.round(dmg * mult));
  meterHit('hero', (App.user && App.user.username) || 'You', final);
  damageEnemy(final, crit ? 'CRIT ' : '', 'hero');
  // lifesteal
  if (stats.lifesteal > 0 && !App.dead) {
    const heal = final * (stats.lifesteal / 100);
    const s = App.state;
    s.hero.hp = Math.min(stats.maxHp, s.hero.hp + heal);
  }
}

function companionStrike(c) {
  const cs = Engine.companionStats(c);
  const { dmg, crit } = Engine.playerAttack(cs, App.enemy);
  const final = Math.max(1, Math.round(dmg * (cs.damageMult || 1)));
  meterHit(c.id, c.name, final);
  damageEnemy(final, crit ? 'CRIT ' : '', c.emoji + ' ');
}

// Active pet strikes (every 4s from the combat tick). Hunger-gated: a
// starving pet sits out. Damage never outshines the hero.
function petStrike(stats) {
  if (App.dead || !App.enemy || App.spawnPending) return;
  const dmg = Engine.petStrikeDamage(App.state, stats);
  if (dmg <= 0) return;
  const pets = Engine.activePets(App.state);
  const label = pets.length
    ? pets.map(pt => { const s2 = Engine.petSpeciesOf(pt); return (s2 ? s2.emoji : '🐾') + ' ' + (s2 ? s2.name : 'Pet'); }).join(' + ')
    : '🐾 Pet';
  meterHit('pet', label, dmg);
  damageEnemy(dmg, '', pets.map(pt => { const s2 = Engine.petSpeciesOf(pt); return s2 ? s2.emoji : '🐾'; }).join('') + ' ');
}

function damageEnemy(dmg, prefix, sourceLabel) {
  const enemy = App.enemy;
  if (!enemy || App.dead || App.spawnPending) return;
  enemy.hp -= dmg;
  UI.enemyHitFlash();
  const isCrit = String(prefix).includes('CRIT');
  UI.floatText(`${prefix}${formatNum(dmg)}`, isCrit ? 'crit' : 'dmg', dmg);
  if (enemy.hp <= 0) onKillEnemy();
}

// Spawns the next enemy, delaying briefly when the modern death animation
// is playing so the fade-out stays visible. App.spawnPending guards the
// damage pipeline against double-kills during the window.
function spawnNextEnemy() {
  if (UI.enemyDeathFade()) {
    App.spawnPending = true;
    setTimeout(() => {
      App.spawnPending = false;
      if (!App.dead) spawnEnemy();
    }, 300);
  } else {
    spawnEnemy();
  }
}

function onKillEnemy() {
  if (App.spawnPending) return; // already processing a kill
  const s = App.state;
  const enemy = App.enemy;
  const stage = enemy.stage;
  const stats = Engine.computeStats(s);

  // Raid: each kill advances the wave instead of the stage, with a gold bonus.
  const inRaid = Raid.isActive();
  const raidLoot = inRaid ? Raid.onKill(s) : null;

  const pb = partyBonus();
  let gold = Engine.goldForKill(stage, stats.goldBonus + (stats.talentGoldPct || 0) + pb.goldPct);
  gold = Math.floor(gold * Engine.eventGoldMult());
  if (raidLoot) gold = Math.floor(gold * raidLoot.goldMult);
  const addedGold = Engine.addGold(s, gold);
  Audio.play('coin');
  const cappedNote = addedGold < gold ? ' · gold cap' : '';
  s.stats.kills += 1;
  // Kill streak: +1 per kill, boosts loot drop chance; resets on defeat.
  s.streak = (s.streak || 0) + 1;
  const streakBonus = Engine.streakDropBonus(s.streak);
  // Radiant enemies: guaranteed loot + triple gold.
  const radiant = !!enemy.radiant;
  if (radiant) {
    const rGold = Math.floor(gold * 2);
    Engine.addGold(s, rGold);
    UI.combatLog(`🌟 Radiant ${enemy.name} slain! Bonus +${formatNum(rGold)} gold!`, 'loot');
  }
  const isDungeonBoss = enemy.boss && s.mode === 'dungeon';
  const isRaidBoss = inRaid && raidLoot && raidLoot.boss;
  if (enemy.boss) {
    s.bossesKilled += 1;
    s.stars += 1; // bosses grant a star
    UI.combatLog(`👹 Boss slain! +${formatNum(addedGold)} gold${cappedNote}, +1 ⭐`, 'boss');
    UI.toast(`Boss slain! +${formatNum(addedGold)} gold${cappedNote}, +1 ⭐`, 'success');
  }
  const killXp = Math.floor(Engine.xpForKill(stage) * Engine.eventXpMult());
  const xpRes = Engine.gainXp(s, killXp, Date.now(), pb.xpPct);
  // The active pet earns 15% of the kill's XP.
  const petXpRes = Engine.gainPetXp(s, Math.floor(killXp * 0.15));
  for (const g of petXpRes.gains) {
    for (const lv of g.levels) {
      UI.notify('level', `🐾 ${g.name} reached level ${lv}!`, 'success');
      UI.combatLog(`🐾 ${g.name} leveled up to ${lv}!`, 'level');
    }
  }
  const loot = Engine.rollLoot(stage, enemy.boss, raidLoot ? raidLoot.lootTier : null,
    { bonusChance: streakBonus, guaranteed: radiant, classId: s.playerClass });
  if (loot) {
    s.inventory.push(loot);
    const tag = radiant ? '🌟 Radiant loot' : '🎒 Loot';
    UI.notify('loot', `${tag}: ${loot.name}`, 'loot');
    UI.combatLog(`${tag} ${loot.name} (${loot.rarity})`, 'loot');
    if (UI.activeTab === 'gear') UI.renderGear(s);
  }
  // Earnable set pieces (drop sources documented on Engine.PLAYER_SETS).
  const setDrop = Engine.rollSetDrop(stage, { boss: enemy.boss, dungeonBoss: isDungeonBoss, raidBoss: isRaidBoss });
  if (setDrop) {
    s.inventory.push(setDrop);
    UI.notify('loot', `🔥 Set piece: ${setDrop.name}!`, 'loot');
    UI.combatLog(`🔥 Looted ${setDrop.name} (${setDrop.setName})`, 'loot');
    if (UI.activeTab === 'gear') UI.renderGear(s);
  }
  // Pet eggs from bosses (drop sources documented on Engine.rollPetEgg).
  if (Engine.rollPetEgg({ boss: enemy.boss, dungeonBoss: isDungeonBoss, raidBoss: isRaidBoss })) {
    Engine.ensurePets(s).eggs += 1;
    UI.notify('loot', '🥚 A pet egg dropped! Hatch it in 🐾 Pets.', 'loot');
    UI.combatLog('🥚 A pet egg dropped!', 'loot');
    if (UI.activeTab === 'pets') UI.renderPetsTab(s);
  }
  if (xpRes.levels.length) {
    UI.levelUpModal(xpRes.levels);
    UI.combatLog(`⬆️ Level ${xpRes.levels[xpRes.levels.length - 1]}!`, 'level');
    const mp = xpRes.levels.filter(l => l % 10 === 0).length;
    if (mp > 0) {
      UI.notify('level', `🧠 +${mp} Mastery point${mp > 1 ? 's' : ''}! Spend in Settings → Mastery.`, 'success');
      if (UI.activeTab === 'settings') UI.renderMore(s, App.user);
    }
  }
  announceSkillUnlocks(xpRes.skills);
  checkAch();

  if (inRaid) {
    // Raid: stay on the same stage, spawn the next wave.
    UI.combatLog(`🌀 Wave ${raidLoot.wave} cleared!${raidLoot.boss ? ' Boss down!' : ''}`, raidLoot.boss ? 'boss' : 'info');
    spawnNextEnemy();
    UI.updateHUD(s, App.user);
    return;
  }
  s.stage += 1;
  spawnNextEnemy();
  UI.updateHUD(s, App.user);
  // rebirth unlock may have appeared
  if (s.level >= Engine.MAX_LEVEL) UI.renderBattle(s);
}

function enemyStrikeTick(stats) {
  const s = App.state;
  const enemy = App.enemy;
  if (!enemy || App.dead || App.spawnPending) return;
  // pick target: hero, or random alive fighter in dungeon mode
  let target = { kind: 'hero' };
  if (s.mode === 'dungeon') {
    const alive = s.party.filter(c => c.hp > 0);
    const pool = ['hero', ...alive.map(c => c.id)];
    const pickId = pool[Math.floor(Math.random() * pool.length)];
    target = pickId === 'hero' ? { kind: 'hero' } : { kind: 'comp', c: s.party.find(c => c.id === pickId) };
  }
  const tStats = target.kind === 'hero' ? stats : Engine.companionStats(target.c);
  const res = Engine.enemyStrike(tStats, enemy.attack);
  const tName = target.kind === 'hero' ? 'You' : target.c.name;

  if (res.dodged) {
    UI.floatText('DODGE', 'dodge');
    return;
  }
  if (res.parried) {
    UI.floatText('PARRY', 'parry');
    UI.combatLog(`🛡️ ${tName} parried and countered!`);
    meterHit('hero', (App.user && App.user.username) || 'You', res.counter);
    damageEnemy(res.counter, '', 'counter');
    return;
  }
  if (res.dmg <= 0) return;
  // Role-based toughness: companions take scaled damage (tanks shrug off
  // far more than DPS). Applied after dodge/parry, before HP subtraction.
  let finalDmg = res.dmg;
  if (target.kind !== 'hero' && tStats.damageTakenMult) {
    finalDmg = Math.max(1, Math.round(res.dmg * tStats.damageTakenMult));
  }
  if (target.kind === 'hero') {
    s.hero.hp -= finalDmg;
    UI.floatText(`-${formatNum(finalDmg)}`, 'hurt');
    if (s.hero.hp <= 0) { s.hero.hp = 0; onDefeat(); }
  } else {
    target.c.hp -= finalDmg;
    UI.combatLog(`💔 ${target.c.name} took ${formatNum(finalDmg)}.`);
    if (target.c.hp <= 0) {
      target.c.hp = 0;
      UI.notify('death', `${target.c.emoji} ${target.c.name} is down!`, 'error');
    }
  }
}

function onDefeat() {
  const s = App.state;
  App.dead = true;
  App.respawnAt = Date.now() + RESPAWN_MS;
  // Death breaks the kill streak.
  if (s.streak >= 25) UI.toast(`💔 Kill streak of ${s.streak} ended!`, 'info');
  s.streak = 0;
  const lost = Math.floor(s.gold * 0.02);
  if (!s.infGold) s.gold -= lost; // infinite-gold perk: death takes nothing
  // Raid: death ends the run (loot kept); drop back to clicker mode.
  if (Raid.isActive()) {
    const res = Raid.onDeath(s);
    Raid.exit();
    s.mode = 'clicker';
    UI.setMode('clicker');
    UI.setDead(true);
    UI.combatLog(`🌀 Raid run ended at wave ${res.wavesCleared} — best ${res.best}. Lost ${formatNum(lost)} gold. Reviving…`, 'death');
    UI.toast(`🌀 Raid ended at wave ${res.wavesCleared} (best ${res.best})!`, 'info');
    saveNow();
    return;
  }
  // Mercy rule: dying 3x in a row to the same boss retreats you 5 stages,
  // so a wall becomes a farming trip instead of an endless death loop.
  if (App.enemy && App.enemy.boss) {
    if (App.lastDeathStage === s.stage) App.deathStreak += 1;
    else { App.lastDeathStage = s.stage; App.deathStreak = 1; }
    if (App.deathStreak >= 3) {
      App.deathStreak = 0;
      s.stage = Math.max(1, s.stage - 5);
      UI.toast(`💨 Overwhelmed! You retreat to stage ${s.stage} to grow stronger.`, 'info');
      UI.combatLog(`💨 Overwhelmed by the boss — retreated to stage ${s.stage}.`, 'death');
      saveNow();
    }
  } else {
    App.deathStreak = 0;
  }
  UI.setDead(true);
  UI.combatLog(`💀 You fell! Lost ${formatNum(lost)} gold. Reviving…`, 'death');
  UI.notify('death', `You fell! −${formatNum(lost)} gold. Reviving…`, 'error');
}

function respawn() {
  const s = App.state;
  const stats = Engine.computeStats(s);
  App.dead = false;
  s.hero.hp = stats.maxHp;
  for (const c of s.party) c.hp = c.maxHp;
  UI.setDead(false);
  spawnEnemy();
  UI.updateHUD(s, App.user);
}

// ---------------- pause-while-browsing ----------------
// Real-time combat must never punish the player for reading a menu.
// The world freezes whenever the player is NOT actively watching the
// battle tab: browsing the gear shop / settings / party / etc., any
// full-screen modal (boss intro, changelog, confirms), the GM console,
// or resting at the Shadowed Hearth (inn tab — its own branch in tick()
// keeps the 2%/s rest-heal running while everything else stays frozen).
function computePaused() {
  if (!App.started) return false;
  const appView = document.getElementById('view-app');
  if (!appView || appView.classList.contains('hidden')) return true;
  if (UI.anyModalOpen()) return true;
  return UI.activeTab !== 'battle';
}

// Runs at the top of every tick; acts only on transitions so the pill and
// wall-clock timers stay in sync. While paused, tick() returns before ANY
// world system advances: no play-time, no regen, no mine trickle, no
// hero/companion/pet strikes, no hunger decay, no enemy attacks, and the
// death-respawn timer holds still.
function updatePauseState() {
  let paused = false;
  try {
    paused = computePaused();
  } catch { paused = App._paused; }
  if (paused === App._paused) return;
  const now = Date.now();
  if (paused) {
    App._pauseStartedAt = now;
  } else if (App._pauseStartedAt) {
    // Resume: shift wall-clock timers forward by the frozen duration so a
    // pause neither grants nor steals time — frenzy, skill cooldowns, the
    // respawn timer, and the tap-combo window all freeze equally.
    const d = now - App._pauseStartedAt;
    if (d > 0) {
      if (App.frenzyUntil > App._pauseStartedAt) App.frenzyUntil += d;
      for (const k of Object.keys(App.skillCDs || {})) {
        if (App.skillCDs[k] > App._pauseStartedAt) App.skillCDs[k] += d;
      }
      if (App.respawnAt > App._pauseStartedAt) App.respawnAt += d;
      if (App.lastTapAt) App.lastTapAt += d;
    }
    App._pauseStartedAt = 0;
  }
  App._paused = paused;
  try { UI.setPaused(paused); } catch { /* pill is cosmetic */ }
}

// ---------------- main tick ----------------
function tick() {
  const s = App.state;
  if (!s || !App.enemy) return;
  updatePauseState();

  // Browsing a menu (or a modal on top of battle): the world is frozen —
  // nothing below advances. The inn branch above is the one exception:
  // the Hearth pauses combat but keeps its rest-heal.
  if (App._paused && !App.inInn) return;

  const dt = TICK_MS / 1000;
  s.stats.playTimeSec += dt;

  if (App.dead) {
    if (Date.now() >= App.respawnAt) respawn();
    return;
  }

  // Inn (AFK safe zone): combat is fully suspended — no damage in or out,
  // no enemy progression — and the hero regenerates 2% max HP per second.
  if (App.inInn) {
    const stats = Engine.computeStats(s);
    s.hero.hp = Engine.innRegen(s.hero.hp, stats.maxHp, dt);
    UI.renderInn(s, stats);
    UI.updateHUD(s, App.user);
    return;
  }

  const stats = Engine.computeStats(s);

  // Mining trickle: a slow passive ore drip while the game runs (~1/30s).
  App.mineTrickle = (App.mineTrickle || 0) + dt;
  if (App.mineTrickle >= 30) {
    App.mineTrickle = 0;
    Engine.trickleOre(s);
    if (UI.activeTab === 'mine') UI.renderMine(s);
  }

  // regen
  if (stats.regen > 0 && s.hero.hp < stats.maxHp) {
    s.hero.hp = Math.min(stats.maxHp, s.hero.hp + stats.regen * dt);
  }
  for (const c of s.party) {
    if (c.hp > 0 && c.hp < c.maxHp && c.regen > 0) c.hp = Math.min(c.maxHp, c.hp + c.regen * dt);
  }

  // hero attacks: full rate in auto/dungeon, 35% idle rate in clicker mode
  // (taps remain the main damage there, boosted by combo + frenzy).
  {
    App.heroTimer += dt * (s.mode === 'clicker' ? 0.35 : 1);
    const iv = 1 / Math.max(0.2, stats.attackSpeed);
    let guard = 0;
    while (App.heroTimer >= iv && guard++ < 10) {
      App.heroTimer -= iv;
      heroStrike(stats);
      if (App.dead || !App.enemy) break;
    }
  }

  // companions attack in dungeon mode; healer-role allies also mend the PLAYER
  if (s.mode === 'dungeon') {
    for (const c of s.party) {
      if (c.hp <= 0 || App.dead) continue;
      App.companionTimers[c.id] = (App.companionTimers[c.id] || 0) + dt;
      const iv = 1 / 1.2;
      let guard = 0;
      while (App.companionTimers[c.id] >= iv && guard++ < 10) {
        App.companionTimers[c.id] -= iv;
        companionStrike(c);
        if (App.dead || !App.enemy) break;
      }
      // Healer mend: every HEALER_MEND_SEC, restore player HP (tick owns the
      // cooldown; Engine.applyHealerMend does the math).
      const roleKind = c.roleKind || Engine.companionRole(c);
      if (roleKind === 'healer' && s.hero.hp < stats.maxHp) {
        App.healerTimers[c.id] = (App.healerTimers[c.id] || 0) + dt;
        if (App.healerTimers[c.id] >= Engine.HEALER_MEND_SEC) {
          App.healerTimers[c.id] = 0;
          const healed = Engine.applyHealerMend(s, c, stats.maxHp);
          if (healed > 0) {
            UI.floatText(`+${formatNum(healed)}`, 'heal');
            UI.combatLog(`💚 ${c.name} mended you for ${formatNum(healed)} HP.`);
          }
        }
      }
    }
  }

  // The active pet strikes every 4s in every combat mode (hunger-gated).
  App.petTimer = (App.petTimer || 0) + dt;
  if (App.petTimer >= Engine.PET_STRIKE_SEC) {
    App.petTimer = 0;
    petStrike(stats);
  }

  // Pet hunger decays with play time (-1 per 5 min).
  App.petHungerAcc = (App.petHungerAcc || 0) + dt;
  if (App.petHungerAcc >= Engine.PET_HUNGER_DECAY_SEC) {
    App.petHungerAcc = 0;
    Engine.decayPetHunger(s, 1);
  }

  // enemy counter-attacks
  App.enemyTimer += dt;
  if (App.enemyTimer >= ENEMY_ATTACK_S) {
    App.enemyTimer = 0;
    if (!App.dead) enemyStrikeTick(stats);
  }

  UI.updateBattle(s, stats, { enemy: App.enemy, user: App.user, skillCDs: App.skillCDs });
  // keep chips / hero panel fresh at low frequency
  if (!tick._n) tick._n = 0;
  if (++tick._n % 8 === 0) {
    UI.updateHeroPanel(s, stats, App);
    UI.refreshPartyBars(s);
  }
  // live damage meter, every 1s
  if (tick._n % 4 === 0) UI.renderMeter(meterSnapshot());
}

// ---------------- player actions ----------------
function doTap() {
  const s = App.state;
  if (!s || App.dead || App._paused || s.mode !== 'clicker') return;
  const now = Date.now();
  // Combo: taps within the combo window keep it alive.
  if (now - App.lastTapAt < Engine.COMBO_WINDOW_MS) App.tapCombo += 1;
  else App.tapCombo = 1;
  App.lastTapAt = now;
  if (App.tapCombo > (s.stats.maxCombo || 0)) s.stats.maxCombo = App.tapCombo;
  if (App.tapCombo === Engine.FRENZY_COMBO) {
    App.frenzyUntil = now + Engine.FRENZY_MS;
    UI.toast('⚡ FRENZY! Double tap damage for 10s!', 'success');
  }
  const frenzy = now < App.frenzyUntil;
  s.stats.taps += 1;
  heroStrike(Engine.computeStats(s), Engine.tapDamageMult(s, App.tapCombo, frenzy));
  UI.updateCombo(App.tapCombo, frenzy, App.frenzyUntil - now);
  checkAch();
}

// Unlock check helper: toasts + logs newly earned achievements and titles.
function checkAch() {
  const s = App.state;
  if (!s) return;
  const fresh = Engine.checkAchievements(s);
  for (const a of fresh) {
    UI.toast(`🏆 ${a.name}! +${a.stars} ⭐`, 'success');
    UI.combatLog(`🏆 Achievement: ${a.name} (+${a.stars} ⭐)`, 'level');
  }
  const freshTitles = Engine.checkTitles(s);
  for (const t of freshTitles) {
    UI.titleToast(t.name);
    UI.combatLog(`👑 Title unlocked: ${t.name}`, 'level');
  }
  if (fresh.length || freshTitles.length) {
    Audio.play('claim');
    if (UI.activeTab === 'settings') UI.renderMore(s, App.user);
    UI.updateHUD(s, App.user);
    saveNow();
  }
}

// Toast newly unlocked active skills and refresh the battle skill row.
function announceSkillUnlocks(skillIds) {
  if (!skillIds || !skillIds.length) return;
  for (const id of skillIds) {
    const def = Engine.SKILLS[id];
    if (!def) continue;
    UI.notify('level', `${def.emoji} New skill unlocked: ${def.name}! (${def.desc})`, 'success');
    UI.combatLog(`${def.emoji} Skill unlocked: ${def.name} — ${def.desc}`, 'level');
  }
  if (UI.activeTab === 'battle') UI.renderSkillRow(App.state);
}

function doClaimQuest(period, id) {
  const s = App.state;
  if (!s) return;
  const res = Engine.claimQuest(s, period, id);
  if (!res || !res.ok) return;
  UI.notify('quest', `📜 Quest complete! +💰${formatNum(res.rewards.gold)} +⭐${res.rewards.stars} +✨${formatNum(res.rewards.xp)} XP`, 'success');
  UI.renderQuests(s);
  UI.updateHUD(s, App.user);
  if (res.levels && res.levels.length) UI.levelUpModal(res.levels);
  announceSkillUnlocks(res.skills);
  saveNow();
}

function doEnchant(id) {
  const s = App.state;
  if (!s) return;
  const item = (s.inventory || []).find((i) => i.id === id);
  if (!item) return;
  const lvl = Engine.enchantLevel(item);
  if (lvl >= Engine.ENCHANT_MAX) return;
  const cost = Engine.enchantCost(item);
  if ((s.gold || 0) < cost) {
    UI.toast('Not enough gold to enchant.', 'error');
    return;
  }
  s.gold -= cost;
  item.enchant = lvl + 1;
  UI.toast(`⬆️ ${item.name} is now +${item.enchant}! Stats ×${(1 + Engine.ENCHANT_PCT * item.enchant).toFixed(2)}`, 'success');
  UI.renderGear(s);
  UI.updateHUD(s, App.user);
  saveNow();
}

function useSkill(id) {
  const s = App.state;
  const def = Engine.SKILLS[id];
  if (!s || App.dead || App._paused || !def || !(s.skills || []).includes(id)) return;
  const now = Date.now();
  if (now < (App.skillCDs[id] || 0)) return;
  App.skillCDs[id] = now + def.cdMs;
  s.stats.taps += 1;
  // Skill mastery: track the cast, apply +2% effectiveness per mastery level.
  const mast = Engine.recordSkillUse(s, id) || { level: 0, leveledUp: false };
  const mMult = 1 + mast.level * Engine.MASTERY_PCT_PER_LEVEL;
  if (mast.leveledUp) {
    UI.toast(`🎯 ${def.name} Mastery ${mast.level}! +${Math.round(mast.level * Engine.MASTERY_PCT_PER_LEVEL * 100)}% effectiveness`, 'success');
  }
  const stats = Engine.computeStats(s);
  if (id === 'heal') {
    const amount = Math.round(stats.maxHp * (def.healPct / 100) * mMult);
    s.hero.hp = Math.min(stats.maxHp, s.hero.hp + amount);
    UI.floatText(`+${formatNum(amount)}`, 'heal');
    UI.combatLog(`💚 Heal restored ${formatNum(amount)} HP.`, 'heal');
  } else {
    let mult = (def.mult || 1) * mMult;
    if (id === 'execute' && App.enemy && App.enemy.maxHp > 0) {
      const frac = App.enemy.hp / App.enemy.maxHp;
      mult = frac < def.threshold ? def.mult : def.executeMult;
      UI.combatLog(frac < def.threshold
        ? `⚔️ Execute! ${def.mult}× damage on the weakened foe.`
        : `⚔️ Execute glanced (${def.executeMult}×) — target above ${Math.round(def.threshold * 100)}% HP.`, 'skill');
    }
    UI.floatText(def.name.toUpperCase(), 'skill');
    heroStrike(stats, mult);
  }
}

function setMode(mode) {
  const s = App.state;
  if (!s || s.mode === mode) { UI.setMode(mode); return; }
  const wasRaid = s.mode === 'raid';
  if (wasRaid) Raid.exit();
  s.mode = mode;
  App.heroTimer = 0;
  App.companionTimers = {};
  App.healerTimers = {};
  UI.setMode(mode);
  UI.renderBattle(s);
  UI.updateHeroPanel(s, Engine.computeStats(s), App);
  UI.toast({ clicker: '👆 Clicker mode — tap to attack!', auto: '🤖 Auto mode — your hero fights alone.', dungeon: '🏰 Dungeon mode — party fights with you!', raid: '🌀 Raid mode — endless waves! Death ends the run.' }[mode] || mode);
  // Entering or leaving raid needs a fresh enemy (waves vs stage enemies).
  if (mode === 'raid' || wasRaid) spawnEnemy();
  saveNow();
}

// ---------------- Inn (AFK safe zone) ----------------
// Session-only: entering suspends all combat (no damage in or out, no
// enemy progression) and regenerates HP; leaving resumes the fight.
// On game load the player always starts back at battle (safe default).
function enterInn() {
  const s = App.state;
  if (!s || App.inInn) return;
  App.inInn = true;
  UI.showTab('inn');
  UI.startInnGlow();
  try { Audio.startInnAmbience(); } catch { /* audio is optional */ }
  UI.renderInn(s, Engine.computeStats(s));
  UI.toast('🏠 You rest at the inn — safe from harm.', 'success');
}

function leaveInn(toBattle) {
  if (!App.inInn) return;
  App.inInn = false;
  try { Audio.stopInnAmbience(); } catch { /* ignore */ }
  UI.stopInnGlow();
  if (toBattle) {
    UI.showTab('battle');
    UI.toast('⚔️ Back to the fight!', 'info');
  }
}

function doEquip(id) {
  const s = App.state;
  if (Engine.equipItem(s, id)) {
    UI.renderGear(s);
    UI.toast('Equipped.', 'success');
    saveNow();
  }
}

function doSell(id) {
  const s = App.state;
  const item = s.inventory.find(i => i.id === id);
  if (!item) return;
  const gold = Engine.sellItem(s, id);
  if (gold > 0) {
    UI.toast(`Sold ${item.name} for 💰${formatNum(gold)}.`, 'success');
    UI.renderGear(s);
    UI.updateHUD(s, App.user);
    saveNow();
  }
}

// ---------------- Mining & Forging ----------------
function doMine() {
  const s = App.state;
  if (!s || App.dead) return;
  const res = Engine.mineTap(s);
  const oreDef = Engine.ORE_BY_ID[res.ore] || {};
  let msg = `+1 ${oreDef.emoji || ''} ${oreDef.name || res.ore}`;
  if (res.broke) {
    const bonusTxt = res.bonus.length ? ` (+${res.bonus.length} bonus)` : '';
    msg += ` — rock shattered!${bonusTxt} Now depth ${s.mine.depth}.`;
    UI.toast(`⛏️ Rock shattered! Depth ${s.mine.depth}.`, 'success');
  }
  UI.renderMine(s, msg);
  if (App.mineTaps === undefined) App.mineTaps = 0;
  if (++App.mineTaps % 25 === 0) saveNow(); // don't hammer the save endpoint
}

// ---------------- Pickaxe upgrades ----------------
function doPickaxeUpgrade() {
  const s = App.state;
  if (!s || App.dead) return;
  const res = Engine.buyPickaxeUpgrade(s);
  if (res === true) {
    const t = Engine.pickaxeTier(s);
    UI.toast(`${t.emoji} Upgraded to ${t.name}! (×${t.mult} tap damage)`, 'success');
    saveNow();
  } else {
    UI.toast(res, 'error');
  }
  UI.renderMine(s);
}

function doForgeTier(slot, tier) {
  if (UI.forgeSel[slot]) UI.forgeSel[slot].tier = tier;
  UI.renderGear(App.state);
}

function doForgeStat(slot, stat) {
  const sel = UI.forgeSel[slot];
  if (!sel || !Engine.FORGE_STATS.includes(stat)) return;
  const i = sel.stats.indexOf(stat);
  if (i >= 0) sel.stats.splice(i, 1);
  else if (sel.stats.length < Engine.MAX_FORGE_PICKS) sel.stats.push(stat);
  else UI.toast(`Pick at most ${Engine.MAX_FORGE_PICKS} stats.`, 'error');
  UI.renderGear(App.state);
}

function doForgeCraft(slot) {
  const s = App.state;
  const sel = UI.forgeSel[slot];
  if (!s || !sel) return;
  const res = Engine.craftGalaxyItem(s, slot, sel.tier, sel.stats);
  if (typeof res === 'string') {
    UI.toast(res, 'error');
    return;
  }
  UI.toast(`🌌 Forged ${res.name}!`, 'success');
  UI.renderGear(s);
  UI.updateHUD(s, App.user);
  saveNow();
}

function doGalaxyEquip(slot) {
  const s = App.state;
  if (Engine.equipGalaxy(s, slot)) {
    const item = Engine.galaxyItemFor(s, slot);
    UI.toast(`Equipped ${item ? item.name : 'galaxy gear'}.`, 'success');
    UI.renderGear(s);
    UI.updateHUD(s, App.user);
    saveNow();
  }
}

function doGalaxyUnequip(slot) {
  const s = App.state;
  if (Engine.unequipGalaxy(s, slot)) {
    UI.renderGear(s);
    UI.updateHUD(s, App.user);
    saveNow();
  }
}

function doUpgrade(kind) {
  const s = App.state;
  const lvl = (s.upgrades && s.upgrades[kind]) || 1;
  const cost = Engine.upgradeCost(kind, lvl);
  if (!Engine.spendGold(s, cost)) { UI.toast('Not enough gold.', 'error'); return; }
  s.upgrades[kind] = lvl + 1;
  UI.renderGear(s);
  UI.updateHUD(s, App.user);
  UI.toast(`${Engine.UPGRADE_INFO[kind].name} → Lv ${lvl + 1}!`, 'success');
  saveNow();
}

function doTalent(id) {
  const s = App.state;
  if (!s) return;
  if (Engine.spendTalent(s, id)) {
    UI.renderMore(s, App.user);
    UI.updateHUD(s, App.user);
    UI.toast(`🧠 ${Engine.TALENTS[id].name} ranked up!`, 'success');
    saveNow();
  } else {
    UI.toast('Need a Mastery point — earn 1 per 10 levels.', 'error');
  }
}

function doProfession(id) {
  const s = App.state;
  if (!s) return;
  const cost = Engine.levelProfession(s, id);
  if (cost == null) { UI.toast('Max level reached.', 'error'); return; }
  if (!Engine.spendGold(s, cost)) { UI.toast('Not enough gold.', 'error'); return; }
  s.professions[id] = ((s.professions && s.professions[id]) || 1) + 1;
  UI.renderMore(s, App.user);
  UI.updateHUD(s, App.user);
  UI.toast(`${Engine.PROFESSIONS[id].emoji} ${Engine.PROFESSIONS[id].name} → Lv ${s.professions[id]}!`, 'success');
  saveNow();
}

function doRecruit(recruitId) {
  const s = App.state;
  const r = Engine.RECRUITS.find(x => x.id === recruitId);
  if (!r) return;
  if (s.party.length >= Engine.MAX_PARTY) { UI.toast('Party is full (3).', 'error'); return; }
  if (s.party.some(c => c.name === r.name)) { UI.toast('Already recruited.', 'error'); return; }
  if (!Engine.spendGold(s, r.cost)) { UI.toast('Not enough gold.', 'error'); return; }
  const c = Engine.makeCompanion(r, s.level);
  s.party.push(c);
  renderPartyTab();
  UI.updateHUD(s, App.user);
  UI.toast(`${r.emoji} ${r.name} joined your party!`, 'success');
  saveNow();
}

function doLevelUpCompanion(id) {
  const s = App.state;
  const c = (s.party || []).find(x => x && x.id === id);
  if (!c) return;
  const res = Engine.levelUpCompanion(s, id);
  if (!res.ok) {
    if (res.reason === 'gold') UI.toast(`Not enough gold (need 💰${formatNum(res.cost)}).`, 'error');
    else UI.toast('Could not level up.', 'error');
    return;
  }
  renderPartyTab();
  UI.updateHUD(s, App.user);
  UI.toast(`${c.emoji} ${c.name} leveled up to Lv ${res.level}! (+3⚔️ +1🛡️ +20❤️)`, 'success');
  saveNow();
}

function doDismiss(id) {
  const s = App.state;
  const idx = s.party.findIndex(c => c.id === id);
  if (idx < 0) return;
  const [c] = s.party.splice(idx, 1);
  delete App.companionTimers[id];
  renderPartyTab();
  UI.toast(`${c.name} left the party.`, 'info');
  saveNow();
}

// ---------------- pets ----------------
function doHatchPet(tier) {
  const s = App.state;
  if (!s) return;
  const t = (typeof tier === 'string' && (tier === 'wild' || Engine.SHOP_EGG_TIERS.includes(tier))) ? tier : 'wild';
  const pet = Engine.hatchPet(s, t);
  if (!pet) {
    UI.toast('No pet eggs to hatch — bosses drop them, or buy one in the Pet Shop.', 'info');
    return;
  }
  const sp = Engine.petSpeciesOf(pet);
  UI.toast(`🥚 Hatched a ${sp.name}! ${sp.emoji}`, 'success');
  UI.combatLog(`🥚 Hatched ${sp.emoji} ${sp.name}!`, 'loot');
  if (UI.activeTab === 'pets') UI.renderPetsTab(s);
  checkAch(); // first-hatch / pack titles
  saveNow();
}

function doBreedPets() {
  const s = App.state;
  if (!s) return;
  const [a, b] = UI._breedSel || [];
  const res = Engine.breedPets(s, a, b);
  if (!res.ok) {
    UI.toast(res.reason === 'gold' ? `Not enough gold — breeding costs 💰${formatNum(res.cost)}.` : 'Pick two different pets to breed.', 'warn');
    return;
  }
  const sp = Engine.petSpeciesOf(res.pet);
  UI.toast(`💕 Bred a ${sp.name}! ${sp.emoji}`, 'success');
  UI.combatLog(`💕 Bred ${sp.emoji} ${sp.name}!`, 'loot');
  UI.renderPetsTab(s);
  saveNow();
}

async function doCombinePets() {
  const s = App.state;
  if (!s) return;
  const uids = (UI._combineSel || []).slice();
  const p = Engine.ensurePets(s);
  const picks = uids.map(u => p.collection.find(x => x.uid === u)).filter(Boolean);
  if (picks.length === 3) {
    const names = picks.map(x => `${Engine.petSpeciesOf(x).emoji} ${Engine.petSpeciesOf(x).name} Lv ${x.level}`).join('<br>');
    const ok = await UI.confirm(
      '🔀 Combine pets?',
      `<p>Permanently sacrifice these three pets to create one pet of the next rarity up?</p><p>${names}</p><p class="muted">This cannot be undone.</p>`,
      'Combine'
    );
    if (!ok) return;
  }
  const res = Engine.combinePets(s, uids);
  if (!res.ok) {
    const msg = { 'pick-three': 'Pick three pets to combine.', 'same-rarity': 'All three pets must share a rarity.', 'max-rarity': 'Those pets are already max rarity!', 'protected': 'Special pets cannot be combined.' }[res.reason] || 'Combine failed.';
    UI.toast(msg, 'warn');
    return;
  }
  const sp = Engine.petSpeciesOf(res.pet);
  UI.toast(`🔀 Combined into a Lv ${res.pet.level} ${sp.name}! ${sp.emoji}`, 'success');
  UI.combatLog(`🔀 Combined into ${sp.emoji} Lv ${res.pet.level} ${sp.name}!`, 'loot');
  UI.renderPetsTab(s);
  saveNow();
}

function doBuyTokenItem(itemId) {
  const s = App.state;
  if (!s) return;
  const res = Engine.buyTokenItem(s, itemId, Date.now());
  if (!res.ok) {
    const msg = {
      'bad-item': 'That item is gone.',
      'not-in-stock': 'That item rotated out of stock.',
      'tokens': `Not enough 🌀 tokens — need ${res.cost}. Rebirth to earn more!`,
      'owned': 'You already own that one.',
    }[res.reason] || 'Could not buy that.';
    UI.toast(msg, 'warn');
    return;
  }
  const item = res.item;
  UI.toast(`🌀 Bought ${item.name || item.id}! Yours forever.`, 'success');
  UI.combatLog(`🌀 Token shop: bought ${item.name || item.id}.`, 'loot');
  UI.renderTokenShop(s);
  saveNow();
}

function doBuyEgg(tier) {
  const s = App.state;
  if (!s) return;
  const res = Engine.buyEgg(s, tier);
  if (!res.ok) {
    UI.toast(res.reason === 'gold' ? 'Not enough gold for that egg.' : 'That egg is not for sale.', 'error');
    return;
  }
  const t = Engine.EGG_TIERS[tier];
  const priceNote = s.infGold ? ' (∞ gold)' : ` for 💰${formatNum(t.price)} gold`;
  UI.toast(`${t.emoji} Bought a ${t.name}${priceNote}!`, 'success');
  UI.combatLog(`🛒 Bought ${t.emoji} ${t.name} from the Pet Shop.`, 'loot');
  UI.renderPetsTab(App.state);
  saveNow();
}

function doSellPet(petUid) {
  const s = App.state;
  if (!s) return;
  const p = Engine.ensurePets(s);
  const pet = p.collection.find(x => x.uid === petUid);
  const sp = pet && Engine.petSpeciesOf(pet);
  if (!pet || !sp) return;
  if (!Engine.canSellPet(pet)) {
    UI.toast('That pet is special — it cannot be sold.', 'error');
    return;
  }
  const res = Engine.sellPet(s, petUid);
  if (!res.ok) {
    UI.toast(res.reason === 'unsellable' ? 'That pet is special — it cannot be sold.' : 'Could not sell that pet.', 'error');
    return;
  }
  UI.toast(`💰 Sold ${sp.emoji} ${res.name} for 💰${formatNum(res.gold)} gold${res.capped ? ' (gold cap reached)' : ''}.`, 'success');
  UI.combatLog(`💰 Sold ${sp.emoji} ${res.name} for 💰${formatNum(res.gold)}.`, 'loot');
  UI.renderPetsTab(App.state);
  saveNow();
}

function doSetSecondPet(petUid) {
  const s = App.state;
  if (!s || s.playerClass !== 'hunter') return;
  const p = Engine.ensurePets(s);
  const pet = p.collection.find(x => x.uid === petUid);
  if (!pet || petUid === p.activeUid) return;
  p.secondUid = petUid;
  const sp = Engine.petSpeciesOf(pet);
  UI.toast(`${sp.emoji} ${sp.name} joins the hunt as your second pet!`, 'success');
  UI.renderPetsTab(App.state);
  saveNow();
}

function doRemoveSecondPet() {
  const s = App.state;
  if (!s) return;
  const p = Engine.ensurePets(s);
  if (!p.secondUid) return;
  p.secondUid = null;
  UI.toast('Second pet dismissed.', 'info');
  UI.renderPetsTab(App.state);
  saveNow();
}

// ---------------- multiplayer party ----------------
// App.mpParty caches the GET /api/party view (null = not in a party).
// Bonuses are computed from this cache; the server recomputes them from
// DB truth on every /api/party response, so the client can never inflate
// its own bonus — gainXp clamps the passed percentage anyway.
function partyCtx() {
  const s = App.state;
  return {
    mpParty: App.mpParty,
    username: App.user && App.user.username,
    isGuest: isGuest(),
    ownNpcCount: s && Array.isArray(s.party) ? s.party.length : 0,
  };
}

function renderPartyTab() {
  if (App.state) UI.renderParty(App.state, partyCtx());
}

function partyBonus() {
  const mp = App.mpParty;
  // Server-computed bonuses from DB truth (GET /api/party) — preferred.
  if (mp && mp.bonuses && Number.isFinite(mp.bonuses.xpPct) && Number.isFinite(mp.bonuses.goldPct)) {
    return { xpPct: mp.bonuses.xpPct, goldPct: mp.bonuses.goldPct };
  }
  // Fallback: local estimate (own NPC allies only; no server data yet).
  const npcs = App.state && Array.isArray(App.state.party) ? App.state.party.length : 0;
  return { xpPct: npcs * 4, goldPct: 0 };
}

// Refetch the party view. Offline-tolerant: keeps the stale cache on error.
async function loadMpParty() {
  if (isGuest() || !App.user) { App.mpParty = null; }
  else {
    try {
      const res = await api.partyGet();
      App.mpParty = res.party || null;
    } catch { /* keep stale cache */ }
  }
  if (UI.activeTab === 'party' && App.state) UI.renderParty(App.state, partyCtx());
}

// Poll GET /api/party every 30s only while the Party tab is active.
function setMpPoll(on) {
  if (App.mpPoll) { clearInterval(App.mpPoll); App.mpPoll = null; }
  if (on && !isGuest()) App.mpPoll = setInterval(() => { loadMpParty(); }, 30000);
}

async function doMpCreate() {
  if (isGuest()) { promptUpgrade('multiplayer parties'); return; }
  try {
    const res = await api.partyCreate();
    App.mpParty = res.party;
    UI.toast(`🎉 Party created! Code: ${res.code}`, 'success');
  } catch (e) { UI.toast(e.message || 'Could not create party.', 'error'); }
  renderPartyTab();
}

async function doMpJoin(code) {
  if (isGuest()) { promptUpgrade('multiplayer parties'); return; }
  code = String(code || '').trim().toUpperCase();
  if (!code) { UI.toast('Enter the 6-letter party code.', 'error'); return; }
  try {
    const res = await api.partyJoin(code);
    App.mpParty = res.party;
    UI.toast('🎉 Joined the party!', 'success');
  } catch (e) { UI.toast(e.message || 'Could not join party.', 'error'); }
  renderPartyTab();
}

async function doMpLeave() {
  try {
    await api.partyLeave();
    App.mpParty = null;
    UI.toast('You left the party.', 'info');
  } catch (e) { UI.toast(e.message || 'Could not leave party.', 'error'); }
  renderPartyTab();
}

async function doMpKick(userId) {
  try {
    await api.partyKick(Number(userId));
    const res = await api.partyGet();
    App.mpParty = res.party;
    UI.toast('Member kicked.', 'info');
  } catch (e) { UI.toast(e.message || 'Could not kick member.', 'error'); }
  renderPartyTab();
}

async function doMpDisband() {
  if (!window.confirm('Disband the party for everyone?')) return;
  try {
    await api.partyDisband();
    App.mpParty = null;
    UI.toast('Party disbanded.', 'info');
  } catch (e) { UI.toast(e.message || 'Could not disband party.', 'error'); }
  renderPartyTab();
}

function doMpCopy() {
  const code = App.mpParty && App.mpParty.code;
  if (!code) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(
      () => UI.toast('📋 Party code copied!', 'success'),
      () => UI.toast(`Party code: ${code}`, 'info')
    );
  } else {
    UI.toast(`Party code: ${code}`, 'info');
  }
}

function doBuyGear(stockId) {
  const s = App.state;
  if (!s) return;
  const res = Engine.buyGearItem(s, stockId);
  if (!res.ok) {
    UI.toast(res.reason === 'gold' ? 'Not enough gold for that gear.' : 'That item is not for sale.', 'error');
    return;
  }
  const entry = Engine.GEAR_SHOP_STOCK.find(e => e.id === stockId);
  const priceNote = s.infGold ? ' (∞ gold)' : ` for 💰${formatNum(entry.price)} gold`;
  UI.toast(`${entry.emoji} Bought ${res.item.name}${priceNote}!`, 'success');
  UI.combatLog(`🛒 Bought ${entry.emoji} ${res.item.name} (${res.item.rarity}) from the Gear Shop.`, 'loot');
  UI.renderGear(s);
  saveNow();
}

function doGotoPetShop() {
  UI.showTab('pets');
}

function doFeedPet(petUid) {
  const s = App.state;
  if (!s) return;
  const res = Engine.feedPet(s, petUid);
  if (!res.ok) {
    UI.toast(res.reason === 'gold' ? 'Not enough gold to feed.' : res.reason === 'full' ? 'That pet is full.' : 'Pet not found.', 'error');
    return;
  }
  UI.toast(`🍖 Fed for 💰${formatNum(res.cost)} gold.`, 'success');
  UI.renderPetsTab(App.state);
  saveNow();
}

function doSetActivePet(petUid) {
  const s = App.state;
  if (!s) return;
  const p = Engine.ensurePets(s);
  const pet = p.collection.find(x => x.uid === petUid);
  if (!pet) return;
  p.activeUid = petUid;
  const sp = Engine.petSpeciesOf(pet);
  UI.toast(`${sp.emoji} ${sp.name} is now your active pet!`, 'success');
  UI.renderPetsTab(App.state);
  saveNow();
}

// A GM grant targeted this session's player: swap in the updated saved state
// and refresh every view so the grant is visible immediately.
function applyExternalState(srv) {
  if (!srv) return;
  App.state = Engine.ensureState(srv);
  Raid.init(App.state);
  applyUiStyle();
  applyCustomStyles();
  applyAudioPrefs();
  const s = App.state;
  UI.updateHUD(s, App.user);
  UI.renderBattle(s);
  UI.renderGear(s);
  renderPartyTab();
  if (UI.activeTab === 'settings') UI.renderMore(s, App.user);
  if (App.enemy) UI.setEnemy(App.enemy);
  UI.updateHeroPanel(s, Engine.computeStats(s), App);
  saveNow();
}

async function doRebirth() {
  const s = App.state;
  if (s.level < Engine.MAX_LEVEL) return;
  const count = (s.rebirthCount || 0) + 1;
  const ok = await UI.confirm(
    '🌀 Rebirth?',
    `<p>Return to <b>level 1</b>. Everything else stays: stage, gold, gear, pets, titles.</p>
     <p class="muted">This will be your rebirth #${count}.</p>`,
    'Rebirth!'
  );
  if (!ok) return;
  const res = Engine.rebirth(s);
  if (!res) return;
  App.dead = false;
  UI.setDead(false);
  applyCustomStyles();
  applyAudioPrefs();
  spawnEnemy();
  UI.renderBattle(s);
  UI.renderGear(s);
  renderPartyTab();
  UI.renderMore(s, App.user);
  UI.updateHUD(s, App.user);
  UI.toast(`🌀 Reborn! Back to level 1 — rebirth #${s.rebirthCount}.`, 'success');
  checkAch();
  saveNow();
}

async function doRedeem() {
  if (isGuest()) { promptUpgrade('gift codes'); return; }
  const input = document.getElementById('redeem-input');
  const code = (input.value || '').trim().toUpperCase();
  if (!code) { UI.toast('Enter a gift code.', 'error'); return; }
  try {
    const res = await api.redeem(code);
    // Server merged the reward into saved state; save local progress first,
    // then pull the server-merged reward fields back in.
    await saveNow();
    const { state: srv } = await api.getState();
    const fresh = Engine.ensureState(srv);
    // keep local live progress, take the server-merged reward fields
    App.state.inventory = fresh.inventory;
    App.state.gold = fresh.gold;
    App.state.stars = fresh.stars;
    App.state.codesRedeemed = fresh.codesRedeemed;
    input.value = '';
    UI.renderGear(App.state);
    UI.renderMore(App.state, App.user);
    UI.updateHUD(App.state, App.user);
    const reward = res.reward || { kind: 'gear', amount: 0 };
    let msg;
    if (reward.kind === 'gold') msg = `🎁 Redeemed: +💰${formatNum(reward.amount)} gold!`;
    else if (reward.kind === 'stars') msg = `🎁 Redeemed: +⭐${formatNum(reward.amount)} stars!`;
    else msg = `🎁 Redeemed! ${res.set ? '(' + res.set + ' set added)' : ''}`;
    UI.toast(msg, 'success');
    saveNow();
  } catch (e) {
    UI.toast(e.message || 'Redeem failed.', 'error');
  }
}

async function doLogout() {
  if (isGuest()) {
    const ok = await UI.confirm(
      'Exit guest session?',
      '<p>Your guest hero stays saved on <b>this device</b> — you can continue from the login screen later.</p>',
      'Exit'
    );
    if (!ok) return;
    location.reload();
    return;
  }
  const ok = await UI.confirm('Logout?', '<p>Your progress is saved. See you soon, hero.</p>', 'Logout');
  if (!ok) return;
  try { await saveNow(); } catch { /* ignore */ }
  try { await api.logout(); } catch { /* ignore */ }
  location.reload();
}

// ---------------- tab switching ----------------
// Mounts the guild panel into the Guild tab once per session.
// (Failures render an inline error + Retry inside the panel; the fetch
// itself has a timeout so a sleeping backend can't hang on "Loading…"
// forever — see guild.js.)
let guildMounted = false;
function mountGuild() {
  const el = document.getElementById('guild-section');
  if (!el || guildMounted) return;
  guildMounted = true;
  // Guide quest "Strength in Numbers": visiting the Guilds tab counts.
  const s = App.state;
  if (s) {
    if (!s.guideTabs || typeof s.guideTabs !== 'object') s.guideTabs = {};
    if (!s.guideTabs.guild) { s.guideTabs.guild = true; saveNow(); }
  }
  if (isGuest()) {
    // Guilds are server-side: guests get the upgrade prompt instead of a 401.
    el.innerHTML = `<p class="muted small">🏰 Guilds need an account — create one and your guest progress comes with you.</p>
      <button class="btn gold wide" id="guild-upgrade-btn" type="button">✨ Create account</button>`;
    el.querySelector('#guild-upgrade-btn').addEventListener('click', openUpgradeModal);
    return;
  }
  try { renderGuildSection(el, api, App.state); } catch (e) { console.warn('guild mount failed', e); }
}

// Polls for staff broadcasts; toasts any announcement newer than the last seen.
async function pollBroadcast() {
  try {
    const r = await api.latestBroadcast();
    const b = r && r.broadcast;
    if (!b || !b.id) return;
    let seen = 0;
    try { seen = Number(localStorage.getItem('kop-broadcast-seen') || 0); } catch { /* ignore */ }
    if (b.id > seen) {
      try { localStorage.setItem('kop-broadcast-seen', String(b.id)); } catch { /* ignore */ }
      UI.toast(`📢 ${b.message}`, 'info', 6000);
    }
  } catch { /* offline-tolerant */ }
}

async function onTabSwitch(tab, force = false) {
  const s = App.state;
  if (!s) return;
  // Navigating anywhere else ends the inn rest (leaveInn(true) would fight
  // the tab switch in progress, so exit silently here).
  if (tab !== 'inn' && App.inInn) leaveInn(false);
  // Party polling only lives while the Party tab is open.
  setMpPoll(tab === 'party');
  if (tab === 'gear') UI.renderGear(s);
  else if (tab === 'mine') UI.renderMine(s);
  else if (tab === 'party') { loadMpParty(); renderPartyTab(); }
  else if (tab === 'pets') UI.renderPetsTab(s);
  else if (tab === 'tokenshop') UI.renderTokenShop(s);
  else if (tab === 'settings') { UI.renderMore(s, App.user); UI.syncNotifSettings(s.settings && s.settings.notif); }
  else if (tab === 'stats') UI.renderStats(s, App.user);
  else if (tab === 'titles') UI.renderTitles(s);
  else if (tab === 'guild') { mountGuild(); }
  else if (tab === 'quests') UI.renderQuests(s);
  else if (tab === 'battle') {
    UI.renderBattle(s);
    if (App.enemy) UI.setEnemy(App.enemy);
    // Battle background (Settings → ⚔️ Battle background): the current
    // realm's animated scene (default), the player's picked background, or
    // off (plain dark, no animated scene). Leaving battle restores the
    // saved background style below.
    try {
      const bbg = battleBgOf(s);
      if (bbg === 'mystyle') UI.setBgScene(bgStyleOf(s), bgSceneOpts(s));
      else if (bbg === 'off') UI.setBgScene('off', bgSceneOpts(s));
      else {
        const world = Engine.worldForStage(s.stage);
        if (world && world.bgScene) UI.setBgScene(world.bgScene, bgSceneOpts(s));
      }
    } catch { /* keep saved background on error */ }
  } else if (tab === 'ranks') {
    await loadRanks();
  }
  // Non-battle tabs always honor the saved background style.
  if (tab !== 'battle') {
    try { UI.setBgScene(bgStyleOf(s), bgSceneOpts(s)); } catch { /* ignore */ }
  }
  void force;
}

async function loadRanks() {
  // Guilds category (server-ranked by guild level → member power → count).
  const cat = UI.ranksCategory || 'heroes';
  if (cat === 'guilds') {
    try {
      const { guilds } = await api.guildRankings();
      UI.renderGuildRanks(guilds || []);
    } catch (e) {
      UI.toast('Could not load guild rankings.', 'error');
    }
    return;
  }
  // Heroes: 7 ranking pills (?by=) + All/Friends filter.
  const by = UI.lbCategory || 'level';
  try {
    const { entries } = await api.leaderboard(by);
    UI.renderRanks(entries || [], App.user ? App.user.username : null, by, App.state);
  } catch (e) {
    UI.toast('Could not load leaderboard.', 'error');
  }
  // Keep the selected sub-tab and refresh friends in the background.
  UI.switchRanksSubtab(App.ranksSubtab === 'friends' ? 'friends' : 'board');
  loadFriends();
}

async function loadFriends() {
  if (isGuest()) {
    UI.renderFriends(null, true);
    UI.showFriendsModal(null, true);
    UI.setFriendBadge(0);
    return;
  }
  try {
    const data = await api.getFriends();
    App.friends = data;
    UI.renderFriends(data, false);
    UI.showFriendsModal(data, false);
    UI.setFriendBadge((data.incoming || []).length);
  } catch (e) {
    UI.renderFriends({ friends: [], incoming: [], outgoing: [] }, false);
    UI.showFriendsModal({ friends: [], incoming: [], outgoing: [] }, false);
    UI.setFriendBadge(0);
  }
}

// ---------------- go ----------------
document.addEventListener('DOMContentLoaded', boot);
