/**
 * Self-check: starts the built server over stdio against the sample state file,
 * calls every tool as a client would, and exits non-zero on any failure.
 * Run with: npm run build && npm run smoke
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';

async function connect(stateFile: string) {
  const c = new Client({ name: 'smoke-test', version: '1.0.0' });
  await c.connect(new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: { ...getDefaultEnvironment(), DPS_BRIDGE_FILE: resolve(stateFile) },
  }));
  return c;
}

const client = await connect('../examples/state.sample.json');

const { tools } = await client.listTools();
assert.deepEqual(tools.map((t) => t.name).sort(),
  ['osrs_best_owned_setup', 'osrs_calculate_dps', 'osrs_compare_setups', 'osrs_get_loadout', 'osrs_search_monsters']);
for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, `${t.name} should be read-only`);

const call = async (name: string, args: Record<string, unknown>, on: Client = client) => {
  const r = await on.callTool({ name, arguments: args });
  assert.ok(!r.isError, `${name} failed: ${JSON.stringify(r.content)}`);
  return r;
};

const loadout = await call('osrs_get_loadout', { response_format: 'json' });
const l = loadout.structuredContent as { player: string; loadout: { prayers: string[] } };
assert.equal(l.player, 'SampleTom');
assert.deepEqual(l.loadout.prayers, ['PIETY']);

const dps = await call('osrs_calculate_dps', { response_format: 'json' });
const d = dps.structuredContent as { monster: string; result: { dps: number; maxHit: number } };
assert.equal(d.monster, 'Abyssal demon (Standard)');
assert.equal(d.result.maxHit, 47);
assert.equal(d.result.dps, 7.753);

const md = await call('osrs_calculate_dps', { monster: 'Vorkath', monster_version: 'Post-quest' });
assert.match((md.content[0] as { text: string }).text, /# DPS vs Vorkath \(Post-quest\)/);

const cmp = await call('osrs_compare_setups', {
  response_format: 'json',
  variants: [{ label: 'no prayer', prayers: [] }, { label: 'slayer helm', equipment: { head: 'Slayer helmet (i)' } }],
});
const rows = (cmp.structuredContent as { results: { label: string }[] }).results.map((r) => r.label);
assert.deepEqual(rows, ['slayer helm', 'current', 'no prayer']);

// Defence drains: 2 DWH on post-quest Vorkath 214 -> 150 -> 105; Nex is floored at 250
const dwh = await call('osrs_calculate_dps', {
  monster: 'Vorkath', monster_version: 'Post-quest', defence_reductions: { dwh_hits: 2 }, response_format: 'json',
});
const dw = dwh.structuredContent as { defence_level: { base: number; effective: number }; result: { dps: number } };
assert.deepEqual(dw.defence_level, { base: 214, effective: 105 });
assert.ok(dw.result.dps > 3.698, 'DWH should raise DPS vs no spec');
const nex = await call('osrs_calculate_dps', { monster: 'Nex', defence_reductions: { dwh_hits: 3 }, response_format: 'json' });
assert.equal((nex.structuredContent as { defence_level: { effective: number } }).defence_level.effective, 250);

const search = await call('osrs_search_monsters', { query: 'dragon', limit: 3, response_format: 'json' });
const page = search.structuredContent as { count: number; has_more: boolean; next_offset?: number };
assert.equal(page.count, 3);
assert.ok(page.has_more && page.next_offset === 3, 'pagination should point to the next page');

const invalid = await client.callTool({ name: 'osrs_search_monsters', arguments: { query: 'x' } });
assert.equal(invalid.isError, true, 'a one-character query should be rejected');

const badPrayer = await client.callTool({ name: 'osrs_calculate_dps', arguments: { prayers: ['SUPER_PIETY'] } });
assert.equal(badPrayer.isError, true, 'unknown prayer should be a readable tool error');
assert.match((badPrayer.content[0] as { text: string }).text, /Valid:/);

// osrs_best_owned_setup on the v1 sample (no bank file): ranks the worn gear against the current target
type Plan = {
  monster: { name: string; version: string };
  styles: Record<string, { unavailable?: string; setups?: { dps: number; items: Record<string, { name: string; source: string } | null>; swaps: unknown[] }[] }>;
  bankAgeMs: number | null;
};
const wornOnly = (await call('osrs_best_owned_setup', { style: 'melee', response_format: 'json' })).structuredContent as Plan;
assert.equal(wornOnly.monster.name, 'Abyssal demon');
assert.equal(wornOnly.bankAgeMs, null);
assert.equal(wornOnly.styles.melee.setups?.[0].items.weapon?.name, 'Abyssal whip');
await client.close();

// osrs_best_owned_setup on the v2 fixture with its bank: Maggot King Far has no melee, ranged comes from the bank
const fixture = await connect('fixtures/ironman-v2/state.json');
const far = (await call('osrs_best_owned_setup', {
  monster: 'Maggot King', monster_version: 'Far', boosts: 'live', response_format: 'json',
}, fixture)).structuredContent as Plan;
assert.equal(far.monster.version, 'Far');
assert.ok(far.styles.melee.unavailable, 'melee should be unavailable in the Far phase');
const ranged = far.styles.ranged.setups![0];
assert.equal(ranged.dps, 4.344);
assert.deepEqual(ranged.items.weapon, { id: 9185, name: 'Rune crossbow', source: 'inventory' });
assert.equal(ranged.items.ammo?.source, 'bank');
assert.ok(far.styles.magic.setups!.length > 0);
// The page's cycler lists (every owned item per slot) stay out of the tool reply: they would only fill the context.
assert.ok(!('owned' in far.styles.ranged), 'no cycler lists in the tool reply');

const farMd = await call('osrs_best_owned_setup', { monster: 'Maggot King', monster_version: 'Far' }, fixture);
const farText = (farMd.content[0] as { text: string }).text;
assert.match(farText, /# Best owned setups vs Maggot King \(Far\)/);
assert.match(farText, /## Melee\nUnavailable:/);
assert.match(farText, /Rune crossbow \[inventory\]/);

const badStyle = await fixture.callTool({ name: 'osrs_best_owned_setup', arguments: { monster: 'Maggot King', style: 'summoning' } });
assert.equal(badStyle.isError, true, 'an unknown style should be rejected by the schema');

// Ticket #6, "plan Maggot King Nearby with 2 DWH": Planned boosts by default, the owned potion with its doses,
// the 3 tiers, the defence before and after, and a higher DPS than with no drain.
type BoostPlan = {
  boosts: string;
  defence: { base: number; effective: number };
  styles: Record<string, {
    setups: { dps: number }[];
    assumed: { prayers: string[]; potions: { name: string; doses: number }[] } | null;
    tiers: Record<string, { dps: number; swaps: unknown[] } | null>;
  }>;
};
const nearby = { monster: 'Maggot King', monster_version: 'Nearby', unlocked_prayers: ['PIETY', 'RIGOUR', 'AUGURY'] };
const noDrain = (await call('osrs_best_owned_setup', { ...nearby, response_format: 'json' }, fixture)).structuredContent as BoostPlan;
const twoDwh = (await call('osrs_best_owned_setup', { ...nearby, defence_reductions: { dwh_hits: 2 }, response_format: 'json' }, fixture))
  .structuredContent as BoostPlan;
assert.equal(twoDwh.boosts, 'planned');
assert.deepEqual(twoDwh.styles.melee.assumed, { prayers: ['Piety'], potions: [{ name: 'Super combat potion', doses: 6 }] });
assert.deepEqual(twoDwh.styles.ranged.assumed, { prayers: ['Rigour'], potions: [{ name: 'Ranging potion', doses: 14 }] });
assert.deepEqual(Object.keys(twoDwh.styles.melee.tiers), ['bestOwned', 'upToTwoSwaps', 'wearingNow']);
assert.ok(twoDwh.styles.melee.tiers.upToTwoSwaps!.swaps.length <= 2);
assert.equal(noDrain.defence.effective, noDrain.defence.base);
assert.ok(twoDwh.defence.effective < twoDwh.defence.base, 'the drains should lower the defence');
assert.ok(twoDwh.styles.melee.setups[0].dps > noDrain.styles.melee.setups[0].dps, '2 DWH should raise the DPS');

const dwhText = ((await call('osrs_best_owned_setup', { ...nearby, defence_reductions: { dwh_hits: 2 } }, fixture)).content[0] as { text: string }).text;
assert.match(dwhText, /Boosts: Planned/);
const drainedPct = Math.round((1 - twoDwh.defence.effective / twoDwh.defence.base) * 100);
assert.ok(drainedPct >= 50 && drainedPct <= 52, `2 DWH hits remove about 51% of the defence, got ${drainedPct}%`);
assert.match(dwhText, new RegExp(`Defence ${twoDwh.defence.base} → \\*\\*${twoDwh.defence.effective}\\*\\* after drains \\(-${drainedPct}%\\)`));
assert.match(dwhText, /Assumed: Piety · Super combat potion \(6 doses owned\)/);
assert.match(dwhText, /Best owned: \*\*[\d.]+ DPS\*\*/);
assert.match(dwhText, /≤ 2 swaps: \*\*[\d.]+ DPS\*\*/);
assert.match(dwhText, /Wearing now: \*\*[\d.]+ DPS\*\*/);

