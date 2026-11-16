/**
 * Self-check: starts the built server over stdio against the sample state file,
 * calls every tool as a client would, and exits non-zero on any failure.
 * Run with: npm run build && npm run smoke
 */
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const client = new Client({ name: 'smoke-test', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: { ...getDefaultEnvironment(), DPS_BRIDGE_FILE: resolve('../examples/state.sample.json') },
}));

const { tools } = await client.listTools();
assert.deepEqual(tools.map((t) => t.name).sort(),
  ['osrs_calculate_dps', 'osrs_compare_setups', 'osrs_get_loadout', 'osrs_search_monsters']);
for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, `${t.name} should be read-only`);

const call = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
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

await client.close();
console.error('Smoke test passed');
