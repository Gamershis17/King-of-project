'use strict';
/**
 * Nerf-batch unit tests (no server, no DOM).
 * Covers Stream 1: kinked XP curve, rebirth scaling, kill-XP nerf,
 * +50% xpBonus clamp in gainXp, and server-side xpNext anti-spoof.
 *
 * Run: node test/nerf.js
 */
const assert = require('assert');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL ${name}: ${e.message}`);
  }
}

async function main() {
  const E = await import('../public/js/engine.js');
  const V = require('../src/validation.js');

  console.log('== xp curve (kink at 60) ==');
  check('xpForLevel(1) = 80', () => {
    assert.strictEqual(E.xpForLevel(1, 0), 80);
  });
  check('curve unchanged at/below kink: L60 matches old 1.30 formula', () => {
    assert.strictEqual(E.xpForLevel(60, 0), Math.round(80 * Math.pow(1.30, 59)));
  });
  check('kink is continuous: L61 / L60 ~= 1.42', () => {
    const r = E.xpForLevel(61, 0) / E.xpForLevel(60, 0);
    assert.ok(r > 1.415 && r < 1.425, `ratio ${r}`);
  });
  check('level 70 much steeper than the old curve', () => {
    const old70 = Math.round(80 * Math.pow(1.30, 69));
    assert.ok(E.xpForLevel(70, 0) > old70 * 1.5,
      `new ${E.xpForLevel(70, 0)} vs old ${old70}`);
  });
  check('total XP 1->70 nerfed (old ~19.4B)', () => {
    let total = 0;
    for (let L = 1; L <= 69; L++) total += E.xpForLevel(L, 0);
    assert.ok(total > 30e9 && total < 40e9, `total ${total}`);
  });

  console.log('== rebirth scaling ==');
  check('rebirthXpMult: 0->1, 1->1.35, 2->1.8225', () => {
    assert.strictEqual(E.rebirthXpMult(0), 1);
    assert.ok(Math.abs(E.rebirthXpMult(1) - 1.35) < 1e-9);
    assert.ok(Math.abs(E.rebirthXpMult(2) - 1.8225) < 1e-9);
  });
  check('xpForLevel scales with rebirthCount', () => {
    const base = E.xpForLevel(10, 0);
    // allow ±1 for double-rounding: round(round(base)*mult) vs round(base*mult)
    assert.ok(Math.abs(E.xpForLevel(10, 2) - base * 1.8225) < 1.5,
      `got ${E.xpForLevel(10, 2)} vs base ${base}`);
  });
  check('rebirth() bumps count and scales xpNext', () => {
    const s = E.ensureState({ race: 'orc', level: 70, rebirthCount: 0 });
    s.xpNext = E.xpForLevel(70, 0);
    const out = E.rebirth(s);
    assert.ok(out, 'rebirth should succeed at 70');
    assert.strictEqual(s.rebirthCount, 1);
    assert.strictEqual(s.level, 1);
    assert.strictEqual(s.xpNext, E.xpForLevel(1, 1));
  });
  check('ensureState recomputes xpNext with rebirth scaling', () => {
    const s = E.ensureState({ race: 'orc', level: 70, rebirthCount: 2, xpNext: 1 });
    assert.strictEqual(s.xpNext, E.xpForLevel(70, 2));
  });

  console.log('== kill xp nerf ==');
  check('xpForKill uses 1.12 base', () => {
    assert.strictEqual(E.xpForKill(1), Math.round(10 * 1.12));
  });
  check('xpForKill(148) nerfed below 1B (was ~9.6B)', () => {
    assert.ok(E.xpForKill(148) < 1e9, `got ${E.xpForKill(148)}`);
  });

  console.log('== xpBonus clamp in gainXp ==');
  check('computeStats still reports the true (unclamped) xpBonus', () => {
    const s = E.ensureState({ race: 'orc', level: 60, xp: 0 });
    s.mine = { ores: { galaxy: 10, supergalaxy: 5 } };
    const item = E.craftGalaxyItem(s, 'weapon', 'super', ['xpBonus']);
    assert.ok(item && typeof item === 'object', `craft failed: ${item}`);
    assert.ok(E.equipGalaxy(s, 'weapon'), 'equip failed');
    const stats = E.computeStats(s);
    assert.strictEqual(stats.xpBonus, 600, `tooltip xpBonus ${stats.xpBonus}`);
  });
  check('gainXp caps gear xpBonus at +50% (600% item -> 1.5x, not 7x)', () => {
    const mk = () => E.ensureState({ race: 'orc', level: 60, xp: 0 });
    const plain = mk();
    E.gainXp(plain, 10000);
    assert.strictEqual(plain.xp, 10000, `plain ${plain.xp}`);
    const geared = mk();
    geared.mine = { ores: { galaxy: 10, supergalaxy: 5 } };
    E.craftGalaxyItem(geared, 'weapon', 'super', ['xpBonus']);
    E.equipGalaxy(geared, 'weapon');
    E.gainXp(geared, 10000);
    assert.strictEqual(geared.xp, 15000, `geared ${geared.xp}`);
  });

  console.log('== server anti-spoof (validation.js) ==');
  check('sanitizeStateBlob recomputes xpNext from level+rebirthCount', () => {
    const blob = {
      level: 70, rebirthCount: 3, xpNext: 5, xp: 0, stage: 1,
      bossesKilled: 0, gold: 0, stars: 0, inventory: [], codesRedeemed: [],
    };
    const res = V.sanitizeStateBlob(blob);
    assert.ok(res.ok, `not ok: ${res.error}`);
    assert.strictEqual(res.state.xpNext, E.xpForLevel(70, 3),
      `xpNext ${res.state.xpNext}`);
  });
  check('tampered rebirthCount is clamped before the recompute', () => {
    const blob = {
      level: 10, rebirthCount: 1e12, xpNext: 1, xp: 0, stage: 1,
      bossesKilled: 0, gold: 0, stars: 0, inventory: [], codesRedeemed: [],
    };
    const res = V.sanitizeStateBlob(blob);
    assert.ok(res.ok);
    assert.strictEqual(res.state.rebirthCount, 100000);
    assert.strictEqual(res.state.xpNext, E.xpForLevel(10, 100000));
  });

  console.log(failures === 0 ? 'NERF TESTS PASSED' : `${failures} NERF TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