const liveText = ((await call('osrs_best_owned_setup', { ...nearby, boosts: 'live' }, fixture)).content[0] as { text: string }).text;
assert.match(liveText, /Boosts: Live/);
assert.doesNotMatch(liveText, /Assumed:/);

const badUnlocked = await fixture.callTool({ name: 'osrs_best_owned_setup', arguments: { ...nearby, unlocked_prayers: ['SUPER_PIETY'] } });
assert.equal(badUnlocked.isError, true, 'an unknown unlocked prayer should be rejected by the schema');
assert.match((badUnlocked.content[0] as { text: string }).text, /Input validation error/);

// Ticket #7: the standard-spellbook fixture has no thrall line
assert.equal((twoDwh as BoostPlan & { thrall: unknown }).thrall, null);
assert.doesNotMatch(dwhText, /thrall/i);
await fixture.close();

// Ticket #7: the Arceuus fixture has a "+ greater thrall" line next to the Wiki-calc DPS, with its wiki source
const arceuus = await connect('fixtures/ironman-arceuus/state.json');
const farArgs = { monster: 'Maggot King', monster_version: 'Far', style: 'ranged', boosts: 'live' };
const withThrall = (await call('osrs_best_owned_setup', { ...farArgs, response_format: 'json' }, arceuus)).structuredContent as Plan
  & { thrall: { dps: number; source: { url: string; readOn: string } } | null };
