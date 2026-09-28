// ============================================================
// engine.js — pure game logic for King of Project.
// No DOM access. Safe to unit-test in Node.
// Follows ~/workspace/rpg-server/API_CONTRACT.md exactly.
// ============================================================

// ---------------- Player cosmetic styles ----------------
// Custom button / background presets (Settings). Cosmetic only —
// unknown values normalize to 'default' in ensureState().
export const BTN_STYLE_IDS = ['default', 'ocean', 'crimson', 'emerald', 'gold', 'mono'];
export const BG_STYLE_IDS = ['default', 'deepspace', 'crimson', 'emerald', 'midnight', 'shadow-eyes', 'orbs', 'ember-drift'];

// ---------------- Level cap ----------------
// Hard level cap: no XP gains, GM grants, or loaded saves may push a
// character past this. Rebirth unlocks at MAX_LEVEL.
export const MAX_LEVEL = 70;

// ---------------- Guild perks ----------------
// Set by the guild module after fetching the player's guild (server-side
// guild level). Applied in computeStats / gainXp below. Defaults to no
// bonus so guests / guildless players are unaffected.
let GUILD_PERKS = { xpPct: 0, goldPct: 0, dmgPct: 0 };
export function setGuildPerks(p) {
  GUILD_PERKS = {
    xpPct: Math.max(0, Number(p && p.xpPct) || 0),
    goldPct: Math.max(0, Number(p && p.goldPct) || 0),
    dmgPct: Math.max(0, Number(p && p.dmgPct) || 0),
  };
}
export function getGuildPerks() {
  return { ...GUILD_PERKS };
}

// ---------------- Inn (AFK safe zone) ----------------
// Session-only rest state: while inside the inn combat is fully
// suspended (no damage in or out) and the hero regenerates.
// Pure functions — safe to unit-test in Node.
export const INN_REGEN_PER_SEC = 0.02; // 2% of max HP per second
export function innRegen(hp, maxHp, dt) {
  if (!(hp < maxHp) || !(maxHp > 0) || !(dt > 0)) return hp;
  return Math.min(maxHp, hp + maxHp * INN_REGEN_PER_SEC * dt);
}

// ---------------- Mining & Forging ----------------
// Mine tab: tap the rock to chip ores loose. Deeper rock unlocks rarer
// ore tiers. The Galaxy Forge (Gear tab) turns ores into Super Galaxy
// gear with player-chosen custom stats. Only ONE forged weapon and ONE
// forged armor can exist at a time — enforced structurally by the two
// forge slots below.
export const ORE_TIERS = [
  { id: 'copper',      name: 'Copper',            emoji: '🟤', power: 1,    unlockDepth: 1 },
  { id: 'iron',        name: 'Iron',              emoji: '⚙️', power: 3,    unlockDepth: 3 },
  { id: 'silver',      name: 'Silver',            emoji: '⚪', power: 8,    unlockDepth: 6 },
  { id: 'gold',        name: 'Gold Ore',          emoji: '🟡', power: 20,   unlockDepth: 10 },
  { id: 'mithril',     name: 'Mithril',           emoji: '🔷', power: 50,   unlockDepth: 15 },
  { id: 'adamant',     name: 'Adamant',           emoji: '🟣', power: 130,  unlockDepth: 21 },
  { id: 'galaxy',      name: 'Galaxy Shard',      emoji: '🌌', power: 350,  unlockDepth: 28 },
  { id: 'supergalaxy', name: 'Super Galaxy Core', emoji: '💜', power: 1000, unlockDepth: 36 },
];
export const ORE_BY_ID = Object.fromEntries(ORE_TIERS.map(o => [o.id, o]));
export const MAX_MINE_DEPTH = 60;

// Pickaxe tiers: each tier multiplies tap damage in mineDamage().
// Tier 0 is the starting stick (free). Upgrades cost the named ore +
// gold and are bought from the Mine tab via buyPickaxeUpgrade().
export const PICKAXE_TIERS = [
  { name: 'Cracked Stick',    emoji: '🪵', mult: 1,    cost: null },
  { name: 'Copper Pick',      emoji: '⛏️', mult: 1.6,  cost: { copper: 20, gold: 500 } },
  { name: 'Iron Pick',        emoji: '⛏️', mult: 2.5,  cost: { iron: 30, gold: 5000 } },
  { name: 'Steel Pick',       emoji: '⛏️', mult: 4,    cost: { iron: 40, silver: 20, gold: 50000 } },
  { name: 'Mithril Pick',     emoji: '⛏️', mult: 6.5,  cost: { mithril: 30, gold: 500000 } },
  { name: 'Adamant Pick',     emoji: '⛏️', mult: 10,   cost: { adamant: 25, gold: 5000000 } },
  { name: 'Galaxy Pick',      emoji: '🌌', mult: 16,   cost: { galaxy: 20, gold: 50000000 } },
  { name: 'Super Galaxy Pick',emoji: '💜', mult: 25,   cost: { supergalaxy: 10, gold: 500000000 } },
];
export const MAX_PICKAXE_TIER = PICKAXE_TIERS.length - 1;

// Forge tiers: pick a tier when crafting; higher tiers cost rarer ores
// and multiply the custom stat values. Super Galaxy is deliberately OP.
export const FORGE_TIERS = [
  { id: 'star',   name: 'Starforged',   emoji: '⭐', mult: 1,  cost: { iron: 25, silver: 10 } },
  { id: 'void',   name: 'Voidforged',   emoji: '🌑', mult: 3,  cost: { gold: 20, mithril: 10 } },
  { id: 'galaxy', name: 'Galaxyforged', emoji: '🌌', mult: 10, cost: { adamant: 15, galaxy: 8 } },
  { id: 'super',  name: 'Super Galaxy', emoji: '💜', mult: 30, cost: { galaxy: 10, supergalaxy: 5 } },
];
export const FORGE_TIER_BY_ID = Object.fromEntries(FORGE_TIERS.map(t => [t.id, t]));
// Craftable custom stats (pick up to MAX_FORGE_PICKS per item).
export const FORGE_STATS = ['attack', 'defense', 'maxHp', 'critChance', 'critDamage', 'lifesteal', 'attackSpeed', 'xpBonus', 'goldBonus'];
export const FORGE_STAT_BASE = {
  attack: 500, defense: 400, maxHp: 1500, critChance: 8, critDamage: 30,
  lifesteal: 3, attackSpeed: 0.15, xpBonus: 20, goldBonus: 20,
};
export const FORGE_STAT_EMOJI = {
  attack: '⚔️', defense: '🛡️', maxHp: '❤️', critChance: '🎯', critDamage: '💥',
  lifesteal: '🩸', attackSpeed: '👆', xpBonus: '✨', goldBonus: '💰',
};
export const MAX_FORGE_PICKS = 3;
export const CRAFT_STAT_CAP = 1e9; // sane upper bound: never Infinity
export const GALAXY_EQUIP_ID = 'galaxy'; // sentinel id in state.equipped

export function mineRockMaxHp(depth) {
  return Math.max(10, Math.round(30 * Math.pow(1.22, Math.max(1, depth) - 1)));
}
export function mineDamage(state) {
  const tapLvl = (state.upgrades && state.upgrades.tap) || 1;
  const base = Math.max(1, Math.round(4 + (state.level || 1) * 1.5 + (tapLvl - 1) * 4));
  // Equipped pickaxe multiplies tap damage (rounded).
  return Math.max(1, Math.round(base * pickaxeTier(state).mult));
}
// Defensive pickaxe tier lookup: clamps a tampered/missing value to 0..7.
export function pickaxeTier(state) {
  const raw = state && state.mine && state.mine.pickaxe;
  const idx = Number.isFinite(Number(raw))
    ? Math.max(0, Math.min(MAX_PICKAXE_TIER, Math.floor(Number(raw))))
    : 0;
  return PICKAXE_TIERS[idx];
}
// Cost object ({oreId: n, gold}) of the NEXT pickaxe tier, or null when
// already at MAX tier.
export function pickaxeUpgradeCost(state) {
  ensureMine(state);
  const next = PICKAXE_TIERS[state.mine.pickaxe + 1];
  return next && next.cost ? { ...next.cost } : null;
}
// Buy the next pickaxe tier. Returns true on success, or an error string
// (maxed / missing ore / missing gold). Deducts ores + gold (spendGold
// so the infinite-gold perk bypasses the gold cost).
export function buyPickaxeUpgrade(state) {
  ensureMine(state);
  const cur = state.mine.pickaxe;
  const next = PICKAXE_TIERS[cur + 1];
  if (!next || !next.cost) return 'Pickaxe is already at MAX tier.';
  const cost = next.cost;
  for (const [k, n] of Object.entries(cost)) {
    if (k === 'gold') continue;
    const have = state.mine.ores[k] || 0;
    if (have < n) {
      const od = ORE_BY_ID[k];
      return `Need ${n - have} more ${(od && od.name) || k}.`;
    }
  }
  const goldCost = cost.gold || 0;
  const goldHave = state.gold || 0;
  if (!spendGold(state, goldCost)) return `Need ${goldCost - goldHave} more gold.`;
  for (const [k, n] of Object.entries(cost)) {
    if (k === 'gold') continue;
    state.mine.ores[k] = Math.max(0, (state.mine.ores[k] || 0) - n);
  }
  state.mine.pickaxe = cur + 1;
  return true;
}
export function unlockedOres(depth) {
  return ORE_TIERS.filter(o => depth >= o.unlockDepth);
}
// Weighted roll among unlocked tiers; common ores drop more often.
export function rollOre(depth) {
  const tiers = unlockedOres(depth);
  if (!tiers.length) return 'copper';
  const n = tiers.length;
  let total = 0;
  const weights = tiers.map((_, i) => { const w = n - i; total += w; return w; });
  let r = Math.random() * total;
  for (let i = 0; i < tiers.length; i++) {
    r -= weights[i];
    if (r <= 0) return tiers[i].id;
  }
  return tiers[tiers.length - 1].id;
}
export function ensureMine(s) {
  if (!s.mine || typeof s.mine !== 'object') s.mine = {};
  const m = s.mine;
  m.depth = Math.max(1, Math.min(MAX_MINE_DEPTH, Math.floor(Number(m.depth) || 1)));
  m.rockMaxHp = mineRockMaxHp(m.depth);
  if (!Number.isFinite(Number(m.rockHp)) || m.rockHp < 0 || m.rockHp > m.rockMaxHp) {
    m.rockHp = m.rockMaxHp;
  }
  if (!m.ores || typeof m.ores !== 'object' || Array.isArray(m.ores)) m.ores = {};
  for (const o of ORE_TIERS) {
    const v = m.ores[o.id];
    m.ores[o.id] = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  }
  // Pickaxe tier (0..7) + lifetime mining counters. All default 0 and stay
  // finite/non-negative so tampered saves can't smuggle weird values in.
  const pk = Math.floor(Number(m.pickaxe));
  m.pickaxe = Number.isFinite(pk) ? Math.max(0, Math.min(MAX_PICKAXE_TIER, pk)) : 0;
  for (const k of ['totalTaps', 'totalMined', 'maxDepth']) {
    const v = m[k];
    m[k] = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  }
  if (!s.forge || typeof s.forge !== 'object') s.forge = {};
  // Forge lifetime counters (read by title unlocks): total crafts ever
  // plus whether a Super Galaxy item has ever been crafted.
  const f = s.forge;
  const cr = Math.floor(Number(f.crafts));
  f.crafts = Number.isFinite(cr) ? Math.max(0, cr) : 0;
  f.superCrafted = f.superCrafted === true;
  for (const slot of ['weapon', 'armor']) {
    const it = s.forge[slot];
    if (!it || typeof it !== 'object' || it.slot !== slot || !it.galaxy) {
      s.forge[slot] = null;
      continue;
    }
    // Normalize a forged item from an older save: finite stats, sane cap.
    const stats = {};
    for (const k of FORGE_STATS) {
      const v = it.stats && it.stats[k];
      stats[k] = Number.isFinite(v) ? Math.min(CRAFT_STAT_CAP, Math.max(0, v)) : 0;
    }
    it.stats = stats;
    it.enchant = 0;
    it.unsellable = true;
  }
  return s;
}
// One tap on the rock. Returns { ore, broke, bonus } for UI feedback.
export function mineTap(state) {
  ensureMine(state);
  const m = state.mine;
  const dmg = mineDamage(state);
  m.rockHp -= dmg;
  const ore = rollOre(m.depth);
  m.ores[ore] = (m.ores[ore] || 0) + 1;
  m.totalTaps++;
  m.totalMined++;
  let broke = false;
  const bonus = [];
  if (m.rockHp <= 0) {
    broke = true;
    const n = 3 + Math.floor(m.depth / 2);
    for (let i = 0; i < n; i++) {
      const b = rollOre(m.depth);
      m.ores[b] = (m.ores[b] || 0) + 1;
      m.totalMined++;
      bonus.push(b);
    }
    m.depth = Math.min(MAX_MINE_DEPTH, m.depth + 1);
    m.rockMaxHp = mineRockMaxHp(m.depth);
    m.rockHp = m.rockMaxHp;
  }
  m.maxDepth = Math.max(m.maxDepth, m.depth);
  return { ore, broke, bonus };
}
// Slow passive trickle while the game runs (called ~every 30s by the tick).
export function trickleOre(state) {
  ensureMine(state);
  const ore = rollOre(state.mine.depth);
  state.mine.ores[ore] = (state.mine.ores[ore] || 0) + 1;
  state.mine.totalMined++;
  return ore;
}
export function forgeCost(tierId) {
  const t = FORGE_TIER_BY_ID[tierId];
  return t ? { ...t.cost } : null;
}
export function canCraft(state, tierId) {
  ensureMine(state);
  const cost = forgeCost(tierId);
  if (!cost) return false;
  return Object.entries(cost).every(([ore, n]) => (state.mine.ores[ore] || 0) >= n);
}
function forgeStatValue(stat, mult) {
  const base = FORGE_STAT_BASE[stat] || 0;
  const v = base * mult;
  const r = (stat === 'attackSpeed') ? round1(v) : Math.round(v);
  return Math.min(CRAFT_STAT_CAP, r);
}
// Craft a galaxy item into the forge slot (weapon|armor). Reforging replaces
// the old item. Returns the item, or an error string.
export function craftGalaxyItem(state, slot, tierId, statIds) {
  ensureMine(state);
  if (slot !== 'weapon' && slot !== 'armor') return 'Invalid forge slot.';
  const tier = FORGE_TIER_BY_ID[tierId];
  if (!tier) return 'Invalid forge tier.';
  const picks = [...new Set((statIds || []).filter(s => FORGE_STATS.includes(s)))].slice(0, MAX_FORGE_PICKS);
  if (!picks.length) return 'Pick at least 1 stat to forge.';
  const cost = forgeCost(tierId);
  for (const [ore, n] of Object.entries(cost)) {
    if ((state.mine.ores[ore] || 0) < n) {
      const od = ORE_BY_ID[ore];
      return `Need ${n} ${(od && od.name) || ore}.`;
    }
  }
  for (const [ore, n] of Object.entries(cost)) state.mine.ores[ore] -= n;
  const stats = {};
  for (const s of picks) stats[s] = forgeStatValue(s, tier.mult);
  const item = {
    id: uid(), galaxy: true, unsellable: true, enchant: 0,
    name: `${tier.emoji} ${tier.name} ${slot === 'weapon' ? 'Blade' : 'Aegis'}`,
    slot, rarity: 'galaxy', forgeTier: tier.id, stats, value: 0,
  };
  state.forge[slot] = item;
  // Lifetime forge counters (read by title unlocks).
  state.forge.crafts = (state.forge.crafts || 0) + 1;
  if (tierId === 'super') state.forge.superCrafted = true;
  // If a galaxy item was equipped here it is replaced by the new one.
  if (state.equipped && state.equipped[slot] === GALAXY_EQUIP_ID) {
    // stays equipped — the new item takes effect immediately
  }
  return item;
}
export function galaxyItemFor(state, slot) {
  if (!state.forge || !state.forge[slot] || !state.forge[slot].galaxy) return null;
  return state.forge[slot];
}
export function equipGalaxy(state, slot) {
  if (slot !== 'weapon' && slot !== 'armor') return false;
  if (!galaxyItemFor(state, slot)) return false;
  if (!state.equipped) state.equipped = {};
  state.equipped[slot] = GALAXY_EQUIP_ID;
  return true;
}
export function unequipGalaxy(state, slot) {
  if (state.equipped && state.equipped[slot] === GALAXY_EQUIP_ID) {
    state.equipped[slot] = null;
    return true;
  }
  return false;
}

