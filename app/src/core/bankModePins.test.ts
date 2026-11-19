// Seam 1 (core): pins (the page's ‹ › slot cyclers) and the owned items each cycler can offer (ticket #9).
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { planBankMode, type Setup, type StylePlan } from './bankMode';
import { readState } from './liveState';

const NOW = 1794791879541;
const load = (name: string) => readState(resolve('fixtures', name, 'state.json'), resolve('fixtures', name, 'bank.json'), NOW);
const NEARBY = { name: 'Maggot King', version: 'Nearby' };

const ranked = (plan: StylePlan | undefined) => {
  assert.ok(plan && 'setups' in plan, `expected setups, got ${JSON.stringify(plan)}`);
  return plan;
};
const weaponOf = (s: Setup) => s.items.weapon?.name ?? null;

// Item ids of the ironman-v2 fixture.
const ABYSSAL_WHIP = 4151; // worn
const MAGIC_SHORTBOW_I = 12788; // bank, two-handed
const OCCULT_NECKLACE = 12002; // bank
const TOME_OF_FIRE = 20714; // bank (shield slot)
const ARMADYL_GODSWORD = 11802; // not owned

test('a pinned weapon is in every setup of the style', async () => {
  const state = await load('ironman-v2');

  const plan = planBankMode(state, {
    monster: NEARBY, style: 'melee', boosts: 'live', pins: { weapon: ABYSSAL_WHIP },
  });

  // Unpinned, the fixture's best melee weapon against this phase is the Dragon warhammer.
  const { setups } = ranked(plan.styles.melee);
  assert.ok(setups.length > 0);
  for (const setup of setups) assert.equal(weaponOf(setup), 'Abyssal whip');
});

test('a pinned item that the optimizer would not pick lowers the DPS, and the other slots are still chosen', async () => {
  const state = await load('ironman-v2');
  const request = { monster: NEARBY, style: 'melee', boosts: 'live' } as const;

  const free = ranked(planBankMode(state, request).styles.melee).setups[0];
  const pinned = ranked(planBankMode(state, { ...request, pins: { neck: OCCULT_NECKLACE } }).styles.melee).setups[0];

  // The Amulet of fury gives melee strength; the Occult necklace gives none.
  assert.equal(free.items.neck?.name, 'Amulet of fury');
  assert.equal(pinned.items.neck?.name, 'Occult necklace');
  assert.ok(pinned.dps < free.dps, `${pinned.dps} should be below ${free.dps}`);
  assert.equal(weaponOf(pinned), 'Dragon warhammer');
});

test('a pin of an item that is not owned is ignored, with a note', async () => {
  const state = await load('ironman-v2');
  const request = { monster: NEARBY, style: 'melee', boosts: 'live' } as const;

  const plan = planBankMode(state, { ...request, pins: { weapon: ARMADYL_GODSWORD } });

  assert.deepEqual(plan.styles.melee, planBankMode(state, request).styles.melee);
  assert.ok(plan.notes.some((n) => /Armadyl godsword/.test(n) && /ignored/.test(n)), plan.notes.join('\n'));
});

test('a pinned shield cannot go with a pinned two-handed weapon: the style says so', async () => {
  const state = await load('ironman-v2');

  const plan = planBankMode(state, {
    monster: NEARBY, style: 'ranged', boosts: 'live', pins: { weapon: MAGIC_SHORTBOW_I, shield: TOME_OF_FIRE },
  });

  assert.deepEqual(plan.styles.ranged, { unavailable: 'No owned setup can attack with ranged with the pinned items.' });
});

test('each slot cycler offers owned items only, with their source; the weapon cycler offers the weapons of the style', async () => {
  const state = await load('ironman-v2');
  const ownedIds = new Set([
    ...Object.values(state.equipment ?? {}), ...state.inventory.map((i) => i.id), ...(state.bank?.items ?? []).map((i) => i.id),
  ]);

  const plan = planBankMode(state, { monster: NEARBY, boosts: 'live' });

  const melee = ranked(plan.styles.melee).owned;
  const ranged = ranked(plan.styles.ranged).owned;
  for (const [slot, items] of Object.entries(melee)) {
    for (const item of items) assert.ok(ownedIds.has(item.id), `${slot}: ${item.name} is owned`);
    assert.equal(new Set(items.map((i) => i.id)).size, items.length, `${slot}: no item twice`);
  }
  assert.deepEqual(melee.neck.map((i) => [i.name, i.source]).sort(), [
    ['Amulet of fury', 'worn'], ['Necklace of anguish', 'bank'], ['Occult necklace', 'bank'],
  ]);
  // A staff has melee (crush) styles; a powered staff (the Trident) and the bows have none.
  assert.deepEqual(melee.weapon.map((i) => i.name).sort(), ['Abyssal whip', 'Dragon warhammer', 'Mystic smoke staff']);
  assert.deepEqual(ranged.weapon.map((i) => i.name).sort(), ['Magic shortbow (i)', 'Rune crossbow']);
});

test('the 2-swap tier holds the pins, and "wearing now" ignores them', async () => {
  const state = await load('ironman-v2');
  const request = { monster: NEARBY, style: 'melee', boosts: 'live' } as const;

  const free = ranked(planBankMode(state, request).styles.melee);
  const pinned = ranked(planBankMode(state, { ...request, pins: { neck: OCCULT_NECKLACE } }).styles.melee);

  assert.equal(pinned.tiers.upToTwoSwaps?.items.neck?.name, 'Occult necklace');
  assert.ok(pinned.tiers.upToTwoSwaps!.swaps.length <= 2);
  assert.deepEqual(pinned.tiers.wearingNow, free.tiers.wearingNow);
});
