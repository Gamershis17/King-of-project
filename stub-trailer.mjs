// Stub API server for filming real gameplay screenshots.
// Serves public/ statically + canned API responses. Visuals are identical
// to the live game (all rendering is client-side).
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');

const state = {
  race: 'human',
  mode: 'clicker',
  level: 28, xp: 1200, xpNext: 5000,
  gold: 128450, stars: 14,
  stage: 34, bossesKilled: 3,
  prestigeCount: 1, prestigeBonus: 25,
  hero: {
    hp: 920, maxHp: 920, attack: 145, defense: 38,
    critChance: 12, critDamage: 175, parry: 8, dodge: 9,
    lifesteal: 3, attackSpeed: 1.2, regen: 5,
  },
  party: [
    { id: 'c-film-1', name: 'Kael', race: 'elf', emoji: '🧝', role: 'Ranger',
      level: 26, attack: 118, defense: 30, maxHp: 520, hp: 520,
      dodge: 8, critChance: 10, regen: 2 },
  ],
  inventory: [], equipped: { weapon: null, armor: null, helmet: null, boots: null, trinket: null },
  upgrades: { weapon: 4, armor: 3, skill: 3, tap: 5 },
  skills: ['power-strike'],
  companions: [],
  codesRedeemed: [],
  stats: { taps: 5230, kills: 1840, playTimeSec: 21600, maxCombo: 132 },
  mastery: { points: 0, spent: { might: 2, vitality: 0, fortune: 0 } },
  professions: { herbalism: 3, smithing: 2 },
  achievements: [],
  titlesUnlocked: ['wanderer', 'bossbane', 'veteran', 'idle-king'],
  activeTitle: 'bossbane',
  badge: 'youtuber',
  country: 'US',
  restedUntil: 0,
};

const app = express();
app.use(express.json());
app.get('/api/status', (req, res) => res.json({ ok: true, maintenance: false, message: null }));
app.get('/api/auth/me', (req, res) => res.json({ user: { username: 'Gamershis17', role: 'owner' } }));
app.get('/api/state', (req, res) => res.json({ state }));
app.post('/api/state', (req, res) => res.json({ ok: true }));
app.get('/api/leaderboard', (req, res) => res.json({ entries: [
  { username: 'Gamershis17', race: 'human', title: 'bossbane', badge: 'youtuber', country: 'US', level: 28, stage: 34, bossesKilled: 3, prestige: 1, power: 45210 },
  { username: 'DragonSlayer99', race: 'orc', title: 'veteran', badge: 'streamer', country: 'GB', level: 24, stage: 29, bossesKilled: 2, prestige: 1, power: 32100 },
  { username: 'MinaPlays', race: 'elf', title: 'goldhoarder', badge: null, country: 'JP', level: 21, stage: 25, bossesKilled: 2, prestige: 0, power: 24500 },
]}));
app.use(express.static(PUBLIC));
app.listen(3100, () => console.log('stub on :3100'));