// ---------------- Races ----------------
export const RACES = {
  human:     { name: 'Human Vanguard', emoji: '🛡️', trait: 'Balanced: +10% XP gain',
               xpMult: 1.10 },
  orc:       { name: 'Orc Warborn',    emoji: '🪓', trait: '+20% attack, −5% dodge',
               atkMult: 1.20, dodgeMod: -5 },
  celestial: { name: 'Celestial',      emoji: '✨', trait: '+15% max HP, +2 HP/s regen',
               hpMult: 1.15, regenBonus: 2 },
  dragonkin: { name: 'Dragonkin',      emoji: '🐉', trait: '+25% crit damage',
               critDmgBonus: 25 },
  fae:       { name: 'Fae Vanguard',   emoji: '🧚', trait: '+10% dodge, +10% attack speed',
               dodgeBonus: 10, atkSpdMult: 1.10 },
  revenant:  { name: 'Revenant',       emoji: '💀', trait: '+5% lifesteal, +5% parry',
               lifestealBonus: 5, parryBonus: 5 },
};

// ---------------- Classes ----------------
// Permanent per-character choice (state.playerClass). Bonuses apply in
// computeStats; hunter's pet perks hook into petStrikeDamage / petFeedCost.
export const CLASSES = {
  hunter: {
    name: 'Hunter', emoji: '🏹',
    desc: 'Master of beasts. Field two pets at once — they fight harder and eat cheaper.',
    perks: ['Field 2 pets at once', 'Pets deal +50% damage', 'Feeding costs 30% less', '+5% dodge'],
    petDmgMult: 1.5, feedCostMult: 0.7, dodgeBonus: 5,
  },
  warrior: {
    name: 'Warrior', emoji: '⚔️',
    desc: 'An unbreakable wall. Outlasts anything the dark throws at you.',
    perks: ['+30% max HP', '+15% defense'],
    hpMult: 1.30, defMult: 1.15,
  },
  mage: {
    name: 'Mage', emoji: '🔮',
    desc: 'Glass cannon. Overwhelming power in a fragile frame.',
    perks: ['+25% attack', '+10% crit chance', '−10% max HP'],
    atkMult: 1.25, critChBonus: 10, hpMult: 0.90,
  },
  assassin: {
    name: 'Assassin', emoji: '🌙',
    desc: 'Strikes from shadow. Every hit could be the last one.',
    perks: ['+40% crit damage', '+10% dodge', '+5% attack speed'],
    critDmgBonus: 40, dodgeBonus: 10, atkSpdBonus: 0.05,
  },
};
export function classDef(id) { return CLASSES[id] || null; }

// ---------------- Specializations ----------------
// Second permanent choice (state.spec), picked after class. Any spec pairs
// with any class. Modifiers stack multiplicatively/additively with class
// bonuses in computeStats. 'classic' = no modifiers (original game feel).
export const SPECS = {
  tank: {
    name: 'Tank', emoji: '🛡️',
    desc: 'An immovable bulwark. Soak hits that would flatten anyone else.',
    perks: ['+20% max HP', '+20% defense', '−10% attack'],
    hpMult: 1.20, defMult: 1.20, atkMult: 0.90,
  },
  dps: {
    name: 'DPS', emoji: '⚔️',
    desc: 'Pure damage. End fights before they can hurt you.',
    perks: ['+20% attack', '+10% crit chance', '−10% defense'],
    atkMult: 1.20, critChBonus: 10, defMult: 0.90,
  },
  healer: {
    name: 'Healer', emoji: '💚',
    desc: 'Sustains through anything. Outlast the darkness.',
    perks: ['+3 HP/s regen', '+5% lifesteal', '+10% max HP'],
    regenBonus: 3, lifestealBonus: 5, hpMult: 1.10,
  },
  classic: {
    name: 'Classic', emoji: '📜',
    desc: 'The classic way — no specialization bonuses. Exactly the original feel.',
    perks: ['No bonuses', 'The original game feel'],
  },
};
export function specDef(id) { return SPECS[id] || null; }

// ---------------- Rarity / slots / stats ----------------
export const RARITIES = [
  { id: 'common',    weight: 50,  color: '#9aa0a6', stats: 1, mult: 1,   prefix: 'Iron' },
  { id: 'magic',     weight: 25,  color: '#4da3ff', stats: 2, mult: 1.6, prefix: 'Runed' },
  { id: 'rare',      weight: 13,  color: '#ffd23f', stats: 2, mult: 2.5, prefix: 'Gilded' },
  { id: 'epic',      weight: 7,   color: '#b366ff', stats: 3, mult: 4,   prefix: 'Arcane' },
  { id: 'legendary', weight: 3.5, color: '#ff8c1a', stats: 3, mult: 6.5, prefix: 'Mythril' },
  { id: 'mythic',    weight: 1.5, color: '#ff3b3b', stats: 4, mult: 10,  prefix: 'Eternal' },
];
export const RARITY_BY_ID = Object.fromEntries(RARITIES.map(r => [r.id, r]));
export const RARITY_IDX = Object.fromEntries(RARITIES.map((r, i) => [r.id, i]));

export const SLOTS = ['weapon', 'armor', 'helmet', 'boots', 'trinket'];
export const SLOT_INFO = {
  weapon:  { name: 'Weapon',  emoji: '⚔️' },
  armor:   { name: 'Armor',   emoji: '🛡️' },
  helmet:  { name: 'Helmet',  emoji: '⛑️' },
  boots:   { name: 'Boots',   emoji: '🥾' },
  trinket: { name: 'Trinket', emoji: '📿' },
};

export const STAT_LABELS = {
  attack: 'Attack', defense: 'Defense', maxHp: 'Max HP',
  critChance: 'Crit %', critDamage: 'Crit Dmg %',
  parry: 'Parry %', dodge: 'Dodge %', lifesteal: 'Lifesteal %',
  attackSpeed: 'Atk Speed', regen: 'Regen/s',
  goldBonus: 'Gold %', xpBonus: 'XP %',
};

// ---------------- Small utils ----------------
let _uidCounter = 0;
export function uid() {
  return 'i' + Date.now().toString(36) + (_uidCounter++).toString(36) +
    Math.floor(Math.random() * 1e6).toString(36);
}
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function round1(v) { return Math.round(v * 10) / 10; }
export function round2(v) { return Math.round(v * 100) / 100; }

// ---------------- State ----------------
export function defaultState(race) {
  return {
    race: race || null,
    mode: 'clicker',
    level: 1, xp: 0, xpNext: xpForLevel(1),
    gold: 0, stars: 0,
    stage: 1, bossesKilled: 0,
    rebirthCount: 0,
    hero: {
      hp: 100, maxHp: 100, attack: 10, defense: 2,
      critChance: 5, critDamage: 150, parry: 0, dodge: 5,
      lifesteal: 0, attackSpeed: 1.0, regen: 0,
    },
    party: [],
    inventory: [],
    equipped: { weapon: null, armor: null, helmet: null, boots: null, trinket: null },
    upgrades: { weapon: 1, armor: 1, skill: 1, tap: 1 },
    skills: ['power-strike'],
    companions: [],
    codesRedeemed: [],
    stats: { taps: 0, kills: 0, playTimeSec: 0, maxCombo: 0, questsCompleted: 0 },
    mastery: { points: 0, spent: { might: 0, vitality: 0, fortune: 0 } },
    professions: { herbalism: 1, smithing: 1 },
    achievements: [],
    titlesUnlocked: ['wanderer'],
    activeTitle: 'wanderer',
    badge: null,      // GM-granted creator badge id (e.g. 'youtuber') — shown on leaderboard
    country: null,    // ISO-3166 country code (e.g. 'US') — flag shown on leaderboard
    infGold: false,   // owner-only perk: infinite gold (purchases never deduct)
    restedUntil: 0,
    playerClass: null, // permanent class choice: hunter|warrior|mage|assassin (null = not chosen)
    spec: null,       // permanent specialization: tank|dps|healer|classic (null = not chosen)
    pets: { collection: [], activeUid: null, eggs: 0 }, // pet system (all players)
    mine: { depth: 1, rockHp: 30, rockMaxHp: 30, ores: {} }, // mining (backfilled by ensureMine)
    forge: { weapon: null, armor: null }, // at most ONE forged galaxy weapon + ONE forged armor
  };
}

// Merge a server blob with defaults so old/missing fields never crash the client.
export function ensureState(raw) {
  const d = defaultState('human');
  if (!raw || typeof raw !== 'object') { d.race = null; return d; }
  const s = { ...d, ...raw };
  if (!raw.race) s.race = null; // first run -> race select
  // Permanent class choice; unknown values reset to "not chosen".
  s.playerClass = (raw.playerClass && CLASSES[raw.playerClass]) ? raw.playerClass : null;
  // Permanent specialization; unknown values reset to "not chosen".
  s.spec = (raw.spec && SPECS[raw.spec]) ? raw.spec : null;
  s.hero = { ...d.hero, ...(raw.hero || {}) };
  s.equipped = { ...d.equipped, ...(raw.equipped || {}) };
  s.upgrades = { ...d.upgrades, ...(raw.upgrades || {}) };
  s.stats = { ...d.stats, ...(raw.stats || {}) };
  s.mastery = { points: 0, spent: {}, ...(raw.mastery || {}) };
  s.mastery.spent = { might: 0, vitality: 0, fortune: 0, ...(s.mastery.spent || {}) };
  s.mastery.points = Math.max(0, Math.floor(s.mastery.points || 0));
  s.professions = { herbalism: 1, smithing: 1, ...(raw.professions || {}) };
  if (!Array.isArray(s.achievements)) s.achievements = [];
  if (!Array.isArray(s.titlesUnlocked) || !s.titlesUnlocked.length) s.titlesUnlocked = ['wanderer'];
  if (typeof s.activeTitle !== 'string' || !s.activeTitle) s.activeTitle = s.titlesUnlocked[0];
  if (typeof s.badge !== 'string' || !BADGE_BY_ID[s.badge]) s.badge = null; // unknown badges cleared
  if (typeof s.country !== 'string' || !isValidCountry(s.country)) s.country = null;
  // Guide-chain progress flags (e.g. tabs visited for the onboarding quests).
  if (!s.guideTabs || typeof s.guideTabs !== 'object') s.guideTabs = {};
  // Custom button/background styles; unknown values reset to default.
  if (!BTN_STYLE_IDS.includes(s.btnStyle)) s.btnStyle = 'default';
  if (!BG_STYLE_IDS.includes(s.bgStyle)) s.bgStyle = 'default';
  // Audio prefs are cosmetic; unknown values reset to defaults
  // (SFX on, music off / opt-in).
  s.audio = { sfx: !s.audio || s.audio.sfx !== false, music: !!(s.audio && s.audio.music) };
  s.infGold = s.infGold === true; // owner-only perk flag
  s.restedUntil = Number(raw.restedUntil) || 0;
  // Clamp over-cap gold (e.g. after the owner lowers the cap). The
  // infinite-gold perk bypasses the cap entirely.
  if (s.infGold !== true && Number.isFinite(s.gold)) {
    s.gold = Math.min(Math.max(0, s.gold), GOLD_CAP);
  }
  ensurePets(s);
  if (!Array.isArray(s.party)) s.party = [];
  if (!Array.isArray(s.inventory)) s.inventory = [];
  // Notification prefs live on the save (per player / guest) so they sync with
  // the account. Backfill defaults: every category ON.
  if (!s.settings || typeof s.settings !== 'object') s.settings = {};
  if (!s.settings.notif || typeof s.settings.notif !== 'object') s.settings.notif = {};
  for (const cat of ['level', 'death', 'loot', 'quest']) {
    if (s.settings.notif[cat] === undefined) s.settings.notif[cat] = true;
  }
  // Animated background scene options (Settings → Background).
  if (!['violet', 'ember', 'gold'].includes(s.settings.eyeColor)) s.settings.eyeColor = 'violet';
  if (!Array.isArray(s.settings.orbColors) || s.settings.orbColors.length !== 3 ||
      !s.settings.orbColors.every((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))) {
    s.settings.orbColors = ['#a855f7', '#7c3aed', '#22d3ee'];
  }
  if (!Array.isArray(s.skills) || !s.skills.length) s.skills = ['power-strike'];
  // Old saves: grant every skill the player's current level has unlocked.
  for (const id of SKILL_ORDER) {
    if (s.level >= SKILLS[id].unlockLevel && !s.skills.includes(id)) s.skills.push(id);
  }
  // Old saves: skill-use counters for the mastery track (default 0 casts).
  if (!s.skillUses || typeof s.skillUses !== 'object') s.skillUses = {};
  for (const id of SKILL_ORDER) {
    if (!Number.isFinite(Number(s.skillUses[id]))) s.skillUses[id] = 0;
  }
  // Old saves: normalize enchant levels on inventory items (0–10 ints).
  for (const it of s.inventory) {
    it.enchant = Math.max(0, Math.min(ENCHANT_MAX, Math.floor(Number(it.enchant) || 0)));
  }
  ensureQuests(s); // backfill the quest board on old saves
  ensureStoryQuests(s); // backfill one-time class + mastery quests
  ensureMine(s); // backfill mining + forge slots on old saves
  if (!Array.isArray(s.codesRedeemed)) s.codesRedeemed = [];
  if (!Array.isArray(s.companions)) s.companions = [];
  if (!['clicker', 'auto', 'dungeon'].includes(s.mode)) s.mode = 'clicker';
  s.level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(s.level || 1)));
  // Legacy prestige saves: fold the old count into rebirths, drop the bonus.
  if (raw.rebirthCount === undefined && raw.prestigeCount !== undefined) s.rebirthCount = raw.prestigeCount;
  delete s.prestigeCount; delete s.prestigeBonus;
  // Achievement id rename: prestige-1 -> rebirth-1 (same feat, new name).
  if (Array.isArray(s.achievements)) {
    const i = s.achievements.indexOf('prestige-1');
    if (i !== -1) s.achievements[i] = 'rebirth-1';
  }
  s.rebirthCount = Math.max(0, Math.floor(s.rebirthCount || 0));
  s.stage = Math.max(1, Math.floor(s.stage || 1));
  s.xpNext = xpForLevel(s.level, s.rebirthCount);
  s.hero.hp = clamp(s.hero.hp, 0, s.hero.maxHp);
  for (const c of s.party) {
    c.hp = clamp(c.hp, 0, c.maxHp);
    if (!c.role) c.role = 'Companion';
    // Normalize companions from older saves: default missing level, and
    // backfill the recruit's base cost (used by the level-up cost curve)
    // by matching the recruit by id or name.
    c.level = Math.max(1, Math.floor(c.level || 1));
    if (!Number.isFinite(Number(c.baseCost)) || Number(c.baseCost) <= 0) {
      const r = (c.recruitId && RECRUIT_BY_ID[c.recruitId])
        || RECRUITS.find(x => x.name === c.name);
      c.baseCost = r ? r.cost : 50;
      if (r && !c.recruitId) c.recruitId = r.id;
    }
  }
  return s;
}

// ---------------- XP / levels / gold ----------------
// XP curve: 1.30 exponent for levels 1-60, then a steeper 1.42 exponent for
// 61-70. The value is continuous at the kink (level 60).
const xpForLevelBase = (level) => {
  const l = Math.max(1, Math.floor(level || 1));
  if (l <= 60) return 80 * Math.pow(1.30, l - 1);
  return 80 * Math.pow(1.30, 59) * Math.pow(1.42, l - 60);
};
// Rebirth scaling: every rebirth multiplies all XP requirements by
// 1.35^rebirths, so repeated climbs stay meaningful instead of trivial.
// Effective count is clamped at 200 so tampered values can't blow up the math.
export const MAX_EFFECTIVE_REBIRTHS = 200;
export const rebirthXpMult = (rebirthCount) =>
  Math.pow(1.35, Math.min(MAX_EFFECTIVE_REBIRTHS, Math.max(0, Math.floor(rebirthCount || 0))));
export const xpForLevel = (level, rebirthCount = 0) =>
  Math.max(1, Math.round(xpForLevelBase(level) * rebirthXpMult(rebirthCount)));
export const xpForKill = (stage) => Math.max(1, Math.round(8 * Math.pow(1.12, stage)));
// Deducts gold for a purchase. Returns false when the player can't afford
// it. Infinite-gold perk holders never pay.
export function spendGold(s, cost) {
  if (s.infGold) return true;
  if ((s.gold || 0) < cost) return false;
  s.gold -= cost;
  return true;
}

// Server gold cap (owner-adjustable, default 9000T). The client refreshes it
// from GET /api/settings at boot via setGoldCap().
let GOLD_CAP = 9e15;
export function setGoldCap(cap) {
  if (Number.isFinite(cap) && cap >= 1e12) GOLD_CAP = cap;
}
export function goldCap() { return GOLD_CAP; }

