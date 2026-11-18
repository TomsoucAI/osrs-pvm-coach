// Seam 1 (core): Planned boosts, tiers by swap count and manual defence drains in planBankMode (ticket #6).
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  buildPlayer, calculate, resolveMonster, SLOTS,
} from '../calc';
import { planBankMode, type StylePlan } from './bankMode';
import { readState } from './liveState';
import { exhaustiveSearch } from './oracle';

const NOW = 1794791879541;
const load = (name: string) => readState(resolve('fixtures', name, 'state.json'), resolve('fixtures', name, 'bank.json'), NOW);
const NEARBY = { name: 'Maggot King', version: 'Nearby' };

const ranked = (plan: StylePlan | undefined) => {
  assert.ok(plan && 'setups' in plan, `expected setups, got ${JSON.stringify(plan)}`);
  return plan;
};

test('Planned mode assumes the best prayer of each style, and only from the unlocked list', async () => {
  const state = await load('ironman-v2');
  const prayersWith = (unlockedPrayers?: string[]) => {
    const plan = planBankMode(state, { monster: NEARBY, boosts: 'planned', unlockedPrayers });
    return (['melee', 'ranged', 'magic'] as const).map((style) => ranked(plan.styles[style]).assumed?.prayers);
  };

  // Default: every prayer is unlocked.
  assert.deepEqual(prayersWith(), [['Zeal'], ['Rigour'], ['Augury']]);
  assert.deepEqual(prayersWith(['Piety', 'Chivalry', 'Eagle Eye', 'Sharp Eye', 'Mystic Might']), [['Piety'], ['Eagle Eye'], ['Mystic Might']]);
  // Without a combined melee prayer, the best accuracy prayer and the best strength prayer go together.
  assert.deepEqual(prayersWith(['Ultimate Strength', 'Incredible Reflexes', 'Burst of Strength']), [['Incredible Reflexes', 'Ultimate Strength'], [], []]);
  assert.deepEqual(prayersWith([]), [[], [], []]);
});

// The fixture owns: Super combat potion(4) in the inventory; Super combat potion(2), 2 Super strength(4),
// 3 Ranging potion(4) and 1 Ranging potion(2) in the bank. It owns no magic potion.
test('Planned mode assumes the best owned potion of each style, with the doses owned', async () => {
  const state = await load('ironman-v2');

  const plan = planBankMode(state, { monster: NEARBY, boosts: 'planned' });

  assert.equal(plan.boosts, 'planned');
  assert.deepEqual(ranked(plan.styles.melee).assumed?.potions, [{ name: 'Super combat potion', doses: 6 }]);
  assert.deepEqual(ranked(plan.styles.ranged).assumed?.potions, [{ name: 'Ranging potion', doses: 14 }]);
  assert.deepEqual(ranked(plan.styles.magic).assumed?.potions, []);
});

test('Planned mode pairs an attack potion with a strength potion when no owned potion gives both', async () => {
  const state = await load('ironman-v2');
  const superCombat = [12695, 12699];
  const separate = {
    ...state,
    // Super attack(3) replaces the Super combat potions.
    inventory: [...state.inventory.filter((i) => !superCombat.includes(i.id)), { id: 145, quantity: 1 }],
    bank: state.bank && { ...state.bank, items: state.bank.items.filter((i) => !superCombat.includes(i.id)) },
  };

  const plan = planBankMode(separate, { monster: NEARBY, style: 'melee', boosts: 'planned' });

  assert.deepEqual(ranked(plan.styles.melee).assumed?.potions, [
    { name: 'Super attack', doses: 3 }, { name: 'Super strength', doses: 8 },
  ]);
});

test('the Planned DPS is the engine DPS of the same setup with the assumed prayer and potion', async () => {
  const state = await load('ironman-v2');
  const live = ranked(planBankMode(state, { monster: NEARBY, style: 'melee', boosts: 'live' }).styles.melee);

  const planned = ranked(planBankMode(state, { monster: NEARBY, style: 'melee', boosts: 'planned', unlockedPrayers: ['Piety'] }).styles.melee);

  assert.equal(live.assumed, null);
  const best = planned.setups[0];
  // The same setup through the existing calc path (the one the Wiki reference values pin), with explicit overrides.
  const monster = resolveMonster(NEARBY);
  const { player } = buildPlayer(state, monster, {
    equipment: Object.fromEntries(SLOTS.map((slot) => [slot, best.items[slot]?.id ?? null])),
    style: best.style.split(' (')[0],
    prayers: ['PIETY'],
    potions: ['SUPER_COMBAT'],
  });
  assert.equal(best.dps, calculate(player, monster).dps);
  assert.ok(best.dps > live.setups[0].dps, `${best.dps} should be above the unboosted ${live.setups[0].dps}`);
});