assert.equal(withThrall.thrall?.dps, 0.625);
assert.equal(withThrall.styles.ranged.setups![0].dps, 4.344, 'the thrall is not in the Wiki-calc DPS');
const thrallText = ((await call('osrs_best_owned_setup', farArgs, arceuus)).content[0] as { text: string }).text;
assert.match(thrallText, /\+ Greater thrall: \*\*0\.625 DPS\*\*, on top of each setup's DPS \(not in it\)\. Source: https:\/\/oldschool\.runescape\.wiki\/w\/Thralls, read on 2026-11-18\./);
await arceuus.close();

// Counted drains (state v2): the plugin counted 1 DWH hit on the current target, an Abyssal demon (defence 135 - floor(135 * 0.3) = 95)
type Dps = { defence_level: { base: number; effective: number }; result: { dps: number }; notes: string[] };
const drained = await connect('fixtures/spec-drains/state.json');
const counted = (await call('osrs_calculate_dps', { response_format: 'json' }, drained)).structuredContent as Dps;
assert.deepEqual(counted.defence_level, { base: 135, effective: 95 });
assert.ok(counted.result.dps > 7.753, 'a counted DWH hit should raise the DPS');
assert.ok(counted.notes.some((n) => /counted/i.test(n)), 'a note names the counted drains');

const manual = (await call('osrs_calculate_dps', { defence_reductions: { dwh_hits: 0 }, response_format: 'json' }, drained)).structuredContent as Dps;
assert.deepEqual(manual.defence_level, { base: 135, effective: 135 });
assert.equal(manual.result.dps, 7.753);

const other = (await call('osrs_calculate_dps', { monster: 'Vorkath', monster_version: 'Post-quest', response_format: 'json' }, drained)).structuredContent as Dps;
assert.deepEqual(other.defence_level, { base: 214, effective: 214 });

// osrs_compare_setups: "current" carries the counted drains, a variant's own defence_reductions replace them
const cmpDrained = (await call('osrs_compare_setups', {
  response_format: 'json', variants: [{ label: 'dwh missed', defence_reductions: { dwh_hits: 0 } }],
}, drained)).structuredContent as { results: { label: string; defence: number }[]; notes: string[] };
assert.deepEqual(cmpDrained.results.map((r) => [r.label, r.defence]), [['current', 95], ['dwh missed', 135]]);
assert.ok(cmpDrained.notes.some((n) => /counted/i.test(n)));
await drained.close();

// Drains that do not match the schema count as no drains: the rest of the state still reads
const malformedFile = join(mkdtempSync(join(tmpdir(), 'dps-bridge-')), 'state.json');
const drainsFixture = JSON.parse(readFileSync('fixtures/spec-drains/state.json', 'utf8'));
writeFileSync(malformedFile, JSON.stringify({ ...drainsFixture, drains: { targetId: 415, dwhHits: 'one' } }));
const malformed = await connect(malformedFile);
const noDrains = (await call('osrs_calculate_dps', { response_format: 'json' }, malformed)).structuredContent as Dps;
assert.deepEqual(noDrains.defence_level, { base: 135, effective: 135 });
assert.equal(noDrains.result.dps, 7.753);
await malformed.close();

console.error('Smoke test passed');
