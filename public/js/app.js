// ============================================================
// app.js — boot, session flow, game loops, combat wiring.
// ============================================================
import { api } from './api.js';
import * as Engine from './engine.js';
import { UI, esc, formatNum } from './ui.js';
import { Auth } from './auth.js';
import { GM } from './gm.js';
import { Raid } from './raid.js';
import { renderGuildSection } from './guild.js';

const TICK_MS = 250;
const AUTOSAVE_MS = 15000;
const ENEMY_ATTACK_S = 2.0;
const RESPAWN_MS = 3000;
const SKILL_CD_MS = 12000;
const SKILL_MULT = 2.5;

const App = {
  user: null,
  state: null,
  enemy: null,
  dead: false,
  respawnAt: 0,
  heroTimer: 0,
  enemyTimer: 0,
  companionTimers: {}, // companion id -> seconds accumulated
  skillReadyAt: 0,
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
  UI.handlers = {
    onTap: doTap,
    onSkill: usePowerStrike,
    onMode: setMode,
    onPrestige: doPrestige,
    onEquip: doEquip,
    onSell: doSell,
    onUpgrade: doUpgrade,
    onRecruit: doRecruit,
    onDismiss: doDismiss,
    onLevelUpCompanion: doLevelUpCompanion,
    onHatchPet: doHatchPet,
    onFeedPet: doFeedPet,
    onSetActivePet: doSetActivePet,
    onRedeem: doRedeem,
    onLogout: doLogout,
    onOpenGM: () => GM.open(App.user),
    onTalent: doTalent,
    onProfession: doProfession,
    onSaveState: () => saveNow(),
    onExternalState: applyExternalState,
    onTab: onTabSwitch,
    onUiStyle: setUiStyle,
    onShare: () => UI.shareGame(App.state, App.user),
    onChangelog: () => UI.openChangelog(),
    onTitle: (id) => {
      const s = App.state;
      if (!s || !(s.titlesUnlocked || []).includes(id)) return;
      s.activeTitle = id;
      UI.renderMore(s, App.user);
      UI.toast(`👑 Title set: ${Engine.titleName(id)}`, 'success');
      saveNow();
    },
    onCountry: (code) => {
      const s = App.state;
      if (!s) return;
      const c = String(code || '').toUpperCase();
      s.country = c && Engine.isValidCountry(c) ? c : null;
      UI.renderMore(s, App.user);
      UI.toast(c && s.country ? `🌍 Flag set: ${Engine.countryFlag(c)}` : '🌍 Flag removed.', 'success');
      saveNow();
    },
  };
  UI.init();

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

  if (!user) {
    UI.showView('auth');
    Auth.init({ onAuthed: (u) => enterApp(u) });
  } else {
    enterApp(user);
  }
}

async function enterApp(user) {
  App.user = user;
  let raw, lastSeenAt;
  try {
    const res = await api.getState();
    raw = res.state; lastSeenAt = res.lastSeenAt;
  } catch (e) {
    UI.showView('auth');
    Auth.init({ onAuthed: (u) => enterApp(u) });
    UI.toast('Session expired — please log in again.', 'error');
    return;
  }

  // Server gold cap (owner-adjustable); failure keeps the built-in default.
  try {
    const sj = await api.getSettings();
    if (sj && Number.isFinite(sj.goldCap)) Engine.setGoldCap(sj.goldCap);
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
            try { await api.saveState(App.state); } catch { /* offline-tolerant */ }
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
      try { await api.saveState(state); } catch { /* offline-tolerant */ }
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
  UI.showView('app');

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
      await saveNow();
    }
  }

  startGame();
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

function startGame() {
  if (App.started) return;
  App.started = true;
  applyUiStyle();
  UI.showView('app');
  spawnEnemy();
  UI.renderBattle(App.state);
  UI.renderGear(App.state);
  UI.renderParty(App.state);
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
    if (App.state) api.saveStateBeacon(App.state);
  });
  window.addEventListener('pagehide', () => {
    if (App.state) api.saveStateBeacon(App.state);
  });
}

