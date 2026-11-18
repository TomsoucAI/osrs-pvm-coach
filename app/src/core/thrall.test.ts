// Seam 1 (core): the "+ greater thrall DPS" line of planBankMode (ticket #7). It sits next to the Wiki-calc DPS, never in it.
// Expected values: the OSRS Wiki Thralls page, read on 2026-11-18 (greater thrall: Magic 76, 10 fire + 5 blood + 1 cosmic,
// max hit 3, one attack every 2.4 s, always hits, 0.625 DPS).
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { planBankMode, type BankModeRequest } from './bankMode';
import { readState } from './liveState';

const NOW = 1794791879541;
const load = (name: string) => readState(resolve('fixtures', name, 'state.json'), resolve('fixtures', name, 'bank.json'), NOW);
// One style keeps each plan fast: the thrall line does not depend on the style asked.
const FAR_RANGED: BankModeRequest = { monster: { name: 'Maggot King', version: 'Far' }, style: 'ranged', boosts: 'live' };

test('with the Arceuus book, Magic 76+ and the runes owned, the plan has a greater thrall line from the wiki', async () => {
  const plan = planBankMode(await load('ironman-arceuus'), FAR_RANGED);

  assert.deepEqual(plan.thrall, {
    name: 'Greater thrall',
    dps: 0.625,
    maxHit: 3,
    attackSeconds: 2.4,
    source: { url: 'https://oldschool.runescape.wiki/w/Thralls', readOn: '2026-11-18' },
  });
});

test('the thrall line is hidden on a book other than Arceuus, or an unknown book (v1 file)', async () => {
  const arceuus = await load('ironman-arceuus');

  for (const spellbook of ['standard', 'ancient', 'lunar', null] as const) {
    assert.equal(planBankMode({ ...arceuus, spellbook }, FAR_RANGED).thrall, null, `spellbook ${spellbook}`);
  }
  assert.equal(planBankMode(await load('ironman-v2'), FAR_RANGED).thrall, null, 'the standard-spellbook fixture');
});

test('the thrall line needs a current Magic level of 76: a boost counts, a drain too', async () => {
  const arceuus = await load('ironman-arceuus');
  const withMagic = (real: number, boosted: number) => planBankMode({
    ...arceuus, realLevels: { ...arceuus.realLevels, magic: real }, boostedLevels: { ...arceuus.boostedLevels, magic: boosted },
  }, FAR_RANGED).thrall;

  assert.equal(withMagic(75, 75), null, 'Magic 75');
  assert.equal(withMagic(80, 75), null, 'Magic 80 drained to 75');
  assert.equal(withMagic(76, 76)?.name, 'Greater thrall', 'Magic 76');
  assert.equal(withMagic(74, 76)?.name, 'Greater thrall', 'Magic 74 boosted to 76');
});

// Item ids: RuneLite `net.runelite.api.ItemID`: FIRE_RUNE 554, COSMIC_RUNE 564, BLOOD_RUNE 565.
const FIRE = 554;
const COSMIC = 564;
const BLOOD = 565;

test('the thrall line needs 10 fire, 5 blood and 1 cosmic runes, counted over the rune pouch, inventory and bank', async () => {
  const arceuus = await load('ironman-arceuus');
  type Stacks = { id: number; quantity: number }[];
  const noRunes = (stacks: Stacks) => stacks.filter((s) => ![FIRE, COSMIC, BLOOD].includes(s.id));
  const withRunes = (runes: { pouch?: Stacks; inventory?: Stacks; bank?: Stacks }) => planBankMode({
    ...arceuus,
    runePouch: (runes.pouch ?? []).map(({ id, quantity }) => ({ runeItemId: id, quantity })),
    inventory: [...noRunes(arceuus.inventory), ...(runes.inventory ?? [])],
    bank: arceuus.bank && { ...arceuus.bank, items: [...noRunes(arceuus.bank.items), ...(runes.bank ?? [])] },
  }, FAR_RANGED).thrall;
  const enough = { fire: 10, blood: 5, cosmic: 1 };
  const inPouch = (r: { fire: number; blood: number; cosmic: number }) => ({
    pouch: [{ id: FIRE, quantity: r.fire }, { id: BLOOD, quantity: r.blood }, { id: COSMIC, quantity: r.cosmic }],
  });

  assert.equal(withRunes(inPouch(enough))?.name, 'Greater thrall', 'exactly enough runes in the pouch');
  assert.equal(withRunes(inPouch({ ...enough, fire: 9 })), null, '9 fire runes');
  assert.equal(withRunes(inPouch({ ...enough, blood: 4 })), null, '4 blood runes');
  assert.equal(withRunes(inPouch({ ...enough, cosmic: 0 })), null, 'no cosmic rune');
  assert.equal(withRunes({}), null, 'no runes at all');
  assert.equal(withRunes({
    pouch: [{ id: FIRE, quantity: 4 }],
    inventory: [{ id: FIRE, quantity: 6 }, { id: BLOOD, quantity: 5 }],
    bank: [{ id: COSMIC, quantity: 1 }],
  })?.name, 'Greater thrall', 'the runes split over the pouch, inventory and bank');
});

test('the thrall line changes no Wiki-calc number: setups, tiers and defence stay the same', async () => {
  const arceuus = await load('ironman-arceuus');
  const noCosmic = { ...arceuus, bank: arceuus.bank && { ...arceuus.bank, items: arceuus.bank.items.filter((i) => i.id !== COSMIC) } };
  const request: BankModeRequest = { monster: { name: 'Maggot King', version: 'Far' }, boosts: 'planned' };

  const withThrall = planBankMode(arceuus, request);
  const without = planBankMode(noCosmic, request);

  assert.ok(withThrall.thrall && !without.thrall);
  assert.deepEqual(withThrall.styles, without.styles);
  assert.deepEqual(withThrall.defence, without.defence);
});
