// The Cheat sheet's "Wear" panel: the best owned setup from the Gear tab's plan, or why there is none.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { BankModePlan, Setup, StateSummary } from './api';
import { STATIC_CONTROLS, wearOf } from './wear';

const SETUP = { dps: 7.5, maxHit: 52 } as Setup;
const IN: StateSummary = { loggedIn: true, playerName: 'FixtureIron', bankAgeMs: 60_000, worn: null, wornIds: null };
const plan = (styles: BankModePlan['styles'], bankAgeMs: number | null = 60_000) => ({ styles, bankAgeMs }) as BankModePlan;
const ranked = { setups: [SETUP], tiers: { bestOwned: SETUP, upToTwoSwaps: null, wearingNow: null } } as unknown as BankModePlan['styles']['melee'];

test('the setup is the best owned setup of the style, from the plan', () => {
  assert.deepEqual(wearOf({ summary: IN, plan: plan({ melee: ranked }) }, 'melee'), { kind: 'setup', setup: SETUP, noBank: false });
});

test('with no bank snapshot, the setup still shows and says that the bank was not read', () => {
  assert.deepEqual(wearOf({ summary: IN, plan: plan({ melee: ranked }, null) }, 'melee'), { kind: 'setup', setup: SETUP, noBank: true });
});

test('logged out: no setup, and the panel says so', () => {
  const wear = wearOf({ summary: { ...IN, loggedIn: false }, plan: null }, 'melee');

  assert.equal(wear.kind, 'why');
  assert.match(wear.kind === 'why' ? wear.why : '', /logged out/i);
});

test('no readable state or no server: no setup, and the panel says to log in with the plugin on', () => {
  for (const fresh of [null, { summary: null, plan: null }]) {
    const wear = wearOf(fresh, 'melee');

    assert.equal(wear.kind, 'why');
    assert.match(wear.kind === 'why' ? wear.why : '', /DPS Bridge plugin/);
  }
});

test('a style the player cannot attack with gives the plan\'s own reason', () => {
  const wear = wearOf({ summary: IN, plan: plan({ melee: { unavailable: 'No owned weapon attacks with melee.' } }) }, 'melee');

  assert.deepEqual(wear, { kind: 'why', why: 'No owned weapon attacks with melee.' });
});

test('logged in with no plan: the panel says the setup search failed', () => {
  const wear = wearOf({ summary: IN, plan: null }, 'melee');

  assert.equal(wear.kind, 'why');
  assert.match(wear.kind === 'why' ? wear.why : '', /setup search .* failed/);
});

test('the Wear request takes nothing from the fight: no drains, Planned boosts (legality condition)', () => {
  assert.deepEqual(STATIC_CONTROLS, { boosts: 'planned', drains: 'none', bgsDamage: 0, pins: {} });
});
