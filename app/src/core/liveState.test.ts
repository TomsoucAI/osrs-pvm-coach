// Seam 1 (core): readState reads the plugin's state file and bank file through a schema.
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { readState } from './liveState';

const fixture = (name: string, file: string) => resolve('fixtures', name, file);
const NOW = 1794791879541;

test('a v2 state file and its bank file give worn, inventory, bank, rune pouch and spellbook', async () => {
  const state = await readState(fixture('ironman-v2', 'state.json'), fixture('ironman-v2', 'bank.json'), NOW);

  assert.equal(state.loggedIn, true);
  assert.equal(state.playerName, 'FixtureIron');
  assert.equal(state.equipment?.weapon, 4151);
  assert.deepEqual(state.inventory[0], { id: 13576, quantity: 1 });
  assert.equal(state.spellbook, 'standard');
  assert.deepEqual(state.runePouch[0], { runeItemId: 554, quantity: 5000 });
  assert.equal(state.bank?.items.length, 33);
  assert.equal(state.bank?.ageMs, 7_200_000);
});

test('a v1 state file is accepted, with the v2 fields empty', async () => {
  const state = await readState(resolve('../examples/state.sample.json'), fixture('v1-has-no-bank', 'bank.json'), NOW);

  assert.equal(state.loggedIn, true);
  assert.equal(state.playerName, 'SampleTom');
  assert.deepEqual(state.inventory, []);
  assert.deepEqual(state.runePouch, []);
  assert.equal(state.spellbook, null);
  assert.equal(state.bank, null);
});

test('a logged-out state file reads as logged out', async () => {
  const state = await readState(fixture('logged-out', 'state.json'), fixture('logged-out', 'bank.json'), NOW);

  assert.equal(state.loggedIn, false);
  assert.equal(state.bank, null);
});

test('a state file that does not match the schema is refused with the field name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dps-bridge-'));
  const bad = join(dir, 'state.json');
  writeFileSync(bad, JSON.stringify({ version: 2, loggedIn: true, inventory: [{ id: 'whip', quantity: 1 }] }));

  await assert.rejects(readState(bad, join(dir, 'bank.json'), NOW), /inventory/);
});

test('a bank file that does not match the schema is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dps-bridge-'));
  const bank = join(dir, 'bank.json');
  writeFileSync(bank, JSON.stringify({ items: 'everything' }));

  await assert.rejects(readState(fixture('ironman-v2', 'state.json'), bank, NOW), /bank/i);
});
