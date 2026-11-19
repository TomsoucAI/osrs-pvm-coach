// The Boss notes folder and its schema, through the Briefing core's public functions.
// Run with: npm run build && node --test dist/core.test.js (from app/)
import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { listBossNotes, readBriefing } from './briefing';

const NOTES_DIR = resolve('..', 'boss-notes');
let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'boss-notes-test-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function maggotKing(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(NOTES_DIR, 'maggot-king.json'), 'utf8'));
}

/** A notes folder with one file, written from `notes`. */
async function folderWith(name: string, file: string, notes: unknown): Promise<string> {
  const folder = join(dir, name);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, file), JSON.stringify(notes));
  return folder;
}

test('every file in the Boss notes folder passes the schema', async () => {
  const all = await listBossNotes(NOTES_DIR);

  assert.ok(all.length >= 1);
  assert.ok(all.some((n) => n.boss === 'Maggot King'));
});

test('the Maggot King notes hold all seven parts and the drops, each fact with a source', async () => {
  const notes = await readBriefing(NOTES_DIR, 'Maggot King');

  assert.ok(notes);
  assert.equal(notes.status, 'draft');
  assert.match(notes.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
  for (const part of [notes.phases, notes.mechanics, notes.methods, notes.gearPrinciples, notes.combatAchievements, notes.mistakes, notes.drops]) {
    assert.ok(part.length > 0);
    for (const fact of part) assert.ok(fact.sources.length > 0);
  }
  assert.ok(notes.styles.sources.length > 0);
  assert.deepEqual(notes.mechanics.find((m) => m.id === 'slam')?.missDamage, '55');
  assert.deepEqual(notes.mechanics.find((m) => m.id === 'screech')?.prayer, 'off');
});

test('a boss name finds its file whatever the case and spacing', async () => {
  const notes = await readBriefing(NOTES_DIR, '  maggot KING ');

  assert.equal(notes?.boss, 'Maggot King');
});

test('a boss with no file has no notes', async () => {
  assert.equal(await readBriefing(NOTES_DIR, 'Abyssal demon'), null);
  assert.equal(await readBriefing(NOTES_DIR, '../app/package'), null);
});

test('a malformed file is refused at load', async () => {
  const notes = await maggotKing();
  const broken = await folderWith('broken', 'maggot-king.json', { ...notes, status: 'final' });

  await assert.rejects(readBriefing(broken, 'Maggot King'), /status/);
  await assert.rejects(listBossNotes(broken), /status/);
});

test('a file that is not JSON is refused at load', async () => {
  const folder = join(dir, 'not-json');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'maggot-king.json'), '{ not json');

  await assert.rejects(readBriefing(folder, 'Maggot King'), /maggot-king\.json/);
});

test('a fact that names a source the file does not list is refused', async () => {
  const notes = await maggotKing();
  const [first, ...rest] = notes.phases as { sources: unknown[] }[];
  const broken = await folderWith('bad-ref', 'maggot-king.json', {
    ...notes, phases: [{ ...first, sources: [{ ref: 'nowhere' }] }, ...rest],
  });

  await assert.rejects(readBriefing(broken, 'Maggot King'), /nowhere/);
});

test('a file whose boss does not match its file name is refused', async () => {
  const notes = await maggotKing();
  const broken = await folderWith('wrong-name', 'maggot-king.json', { ...notes, boss: 'Kraken' });

  await assert.rejects(readBriefing(broken, 'Maggot King'), /Kraken/);
});

test('a damage range other than "55" or "15–25" is refused', async () => {
  const notes = await maggotKing();
  const [first, ...rest] = notes.mechanics as Record<string, unknown>[];
  const broken = await folderWith('bad-damage', 'maggot-king.json', {
    ...notes, mechanics: [{ ...first, missDamage: 'a lot' }, ...rest],
  });

  await assert.rejects(readBriefing(broken, 'Maggot King'), /missDamage/);
});

// The Cheat sheet (ticket #77): what kills you and what to bring come from the notes.
test('the Maggot King notes name the Mechanics that kill you, in their order', async () => {
  const notes = await readBriefing(NOTES_DIR, 'Maggot King');

  assert.deepEqual(notes?.killers, ['screech', 'slam', 'larvae']);
});

test('a killer that names no Mechanic of the file is refused', async () => {
  const notes = await maggotKing();
  const broken = await folderWith('bad-killer', 'maggot-king.json', { ...notes, killers: ['screech', 'tail-swipe'] });

  await assert.rejects(readBriefing(broken, 'Maggot King'), /tail-swipe/);
});

test('more than 3 killers is refused: the Cheat sheet holds the top 3', async () => {
  const notes = await maggotKing();
  const broken = await folderWith('four-killers', 'maggot-king.json', {
    ...notes, killers: ['screech', 'slam', 'larvae', 'carrion'],
  });

  await assert.rejects(readBriefing(broken, 'Maggot King'), /killers/);
});

test('the Maggot King notes hold one inventory per style that the Wiki gives: magic and ranged, 28 slots each', async () => {
  const notes = await readBriefing(NOTES_DIR, 'Maggot King');

  assert.deepEqual(Object.keys(notes?.inventory ?? {}).sort(), ['magic', 'ranged']);
  assert.equal(notes?.inventory.magic?.items.length, 28);
  assert.equal(notes?.inventory.ranged?.items.length, 28);
  assert.deepEqual(notes?.inventory.magic?.items[8], { item: 'Eye of Ayak', id: 31113 });
  assert.deepEqual(notes?.inventory.ranged?.items[8], { item: 'Zaryte crossbow', id: 26374 });
  assert.ok(notes?.inventory.ranged?.sources.length);
});

test('an inventory of more than 28 items is refused', async () => {
  const notes = await maggotKing();
  const inventory = notes.inventory as Record<string, { items: unknown[] }>;
  const broken = await folderWith('big-inventory', 'maggot-king.json', {
    ...notes, inventory: { ...inventory, magic: { ...inventory.magic, items: [...inventory.magic.items, { item: 'Anglerfish', id: 13441 }] } },
  });

  await assert.rejects(readBriefing(broken, 'Maggot King'), /inventory/);
});

test('notes with no inventory for any style are refused, and so is an inventory for a style that does not exist', async () => {
  const notes = await maggotKing();
  const inventory = notes.inventory as Record<string, unknown>;
  const empty = await folderWith('no-inventory', 'maggot-king.json', { ...notes, inventory: {} });
  const typeless = await folderWith('typeless-inventory', 'maggot-king.json', { ...notes, inventory: { typeless: inventory.magic } });

  await assert.rejects(readBriefing(empty, 'Maggot King'), /inventory/);
  await assert.rejects(readBriefing(typeless, 'Maggot King'), /typeless/);
});