test('tiers: wearing now changes no slot, the 2-swap tier changes at most 2, and the DPS never goes down from tier to tier', async () => {
  const state = await load('ironman-v2');

  const plan = planBankMode(state, { monster: NEARBY, boosts: 'live' });

  const melee = ranked(plan.styles.melee);
  assert.deepEqual(melee.tiers.bestOwned, melee.setups[0]);
  // The fixture wears a whip: the "wearing now" tier is that gear with the whip's best combat style.
  const worn = melee.tiers.wearingNow;
  assert.ok(worn);
  assert.deepEqual(worn.swaps, []);
  for (const slot of SLOTS) assert.equal(worn.items[slot]?.id ?? null, state.equipment?.[slot] ?? null, slot);
  const monster = resolveMonster(NEARBY);
  const whipStyles = ['Flick', 'Lash', 'Deflect'].map((style) => calculate(buildPlayer(state, monster, { style }).player, monster).dps);
  assert.equal(worn.dps, Math.max(...whipStyles));

  for (const style of ['melee', 'ranged', 'magic'] as const) {
    const { tiers } = ranked(plan.styles[style]);
    assert.ok(tiers.upToTwoSwaps, `${style}: a setup within 2 swaps`);
    assert.ok(tiers.upToTwoSwaps.swaps.length <= 2, `${style}: ${tiers.upToTwoSwaps.swaps.length} swaps`);
    assert.ok(tiers.upToTwoSwaps.dps <= tiers.bestOwned.dps, `${style}: 2 swaps <= best owned`);
    assert.ok((tiers.wearingNow?.dps ?? 0) <= tiers.upToTwoSwaps.dps, `${style}: wearing now <= 2 swaps`);
  }
  // A whip cannot attack with ranged: there is no "wearing now" setup for that style.
  assert.equal(ranked(plan.styles.ranged).tiers.wearingNow, null);
  // With magic, the worn gear can cast a spell by hand (Manual Cast): no slot changes.
  assert.deepEqual(ranked(plan.styles.magic).tiers.wearingNow?.swaps, []);
  assert.match(ranked(plan.styles.magic).tiers.wearingNow?.style ?? '', /Manual Cast/);
  // The best ranged setup needs more than 2 swaps, so the 2-swap tier is a weaker setup.
  assert.ok(ranked(plan.styles.ranged).tiers.upToTwoSwaps!.dps < ranked(plan.styles.ranged).tiers.bestOwned.dps);
});

test('manual drains: the plan gives the defence before and after, and the DPS goes up', async () => {
  const state = await load('ironman-v2');
  const planWith = (drains?: { dwhHits?: number; elderMaulHits?: number; bgsDamage?: number }) => planBankMode(state, {
    monster: NEARBY, style: 'melee', boosts: 'live', drains,
  });

  const none = planWith();
  const base = none.defence.base;
  assert.ok(base > 0);
  assert.equal(none.defence.effective, base);

  // Game rules: each Dragon warhammer hit removes 30% of the current defence, each Elder maul hit 35%, and
  // Bandos godsword damage comes off 1 for 1.
  const dwh = planWith({ dwhHits: 2 });
  assert.deepEqual(dwh.defence, { base, effective: Math.trunc(Math.trunc(base * 0.7) * 0.7) });
  assert.deepEqual(planWith({ elderMaulHits: 1 }).defence, { base, effective: Math.trunc(base * 0.65) });
  assert.deepEqual(planWith({ bgsDamage: 20 }).defence, { base, effective: base - 20 });
  assert.ok(ranked(dwh.styles.melee).setups[0].dps > ranked(none.styles.melee).setups[0].dps);
});

test('manual drains stop at the defence floor of the boss (Nex: 250)', async () => {
  const plan = planBankMode(await load('ironman-v2'), {
    monster: { name: 'Nex' }, style: 'melee', boosts: 'live', drains: { dwhHits: 10 },
  });

  assert.equal(plan.defence.base, 260);
  assert.equal(plan.defence.effective, 250);
});

// Oracle: each tier equals a brute-force search that keeps only the setups within the tier's swap count.
for (const version of ['Far', 'Nearby']) {
  for (const combat of ['melee', 'ranged', 'magic'] as const) {
    if (version === 'Far' && combat === 'melee') continue; // unavailable by the phase rule
    test(`the swap-count tiers equal an exhaustive search: Maggot King ${version}, ${combat}`, async () => {
      const state = await load('oracle-small');

      const { tiers } = ranked(planBankMode(state, { monster: { name: 'Maggot King', version }, style: combat, boosts: 'live' }).styles[combat]);

      const summary = (s: { dps: number; swaps: unknown[] | number } | null | undefined) => (
        s ? { dps: s.dps, swaps: typeof s.swaps === 'number' ? s.swaps : s.swaps.length } : null);
      const oracle = (maxSwaps: number) => summary(exhaustiveSearch(state, { name: 'Maggot King', version }, combat, maxSwaps)[0]);
      assert.deepEqual(summary(tiers.upToTwoSwaps), oracle(2));
      assert.deepEqual(summary(tiers.wearingNow), oracle(0));
    });
  }
}