// Adds gold, clamped to the server gold cap. The infinite-gold perk bypasses
// the cap entirely. Returns the amount actually added.
export function addGold(s, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const cur = Math.max(0, Number(s.gold) || 0);
  if (s.infGold === true) { s.gold = cur + amount; return amount; }
  const room = Math.max(0, GOLD_CAP - cur);
  const added = Math.min(amount, room);
  s.gold = cur + added;
  return added;
}

export function goldForKill(stage, goldBonusPct = 0) {
  return Math.max(1, Math.round(
    6 * Math.pow(1.12, stage) *
    (1 + goldBonusPct / 100)
  ));
}

// Adds XP (applying race + gear + rested multipliers), handles level-ups.
// Level-up: +3 attack, +25 maxHp, +2 defense; heals 25% max HP.
// Every 10th level also grants a Mastery point.
// ---------------- Active skills ----------------
// Cooldown-only combat skills (no mana). power-strike is the default;
// the rest unlock automatically on level-up via gainXp().
export const SKILLS = {
  'power-strike': { name: 'Power Strike', emoji: '✨', unlockLevel: 1, cdMs: 12000, mult: 2.5,
    desc: 'A mighty blow dealing 2.5× attack damage.' },
  'fireball': { name: 'Fireball', emoji: '🔥', unlockLevel: 10, cdMs: 20000, mult: 3,
    desc: 'Hurl a fireball dealing 3× attack damage.' },
  'heal': { name: 'Heal', emoji: '💚', unlockLevel: 25, cdMs: 45000, healPct: 35,
    desc: 'Restore 35% of max HP.' },
  'execute': { name: 'Execute', emoji: '⚔️', unlockLevel: 40, cdMs: 30000, mult: 6, executeMult: 1.5, threshold: 0.3,
    desc: '6× damage if the enemy is below 30% HP, else 1.5×.' },
};
export const SKILL_ORDER = ['power-strike', 'fireball', 'heal', 'execute'];

// ---------------- Skill mastery ----------------
// Each active skill tracks lifetime casts in state.skillUses[id].
// Mastery level = min(10, floor(uses / 25)); each level grants +2%
// effectiveness (damage for strikes, healing for Heal).
export const MASTERY_USES_PER_LEVEL = 25;
export const MASTERY_MAX_LEVEL = 10;
export const MASTERY_PCT_PER_LEVEL = 0.02;

export function skillUses(state, id) {
  const m = state && state.skillUses;
  return (m && Number.isFinite(Number(m[id]))) ? Math.max(0, Math.floor(Number(m[id]))) : 0;
}
export function skillMastery(state, id) {
  const uses = skillUses(state, id);
  const level = Math.min(MASTERY_MAX_LEVEL, Math.floor(uses / MASTERY_USES_PER_LEVEL));
  return {
    uses,
    level,
    pct: level * MASTERY_PCT_PER_LEVEL,
    nextAt: (level + 1) * MASTERY_USES_PER_LEVEL,
  };
}
export function recordSkillUse(state, id) {
  if (!state || !SKILLS[id]) return null;
  if (!state.skillUses || typeof state.skillUses !== 'object') state.skillUses = {};
  const before = skillMastery(state, id).level;
  state.skillUses[id] = skillUses(state, id) + 1;
  const after = skillMastery(state, id);
  return { ...after, leveledUp: after.level > before };
}

export function gainXp(state, baseAmount, nowMs = Date.now()) {
  const race = RACES[state.race] || {};
  const stats = computeStats(state);
  const rested = state.restedUntil && nowMs < state.restedUntil;
  // Anti-power-creep: gear/stat XP bonuses are capped at +50% here.
  // computeStats() still reports the true total so tooltips stay truthful.
  // Guild XP perk (+2%/guild level, max +40%) stacks on top of the gear cap.
  const xpBonusPct = Math.min(50, stats.xpBonus || 0) + (GUILD_PERKS.xpPct || 0);
  const amount = Math.max(1, Math.round(
    baseAmount * (race.xpMult || 1) * (1 + xpBonusPct / 100) * (rested ? 1.25 : 1)
  ));
  state.xp += amount;
  const levels = [];
  let guard = 0;
  while (state.xp >= state.xpNext && guard++ < 10000 && state.level < MAX_LEVEL) {
    state.xp -= state.xpNext;
    state.level += 1;
    state.hero.attack += 3;
    state.hero.maxHp += 25;
    state.hero.defense += 2;
    state.xpNext = xpForLevel(state.level, state.rebirthCount);
    levels.push(state.level);
    if (state.level % 10 === 0 && state.mastery) state.mastery.points += 1;
  }
  if (state.level >= MAX_LEVEL) state.xp = 0; // cap reached: bank no XP past it
  if (levels.length) {
    const s2 = computeStats(state);
    state.hero.hp = Math.min(s2.maxHp, state.hero.hp + s2.maxHp * 0.25);
  }
  // Auto-unlock active skills whose level requirement was just met.
  if (!Array.isArray(state.skills)) state.skills = ['power-strike'];
  const newSkills = [];
  for (const id of SKILL_ORDER) {
    const def = SKILLS[id];
    if (def.unlockLevel <= state.level && !state.skills.includes(id)) {
      state.skills.push(id);
      newSkills.push(id);
    }
  }
  return { gained: amount, levels, skills: newSkills };
}

// ---------------- Quests ----------------
// Daily + weekly quest board. Progress uses snapshot baselines taken when
// quests roll, so leaving and returning never double-counts. All client-side
// in the save blob (gameplay is already client-simulated).
export const QUEST_DEFS = [
  { id: 'q-slay-d', period: 'daily', emoji: '⚔️', name: 'Monster Slayer', metric: 'kills', kind: 'gain',
    target: () => 150, desc: (t) => `Slay ${t} enemies` },
  { id: 'q-tap-d', period: 'daily', emoji: '👆', name: 'Relentless', metric: 'taps', kind: 'gain',
    target: () => 300, desc: (t) => `Tap ${t} times` },
  { id: 'q-stage-d', period: 'daily', emoji: '🗺️', name: 'Climber', metric: 'stage', kind: 'reach',
    target: (s) => (s.stage || 1) + 20, desc: (t) => `Reach stage ${t}` },
  { id: 'q-boss-d', period: 'daily', emoji: '👹', name: 'Boss Hunter', metric: 'bosses', kind: 'gain',
    target: () => 3, desc: (t) => `Defeat ${t} bosses` },
  { id: 'q-slay-w', period: 'weekly', emoji: '⚔️', name: 'Exterminator', metric: 'kills', kind: 'gain',
    target: () => 1200, desc: (t) => `Slay ${t} enemies` },
  { id: 'q-boss-w', period: 'weekly', emoji: '👹', name: 'Giantslayer', metric: 'bosses', kind: 'gain',
    target: () => 15, desc: (t) => `Defeat ${t} bosses` },
  { id: 'q-level-w', period: 'weekly', emoji: '⬆️', name: 'Ascendant', metric: 'level', kind: 'reach',
    target: (s) => Math.min(MAX_LEVEL, (s.level || 1) + 5), desc: (t) => `Reach level ${t}` },
  { id: 'q-raid-w', period: 'weekly', emoji: '🌀', name: 'Wave Rider', metric: 'raid', kind: 'reach',
    target: (s) => Math.max(10, ((s.raid && s.raid.best) || 0) + 5), desc: (t) => `Reach raid wave ${t}` },
];

// ---------------- One-time story quests ----------------
// Class questlines + the skill-mastery track. Unlike dailies/weeklies these
// never roll: each entry is created once (baseline snapshot at first sight)
// and stays until claimed. Class quests are only visible to that class.
export const STORY_QUEST_DEFS = [
  { id: 'q-mage-1', group: 'class', classId: 'mage', requiresSkill: 'fireball',
    emoji: '🔥', name: 'Spark of the Arcane',
    metric: 'fireballUses', kind: 'gain', target: 25,
    desc: (t) => `Cast Fireball ${t} times` },
  { id: 'q-mage-2', group: 'class', classId: 'mage',
    emoji: '⚔️', name: 'Battle Mage',
    metric: 'kills', kind: 'gain', target: 200,
    desc: (t) => `Defeat ${t} enemies as a mage` },
  { id: 'q-mage-3', group: 'class', classId: 'mage',
    emoji: '🔮', name: "Archmage's Trial",
    metric: 'level', kind: 'reach', target: 30,
    desc: (t) => `Reach level ${t} as a mage` },
  { id: 'q-mast-1', group: 'mastery',
    emoji: '🎯', name: "Novice's Focus",
    metric: 'mastery:power-strike', kind: 'reach', target: 2,
    desc: (t) => `Reach Power Strike Mastery ${t}` },
  { id: 'q-mast-2', group: 'mastery',
    emoji: '🌟', name: 'Seasoned Caster',
    metric: 'mastery:any', kind: 'reach', target: 5,
    desc: (t) => `Reach Mastery ${t} on any skill` },
  { id: 'q-mast-3', group: 'mastery',
    emoji: '👑', name: 'True Master',
    metric: 'mastery:any', kind: 'reach', target: 10,
    desc: (t) => `Reach Mastery ${t} on any skill` },
  // ---------------- Guided onboarding chain ----------------
  // One-time quests that introduce the game's systems one at a time, in the
  // order a new player should meet them. Each step unlocks only after the
  // previous one is claimed (see `requires` + storyQuestLockedReason).
  { id: 'q-guide-1', group: 'guide',
    emoji: '🗡️', name: 'First Blood',
    metric: 'kills', kind: 'gain', target: 1,
    desc: () => `Defeat 1 enemy (Battle tab)` },
  { id: 'q-guide-2', group: 'guide', requires: 'q-guide-1',
    emoji: '⛏️', name: 'Delve Deeper',
    metric: 'mine', kind: 'gain', target: 10,
    desc: (t) => `Mine ${t} ore (Mine tab)` },
  { id: 'q-guide-3', group: 'guide', requires: 'q-guide-2',
    emoji: '🐾', name: 'Loyal Companion',
    metric: 'pets', kind: 'gain', target: 1,
    desc: () => `Hatch or tame a pet (Party → Pets — try the cheap Stray Egg!)` },
  { id: 'q-guide-4', group: 'guide', requires: 'q-guide-3',
    emoji: '🔨', name: 'Forge Ahead',
    metric: 'forge', kind: 'gain', target: 1,
    desc: () => `Forge a Galaxy item or enchant any gear to +1 (Gear tab)` },
  { id: 'q-guide-5', group: 'guide', requires: 'q-guide-4',
    emoji: '🏰', name: 'Strength in Numbers',
    metric: 'guild', kind: 'reach', target: 1,
    desc: () => `Visit the Guilds tab (join one for perks!)` },
  { id: 'q-guide-6', group: 'guide', requires: 'q-guide-5',
    emoji: '👑', name: 'Make a Name',
    metric: 'title', kind: 'reach', target: 1,
    desc: () => `Equip a title (Titles tab)` },
  { id: 'q-guide-7', group: 'guide', requires: 'q-guide-6',
    emoji: '🌿', name: 'Specialize',
    metric: 'profession', kind: 'reach', target: 1,
    desc: () => `Invest a point in a profession (Settings → Professions)` },
  { id: 'q-guide-8', group: 'guide', requires: 'q-guide-7',
    emoji: '📜', name: 'Daily Grind',
    metric: 'questsCompleted', kind: 'gain', target: 1,
    desc: () => `Complete any daily or weekly quest — you're on your own now!` },
];

export function storyQuestVisible(state, def) {
  if (def.group === 'class' && (!state || state.playerClass !== def.classId)) return false;
  return true;
}

// Sequential gating for the guided onboarding chain: a quest with
// `requires` stays locked until the named quest is claimed.
export function storyQuestLockedReason(state, def) {
  if (!def || !def.requires) return null;
  const prev = STORY_QUEST_DEFS.find((d) => d.id === def.requires);
  const entry = (state && state.quests && Array.isArray(state.quests.story))
    ? state.quests.story.find((e) => e.id === def.requires) : null;
  if (entry && entry.claimed) return null;
  return `Complete “${prev ? prev.name : def.requires}” first`;
}

// Creates missing story entries once (with baseline snapshots for 'gain'
// quests so prior progress never double-counts). Safe to call often.
export function ensureStoryQuests(state, nowMs = Date.now()) {
  ensureQuests(state, nowMs);
  const q = state.quests;
  if (!Array.isArray(q.story)) q.story = [];
  for (const def of STORY_QUEST_DEFS) {
    if (!q.story.find((e) => e.id === def.id)) {
      q.story.push({
        id: def.id,
        target: def.target,
        base: questMetric(state, def.metric),
        claimed: false,
      });
    }
  }
  return q.story;
}

export function storyQuestProgress(state, entry) {
  const def = STORY_QUEST_DEFS.find((d) => d.id === entry.id);
  if (!def) return { progress: 0, target: 1, complete: false, def: null };
  const cur = questMetric(state, def.metric);
  const progress = def.kind === 'reach' ? cur : Math.max(0, cur - (entry.base || 0));
  return { progress, target: entry.target, complete: progress >= entry.target, def };
}

function questMetric(state, metric) {
  // Mastery metrics: 'mastery:<skill-id>' or 'mastery:any' (best skill level).
  if (typeof metric === 'string' && metric.startsWith('mastery:')) {
    const which = metric.slice('mastery:'.length);
    if (which === 'any') return Math.max(0, ...SKILL_ORDER.map((id) => skillMastery(state, id).level));
    return skillMastery(state, which).level;
  }
  switch (metric) {
    case 'taps': return (state.stats && state.stats.taps) || 0;
    case 'kills': return (state.stats && state.stats.kills) || 0;
    case 'bosses': return state.bossesKilled || 0;
    case 'stage': return state.stage || 1;
    case 'level': return state.level || 1;
    case 'raid': return (state.raid && state.raid.best) || 0;
    case 'fireballUses': return skillUses(state, 'fireball');
    case 'mine': return ((state.mine || {}).totalMined) || 0;
    case 'pets': return (state.pets && Array.isArray(state.pets.collection)) ? state.pets.collection.length : 0;
    case 'guild': return (state.guideTabs && state.guideTabs.guild) ? 1 : 0;
    case 'questsCompleted': return (state.stats && state.stats.questsCompleted) || 0;
    case 'title': return (state.activeTitle && state.activeTitle !== 'wanderer') ? 1 : 0;
    case 'profession': {
      const prof = state.professions || {};
      return Math.max(1, ...Object.values(prof).map((v) => Number(v) || 1)) > 1 ? 1 : 0;
    }
    case 'forge': {
      const f = state.forge || {};
      let n = (f.weapon ? 1 : 0) + (f.armor ? 1 : 0);
      // Enchanting any gear to +1 also counts as "forging ahead".
      const slots = state.equipped || {};
      const inv = Array.isArray(state.inventory) ? state.inventory : [];
      const items = [...Object.values(slots), ...inv];
      if (items.some((it) => it && Number(it.enchant) > 0)) n += 1;
      return n;
    }
    default: return 0;
  }
}

