/**
 * Self-check: starts the built server over stdio against the sample state file,
 * calls every tool as a client would, and exits non-zero on any failure.
 * Run with: npm run build && npm run smoke
 */
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
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
const far = (await call('osrs_best_owned_setup', { monster: 'Maggot King', monster_version: 'Far', response_format: 'json' }, fixture))
  .structuredContent as Plan;
assert.equal(far.monster.version, 'Far');
assert.ok(far.styles.melee.unavailable, 'melee should be unavailable in the Far phase');
const ranged = far.styles.ranged.setups![0];
assert.equal(ranged.dps, 4.344);
assert.deepEqual(ranged.items.weapon, { id: 9185, name: 'Rune crossbow', source: 'inventory' });
assert.equal(ranged.items.ammo?.source, 'bank');
assert.ok(far.styles.magic.setups!.length > 0);

const farMd = await call('osrs_best_owned_setup', { monster: 'Maggot King', monster_version: 'Far' }, fixture);
const farText = (farMd.content[0] as { text: string }).text;
assert.match(farText, /# Best owned setups vs Maggot King \(Far\)/);
assert.match(farText, /## Melee\nUnavailable:/);
assert.match(farText, /Rune crossbow \[inventory\]/);

const badStyle = await fixture.callTool({ name: 'osrs_best_owned_setup', arguments: { monster: 'Maggot King', style: 'summoning' } });
assert.equal(badStyle.isError, true, 'an unknown style should be rejected by the schema');
await fixture.close();

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
await drained.close();

console.error('Smoke test passed');