// ---------------- saving ----------------
let _saving = false;
async function saveNow(beaconOnly = false) {
  if (!App.state || _saving) return;
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
    : Engine.enemyFor(s.stage);
  App.enemyTimer = 0;
  App.heroTimer = 0;
  App.companionTimers = {};
  // revive downed companions on a fresh enemy
  for (const c of s.party) if (c.hp <= 0) c.hp = c.maxHp;
  UI.setEnemy(App.enemy);
  // reset the live damage meter for this fight
  App.meter = { startAt: Date.now(), fighters: {} };
  // zone change toast
  const zone = Engine.zoneFor(s.stage);
  if (App.lastZone && App.lastZone !== zone.name) {
    UI.toast(`${zone.emoji} Entered ${zone.name}`, 'info');
  }
  App.lastZone = zone.name;
  UI.updateHeroPanel(s, Engine.computeStats(s), App);
  if (App.enemy.boss && App.lastBossModalStage !== s.stage) {
    App.lastBossModalStage = s.stage;
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
  if (!m) return { rows: [], totalDps: 0 };
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
  meterHit(c.id, c.name, dmg);
  damageEnemy(dmg, crit ? 'CRIT ' : '', c.emoji + ' ');
}

// Active pet strikes (every 4s from the combat tick). Hunger-gated: a
// starving pet sits out. Damage never outshines the hero.
function petStrike(stats) {
  if (App.dead || !App.enemy || App.spawnPending) return;
  const dmg = Engine.petStrikeDamage(App.state, stats);
  if (dmg <= 0) return;
  const pet = Engine.activePet(App.state);
  const sp = pet && Engine.petSpeciesOf(pet);
  meterHit('pet', sp ? sp.name : 'Pet', dmg);
  damageEnemy(dmg, '', (sp ? sp.emoji : '🐾') + ' ');
}

function damageEnemy(dmg, prefix, sourceLabel) {
  const enemy = App.enemy;
  if (!enemy || App.dead || App.spawnPending) return;
  enemy.hp -= dmg;
  UI.enemyHitFlash();
  const isCrit = String(prefix).includes('CRIT');
  UI.floatText(`${prefix}${formatNum(dmg)}`, isCrit ? 'crit' : 'dmg');
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

  let gold = Engine.goldForKill(stage, stats.goldBonus + (stats.talentGoldPct || 0), s.prestigeBonus);
  if (raidLoot) gold = Math.floor(gold * raidLoot.goldMult);
  const addedGold = Engine.addGold(s, gold);
  const cappedNote = addedGold < gold ? ' · gold cap' : '';
  s.stats.kills += 1;
  const isDungeonBoss = enemy.boss && s.mode === 'dungeon';
  const isRaidBoss = inRaid && raidLoot && raidLoot.boss;
  if (enemy.boss) {
    s.bossesKilled += 1;
    s.stars += 1; // bosses grant a star
    UI.combatLog(`👹 Boss slain! +${formatNum(addedGold)} gold${cappedNote}, +1 ⭐`, 'boss');
    UI.toast(`Boss slain! +${formatNum(addedGold)} gold${cappedNote}, +1 ⭐`, 'success');
  }
  const killXp = Engine.xpForKill(stage);
  const xpRes = Engine.gainXp(s, killXp);
  // The active pet earns 15% of the kill's XP.
  const petXpRes = Engine.gainPetXp(s, Math.floor(killXp * 0.15));
  for (const lv of petXpRes.levels) {
    const pet = Engine.activePet(s);
    const petName = pet ? Engine.petSpeciesOf(pet).name : 'Pet';
    UI.toast(`🐾 ${petName} reached level ${lv}!`, 'success');
    UI.combatLog(`🐾 ${petName} leveled up to ${lv}!`, 'level');
  }
  const loot = Engine.rollLoot(stage, enemy.boss, raidLoot ? raidLoot.lootTier : null);
  if (loot) {
    s.inventory.push(loot);
    UI.toast(`🎒 Loot: ${loot.name}`, 'loot');
    UI.combatLog(`🎒 Looted ${loot.name} (${loot.rarity})`, 'loot');
    if (UI.activeTab === 'gear') UI.renderGear(s);
  }
  // Earnable set pieces (drop sources documented on Engine.PLAYER_SETS).
  const setDrop = Engine.rollSetDrop(stage, { boss: enemy.boss, dungeonBoss: isDungeonBoss, raidBoss: isRaidBoss });
  if (setDrop) {
    s.inventory.push(setDrop);
    UI.toast(`🔥 Set piece: ${setDrop.name}!`, 'loot');
    UI.combatLog(`🔥 Looted ${setDrop.name} (${setDrop.setName})`, 'loot');
    if (UI.activeTab === 'gear') UI.renderGear(s);
  }
  // Pet eggs from bosses (drop sources documented on Engine.rollPetEgg).
  if (Engine.rollPetEgg({ boss: enemy.boss, dungeonBoss: isDungeonBoss, raidBoss: isRaidBoss })) {
    Engine.ensurePets(s).eggs += 1;
    UI.toast('🥚 A pet egg dropped! Hatch it in Party → Pets.', 'loot');
    UI.combatLog('🥚 A pet egg dropped!', 'loot');
    if (UI.activeTab === 'party') UI.renderParty(s);
  }
  if (xpRes.levels.length) {
    UI.levelUpModal(xpRes.levels);
    UI.combatLog(`⬆️ Level ${xpRes.levels[xpRes.levels.length - 1]}!`, 'level');
    const mp = xpRes.levels.filter(l => l % 10 === 0).length;
    if (mp > 0) {
      UI.toast(`🧠 +${mp} Mastery point${mp > 1 ? 's' : ''}! Spend in More → Mastery.`, 'success');
      if (UI.activeTab === 'more') UI.renderMore(s, App.user);
    }
  }
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
  // prestige unlock may have appeared
  if (s.level >= 70) UI.renderBattle(s);
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
  if (target.kind === 'hero') {
    s.hero.hp -= res.dmg;
    UI.floatText(`-${formatNum(res.dmg)}`, 'hurt');
    if (s.hero.hp <= 0) { s.hero.hp = 0; onDefeat(); }
  } else {
    target.c.hp -= res.dmg;
    UI.combatLog(`💔 ${target.c.name} took ${formatNum(res.dmg)}.`);
    if (target.c.hp <= 0) {
      target.c.hp = 0;
      UI.toast(`${target.c.emoji} ${target.c.name} is down!`, 'error');
    }
  }
}

function onDefeat() {
  const s = App.state;
  App.dead = true;
  App.respawnAt = Date.now() + RESPAWN_MS;
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
  UI.toast(`You fell! −${formatNum(lost)} gold. Reviving…`, 'error');
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

// ---------------- main tick ----------------
function tick() {
  const s = App.state;
  if (!s || !App.enemy) return;
  const dt = TICK_MS / 1000;
  s.stats.playTimeSec += dt;

  if (App.dead) {
    if (Date.now() >= App.respawnAt) respawn();
    return;
  }

  const stats = Engine.computeStats(s);

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

  // companions attack in dungeon mode
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

  UI.updateBattle(s, stats, { enemy: App.enemy, user: App.user, skillReadyAt: App.skillReadyAt });
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
  if (!s || App.dead || s.mode !== 'clicker') return;
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
    UI.toast(`👑 New title unlocked: ${t.name}!`, 'success');
    UI.combatLog(`👑 Title unlocked: ${t.name}`, 'level');
  }
  if (fresh.length || freshTitles.length) {
    if (UI.activeTab === 'more') UI.renderMore(s, App.user);
    UI.updateHUD(s, App.user);
    saveNow();
  }
}

function usePowerStrike() {
  const s = App.state;
  if (!s || App.dead || !s.skills.includes('power-strike')) return;
  const now = Date.now();
  if (now < App.skillReadyAt) return;
  App.skillReadyAt = now + SKILL_CD_MS;
  s.stats.taps += 1;
  UI.floatText('POWER STRIKE', 'skill');
  heroStrike(Engine.computeStats(s), SKILL_MULT);
}

function setMode(mode) {
  const s = App.state;
  if (!s || s.mode === mode) { UI.setMode(mode); return; }
  const wasRaid = s.mode === 'raid';
  if (wasRaid) Raid.exit();
  s.mode = mode;
  App.heroTimer = 0;
  App.companionTimers = {};
  UI.setMode(mode);
  UI.renderBattle(s);
  UI.updateHeroPanel(s, Engine.computeStats(s), App);
  UI.toast({ clicker: '👆 Clicker mode — tap to attack!', auto: '🤖 Auto mode — your hero fights alone.', dungeon: '🏰 Dungeon mode — party fights with you!', raid: '🌀 Raid mode — endless waves! Death ends the run.' }[mode] || mode);
  // Entering or leaving raid needs a fresh enemy (waves vs stage enemies).
  if (mode === 'raid' || wasRaid) spawnEnemy();
  saveNow();
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
  UI.renderParty(s);
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
  UI.renderParty(s);
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
  UI.renderParty(s);
  UI.toast(`${c.name} left the party.`, 'info');
  saveNow();
}

// ---------------- pets ----------------
function doHatchPet() {
  const s = App.state;
  if (!s) return;
  const pet = Engine.hatchPet(s);
  if (!pet) {
    UI.toast('No pet eggs to hatch — bosses sometimes drop them.', 'info');
    return;
  }
  const sp = Engine.petSpeciesOf(pet);
  UI.toast(`🥚 Hatched a ${sp.name}! ${sp.emoji}`, 'success');
  UI.combatLog(`🥚 Hatched ${sp.emoji} ${sp.name}!`, 'loot');
  UI.renderParty(s);
  checkAch(); // first-hatch / pack titles
  saveNow();
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
  UI.renderParty(s);
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
  UI.renderParty(s);
  saveNow();
}

// A GM grant targeted this session's player: swap in the updated saved state
// and refresh every view so the grant is visible immediately.
function applyExternalState(srv) {
  if (!srv) return;
  App.state = Engine.ensureState(srv);
  Raid.init(App.state);
  applyUiStyle();
  const s = App.state;
  UI.updateHUD(s, App.user);
  UI.renderBattle(s);
  UI.renderGear(s);
  UI.renderParty(s);
  if (UI.activeTab === 'more') UI.renderMore(s, App.user);
  if (App.enemy) UI.setEnemy(App.enemy);
  UI.updateHeroPanel(s, Engine.computeStats(s), App);
  saveNow();
}

async function doPrestige() {
  const s = App.state;
  if (s.level < 70) return;
  const nextBonus = (s.prestigeBonus || 0) + 25;
  const ok = await UI.confirm(
    '🔥 Prestige?',
    `<p>Reset to <b>level 1, stage 1</b> with no gold and no regular gear.</p>
     <p><b class="gold-text">+25% damage & gold</b> (→ +${nextBonus}% total).</p>
     <p class="muted">Kept: 👑 privileged gear sets, ⭐ stars, lifetime stats, race.</p>`,
    'Prestige!'
  );
  if (!ok) return;
  const fresh = Engine.prestige(s);
  if (!fresh) return;
  Raid.carryOver(fresh, s);
  App.state = fresh;
  App.dead = false;
  UI.setDead(false);
  spawnEnemy();
  UI.renderBattle(fresh);
  UI.renderGear(fresh);
  UI.renderParty(fresh);
  UI.renderMore(fresh, App.user);
  UI.updateHUD(fresh, App.user);
  UI.toast(`🔥 Prestiged! +25% damage & gold (total +${fresh.prestigeBonus}%).`, 'success');
  checkAch();
  saveNow();
}

async function doRedeem() {
  const input = document.getElementById('redeem-input');
  const code = (input.value || '').trim().toUpperCase();
  if (!code) { UI.toast('Enter a gift code.', 'error'); return; }
  try {
    const res = await api.redeem(code);
    // Server merged the set into saved state; save local progress first, then pull inventory.
    await saveNow();
    const { state: srv } = await api.getState();
    const fresh = Engine.ensureState(srv);
    // keep local live progress, take the server-merged inventory + redemptions
    App.state.inventory = fresh.inventory;
    App.state.codesRedeemed = fresh.codesRedeemed;
    input.value = '';
    UI.renderGear(App.state);
    UI.renderMore(App.state, App.user);
    UI.toast(`🎁 Redeemed! ${res.set ? '(' + res.set + ' set added)' : ''}`, 'success');
    saveNow();
  } catch (e) {
    UI.toast(e.message || 'Redeem failed.', 'error');
  }
}

async function doLogout() {
  const ok = await UI.confirm('Logout?', '<p>Your progress is saved. See you soon, hero.</p>', 'Logout');
  if (!ok) return;
  try { await saveNow(); } catch { /* ignore */ }
  try { await api.logout(); } catch { /* ignore */ }
  location.reload();
}

// ---------------- tab switching ----------------
// Mounts the guild panel into the More tab once per session.
let guildMounted = false;
function mountGuild() {
  const el = document.getElementById('guild-section');
  if (!el || guildMounted) return;
  guildMounted = true;
  try { renderGuildSection(el, api); } catch (e) { console.warn('guild mount failed', e); }
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
  if (tab === 'gear') UI.renderGear(s);
  else if (tab === 'party') UI.renderParty(s);
  else if (tab === 'more') { UI.renderMore(s, App.user); mountGuild(); }
  else if (tab === 'battle') {
    UI.renderBattle(s);
    if (App.enemy) UI.setEnemy(App.enemy);
  } else if (tab === 'ranks') {
    await loadRanks();
  }
  void force;
}

async function loadRanks() {
  try {
    const { entries } = await api.leaderboard();
    UI.renderRanks(entries || [], App.user ? App.user.username : null);
  } catch (e) {
    UI.toast('Could not load leaderboard.', 'error');
  }
}

// ---------------- go ----------------
document.addEventListener('DOMContentLoaded', boot);