export function questDailyKey(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

export function questWeeklyKey(nowMs = Date.now()) {
  // ISO week id YYYY-Www (UTC).
  const d = new Date(nowMs);
  const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  thu.setUTCDate(thu.getUTCDate() - ((thu.getUTCDay() + 6) % 7) + 3);
  const firstThu = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  firstThu.setUTCDate(firstThu.getUTCDate() - ((firstThu.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((thu - firstThu) / (7 * 864e5));
  return `${thu.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rollQuestSet(state, period, key, count) {
  const pool = QUEST_DEFS.filter((q) => q.period === period);
  const rnd = mulberry32(hashStr(key + ':' + period));
  const order = pool.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, count).map((def) => ({
    id: def.id,
    target: def.target(state),
    base: questMetric(state, def.metric),
    claimed: false,
  }));
}

// Rolls fresh quest sets when the day/week key changes. Safe to call often.
export function ensureQuests(state, nowMs = Date.now()) {
  if (!state.quests || typeof state.quests !== 'object') state.quests = {};
  const q = state.quests;
  const dk = questDailyKey(nowMs);
  if (q.dailyKey !== dk || !Array.isArray(q.daily)) {
    q.dailyKey = dk;
    q.daily = rollQuestSet(state, 'daily', dk, 3);
  }
  const wk = questWeeklyKey(nowMs);
  if (q.weeklyKey !== wk || !Array.isArray(q.weekly)) {
    q.weeklyKey = wk;
    q.weekly = rollQuestSet(state, 'weekly', wk, 2);
  }
  return q;
}

export function questProgress(state, entry) {
  const def = QUEST_DEFS.find((d) => d.id === entry.id);
  if (!def) return { progress: 0, target: 1, complete: false, def: null };
  const cur = questMetric(state, def.metric);
  const progress = def.kind === 'reach' ? cur : Math.max(0, cur - (entry.base || 0));
  return { progress, target: entry.target, complete: progress >= entry.target, def };
}

// Reward preview (also used by claimQuest). Scales with level at claim time.
export function questRewardPreview(state, period) {
  const L = Math.max(1, state.level || 1);
  if (period === 'weekly') {
    return { gold: 10000 * L, stars: 40, xp: Math.round(xpForLevel(L) * 1.5) };
  }
  if (period === 'story') {
    return { gold: 5000 * L, stars: 20, xp: Math.round(xpForLevel(L) * 0.75) };
  }
  return { gold: 2000 * L, stars: 8, xp: Math.round(xpForLevel(L) * 0.3) };
}

export function claimQuest(state, period, id, nowMs = Date.now()) {
  ensureQuests(state, nowMs);
  ensureStoryQuests(state, nowMs);
  const list = period === 'weekly' ? state.quests.weekly
    : period === 'story' ? state.quests.story
    : state.quests.daily;
  const entry = (list || []).find((e) => e.id === id);
  if (!entry || entry.claimed) return { ok: false };
  const prog = period === 'story' ? storyQuestProgress(state, entry) : questProgress(state, entry);
  if (!prog.complete) return { ok: false };
  // Defense in depth: class quests can't be claimed by another class even if
  // a crafted client sends the id.
  if (period === 'story') {
    const def = STORY_QUEST_DEFS.find((d) => d.id === id);
    if (!def || !storyQuestVisible(state, def)) return { ok: false };
    // Guided chain: a step can't be claimed before its prerequisite.
    if (storyQuestLockedReason(state, def)) return { ok: false };
  }
  entry.claimed = true;
  const rw = questRewardPreview(state, period);
  addGold(state, rw.gold);
  if (!state.stats || typeof state.stats !== 'object') state.stats = {};
  state.stats.questsCompleted = Math.max(0, Math.floor(Number(state.stats.questsCompleted) || 0)) + 1;
  state.stars = Math.min(1e15, Math.max(0, Number(state.stars) || 0) + rw.stars);
  const xpRes = gainXp(state, rw.xp, nowMs);
  return { ok: true, rewards: rw, levels: xpRes.levels, skills: xpRes.skills };
}

// ---------------- Worlds ----------------
// Battle areas unlocked at stage thresholds. Each world has its own enemy
// roster, boss roster, tagline, and ambient background scene. Enemy STATS
// still scale purely with stage (see enemyFor) — worlds change who you fight
// and the art direction, never the numbers (balance-neutral by design).
const _E = (name, emoji) => ({ name, emoji });
export const WORLDS = [
  { id: 'gloomwood', name: 'Gloomwood', emoji: '🌲', minStage: 1,
    bgScene: 'shadow-eyes', tagline: 'Where the dark first learned to hunt.',
    enemies: [
      _E('Gloomfang Wolf', '🐺'), _E('Moss Troll', '🧌'), _E('Cave Stalker', '🥷'),
      _E('Ridgeback Boar', '🐗'), _E('Thorn Lurker', '🦔'), _E('Dusk Panther', '🐆'),
      _E('Hollow Bat', '🦇'), _E('Plague Rat', '🐀'), _E('Frost Wisp', '👻'),
      _E('Grave Hound', '🐕'),
    ],
    bosses: [ _E('Warlord Ghash', '👹'), _E('Broodmother Xix', '🕷️'),
      _E('The Briar Tyrant', '🌳'), _E('Duskmaw the Render', '🐺'),
      _E('The Hollow Druid', '🧙'), _E('Carrion Queen Vess', '🦅'),
      _E('Thornback Colossus', '🦏'), _E('The Weeping Treant', '🌲') ] },
  { id: 'ember-wastes', name: 'Ember Wastes', emoji: '🔥', minStage: 100,
    bgScene: 'ember-drift', tagline: 'Ash falls like snow. Nothing here forgives.',
    enemies: [
      _E('Ember Imp', '👺'), _E('Cinder Sprite', '🔥'), _E('Ash Serpent', '🐍'),
      _E('Crimson Slime', '🩸'), _E('Sand Reaver', '🦂'), _E('Rune Scarab', '🪲'),
      _E('Stone Sentinel', '🗿'), _E('Mire Shambler', '🧟'), _E('Dark Acolyte', '🧙'),
      _E('Bone Archer', '💀'),
    ],
    bosses: [ _E('Ancient Wyrm Vex', '🐉'), _E('Dreadlord Malachar', '😈'),
      _E('The Cinder Matriarch', '🔥'), _E('Ashfall Behemoth', '🦣'),
      _E('Pyrelord Ignix', '👺'), _E('The Obsidian Golem', '🗿'),
      _E('Searwing Terror', '🦇'), _E('The Scorched Prophet', '🧙') ] },
  { id: 'void-abyss', name: 'The Void Abyss', emoji: '🌀', minStage: 250,
    bgScene: 'void-tide', tagline: 'Below the world, the dark dreams of you.',
    enemies: [
      _E('Void Stalker', '🌀'), _E('Abyss Maw', '👁️'), _E('Null Wraith', '🌫️'),
      _E('Rift Horror', '🕳️'), _E('Umbral Knight', '⚔️'), _E('Nether Wisp', '💫'),
      _E('Gloom Devourer', '🧛'), _E('Duskrend Hound', '🐕‍🦺'),
    ],
    bosses: [ _E('Voidlord Zerath', '🌌'), _E('The Starless One', '🌑'),
      _E('Riftmother Nyx', '🕳️'), _E('The Unraveled King', '👑'),
      _E('Duskmother Vhara', '🧛'), _E('The Silent Maw', '👁️'),
      _E('Nulltide Leviathan', '🐋'), _E('The Fractured Saint', '💫') ] },
  { id: 'throne-of-shadows', name: 'Throne of Shadows', emoji: '👑', minStage: 500,
    bgScene: 'throne-storm', tagline: 'Kneel. The Throne is waiting.',
    enemies: [
      _E('Shadow Acolyte', '🌒'), _E('Throne Guard', '🛡️'), _E('Nightmare Spawn', '😱'),
      _E('Umbral Assassin', '🎭'), _E('Dread Herald', '📯'), _E('Soul Reaver', '🪦'),
      _E('Dread Leech', '🪱'), _E('Gloom Herald', '🌚'),
    ],
    bosses: [ _E('The Hollow King', '👑'), _E('The Shadow Sovereign', '🖤'),
      _E('The Gloom Empress', '👸'), _E('Dread Inquisitor Morvain', '⚔️'),
      _E('The Pale Chancellor', '🎭'), _E('Nightmare Herald Xhul', '😱'),
      _E('The Thronebreaker', '🛡️'), _E('Umbral Pontiff Vexar', '🌚') ] },
];
export function worldForStage(stage) {
  let w = WORLDS[0];
  for (const cand of WORLDS) if ((stage || 1) >= cand.minStage) w = cand;
  return w;
}

export const isBossStage = (stage) => stage % 10 === 0;

// Balance: normal enemies are weaker (less HP, die faster) but still hit
// hard; no single hit can ever one-shot (capped in enemyStrike). Boss
// damage is tuned "around your level" when player stats are provided.
export function enemyFor(stage, playerStats = null) {
  const boss = isBossStage(stage);
  const world = worldForStage(stage);
  const hp = Math.round(18 * Math.pow(1.125, stage) * (boss ? 1 : 0.6));
  const atk = Math.round(4 * Math.pow(1.085, stage));
  const roster = boss ? world.bosses : world.enemies;
  // Boss identity is deterministic per stage: the announced boss and the
  // spawned boss can never disagree, even when a death-respawn or a delayed
  // spawn re-rolls the same stage. Normal enemies stay random for variety.
  const roll = boss ? mulberry32(((stage * 2654435761) >>> 0))() : Math.random();
  const foe = roster[Math.floor(roll * roster.length)] || { name: 'Shade', emoji: '👹' };
  let attack = boss ? Math.round(atk * 1.35) : atk;
  if (boss && playerStats && playerStats.maxHp > 0) {
    // Bosses hit around your level: after your defense, a clean hit lands
    // between 15% and 30% of your max HP — threatening, never a one-shot.
    const def = Math.max(0, playerStats.defense || 0);
    const lo = def + playerStats.maxHp * 0.15;
    const hi = def + playerStats.maxHp * 0.30;
    attack = Math.max(1, Math.round(Math.min(Math.max(attack, lo), hi)));
  }
  return {
    name: foe.name,
    stage, boss,
    hp: boss ? Math.round(hp * 2.5) : hp,
    maxHp: boss ? Math.round(hp * 2.5) : hp,
    attack,
    emoji: foe.emoji,
    world: world.id,
  };
}

// ---------------- Enchanting ----------------
// Items carry `enchant` 0–10 (backfilled as 0 on old saves). Every numeric
// gear stat is multiplied by (1 + 0.08 × level). Enchants live on the item,
// so they survive rebirth.
export const ENCHANT_MAX = 10;
export const ENCHANT_PCT = 0.08;
const ENCHANT_BASE_COST = {
  common: 100, magic: 500, rare: 2500, epic: 15000, legendary: 100000, mythic: 500000,
};
export function enchantLevel(item) {
  return Math.min(ENCHANT_MAX, Math.max(0, (item && item.enchant) | 0));
}
export function enchantMult(item) {
  return 1 + ENCHANT_PCT * enchantLevel(item);
}
export function enchantCost(item) {
  const lvl = enchantLevel(item);
  const base = ENCHANT_BASE_COST[item && item.rarity] || 100;
  return Math.round(base * Math.pow(lvl + 1, 2));
}

// ---------------- Combat ----------------
// Effective hero stats = base + level gains + equipped gear,
// x race traits x upgrade multipliers x full-set bonus.
export function computeStats(state) {
  const race = RACES[state.race] || {};
  const cls = CLASSES[state.playerClass] || {};
  const spec = SPECS[state.spec] || {};
  const gear = {};
  for (const k of Object.keys(STAT_LABELS)) gear[k] = 0;
  for (const slot of SLOTS) {
    const id = state.equipped && state.equipped[slot];
    if (!id) continue;
    // Forged galaxy gear lives in state.forge, not the inventory.
    const item = id === GALAXY_EQUIP_ID
      ? galaxyItemFor(state, slot)
      : (state.inventory || []).find(i => i.id === id);
    if (!item || item.slot !== slot || !item.stats) continue;
    const em = enchantMult(item);
    for (const [k, v] of Object.entries(item.stats)) {
      if (k in gear && Number.isFinite(v)) gear[k] += v * em;
    }
  }
  const setInfo = equippedSetInfo(state);
  const setMult = 1 + (setInfo ? setInfo.pct : 0) / 100;
  // Earnable player sets: 3pc / 5pc bonuses (see PLAYER_SETS).
  const pSetInfo = playerSetInfo(state);
  let pAtkMult = 1, pDefMult = 1, pHpMult = 1;
  let pCritCh = 0, pAtkSpd = 0, pDodge = 0;
  for (const [setId, count] of Object.entries(equippedPlayerSets(state))) {
    if (count < 3) continue;
    const five = count >= 5;
    if (setId === 'emberheart') {
      pAtkMult *= five ? 1.30 : 1.15;
      if (five) pCritCh += 10;
    } else if (setId === 'frostbound') {
      pHpMult *= five ? 1.40 : 1.20;
      if (five) pDefMult *= 1.20;
    } else if (setId === 'stormcaller') {
      pAtkSpd += five ? 0.35 : 0.20;
      if (five) pDodge += 12;
    }
  }
  // Mastery talents + professions (original systems, WoW-inspired).
  const tal = (state.mastery && state.mastery.spent) || {};
  const mightMult = 1 + 0.04 * (tal.might || 0);
  const vitMult = 1 + 0.04 * (tal.vitality || 0);
  const prof = state.professions || {};
  const smithMult = 1 + 0.015 * (prof.smithing || 1);
  const herbRegen = 0.5 * (prof.herbalism || 1);
  const up = state.upgrades || { weapon: 1, armor: 1, skill: 1 };
  const dmgUpMult = Math.pow(1.12, Math.max(0, up.weapon - 1)) *
                    Math.pow(1.12, Math.max(0, up.skill - 1));
  const defUpMult = Math.pow(1.12, Math.max(0, up.armor - 1));
  // Pet bond: flat bonuses from the ACTIVE pet, added AFTER all multiplicative
  // bonuses (predictable, no double-dipping). Hunger-gated; benched pets give nothing.
  const bond = petBond(state);
  // Guild perks: multiplicative damage, additive XP/gold percentages.
  const gp = GUILD_PERKS;
  const guildDmgMult = 1 + (gp.dmgPct || 0) / 100;
  const h = state.hero;
  return {
    attack: Math.max(1, (h.attack + gear.attack) * (race.atkMult || 1) * (cls.atkMult || 1) * (spec.atkMult || 1) * setMult * pAtkMult * dmgUpMult * mightMult * smithMult * guildDmgMult + bond.atk),
    defense: Math.max(0, (h.defense + gear.defense) * defUpMult * setMult * pDefMult * (cls.defMult || 1) * (spec.defMult || 1) + bond.def),
    maxHp: Math.max(1, Math.round((h.maxHp + gear.maxHp) * (race.hpMult || 1) * (cls.hpMult || 1) * (spec.hpMult || 1) * setMult * pHpMult * vitMult) + bond.hp),
    critChance: clamp(h.critChance + gear.critChance + pCritCh + (cls.critChBonus || 0) + (spec.critChBonus || 0), 0, 100),
    critDamage: Math.max(100, h.critDamage + gear.critDamage + (race.critDmgBonus || 0) + (cls.critDmgBonus || 0)),
    parry: clamp(h.parry + gear.parry + (race.parryBonus || 0), 0, 60),
    dodge: clamp(h.dodge + gear.dodge + pDodge + (race.dodgeBonus || 0) + (race.dodgeMod || 0) + (cls.dodgeBonus || 0), 0, 75),
    lifesteal: Math.max(0, h.lifesteal + gear.lifesteal + (race.lifestealBonus || 0) + (spec.lifestealBonus || 0)),
    attackSpeed: clamp((h.attackSpeed + gear.attackSpeed + pAtkSpd + (cls.atkSpdBonus || 0)) * (race.atkSpdMult || 1), 0.2, 5),
    regen: Math.max(0, h.regen + gear.regen + (race.regenBonus || 0) + (spec.regenBonus || 0) + herbRegen),
    goldBonus: gear.goldBonus + (gp.goldPct || 0),
    xpBonus: gear.xpBonus,
    talentGoldPct: 4 * (tal.fortune || 0),
    setInfo,
    playerSetInfo: pSetInfo,
    bond,
  };
}

// Hero (or companion) attacks the enemy. Returns {dmg, crit}.
export function playerAttack(stats, enemy) {
  const crit = Math.random() * 100 < stats.critChance;
  const raw = stats.attack * (crit ? stats.critDamage / 100 : 1);
  return { dmg: Math.max(1, Math.round(raw)), crit };
}

// Enemy strikes a defender with `stats`. Returns {dmg, dodged, parried, counter}.
export function enemyStrike(stats, enemyAttack) {
  const r = Math.random() * 100;
  if (r < stats.dodge) return { dmg: 0, dodged: true, parried: false, counter: 0 };
  if (r < stats.dodge + stats.parry) {
    return { dmg: 0, dodged: false, parried: true, counter: Math.max(1, Math.round(stats.attack * 0.5)) };
  }
  let dmg = Math.max(1, Math.round(enemyAttack - stats.defense));
  // One-shot guard: a single hit can never deal more than 60% of max HP.
  if (stats.maxHp > 0) dmg = Math.min(dmg, Math.max(1, Math.ceil(stats.maxHp * 0.6)));
  return { dmg, dodged: false, parried: false, counter: 0 };
}

// ---------------- Loot ----------------
export function rollRarity(minIdx = 0) {
  const pool = RARITIES.map((r, i) => ({ r, i })).filter(x => x.i >= minIdx);
  const total = pool.reduce((a, x) => a + x.r.weight, 0);
  let roll = Math.random() * total;
  for (const x of pool) { roll -= x.r.weight; if (roll <= 0) return x.r; }
  return pool[pool.length - 1].r;
}

const SLOT_NAMES = {
  weapon: ['Blade', 'Sword', 'Axe', 'Dagger'],
  armor: ['Plate', 'Mail', 'Carapace'],
  helmet: ['Helm', 'Crown', 'Hood'],
  boots: ['Boots', 'Greaves', 'Treads'],
  trinket: ['Charm', 'Idol', 'Sigil'],
};
const SUFFIX = {
  attack: 'of the Tiger', defense: 'of the Bear', maxHp: 'of the Ox',
  critChance: 'of the Falcon', critDamage: 'of Ruin', parry: 'of the Wall',
  dodge: 'of Shadows', lifesteal: 'of the Leech', attackSpeed: 'of Swiftness',
  regen: 'of Renewal', goldBonus: 'of Greed', xpBonus: 'of Wisdom',
};
const STAT_GEN = {
  attack:      (m, s) => Math.max(1, Math.round((2 + s * 1.0) * m)),
  defense:     (m, s) => Math.max(1, Math.round((1 + s * 0.6) * m)),
  maxHp:       (m, s) => Math.max(5, Math.round((12 + s * 5.5) * m)),
  critChance:  (m) => round1(1 + m * 0.9),
  critDamage:  (m) => Math.round(4 + m * 6),
  parry:       (m) => round1(0.5 + m * 0.7),
  dodge:       (m) => round1(0.5 + m * 0.8),
  lifesteal:   (m) => round1(0.5 + m * 0.6),
  attackSpeed: (m) => round2(0.04 + m * 0.03),
  regen:       (m, s) => round1((0.5 + s * 0.15) * m),
  goldBonus:   (m) => Math.round(2 + m * 4),
  xpBonus:     (m) => Math.round(2 + m * 4),
};
const SLOT_PRIMARY = { weapon: 'attack', armor: 'defense', helmet: 'maxHp', boots: 'dodge', trinket: 'lifesteal' };

// Builds one random-rarity item for a slot with stage-scaled stats.
// Used by rollLoot (drops) and the Gear Shop (purchases). Never produces
// privileged gear: shop/drop items always have set: null.
export function makeLootItem(stage, rarityId, slot) {
  const rarity = RARITY_BY_ID[rarityId] || RARITIES[0];
  const stats = {};
  const primary = SLOT_PRIMARY[slot];
  stats[primary] = STAT_GEN[primary](rarity.mult, stage);
  const pool = Object.keys(STAT_GEN).filter(k => k !== primary);
  for (let i = 1; i < rarity.stats && pool.length; i++) {
    const k = pick(pool);
    pool.splice(pool.indexOf(k), 1);
    stats[k] = STAT_GEN[k](rarity.mult, stage);
  }
  const rIdx = RARITY_IDX[rarity.id];
  let name = `${rarity.prefix} ${pick(SLOT_NAMES[slot])}`;
  if (rIdx >= 2 && SUFFIX[primary]) name += ` ${SUFFIX[primary]}`;
  return {
    id: uid(), name, slot, rarity: rarity.id,
    stats, set: null, setName: null,
    value: Math.max(1, Math.round((4 + stage * 1.5) * rarity.mult)),
    unsellable: false,
  };
}

// Returns an item or null. Drop chances (set pieces see rollSetDrop):
// normal enemies 10%, bosses 80% (rare+ guaranteed, raid bosses epic+).
export function rollLoot(stage, isBoss = false, minIdx = null) {
  if (Math.random() > (isBoss ? 0.80 : 0.10)) return null;
  const rarity = rollRarity(minIdx !== null ? minIdx : (isBoss ? 2 : 0));
  return makeLootItem(stage, rarity.id, pick(SLOTS));
}

export function equipItem(state, itemId) {
  const item = (state.inventory || []).find(i => i.id === itemId);
  if (!item) return false;
  state.equipped[item.slot] = itemId;
  return true;
}

// Sells an item, returns gold gained (0 if not found / unsellable).
export function sellItem(state, itemId) {
  const idx = (state.inventory || []).findIndex(i => i.id === itemId);
  if (idx < 0) return 0;
  const item = state.inventory[idx];
  if (item.unsellable) return 0;
  if (state.equipped[item.slot] === itemId) state.equipped[item.slot] = null;
  state.inventory.splice(idx, 1);
  const gold = Math.max(1, Math.round(item.value || 1));
  return addGold(state, gold);
}

// ---------------- Privileged gear sets ----------------
// Fixed stats, granted via gift codes / GM console / staff roster.
export const PRIVILEGED_SETS = {
  sovereign: {
    name: 'Sovereign Founder\'s Regalia', minRole: 'owner', setBonus: 100,
    pieces: {
      weapon:  { name: 'Sovereign Blade',  stats: { attack: 500, critDamage: 50 } },
      armor:   { name: 'Sovereign Aegis',  stats: { defense: 500, maxHp: 2000 } },
      helmet:  { name: 'Sovereign Crown',  stats: { critChance: 15, attack: 250 } },
      boots:   { name: 'Sovereign Greaves', stats: { dodge: 10, attackSpeed: 0.2, defense: 200 } },
      trinket: { name: 'Sovereign Sigil',  stats: { lifesteal: 5, regen: 20, xpBonus: 50 } },
    },
  },
  fateweaver: {
    name: 'Fateweaver Regalia', minRole: 'gm', setBonus: 60,
    pieces: {
      weapon:  { name: 'Fateweaver Edge',    stats: { attack: 300, critDamage: 30 } },
      armor:   { name: 'Fateweaver Shroud',  stats: { defense: 300, maxHp: 1200 } },
      helmet:  { name: 'Fateweaver Circlet', stats: { critChance: 9, attack: 150 } },
      boots:   { name: 'Fateweaver Steps',   stats: { dodge: 6, attackSpeed: 0.12, defense: 120 } },
      trinket: { name: 'Fateweaver Thread',  stats: { lifesteal: 3, regen: 12, xpBonus: 30 } },
    },
  },
  warden: {
    name: 'Admin Warden Arsenal', minRole: 'admin', setBonus: 35,
    pieces: {
      weapon:  { name: 'Warden Brand',   stats: { attack: 175, critDamage: 18 } },
      armor:   { name: 'Warden Bulwark', stats: { defense: 175, maxHp: 700 } },
      helmet:  { name: 'Warden Helm',    stats: { critChance: 5, attack: 90 } },
      boots:   { name: 'Warden Treads',  stats: { dodge: 4, attackSpeed: 0.07, defense: 70 } },
      trinket: { name: 'Warden Badge',   stats: { lifesteal: 2, regen: 7, xpBonus: 17 } },
    },
  },
  voidwalker: {
    name: 'Voidwalker Regalia', minRole: 'admin', setBonus: 75,
    aura: 'void', auraClass: 'set-voidwalker',
    pieces: {
      weapon:  { name: 'Voidfang Blade',   stats: { attack: 375, critDamage: 38 } },
      armor:   { name: 'Voidweave Shroud', stats: { defense: 375, dodge: 10 } },
      helmet:  { name: 'Voidgaze Hood',    stats: { critChance: 12, attack: 190 } },
      boots:   { name: 'Voidstep Boots',   stats: { dodge: 11, attackSpeed: 0.15, defense: 110 } },
      trinket: { name: 'Void Heart',       stats: { critChance: 7, lifesteal: 7, regen: 15 } },
    },
  },
  dragonscale: {
    name: 'Dragonscale Aegis', minRole: 'admin', setBonus: 80,
    aura: 'dragonfire', auraClass: 'set-dragonscale',
    pieces: {
      weapon:  { name: 'Dragonscale Fang',  stats: { attack: 400, lifesteal: 6 } },
      armor:   { name: 'Dragonscale Plate', stats: { defense: 400, maxHp: 1600 } },
      helmet:  { name: 'Dragonhorn Helm',   stats: { defense: 160, maxHp: 800, regen: 10 } },
      boots:   { name: 'Dragonclaw Greaves', stats: { defense: 120, maxHp: 500, regen: 8 } },
      trinket: { name: 'Dragonheart Ember', stats: { regen: 16, maxHp: 600, lifesteal: 4 } },
    },
  },
  gamemaster: {
    name: 'Game Master Regalia', minRole: 'gm', setBonus: 70,
    aura: 'judgment', auraClass: 'set-gamemaster',
    pieces: {
      weapon:  { name: 'Judgment Gavel',      stats: { attack: 350, critChance: 8 } },
      armor:   { name: "Arbiter's Plate",     stats: { defense: 350, maxHp: 1400 } },
      helmet:  { name: 'Crown of Verdicts',   stats: { defense: 140, critDamage: 35 } },
      boots:   { name: 'Stride of Justice',   stats: { dodge: 8, attackSpeed: 0.14, defense: 105 } },
      trinket: { name: 'Scales of the Master', stats: { goldBonus: 25, xpBonus: 25, lifesteal: 5 } },
    },
  },
};

export function makeSetItem(setId, slot) {
  const def = PRIVILEGED_SETS[setId];
  if (!def || !def.pieces[slot]) throw new Error('Unknown set/slot: ' + setId + '/' + slot);
  const piece = def.pieces[slot];
  return {
    id: uid(), name: piece.name, slot, rarity: 'mythic',
    stats: { ...piece.stats }, set: setId, setName: def.name,
    value: 0, unsellable: true,
  };
}

export function grantFullSet(state, setId) {
  const items = SLOTS.map(slot => makeSetItem(setId, slot));
  state.inventory.push(...items);
  return items;
}

// Full 5-piece match of one set -> {setId, name, pct} else null.
export function equippedSetInfo(state) {
  const counts = {};
  for (const slot of SLOTS) {
    const id = state.equipped && state.equipped[slot];
    if (!id) return null;
    const item = (state.inventory || []).find(i => i.id === id);
    if (!item || !item.set || item.slot !== slot) return null;
    counts[item.set] = (counts[item.set] || 0) + 1;
  }
  const setId = Object.keys(counts)[0];
  if (setId && counts[setId] === SLOTS.length) {
    const def = PRIVILEGED_SETS[setId];
    return { setId, name: def ? def.name : setId, pct: def ? def.setBonus : 0 };
  }
  return null;
}

// ---------------- Earnable player gear sets ----------------
// Unlike privileged sets (GM-granted, fixed stats), these drop from gameplay
// with stage-scaled stats and are the long-term gear chase for regular players.
// Drop sources (see rollSetDrop):
//   - any boss kill (normal / dungeon / raid) ... 1% for a random piece of a random set
// Regular enemies never drop set pieces.
// Set bonuses: 3 pieces and 5 pieces of the same set (applied in computeStats).
export const PLAYER_SETS = {
  emberheart: {
    name: 'Emberheart Arsenal', emoji: '🔥',
    desc: 'Attack and crit. 3pc: +15% attack. 5pc: +30% attack, +10% crit chance.',
    pieces: {
      weapon: 'Emberheart Blade', armor: 'Emberheart Plate', helmet: 'Emberheart Helm',
      boots: 'Emberheart Greaves', trinket: 'Emberheart Charm',
    },
    secondary: ['critChance', 'critDamage'],
  },
  frostbound: {
    name: 'Frostbound Aegis', emoji: '❄️',
    desc: 'Health and defense. 3pc: +20% max HP. 5pc: +40% max HP, +20% defense.',
    pieces: {
      weapon: 'Frostbound Blade', armor: 'Frostbound Plate', helmet: 'Frostbound Helm',
      boots: 'Frostbound Greaves', trinket: 'Frostbound Charm',
    },
    secondary: ['maxHp', 'defense'],
  },
  stormcaller: {
    name: 'Stormcaller Garb', emoji: '⛈️',
    desc: 'Speed and evasion. 3pc: +0.20 attack speed. 5pc: +0.35 attack speed, +12% dodge.',
    pieces: {
      weapon: 'Stormcaller Blade', armor: 'Stormcaller Plate', helmet: 'Stormcaller Helm',
      boots: 'Stormcaller Greaves', trinket: 'Stormcaller Charm',
    },
    secondary: ['attackSpeed', 'dodge'],
  },
};

// Builds one stage-scaled piece of an earnable set (rare-tier stat budget).
export function makePlayerSetPiece(stage, setId, slot) {
  const def = PLAYER_SETS[setId];
  if (!def || !def.pieces[slot]) throw new Error('Unknown player set/slot: ' + setId + '/' + slot);
  const mult = 2.5;
  const stats = {};
  const primary = SLOT_PRIMARY[slot];
  stats[primary] = STAT_GEN[primary](mult, stage);
  const sec = def.secondary[Math.floor(Math.random() * def.secondary.length)];
  if (sec !== primary && STAT_GEN[sec]) stats[sec] = STAT_GEN[sec](mult, stage);
  return {
    id: uid(), name: def.pieces[slot], slot, rarity: 'rare',
    stats, set: setId, setName: def.name,
    value: Math.max(1, Math.round((4 + stage * 1.5) * mult)),
    unsellable: false,
  };
}

// Counts equipped pieces per earnable player set -> { setId: count }.
export function equippedPlayerSets(state) {
  const counts = {};
  for (const slot of SLOTS) {
    const id = state.equipped && state.equipped[slot];
    if (!id) continue;
    const item = (state.inventory || []).find(i => i.id === id);
    if (!item || !item.set || item.slot !== slot || !PLAYER_SETS[item.set]) continue;
    counts[item.set] = (counts[item.set] || 0) + 1;
  }
  return counts;
}

// Best (most pieces) equipped player set for UI display, else null.
export function playerSetInfo(state) {
  const counts = equippedPlayerSets(state);
  let best = null;
  for (const [setId, count] of Object.entries(counts)) {
    if (!best || count > best.count) best = { setId, count };
  }
  if (!best) return null;
  const def = PLAYER_SETS[best.setId];
  return { setId: best.setId, name: def.name, emoji: def.emoji, count: best.count, desc: def.desc };
}

// Returns a set-piece item or null. Really good gear is rare by design:
// flat 1% on ANY boss kill (normal, dungeon, raid bosses). Regular enemies
// never drop set pieces.
export function rollSetDrop(stage, { boss = false, dungeonBoss = false, raidBoss = false } = {}) {
  const isBoss = boss || dungeonBoss || raidBoss;
  if (!isBoss || Math.random() >= 0.01) return null;
  const setIds = Object.keys(PLAYER_SETS);
  return makePlayerSetPiece(stage, setIds[Math.floor(Math.random() * setIds.length)], pick(SLOTS));
}

// ---------------- Gear Shop ----------------
// Armor & weapons purchasable with gold in the Gear tab. Items are generated
// on purchase (guaranteed rarity, stage-scaled stats — same stat budget as
// drops). Legendary/mythic rolls and earnable set pieces are NOT sold: those
// stay drop-only. Privileged gear (GM sets) is never sold or dropped —
// GM-grant only.
export const GEAR_SHOP_STOCK = [
  { id: 'magic-weapon', slot: 'weapon', rarity: 'magic', price: 8000,   emoji: '⚔️', name: 'Fine Weapon',   desc: 'Solid magic weapon, scaled to your stage.' },
  { id: 'magic-armor',  slot: 'armor',  rarity: 'magic', price: 8000,   emoji: '🛡️', name: 'Fine Armor',    desc: 'Solid magic armor, scaled to your stage.' },
  { id: 'rare-weapon',  slot: 'weapon', rarity: 'rare',  price: 40000,  emoji: '🗡️', name: 'Gilded Weapon', desc: 'Guaranteed rare weapon with bonus stats.' },
  { id: 'rare-armor',   slot: 'armor',  rarity: 'rare',  price: 40000,  emoji: '🥋', name: 'Gilded Armor',  desc: 'Guaranteed rare armor with bonus stats.' },
  { id: 'epic-weapon',  slot: 'weapon', rarity: 'epic',  price: 150000, emoji: '🔱', name: 'Arcane Weapon', desc: 'Guaranteed epic weapon — a real upgrade.' },
  { id: 'epic-armor',   slot: 'armor',  rarity: 'epic',  price: 150000, emoji: '🦾', name: 'Arcane Armor',  desc: 'Guaranteed epic armor — a real upgrade.' },
];

// Buys a shop item for gold; the item lands in the inventory. Purchases go
// through spendGold so the owner infinite-gold perk and the gold cap apply.
export function buyGearItem(s, stockId) {
  const entry = GEAR_SHOP_STOCK.find(e => e.id === stockId);
  if (!entry) return { ok: false, reason: 'bad-item' };
  if (!spendGold(s, entry.price)) return { ok: false, reason: 'gold' };
  const item = makeLootItem(Math.max(1, s.stage || 1), entry.rarity, entry.slot);
  (s.inventory || (s.inventory = [])).push(item);
  return { ok: true, item };
}

// ---------------- Pets ----------------
// Available to ALL players; the Hunter class boosts them (see CLASSES).
// Pet eggs drop from bosses (see rollPetEgg); hatching is instant in the
// Pets UI (Party tab). The active pet strikes every 4s in every combat mode
// (see App.tick / petStrike in app.js), gains 15% of kill XP, and survives
// rebirth. Hunger 0-100 decays with play time (-1 per 5 min); feeding costs
// gold scaling with pet level and restores +35 hunger.
// Hunger gating: >50 full damage, 1-50 → 40% damage, 0 → pet sits out.
export const PET_SPECIES = {
  cinderpup:   { name: 'Cinder Pup',   emoji: '🐶', rarity: 'common',    weight: 40, baseDmg: 8,  growth: 1.15,
                 flavor: 'A loyal pup — always by your side, through every battle.', style: 'Loyal · balanced companion',
                 baseStats: { atk: 8,  def: 3,  hp: 50  }, bond: { atk: 2, def: 1, hp: 15 } },
  frostsprite: { name: 'Frost Sprite', emoji: '🧚', rarity: 'magic',     weight: 28, baseDmg: 12, growth: 1.16,
                 baseStats: { atk: 12, def: 2,  hp: 40  }, bond: { atk: 3, def: 0, hp: 10 } },
  stormhawk:   { name: 'Storm Hawk',   emoji: '🦅', rarity: 'rare',      weight: 17, baseDmg: 18, growth: 1.17,
                 baseStats: { atk: 16, def: 4,  hp: 55  }, bond: { atk: 2, def: 1, hp: 15 } },
  emberfox:    { name: 'Ember Fox',    emoji: '🦊', rarity: 'epic',      weight: 10, baseDmg: 26, growth: 1.18,
                 baseStats: { atk: 22, def: 5,  hp: 65  }, bond: { atk: 3, def: 1, hp: 12 } },
  tideturtle:  { name: 'Tide Turtle',  emoji: '🐢', rarity: 'legendary', weight: 5,  baseDmg: 38, growth: 1.19,
                 baseStats: { atk: 20, def: 12, hp: 120 }, bond: { atk: 1, def: 3, hp: 40 } },
  // Mythic line — hatchable from Mythic Eggs (rarely from wild eggs). Stronger
  // than anything below; priced to match (see EGG_TIERS).
  stormdrake:   { name: 'Storm Drake',  emoji: '🐉', rarity: 'mythic',    weight: 2,   baseDmg: 46, growth: 1.20,
                 flavor: 'A young drake — every wingbeat smells of ozone and war.', style: 'Majestic · soaring strikes',
                 baseStats: { atk: 40, def: 10, hp: 100 }, bond: { atk: 3, def: 2, hp: 30 } },
  prismhorn:    { name: 'Prismhorn',    emoji: '🦄', rarity: 'mythic',    weight: 1,   baseDmg: 52, growth: 1.21,
                 flavor: 'Its horn refracts the last light of dying stars.', style: 'Radiant · piercing strikes',
                 baseStats: { atk: 46, def: 12, hp: 110 }, bond: { atk: 4, def: 2, hp: 30 } },
  // Shadow line — Throne of Shadows natives, hatchable from Shadow Eggs
  // (rarely from wild eggs). Dark, loyal, and hungry for the light.
  shadowwisp:   { name: 'Shadow Wisp',  emoji: '👻', rarity: 'shadow',    weight: 2,   baseDmg: 42, growth: 1.20,
                 flavor: 'A whisper of the dark — it drinks the light around it.', style: 'Eerie · chilling strikes',
                 baseStats: { atk: 30, def: 10, hp: 95  }, bond: { atk: 2, def: 2, hp: 30 } },
  gloomstalker: { name: 'Gloomstalker', emoji: '🐈‍⬛', rarity: 'shadow',   weight: 1.5, baseDmg: 48, growth: 1.20,
                 flavor: 'You never see it move. You only see what it leaves behind.', style: 'Silent · ruthless strikes',
                 baseStats: { atk: 36, def: 9,  hp: 90  }, bond: { atk: 3, def: 1, hp: 25 } },
  voidreaver:   { name: 'Void Reaver',  emoji: '💀', rarity: 'shadow',    weight: 1,   baseDmg: 56, growth: 1.21,
                 flavor: 'It remembers every throne that fell — and how.', style: 'Dread · devastating strikes',
                 baseStats: { atk: 44, def: 12, hp: 110 }, bond: { atk: 3, def: 2, hp: 35 } },
  // Hunter starter beasts (not hatchable from eggs — starterOnly). Note: 🐺 is
  // taken by the Gloomfang Wolf enemy, so the wolf-ish slot uses 🦁 Lion.
  // Budget starter: the Ash Mouse is Stray-Egg-only (weight 0 keeps it out
  // of the wild-egg pool) — a cheap first pet for brand-new players.
  ashmouse:   { name: 'Ash Mouse',   emoji: '🐁', rarity: 'common',    weight: 0,  baseDmg: 5,  growth: 1.12,
                 flavor: 'Small, scrappy, and first into the fray. Every legend starts somewhere.', style: 'Scrappy · eager starter',
                 baseStats: { atk: 5,  def: 2,  hp: 35  }, bond: { atk: 1, def: 1, hp: 10 } },
  tiger: { name: 'Tiger', emoji: '🐯', rarity: 'common', weight: 0, baseDmg: 14, growth: 1.16,
           starterOnly: true, flavor: 'A fierce striker — hits hardest from the very first hunt.', style: 'Fierce · high base damage',
           baseStats: { atk: 14, def: 4, hp: 60 }, bond: { atk: 3, def: 1, hp: 15 } },
  bear:  { name: 'Bear',  emoji: '🐻', rarity: 'common', weight: 0, baseDmg: 10, growth: 1.19,
           starterOnly: true, flavor: 'A steady guardian — grows mightier with every level.', style: 'Steady · best late scaling',
           baseStats: { atk: 10, def: 8, hp: 90 }, bond: { atk: 1, def: 2, hp: 30 } },
  lion:  { name: 'Lion',  emoji: '🦁', rarity: 'common', weight: 0, baseDmg: 12, growth: 1.16,
           starterOnly: true, flavor: 'A keen hunter — swift, sharp, and sure.', style: 'Keen · balanced strikes',
           baseStats: { atk: 12, def: 5, hp: 70 }, bond: { atk: 2, def: 1, hp: 20 } },
};
export const HUNTER_STARTERS = ['tiger', 'bear', 'lion', 'cinderpup'];
export const PET_STRIKE_SEC = 4;
export const PET_HUNGER_DECAY_SEC = 300; // -1 hunger per 5 min of active play

// ---------------- Pet Shop ----------------
// The Pet Shop (Party tab → Pets) sells tiered eggs for gold; tier eggs
// guarantee a minimum rarity, unlike wild eggs dropped by bosses.
// pool: null = weighted roll over all non-starter species; otherwise a
// fixed list the egg hatches from (equal chance within the list).
export const EGG_TIERS = {
  wild:    { name: 'Wild Egg',    emoji: '🥚', price: 0,
             desc: 'Dropped by bosses — hatches any companion species.', pool: null },
  stray:   { name: 'Stray Egg',   emoji: '🐣', price: 500,
             desc: 'Hatches an Ash Mouse — small, scrappy, and cheap. Every legend starts somewhere.', pool: ['ashmouse'] },
  common:  { name: 'Common Egg',  emoji: '🐣', price: 5000,
             desc: 'Guaranteed Cinder Pup — a loyal, balanced starter.', pool: ['cinderpup'] },
  glowing: { name: 'Glowing Egg', emoji: '✨', price: 25000,
             desc: 'Hatches a Frost Sprite or Storm Hawk.', pool: ['frostsprite', 'stormhawk'] },
  radiant: { name: 'Radiant Egg', emoji: '💎', price: 100000,
             desc: 'Hatches an Ember Fox or Tide Turtle.', pool: ['emberfox', 'tideturtle'] },
  mythic:  { name: 'Mythic Egg',  emoji: '🌟', price: 250000,
             desc: 'Hatches a Storm Drake or Prismhorn — stronger than any lesser pet.', pool: ['stormdrake', 'prismhorn'] },
  shadow:  { name: 'Shadow Egg',  emoji: '🌑', price: 500000,
             desc: 'Hatches a Shadow Wisp, Gloomstalker, or Void Reaver — children of the dark.', pool: ['shadowwisp', 'gloomstalker', 'voidreaver'] },
};
export const SHOP_EGG_TIERS = ['stray', 'common', 'glowing', 'radiant', 'mythic', 'shadow'];

export function defaultPets() {
  const shopEggs = {};
  for (const t of SHOP_EGG_TIERS) shopEggs[t] = 0;
  return { collection: [], activeUid: null, eggs: 0, shopEggs };
}

// Normalizes s.pets in place and returns it.
export function ensurePets(s) {
  if (!s.pets || typeof s.pets !== 'object') s.pets = defaultPets();
  const p = s.pets;
  if (!Array.isArray(p.collection)) p.collection = [];
  p.collection = p.collection.filter(
    x => x && PET_SPECIES[x.species] && Number.isFinite(x.level)
  );
  for (const x of p.collection) {
    x.level = Math.max(1, Math.floor(x.level));
    x.xp = Math.max(0, Number(x.xp) || 0);
    x.xpNext = petXpForLevel(x.level);
    x.hunger = Math.max(0, Math.min(100, Number(x.hunger) || 0));
    if (!x.uid) x.uid = uid();
  }
  p.eggs = Math.max(0, Math.floor(Number(p.eggs) || 0));
  // Shop eggs: tiered purchases from the Pet Shop. Normalize for old saves
  // that predate the shop (wild boss-drop eggs live in p.eggs).
  if (!p.shopEggs || typeof p.shopEggs !== 'object') p.shopEggs = {};
  for (const t of SHOP_EGG_TIERS) {
    p.shopEggs[t] = Math.max(0, Math.floor(Number(p.shopEggs[t]) || 0));
  }
  if (p.activeUid && !p.collection.some(x => x.uid === p.activeUid)) p.activeUid = null;
  // Hunters may field a second pet. Non-hunters (or a stale uid) lose it.
  if (p.secondUid && !p.collection.some(x => x.uid === p.secondUid)) p.secondUid = null;
  if (s.playerClass !== 'hunter') p.secondUid = null;
  if (p.secondUid && p.secondUid === p.activeUid) p.secondUid = null;
  return p;
}

export function activePets(s) {
  const p = ensurePets(s);
  const out = [];
  const primary = p.collection.find(x => x.uid === p.activeUid);
  if (primary) out.push(primary);
  if (s.playerClass === 'hunter') {
    const second = p.collection.find(x => x.uid === p.secondUid);
    if (second) out.push(second);
  }
  return out;
}

export function activePet(s) {
  const p = ensurePets(s);
  return p.collection.find(x => x.uid === p.activeUid) || null;
}

export function petSpeciesOf(pet) {
  return (pet && PET_SPECIES[pet.species]) || null;
}

// Pet eggs drop from bosses: flat 15% on any boss kill (normal bosses,
// dungeon bosses, raid bosses). Regular enemies never drop eggs.
export function rollPetEgg({ boss = false, dungeonBoss = false, raidBoss = false } = {}) {
  const isBoss = boss || dungeonBoss || raidBoss;
  return isBoss && Math.random() < 0.15;
}

export function rollPetSpeciesId(tier = 'wild') {
  // Tiered shop eggs hatch from a fixed pool (equal chance within it);
  // starter-only species are never hatchable.
  if (tier && tier !== 'wild' && EGG_TIERS[tier] && EGG_TIERS[tier].pool) {
    const pool = EGG_TIERS[tier].pool.filter(id => PET_SPECIES[id] && !PET_SPECIES[id].starterOnly);
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  const pool = Object.keys(PET_SPECIES).filter(id => !PET_SPECIES[id].starterOnly);
  const ids = pool.length ? pool : Object.keys(PET_SPECIES);
  const total = ids.reduce((a, id) => a + PET_SPECIES[id].weight, 0);
  let roll = Math.random() * total;
  for (const id of ids) {
    roll -= PET_SPECIES[id].weight;
    if (roll <= 0) return id;
  }
  return ids[0];
}

// Hunter's chosen starter pet: level 1, full hunger, set active. Returns the pet or null.
export function addStarterPet(s, speciesId) {
  const p = ensurePets(s);
  if (!speciesId || !PET_SPECIES[speciesId] || !HUNTER_STARTERS.includes(speciesId)) return null;
  const pet = { uid: uid(), species: speciesId, level: 1, xp: 0, xpNext: petXpForLevel(1), hunger: 100 };
  p.collection.push(pet);
  p.activeUid = pet.uid;
  return pet;
}

// Consumes one egg and adds a new pet (auto-active if none). tier is
// 'wild' (boss-drop egg) or a shop tier id. Returns the pet or null.
export function hatchPet(s, tier = 'wild') {
  const p = ensurePets(s);
  if (tier && tier !== 'wild') {
    if (!SHOP_EGG_TIERS.includes(tier) || (p.shopEggs[tier] || 0) < 1) return null;
    p.shopEggs[tier] -= 1;
  } else {
    if (p.eggs < 1) return null;
    p.eggs -= 1;
    tier = 'wild';
  }
  const species = rollPetSpeciesId(tier);
  const pet = { uid: uid(), species, level: 1, xp: 0, xpNext: petXpForLevel(1), hunger: 100 };
  p.collection.push(pet);
  if (!p.activeUid) p.activeUid = pet.uid;
  return pet;
}

// Buys one shop egg for gold. Respects the owner infinite-gold perk
// (spendGold bypasses deduction). Returns {ok, reason}.
export function buyEgg(s, tier) {
  const p = ensurePets(s);
  if (!SHOP_EGG_TIERS.includes(tier)) return { ok: false, reason: 'bad-tier' };
  const price = EGG_TIERS[tier].price;
  if (!spendGold(s, price)) return { ok: false, reason: 'gold' };
  p.shopEggs[tier] = (p.shopEggs[tier] || 0) + 1;
  return { ok: true, tier };
}

export function petFeedCost(pet, state) {
  const base = Math.floor(100 * Math.pow(Math.max(1, pet.level), 1.5));
  const mult = (state && CLASSES[state.playerClass] && CLASSES[state.playerClass].feedCostMult) || 1;
  return Math.max(1, Math.floor(base * mult));
}

// Feeds a pet (+35 hunger, capped 100) for gold. Returns {ok, reason}.
export function feedPet(s, petUid) {
  const p = ensurePets(s);
  const pet = p.collection.find(x => x.uid === petUid);
  if (!pet) return { ok: false, reason: 'not-found' };
  if (pet.hunger >= 100) return { ok: false, reason: 'full' };
  const cost = petFeedCost(pet, s);
  if (!spendGold(s, cost)) return { ok: false, reason: 'gold' };
  pet.hunger = Math.min(100, pet.hunger + 35);
  return { ok: true, cost };
}

// ---------------- Sell pets ----------------
// Sell price scales with rarity and level: rarity base × (1 + 15% per level
// past 1). Respects the gold cap via addGold. Species flagged unsellable
// (GM-only / special pets) can never be sold. Selling the active (or second)
// pet reassigns the slot to the first remaining pet, or clears it.
const PET_SELL_BASE = {
  common: 800, magic: 2000, rare: 5000, epic: 15000,
  legendary: 40000, mythic: 80000, shadow: 120000,
};
export function petSellPrice(pet) {
  const sp = petSpeciesOf(pet);
  if (!sp || sp.unsellable) return 0;
  const base = PET_SELL_BASE[sp.rarity] || 800;
  const lv = Math.max(1, Math.floor(pet.level) || 1);
  return Math.max(1, Math.round(base * (1 + 0.15 * (lv - 1))));
}
export function canSellPet(pet) {
  const sp = petSpeciesOf(pet);
  return !!(pet && sp && !sp.unsellable);
}
// Sells a pet for gold. Returns {ok, gold, name, reason}.
export function sellPet(s, petUid) {
  const p = ensurePets(s);
  const idx = p.collection.findIndex(x => x.uid === petUid);
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const pet = p.collection[idx];
  if (!canSellPet(pet)) return { ok: false, reason: 'unsellable' };
  const price = petSellPrice(pet);
  const name = (petSpeciesOf(pet) || {}).name || 'Pet';
  p.collection.splice(idx, 1);
  if (p.activeUid === petUid) {
    const next = p.collection[0] || null;
    p.activeUid = next ? next.uid : null;
  }
  if (p.secondUid === petUid) {
    const next = p.collection.find(x => x.uid !== p.activeUid) || null;
    p.secondUid = next ? next.uid : null;
  }
  const gained = addGold(s, price);
  return { ok: true, gold: gained, name, capped: gained < price };
}

// ---------------- Coming-soon teasers ----------------
// Visible but unobtainable: Starlight pets and shadow demons are teased in
// the Pet Shop as locked entries. NOT a Seasons system — just static teasers.
export const PET_TEASERS = [
  { id: 'starlight', name: 'Starlight pets', emoji: '🌠',
    desc: 'Celestial companions wreathed in starlight. Arriving in a future update.' },
  { id: 'shadow-demons', name: 'Shadow demons', emoji: '😈',
    desc: 'True demons of the Throne — not yet ready to be tamed.' },
];

// A pet's own stats: base × growth^(level-1). Display only — bond is separate.
export function petStats(pet) {
  const zero = { atk: 0, def: 0, hp: 0 };
  if (!pet) return zero;
  const sp = petSpeciesOf(pet);
  if (!sp) return zero;
  const g = Math.pow(sp.growth || 1.15, Math.max(0, pet.level - 1));
  const bs = sp.baseStats || { atk: sp.baseDmg || 1, def: 1, hp: 10 };
  return {
    atk: Math.max(1, Math.round(bs.atk * g)),
    def: Math.max(0, Math.round(bs.def * g)),
    hp: Math.max(1, Math.round(bs.hp * g)),
  };
}

// Bond: the ACTIVE pet grants the player flat ATK/DEF/maxHP =
// per-level species values × pet level, hunger-gated like strike damage.
// Applied AFTER class/spec multiplicative bonuses in computeStats;
// Hunter's +50% pet-damage bonus does NOT affect bond. Benched pets grant nothing.
export function petBondFor(pet) {
  const zero = { atk: 0, def: 0, hp: 0 };
  if (!pet) return zero;
  const sp = petSpeciesOf(pet);
  const b = (sp && sp.bond) || zero;
  const mult = petHungerMult(pet);
  if (!mult) return zero;
  const lv = Math.max(1, pet.level);
  return {
    atk: Math.round(b.atk * lv * mult),
    def: Math.round(b.def * lv * mult),
    hp: Math.round(b.hp * lv * mult),
  };
}
export function petBond(s) {
  const zero = { atk: 0, def: 0, hp: 0 };
  const out = { ...zero };
  for (const pet of activePets(s)) {
    const b = petBondFor(pet);
    out.atk += b.atk; out.def += b.def; out.hp += b.hp;
  }
  return out;
}

// Hunger damage gating: >50 full, 1-50 → 40%, 0 → sits out.
export function petHungerMult(pet) {
  if (!pet) return 0;
  if (pet.hunger <= 0) return 0;
  return pet.hunger > 50 ? 1 : 0.4;
}

// Active pet(s) strike damage: (25% + 4%/level) of hero attack each, hunger-gated.
// Meaningful but never outshines the hero. Hunters get +50% pet damage and
// may field a second pet — both strike.
export function petStrikeDamage(s, stats) {
  const pets = activePets(s);
  if (!pets.length) return 0;
  const classMult = (s && CLASSES[s.playerClass] && CLASSES[s.playerClass].petDmgMult) || 1;
  let total = 0;
  for (const pet of pets) {
    const mult = petHungerMult(pet);
    if (!mult) continue;
    const sp = petSpeciesOf(pet);
    const base = stats.attack * (0.25 + 0.04 * (pet.level - 1));
    const speciesMult = 1 + (sp.baseDmg / 200); // rarer species hit a touch harder
    total += Math.max(1, Math.round(base * mult * speciesMult * classMult));
  }
  return total;
}

export function petXpForLevel(level) {
  return Math.max(1, Math.round(40 * Math.pow(1.28, Math.max(1, level) - 1)));
}

// Active pets gain xp (15% of the kill's XP each). Returns {gains} with one
// entry per pet that leveled: {name, levels}.
export function gainPetXp(s, xp) {
  const gains = [];
  if (!Number.isFinite(xp) || xp <= 0) return { gains };
  for (const pet of activePets(s)) {
    pet.xp += xp;
    const levels = [];
    let guard = 0;
    while (pet.xp >= pet.xpNext && guard++ < 1000) {
      pet.xp -= pet.xpNext;
      pet.level += 1;
      pet.xpNext = petXpForLevel(pet.level);
      levels.push(pet.level);
    }
    if (levels.length) gains.push({ name: (petSpeciesOf(pet) || {}).name || 'Pet', levels });
  }
  return { gains };
}

// Decays every pet's hunger by `amount` (clamped at 0).
export function decayPetHunger(s, amount = 1) {
  const p = ensurePets(s);
  for (const pet of p.collection) pet.hunger = Math.max(0, pet.hunger - amount);
  return p;
}

// ---------------- Upgrades ----------------
export const UPGRADE_INFO = {
  weapon: { name: 'Weapon', emoji: '⚔️', desc: '+12% damage / level' },
  armor:  { name: 'Armor',  emoji: '🛡️', desc: '+12% defense / level' },
  skill:  { name: 'Skill',  emoji: '✨', desc: '+12% damage / level' },
  tap:    { name: 'Tap Power', emoji: '👆', desc: '+15% tap damage / level' },
};
export const upgradeCost = (kind, level) => Math.round(30 * Math.pow(1.7, Math.max(0, level - 1)));

// ---------------- Companions / Party ----------------
export const RECRUITS = [
  { id: 'gromm',  name: 'Gromm the Axe',    race: 'orc',       emoji: '🪓', role: 'Brute',        tier: 'common',    cost: 50,    atk: 6,  def: 1, hp: 60,  dodge: 5,  crit: 5 },
  { id: 'lyra',   name: 'Lyra Swiftbow',    race: 'fae',       emoji: '🧚', role: 'Ranger',       tier: 'common',    cost: 150,   atk: 10, def: 1, hp: 70,  dodge: 15, crit: 10 },
  { id: 'anselm', name: 'Brother Anselm',   race: 'celestial', emoji: '✨', role: 'Cleric',       tier: 'uncommon',  cost: 300,   atk: 12, def: 3, hp: 120, dodge: 5,  crit: 5, regen: 2 },
  { id: 'vex',    name: 'Vex Nightwhisper', race: 'revenant',  emoji: '💀', role: 'Assassin',     tier: 'uncommon',  cost: 600,   atk: 18, def: 2, hp: 90,  dodge: 10, crit: 10 },
  { id: 'ember',  name: 'Ember Scaleborn',  race: 'dragonkin', emoji: '🐉', role: 'Dragon Knight', tier: 'rare',     cost: 1200,  atk: 26, def: 3, hp: 110, dodge: 5,  crit: 15 },
  { id: 'mira',   name: 'Mira Ironhold',    race: 'human',     emoji: '🛡️', role: 'Guardian',     tier: 'epic',      cost: 2500,  atk: 34, def: 5, hp: 160, dodge: 5,  crit: 10 },
  { id: 'kaelith', name: 'Kaelith Doomwarden', race: 'abyssal', emoji: '🌑', role: 'Doomwarden',  tier: 'legendary', cost: 6000,  atk: 48, def: 7, hp: 220, dodge: 15, crit: 15, regen: 3 },
  { id: 'nyx',    name: 'Nyx Starreaver',   race: 'voidborn',  emoji: '🌠', role: 'Starreaver',   tier: 'mythic',    cost: 15000, atk: 70, def: 10, hp: 320, dodge: 20, crit: 20, regen: 5 },
];
export const RECRUIT_BY_ID = Object.fromEntries(RECRUITS.map(r => [r.id, r]));
export const MAX_PARTY = 3;

export function makeCompanion(recruit, playerLevel) {
  const L = Math.max(1, Math.floor(playerLevel || 1));
  const maxHp = recruit.hp + 20 * (L - 1);
  return {
    id: uid(), name: recruit.name, race: recruit.race, emoji: recruit.emoji,
    role: recruit.role || 'Companion',
    recruitId: recruit.id,
    baseCost: recruit.cost,
    level: L,
    attack: recruit.atk + 3 * (L - 1),
    defense: recruit.def + 1 * (L - 1),
    maxHp, hp: maxHp,
    dodge: recruit.dodge || 5, critChance: recruit.crit || 5,
    regen: recruit.regen || 0,
  };
}

// Gold cost to level a companion from its current level to the next.
// Steep curve so cost (not a cap) is the limiter; never below 50g.
export function companionLevelCost(c) {
  const base = Math.max(50, Number(c && c.baseCost) || 50);
  const L = Math.max(1, Math.floor((c && c.level) || 1));
  return Math.max(50, Math.floor(base * 0.4 * Math.pow(L, 1.6)));
}

// Levels a party member up: +3 attack, +1 defense, +20 max HP, +25 HP heal.
// Matches makeCompanion's per-level formula exactly, so a companion leveled
// from L1 is identical to a fresh recruit at the same level.
// Routes through spendGold (respects the infinite-gold perk). No hard cap.
export function levelUpCompanion(s, companionId) {
  const c = (s.party || []).find(x => x && x.id === companionId);
  if (!c) return { ok: false, reason: 'not-found' };
  const cost = companionLevelCost(c);
  if (!spendGold(s, cost)) return { ok: false, reason: 'gold', cost };
  c.level = Math.max(1, Math.floor(c.level || 1)) + 1;
  c.attack = (Number(c.attack) || 0) + 3;
  c.defense = (Number(c.defense) || 0) + 1;
  c.maxHp = (Number(c.maxHp) || 0) + 20;
  c.hp = Math.min(c.maxHp, (Number(c.hp) || 0) + 25);
  return { ok: true, cost, level: c.level };
}

// Lightweight combat stats view for a companion (dodge/parry/counter support).
export function companionStats(c) {
  return {
    attack: c.attack, defense: c.defense,
    critChance: c.critChance || 5, critDamage: 150,
    dodge: c.dodge || 5, parry: 0,
  };
}

// ---------------- Rebirth ----------------
// Level >= MAX_LEVEL. Sets the hero back to level 1; everything else
// (stage, gold, gear, pets, titles, styles) is kept. Each rebirth raises all
// future XP requirements by x1.35 (stacking), so the climb stays meaningful.
export function rebirth(state) {
  if ((state.level || 1) < MAX_LEVEL) return null;
  state.level = 1;
  state.xp = 0;
  state.rebirthCount = (state.rebirthCount || 0) + 1;
  state.xpNext = xpForLevel(1, state.rebirthCount);
  return ensureState(state);
}

// ---------------- Offline earnings ----------------
// Capped at 8h. Returns null when away < 1 minute.
export function offlineEarnings(state, lastSeenAt, nowMs) {
  const elapsedMs = nowMs - lastSeenAt;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60 * 1000) return null;
  const cappedMs = Math.min(elapsedMs, 8 * 3600 * 1000);
  const minutes = Math.floor(cappedMs / 60000);
  const kills = Math.max(1, Math.floor(minutes * 6)); // estimated kills/min
  const stats = computeStats(state);
  const gold = kills * goldForKill(state.stage, stats.goldBonus + (stats.talentGoldPct || 0));
  const xp = kills * xpForKill(state.stage); // gainXp applies race/gear mults
  return { minutes, kills, gold, xp, capped: elapsedMs > 8 * 3600 * 1000 };
}

// ---------------- Zones ----------------
// Original fantasy zones, one per 10 stages. Pure flavor — no licensed IP.
export const ZONES = [
  { name: 'Greenwood Vale', emoji: '🌲' },
  { name: 'Ember Wastes', emoji: '🔥' },
  { name: 'Frostfall Peaks', emoji: '❄️' },
  { name: 'The Sunken Hollow', emoji: '🌊' },
  { name: 'Ashen Badlands', emoji: '🌋' },
  { name: 'Stormcrag Highlands', emoji: '⛈️' },
  { name: 'The Whispering Deep', emoji: '🕳️' },
  { name: 'Crimson Expanse', emoji: '🩸' },
  { name: 'The Shattered Isles', emoji: '🏝️' },
  { name: 'The Eternal Throne', emoji: '👑' },
];
export const zoneFor = (stage) =>
  ZONES[Math.min(ZONES.length - 1, Math.max(0, Math.floor(((stage || 1) - 1) / 10)))];

// ---------------- Mastery talents ----------------
// Earned: 1 Mastery point per 10 levels. Each branch has 5 ranks, 1 point per rank.
export const TALENTS = {
  might:    { name: 'Might',    emoji: '⚔️', desc: '+4% attack per rank', max: 5 },
  vitality: { name: 'Vitality', emoji: '❤️', desc: '+4% max HP per rank', max: 5 },
  fortune:  { name: 'Fortune',  emoji: '💰', desc: '+4% gold per rank', max: 5 },
};
export function spendTalent(state, id) {
  const def = TALENTS[id];
  if (!def || !state.mastery) return false;
  const spent = state.mastery.spent[id] || 0;
  if (state.mastery.points < 1 || spent >= def.max) return false;
  state.mastery.points -= 1;
  state.mastery.spent[id] = spent + 1;
  return true;
}

// ---------------- Professions ----------------
// Leveled with gold; passive always-on bonuses. Generic fantasy crafts.
export const PROFESSIONS = {
  herbalism: { name: 'Herb Gathering', emoji: '🌿', desc: '+0.5 HP/s regen per level', max: 20 },
  smithing:  { name: 'Smithing', emoji: '⚒️', desc: '+1.5% attack per level', max: 20 },
};
export const professionCost = (level) =>
  Math.round(60 * Math.pow(2.1, Math.max(0, (level || 1) - 1)));
// ============================================================
// Returns the gold cost to go from current level to next, or null if maxed.
export function levelProfession(state, id) {
  const def = PROFESSIONS[id];
  if (!def) return null;
  const lvl = (state.professions && state.professions[id]) || 1;
  if (lvl >= def.max) return null;
  return professionCost(lvl);
}

// ---------------- Achievements ----------------
// One-time feats that grant ⭐ stars when unlocked.
export const ACHIEVEMENTS = [
  { id: 'first-blood', name: 'First Blood', emoji: '🩸', desc: 'Defeat your first enemy.', stars: 5, check: (s) => (s.stats.kills || 0) >= 1 },
  { id: 'tap-100', name: 'Warming Up', emoji: '👆', desc: 'Tap 100 times.', stars: 5, check: (s) => (s.stats.taps || 0) >= 100 },
  { id: 'tap-5000', name: 'Tap Storm', emoji: '🌪️', desc: 'Tap 5,000 times.', stars: 15, check: (s) => (s.stats.taps || 0) >= 5000 },
  { id: 'combo-50', name: 'Unstoppable', emoji: '⚡', desc: 'Reach a 50-tap combo.', stars: 10, check: (s) => (s.stats.maxCombo || 0) >= 50 },
  { id: 'boss-1', name: 'Boss Slayer', emoji: '👹', desc: 'Defeat a boss.', stars: 10, check: (s) => (s.bossesKilled || 0) >= 1 },
  { id: 'boss-10', name: 'Boss Hunter', emoji: '🏹', desc: 'Defeat 10 bosses.', stars: 25, check: (s) => (s.bossesKilled || 0) >= 10 },
  { id: 'level-10', name: 'Rising Hero', emoji: '⬆️', desc: 'Reach level 10.', stars: 5, check: (s) => (s.level || 1) >= 10 },
  { id: 'level-50', name: 'Veteran', emoji: '🎖️', desc: 'Reach level 50.', stars: 20, check: (s) => (s.level || 1) >= 50 },
  { id: 'rich-1', name: 'Gold Hoarder', emoji: '💰', desc: 'Hold 10,000 gold at once.', stars: 10, check: (s) => (s.gold || 0) >= 10000 },
  { id: 'collector', name: 'Collector', emoji: '🎒', desc: 'Hold 25 items at once.', stars: 10, check: (s) => (s.inventory || []).length >= 25 },
  { id: 'rebirth-1', name: 'Reborn', emoji: '🔥', desc: 'Rebirth once.', stars: 25, check: (s) => (s.rebirthCount || 0) >= 1 },
  { id: 'zone-5', name: 'Explorer', emoji: '🗺️', desc: 'Reach the Ashen Badlands (stage 41).', stars: 10, check: (s) => (s.stage || 1) >= 41 },
];
// ---------------- Titles ----------------
// Hero titles: unlocked by feats, shown under the profile name and on the
// leaderboard. No stat effect — pure glory.
export const TITLES = [
  { id: 'wanderer',        name: 'the Wanderer',        desc: 'Every hero starts somewhere.',              check: () => true },
  { id: 'first-blood',     name: 'the Bloodied',        desc: 'Win your first battle.',                    check: (s) => (s.stats.kills || 0) >= 1 },
  { id: 'tapstorm',        name: 'the Tapstorm',        desc: 'Reach a 50-tap combo.',                     check: (s) => (s.stats.maxCombo || 0) >= 50 },
  { id: 'bossbane',        name: 'Bossbane',            desc: 'Slay 10 bosses.',                           check: (s) => (s.bossesKilled || 0) >= 10 },
  { id: 'infernal-slayer', name: 'Slayer of the Infernal', desc: 'Slay 25 bosses.',                        check: (s) => (s.bossesKilled || 0) >= 25 },
  { id: 'veteran',         name: 'the Veteran',         desc: 'Reach level 50.',                           check: (s) => (s.level || 1) >= 50 },
  { id: 'unbroken',        name: 'the Unbroken',        desc: 'Reach stage 50.',                           check: (s) => (s.stage || 1) >= 50 },
  { id: 'goldhoarder',     name: 'the Goldhoarder',     desc: 'Hold 100,000 gold at once.',                check: (s) => (s.gold || 0) >= 100000 },
  { id: 'idle-king',       name: 'the Idle King',       desc: 'Rebirth once.',                             check: (s) => (s.rebirthCount || 0) >= 1 },
  { id: 'dungeon-master',  name: 'the Dungeon Master',  desc: 'Fill your 3-companion dungeon party.',      check: (s) => (s.party || []).length >= MAX_PARTY },
  { id: 'overlord',        name: 'the Overlord',        desc: 'Reach stage 100.',                          check: (s) => (s.stage || 1) >= 100 },
  { id: 'sleepless',       name: 'the Sleepless',       desc: 'Play for 1 hour total.',                    check: (s) => (s.stats.playTimeSec || 0) >= 3600 },
  { id: 'tireless',        name: 'the Tireless',        desc: 'Play for 5 hours total.',                   check: (s) => (s.stats.playTimeSec || 0) >= 18000 },
  { id: 'eternal',         name: 'the Eternal',         desc: 'Play for 24 hours total.',                  check: (s) => (s.stats.playTimeSec || 0) >= 86400 },
  { id: 'climber',         name: 'the Climber',         desc: 'Reach stage 25.',                           check: (s) => (s.stage || 1) >= 25 },
  { id: 'ascendant',       name: 'the Ascendant',       desc: 'Reach stage 50.',                           check: (s) => (s.stage || 1) >= 50 },
  { id: 'mythical',        name: 'the Mythical',        desc: 'Reach stage 100.',                          check: (s) => (s.stage || 1) >= 100 },
  { id: 'slayer',          name: 'the Slayer',          desc: 'Slay 100 enemies.',                         check: (s) => (s.stats.kills || 0) >= 100 },
  { id: 'butcher',         name: 'the Butcher',         desc: 'Slay 1,000 enemies.',                       check: (s) => (s.stats.kills || 0) >= 1000 },
  { id: 'annihilator',     name: 'the Annihilator',     desc: 'Slay 10,000 enemies.',                      check: (s) => (s.stats.kills || 0) >= 10000 },
  { id: 'reborn',          name: 'the Reborn',          desc: 'Rebirth twice.',                            check: (s) => (s.rebirthCount || 0) >= 2 },
  { id: 'phoenix',         name: 'the Phoenix',         desc: 'Rebirth 3 times.',                         check: (s) => (s.rebirthCount || 0) >= 3 },
  { id: 'immortal',        name: 'the Immortal',        desc: 'Rebirth 5 times.',                         check: (s) => (s.rebirthCount || 0) >= 5 },
  { id: 'paragon',         name: 'the Paragon',         desc: 'Rebirth 10 times.',                        check: (s) => (s.rebirthCount || 0) >= 10 },
  { id: 'demigod',         name: 'the Demigod',         desc: 'Rebirth 25 times.',                        check: (s) => (s.rebirthCount || 0) >= 25 },
  { id: 'worldforger',     name: 'the Worldforger',     desc: 'Rebirth 50 times.',                        check: (s) => (s.rebirthCount || 0) >= 50 },
  { id: 'beastfriend',      name: 'the Beastfriend',     desc: 'Hatch your first pet.',                     check: (s) => ((s.pets && s.pets.collection) || []).length >= 1 },
  { id: 'packleader',       name: 'the Packleader',      desc: 'Hatch 5 pets.',                             check: (s) => ((s.pets && s.pets.collection) || []).length >= 5 },
  { id: 'apexcompanion',    name: 'the Apex Companion',  desc: 'Raise a pet to level 25.',                  check: (s) => (((s.pets && s.pets.collection) || []).some(p => (p.level || 1) >= 25)) },
  { id: 'executioner',     name: 'the Executioner',     desc: 'Slay 50 bosses.',                           check: (s) => (s.bossesKilled || 0) >= 50 },
  { id: 'godslayer',       name: 'the Godslayer',       desc: 'Slay 100 bosses.',                          check: (s) => (s.bossesKilled || 0) >= 100 },
  { id: 'hoarder',         name: 'the Hoarder',         desc: 'Earn 1,000,000 gold in total.',             check: (s) => (s.stats.totalGoldEarned || 0) >= 1000000 },
  { id: 'magnate',         name: 'the Magnate',         desc: 'Earn 100,000,000 gold in total.',           check: (s) => (s.stats.totalGoldEarned || 0) >= 100000000 },
  { id: 'raider',          name: 'the Raider',          desc: 'Reach wave 10 in a raid.',                  check: (s) => ((s.raid && s.raid.best) || 0) >= 10 },
  { id: 'stormcaller',     name: 'the Stormcaller',     desc: 'Reach wave 25 in a raid.',                  check: (s) => ((s.raid && s.raid.best) || 0) >= 25 },
  { id: 'tidebreaker',     name: 'the Tidebreaker',     desc: 'Reach wave 50 in a raid.',                  check: (s) => ((s.raid && s.raid.best) || 0) >= 50 },
  // ---- Mining & Galaxy Forge titles (stream 3) ----
  // Mine/forge counters may not exist yet (added by a parallel stream);
  // every check below degrades to "locked" on a fresh/old save.
  { id: 'delver',          name: '⛏️ the Delver',        desc: 'Reach depth 20 in the Mine.',               check: (s) => (((s.mine || {}).maxDepth) || 0) >= 20 },
  { id: 'deepdelver',      name: '🕳️ the Deepdelver',    desc: 'Reach depth 40 in the Mine.',               check: (s) => (((s.mine || {}).maxDepth) || 0) >= 40 },
  { id: 'corediver',       name: '🌋 the Corediver',      desc: 'Reach depth 60 in the Mine.',               check: (s) => (((s.mine || {}).maxDepth) || 0) >= 60 },
  { id: 'rockbreaker',     name: '💥 the Rockbreaker',   desc: 'Tap the mining rock 1,000 times.',          check: (s) => (((s.mine || {}).totalTaps) || 0) >= 1000 },
  { id: 'orehoarder',      name: '💰 the Orehoarder',     desc: 'Mine 1,000 ore in total.',                  check: (s) => (((s.mine || {}).totalMined) || 0) >= 1000 },
  { id: 'prospector',      name: '🧭 the Prospector',     desc: 'Upgrade your pickaxe to tier 3.',           check: (s) => Number((((s.mine || {}).pickaxe) || 0)) >= 3 },
  { id: 'master-miner',    name: '⚒️ the Master Miner',   desc: 'Upgrade your pickaxe to the max tier.',     check: (s) => Number((((s.mine || {}).pickaxe) || 0)) >= 7 },
  { id: 'starforger',      name: '⭐ the Starforger',     desc: 'Craft an item in the Galaxy Forge.',        check: (s) => (((s.forge || {}).crafts) || 0) >= 1 },
  { id: 'galaxyforger',    name: '🌌 the Galaxyforger',   desc: 'Craft 10 items in the Galaxy Forge.',       check: (s) => (((s.forge || {}).crafts) || 0) >= 10 },
  { id: 'transcendent',    name: '✨ the Transcendent',   desc: 'Craft your first Super Galaxy item.',       check: (s) => ((s.forge || {}).superCrafted) === true },
  { id: 'ever-reborn',     name: '🌀 the Ever-Reborn',    desc: 'Rebirth 100 times.',                        check: (s) => (s.rebirthCount || 0) >= 100 },
  { id: 'true-capped',     name: '👑 the True Capped',    desc: 'Reach level 70, then rebirth at least once.', check: (s) => ((s.level || 1) >= MAX_LEVEL) && ((s.rebirthCount || 0) >= 1) },
];
export const TITLE_BY_ID = Object.fromEntries(TITLES.map(t => [t.id, t]));
export function titleName(id) { return (TITLE_BY_ID[id] && TITLE_BY_ID[id].name) || id; }

// ---------------- Creator badges & country flags ----------------
// Badges are granted by the owner/GM (GM console), shown next to the name
// on the leaderboard and profile. Country is picked by the player in
// Profile; its flag shows on the leaderboard.
export const BADGES = [
  { id: 'youtuber', emoji: '▶️', name: 'YouTuber' },
  { id: 'streamer', emoji: '🎥', name: 'Streamer' },
  { id: 'vip',      emoji: '💎', name: 'VIP' },
  { id: 'admin',    emoji: '🛡️', name: 'Admin' },
  { id: 'mod',      emoji: '🔨', name: 'Mod' },
];
export const BADGE_BY_ID = Object.fromEntries(BADGES.map(b => [b.id, b]));
export function badgeDef(id) { return BADGE_BY_ID[id] || null; }

export const COUNTRIES = [
  ['US','United States'],['CA','Canada'],['MX','Mexico'],['BR','Brazil'],['AR','Argentina'],
  ['CL','Chile'],['CO','Colombia'],['PE','Peru'],['GB','United Kingdom'],['IE','Ireland'],
  ['FR','France'],['DE','Germany'],['ES','Spain'],['IT','Italy'],['PT','Portugal'],
  ['NL','Netherlands'],['BE','Belgium'],['SE','Sweden'],['NO','Norway'],['DK','Denmark'],
  ['FI','Finland'],['PL','Poland'],['GR','Greece'],['TR','Türkiye'],['UA','Ukraine'],
  ['RU','Russia'],['IN','India'],['PK','Pakistan'],['BD','Bangladesh'],['JP','Japan'],
  ['KR','South Korea'],['CN','China'],['TW','Taiwan'],['HK','Hong Kong'],['SG','Singapore'],
  ['MY','Malaysia'],['ID','Indonesia'],['PH','Philippines'],['TH','Thailand'],['VN','Vietnam'],
  ['AU','Australia'],['NZ','New Zealand'],['ZA','South Africa'],['NG','Nigeria'],['EG','Egypt'],
  ['AE','UAE'],['SA','Saudi Arabia'],['IL','Israel'],
].map(([code, name]) => ({ code, name }));
export function isValidCountry(code) { return COUNTRIES.some(c => c.code === code); }
// Flag emoji from a 2-letter ISO code (regional indicator symbols).
export function countryFlag(code) {
  if (!/^[A-Z]{2}$/.test(code || '')) return '';
  return [...code].map(ch => String.fromCodePoint(0x1F1E6 + ch.charCodeAt(0) - 65)).join('');
}

// Returns newly unlocked title defs (mutates state.titlesUnlocked).
export function checkTitles(state) {
  if (!Array.isArray(state.titlesUnlocked)) state.titlesUnlocked = ['wanderer'];
  // Lifetime gold tracking: no dedicated field exists, so accumulate
  // positive gold deltas between checks into stats.totalGoldEarned.
  // (Decreases from spending are ignored; the total survives rebirth
  // because stats are lifetime stats.)
  if (!state.stats || typeof state.stats !== 'object') state.stats = {};
  const goldNow = state.gold || 0;
  const goldLast = state.stats._lastGoldSeen || 0;
  if (goldNow > goldLast) {
    state.stats.totalGoldEarned = (state.stats.totalGoldEarned || 0) + (goldNow - goldLast);
  }
  state.stats._lastGoldSeen = goldNow;
  const fresh = [];
  for (const t of TITLES) {
    if (state.titlesUnlocked.includes(t.id)) continue;
    let ok = false;
    try { ok = !!t.check(state); } catch { ok = false; }
    if (ok) {
      state.titlesUnlocked.push(t.id);
      fresh.push(t);
    }
  }
  return fresh;
}

// Returns newly unlocked achievements (and applies their star rewards).
export function checkAchievements(state) {
  if (!Array.isArray(state.achievements)) state.achievements = [];
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (state.achievements.includes(a.id)) continue;
    let ok = false;
    try { ok = !!a.check(state); } catch { ok = false; }
    if (ok) {
      state.achievements.push(a.id);
      state.stars = (state.stars || 0) + a.stars;
      fresh.push(a);
    }
  }
  return fresh;
}

// ---------------- Tap combo ----------------
// Combo builds while tapping at least once per 1.5s (tracked in app.js).
// Combo mult: +0.5% tap damage per combo, capped at 2x (200 combo).
// Frenzy: hitting 50 combo triggers 10s of double tap damage.
export const COMBO_WINDOW_MS = 1500;
export const FRENZY_COMBO = 50;
export const FRENZY_MS = 10000;
export function tapDamageMult(state, combo, frenzyActive) {
  const tapLvl = (state.upgrades && state.upgrades.tap) || 1;
  const upMult = Math.pow(1.15, Math.max(0, tapLvl - 1));
  const comboMult = 1 + Math.min(combo || 0, 200) * 0.005;
  return upMult * comboMult * (frenzyActive ? 2 : 1);
}

// ---------------- GM helpers ----------------
// Grant N levels with the normal per-level stat gains + full heal.
export function grantLevels(state, n) {
  n = Math.max(1, Math.min(100, Math.floor(n) || 0));
  if (!n) return 0;
  let granted = 0;
  for (let i = 0; i < n && state.level < MAX_LEVEL; i++) {
    state.level += 1;
    state.hero.attack += 3;
    state.hero.maxHp += 25;
    state.hero.defense += 2;
    if (state.level % 10 === 0 && state.mastery) state.mastery.points += 1;
    granted += 1;
  }
  state.xp = 0;
  state.xpNext = xpForLevel(state.level, state.rebirthCount);
  const s2 = computeStats(state);
  state.hero.hp = s2.maxHp;
  return granted;
}

// RAID MODE (PvE endless waves) — appended 2026-09-25
// Pure logic. raid.js (Raid object) drives the combat loop with these.
// state.raid = { best: 0 } — best wave reached.
// Call ensureRaidState(state) on load.
// ============================================================

// Wave scaling: hp 1.18^wave, atk 1.10^wave, gold 1 + wave*0.15.
// Strictly increasing in wave — difficulty never plateaus.
export function raidWaveScaling(wave) {
  const w = Math.max(1, Math.floor(wave || 1));
  return {
    hpMult: Math.pow(1.18, w),
    atkMult: Math.pow(1.10, w),
    goldMult: 1 + w * 0.15,
  };
}

// Raid bosses appear every 5th wave (5, 10, 15, ...).
export function isRaidBoss(wave) {
  return Math.floor(wave || 0) % 5 === 0 && Math.floor(wave || 0) > 0;
}

// Builds the enemy for a raid wave. Base stats come from the player's
// current stage via enemyFor(), then wave scaling is applied.
// Raid bosses: 2.5x HP of the wave, epic+ loot tier (minIdx 3), 👹 emoji.
// Normal waves: common+ loot tier (minIdx 0).
export function raidEnemyFor(wave, playerStage) {
  const w = Math.max(1, Math.floor(wave || 1));
  const stage = Math.max(1, Math.floor(playerStage || 1));
  const boss = isRaidBoss(w);
  // Non-boss waves must never inherit the stage's boss identity
  // (e.g. player sitting on a x10 boss stage).
  const baseStage = (!boss && isBossStage(stage)) ? stage + 1 : stage;
  const base = enemyFor(baseStage);
  const s = raidWaveScaling(w);
  const hp = Math.max(1, Math.round(base.hp * s.hpMult * (boss ? 2.5 : 1)));
  return {
    name: boss ? pick(BOSS_NAMES) : base.name,
    stage, boss, raidWave: w,
    hp, maxHp: hp,
    attack: Math.max(1, Math.round(base.attack * s.atkMult)),
    emoji: boss ? '👹' : base.emoji,
    lootTier: boss ? 3 : 0, // minIdx into RARITIES for rollLoot()
    goldMult: s.goldMult,
  };
}

// Normalizes state.raid (safe on old saves that lack it).
export function ensureRaidState(state) {
  if (!state || typeof state !== 'object') return state;
  const r = state.raid;
  const best = r && Number.isFinite(+r.best) ? Math.max(0, Math.floor(+r.best)) : 0;
  state.raid = { best };
  return state;
}

// (Rebirth mutates the state in place, so raid progress survives it.)
