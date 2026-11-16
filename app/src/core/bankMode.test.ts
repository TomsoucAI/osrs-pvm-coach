// Seam 1 (core): planBankMode ranks the best owned setups per combat style with the Wiki engine.
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { scanEngineNamedItems } from '../../scripts/engine-named-items';
import { SLOTS } from '../calc';
import referenceDps from '../../fixtures/ironman-v2/reference-dps.json';
import {
  planBankMode, type CombatStyle, type Setup, type StylePlan,
} from './bankMode';
import engineNamedItems from './engineNamedItems.json';
import { readState, type LiveState } from './liveState';
import { exhaustiveSearch } from './oracle';

const NOW = 1794791879541;
const load = (name: string) => readState(resolve('fixtures', name, 'state.json'), resolve('fixtures', name, 'bank.json'), NOW);

const setupsOf = (plan: StylePlan | undefined): Setup[] => {
  assert.ok(plan && 'setups' in plan, `expected setups, got ${JSON.stringify(plan)}`);
  return plan.setups;
};
const names = (s: Setup) => Object.fromEntries(SLOTS.map((slot) => [slot, s.items[slot]?.name ?? null]));

function ownedIds(state: LiveState) {
  return {
    worn: new Set(Object.values(state.equipment ?? {}).filter((id) => id !== null)),
    inventory: new Set(state.inventory.map((i) => i.id)),
    bank: new Set((state.bank?.items ?? []).map((i) => i.id)),
  };
}

test('every recommended item is owned and carries its source', async () => {
  const state = await load('ironman-v2');
  const owned = ownedIds(state);

  const plan = planBankMode(state, { monster: { name: 'Maggot King', version: 'Nearby' } });

  for (const style of ['melee', 'ranged', 'magic'] as const) {
    const setups = setupsOf(plan.styles[style]);
    assert.ok(setups.length >= 1 && setups.length <= 3, `${style}: 1 to 3 setups`);
    for (const setup of setups) {
      for (const item of Object.values(setup.items)) {
        if (item) assert.ok(owned[item.source].has(item.id), `${item.name} should be in ${item.source}`);
      }
    }
  }
});

test('setups are ranked by DPS, one per weapon', async () => {
  const plan = planBankMode(await load('ironman-v2'), { monster: { name: 'Maggot King', version: 'Nearby' }, style: 'melee' });

  const setups = setupsOf(plan.styles.melee);
  assert.deepEqual(Object.keys(plan.styles), ['melee']);
  assert.deepEqual(setups.map((s) => s.dps), [...setups.map((s) => s.dps)].sort((a, b) => b - a));
  assert.equal(new Set(setups.map((s) => s.items.weapon?.name)).size, setups.length);
});

test('Maggot King Far: melee is unavailable, ranged and magic are ranked', async () => {
  const plan = planBankMode(await load('ironman-v2'), { monster: { name: 'Maggot King', version: 'Far' } });

  assert.deepEqual(plan.styles.melee, { unavailable: 'Melee cannot reach the Maggot King in its Far phase.' });
  assert.ok(setupsOf(plan.styles.ranged).length > 0);
  assert.ok(setupsOf(plan.styles.magic).length > 0);
});

test('a two-handed weapon leaves the shield slot empty', async () => {
  const plan = planBankMode(await load('ironman-v2'), { monster: { name: 'Maggot King', version: 'Nearby' }, style: 'ranged' });

  const shortbow = setupsOf(plan.styles.ranged).find((s) => s.items.weapon?.name === 'Magic shortbow (i)');
  assert.ok(shortbow, 'the fixture owns a Magic shortbow (i)');
  assert.equal(shortbow.items.shield, null);
});

test('ammo fits the weapon: bolts with the crossbow, arrows with the bow', async () => {
  const plan = planBankMode(await load('ironman-v2'), { monster: { name: 'Maggot King', version: 'Nearby' }, style: 'ranged' });

  const byWeapon = Object.fromEntries(setupsOf(plan.styles.ranged).map((s) => [s.items.weapon?.name, s.items.ammo?.name]));
  assert.match(byWeapon['Rune crossbow'] ?? '', /bolts/);
  assert.match(byWeapon['Magic shortbow (i)'] ?? '', /arrow/);
});

test('magic uses a spell on the current spellbook, and fire against the fire weakness', async () => {
  const state = await load('ironman-v2');

  const standard = planBankMode(state, { monster: { name: 'Maggot King', version: 'Far' }, style: 'magic' });
  assert.equal(setupsOf(standard.styles.magic)[0].spell, 'Fire Surge');

  const ancient = planBankMode({ ...state, spellbook: 'ancient' }, { monster: { name: 'Maggot King', version: 'Far' }, style: 'magic' });
  for (const setup of setupsOf(ancient.styles.magic)) {
    assert.ok(setup.spell === null || /Barrage|Blitz|Burst|Rush/.test(setup.spell), `${setup.spell} is not an Ancient spell`);
  }
});

test('swaps list each slot that differs from what is worn', async () => {
  const state = await load('ironman-v2');
  const plan = planBankMode(state, { monster: { name: 'Maggot King', version: 'Nearby' }, style: 'ranged' });

  const best = setupsOf(plan.styles.ranged)[0];
  const weaponSwap = best.swaps.find((s) => s.slot === 'weapon');
  assert.equal(weaponSwap?.from, 'Abyssal whip');
  assert.equal(weaponSwap?.to, best.items.weapon?.name);
  for (const swap of best.swaps) assert.notEqual(swap.from, swap.to);
  const unchanged = SLOTS.filter((slot) => !best.swaps.some((s) => s.slot === slot));
  for (const slot of unchanged) assert.equal(best.items[slot]?.id ?? null, state.equipment?.[slot] ?? null, `${slot} is not swapped`);
});

