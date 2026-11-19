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