test('2 Dragon warhammer hits raise the DPS of each melee weapon', async () => {
  const state = await load('ironman-v2');
  const request = { monster: { name: 'Maggot King', version: 'Nearby' }, style: 'melee' } as const;

  const plain = setupsOf(planBankMode(state, request).styles.melee);
  const drained = setupsOf(planBankMode(state, { ...request, drains: { dwhHits: 2 } }).styles.melee);

  for (const before of plain) {
    const after = drained.find((s) => s.items.weapon?.name === before.items.weapon?.name);
    assert.ok(after && after.dps > before.dps, `${before.items.weapon?.name}: ${after?.dps} should be above ${before.dps}`);
  }
});

test('notes name the items and spells that the engine data does not know', async () => {
  const state = await load('ironman-v2');
  const withUnknown: LiveState = {
    ...state, equipment: { ...state.equipment, cape: 99999999 }, autocastSpell: 'Spell Of Tomorrow',
  };

  const plan = planBankMode(withUnknown, { monster: { name: 'Maggot King', version: 'Far' }, style: 'magic' });

  assert.ok(plan.notes.some((n) => /99999999/.test(n) && /cape/.test(n)), plan.notes.join('\n'));
  assert.ok(plan.notes.some((n) => /Spell Of Tomorrow/.test(n)), plan.notes.join('\n'));
  assert.ok(plan.notes.some((n) => /7 owned items/.test(n)), plan.notes.join('\n'));
});

test('a v1 state has no bank and no spellbook: the plan says so and still ranks the worn gear', async () => {
  const state = await readState(resolve('../examples/state.sample.json'), resolve('fixtures/none/bank.json'), NOW);

  const plan = planBankMode(state, { monster: { name: 'Maggot King', version: 'Nearby' } });

  assert.equal(setupsOf(plan.styles.melee)[0].items.weapon?.name, 'Abyssal whip');
  assert.equal(plan.bankAgeMs, null);
  assert.ok(plan.notes.some((n) => /bank/i.test(n)));
  assert.ok(plan.notes.some((n) => /spellbook/i.test(n)));
});

test('a logged-out state cannot be planned', async () => {
  const state = await readState(resolve('fixtures/logged-out/state.json'), resolve('fixtures/logged-out/bank.json'), NOW);

  assert.throws(() => planBankMode(state, { monster: { name: 'Maggot King', version: 'Far' } }), /logged out/i);
});

// Reference setups (Owner verifies, issue #5): Tom enters each one in the official Wiki DPS calculator
// and records the DPS as `wikiDps` in reference-dps.json. Until then the Wiki comparison shows as "todo".
for (const ref of referenceDps.references) {
  const request = {
    monster: { name: 'Maggot King', version: ref.version },
    style: ref.style as CombatStyle,
    drains: 'dwhHits' in ref ? { dwhHits: ref.dwhHits } : undefined,
  };

  test(`reference setup "${ref.label}" is the best owned setup`, async () => {
    const best = setupsOf(planBankMode(await load('ironman-v2'), request).styles[request.style])[0];

    assert.deepEqual(names(best), ref.items);
    assert.equal(best.style, ref.combatStyle);
    assert.equal(best.spell, ref.spell);
    assert.equal(best.dps, ref.engineDps);
  });

  const wikiTest = `reference setup "${ref.label}" matches the Wiki DPS calculator`;
  if (ref.wikiDps === null) {
    test(wikiTest, { todo: 'waiting for the Wiki value from Tom' });
  } else {
    test(wikiTest, async () => {
      const best = setupsOf(planBankMode(await load('ironman-v2'), request).styles[request.style])[0];

      assert.equal(best.dps, ref.wikiDps);
    });
  }
}

// Oracle: on the small fixture bank, the optimizer's result equals a brute-force search with no pruning.
// The fixture sets traps: a slayer helmet on task, an elite void set, a two-handed weapon against
// one-handed + shield, ammo that does not fit, and a Tome of fire with fire spells.
for (const version of ['Far', 'Nearby']) {
  for (const combat of ['melee', 'ranged', 'magic'] as const) {
    if (version === 'Far' && combat === 'melee') continue; // unavailable by the phase rule
    test(`the optimizer equals an exhaustive search: Maggot King ${version}, ${combat}`, async () => {
      const state = await load('oracle-small');

      const expected = exhaustiveSearch(state, { name: 'Maggot King', version }, combat);
      const actual = setupsOf(planBankMode(state, { monster: { name: 'Maggot King', version }, style: combat }).styles[combat]);

      assert.ok(expected.length > 0, 'the oracle found setups');
      assert.deepEqual(
        actual.map((s) => ({ weapon: s.items.weapon?.name ?? null, dps: s.dps, swaps: s.swaps.length })),
        expected.map((s) => ({ weapon: s.weapon, dps: s.dps, swaps: s.swaps })),
      );
      expected.forEach((setup, i) => {
        if (setup.ties === 1) assert.deepEqual(names(actual[i]), setup.items, `rank ${i + 1}: same items`);
      });
    });
  }
}

test('the engine-named item list matches the vendored engine source', () => {
  assert.deepEqual(engineNamedItems, scanEngineNamedItems(resolve('../vendor/osrs-dps-calc')));
});
