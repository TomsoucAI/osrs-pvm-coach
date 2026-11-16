// Test tool: print what the MCP sees, without Claude.
//   node dist/inspect.js                 one-shot (live RuneLite data)
//   node dist/inspect.js --watch         re-print every time the plugin file changes
//   node dist/inspect.js --file x.json   use a saved/sample state file
//   node dist/inspect.js --monster "Vorkath"
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import * as z from 'zod/v4';
import {
  buildPlayer, calculate, describeLoadout, findItem, resolveMonster,
} from './calc';
import { bridgeFile, getSnapshot, Snapshot } from './snapshot';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = opt('--file');
if (file) process.env.DPS_BRIDGE_FILE = resolve(file);
const monsterName = opt('--monster');

// State schema version 2 fields, and the bank file that the plugin writes next to the state file.
const itemStack = z.object({ id: z.number().int(), quantity: z.number().int() });
const v2Fields = z.object({
  inventory: z.array(itemStack).optional(),
  runePouch: z.array(z.object({ runeItemId: z.number().int(), quantity: z.number().int() })).optional(),
  spellbook: z.enum(['standard', 'ancient', 'lunar', 'arceuus']).nullable().optional(),
});
const bankFileSchema = z.object({ timestamp: z.number(), items: z.array(itemStack) });
const BANK_FILE_NAME = 'bank.json';

const stackText = (id: number, quantity: number) => `${findItem(id)?.name ?? `#${id}`} x${quantity}`;

function ageText(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

async function printV2(snap: Snapshot) {
  const v2 = v2Fields.safeParse(snap);
  if (!v2.success) {
    console.log('  note: v2 fields do not match the schema:', z.prettifyError(v2.error));
  } else {
    const { inventory, runePouch, spellbook } = v2.data;
    if (inventory) console.log('Inventory', `(${inventory.length})`, inventory.map((i) => stackText(i.id, i.quantity)).join(' | ') || '(empty)');
    if (runePouch) console.log('Rune pouch', runePouch.map((r) => stackText(r.runeItemId, r.quantity)).join(' | ') || '(empty)');
    if (spellbook !== undefined) console.log('Spellbook', spellbook ?? '(unknown)');
  }

  let text: string;
  try {
    text = await readFile(join(dirname(bridgeFile()), BANK_FILE_NAME), 'utf8');
  } catch {
    return; // no bank snapshot yet: the plugin writes it when the bank is open
  }
  try {
    const bank = bankFileSchema.parse(JSON.parse(text));
    console.log('Bank     ', `${bank.items.length} stacks, seen ${ageText(Date.now() - bank.timestamp)} ago`);
  } catch (e) {
    console.log('  note: bank file does not match the schema:', (e as Error).message);
  }
}

async function printOnce() {
  let snap: Snapshot;
  try {
    snap = await getSnapshot();
  } catch (e) {
    console.log(`\n✗ ${(e as Error).message}`);
    return;
  }
  const monster = monsterName
    ? resolveMonster({ name: monsterName })
    : snap.target
      ? resolveMonster({ id: snap.target.id, name: snap.target.name })
      : resolveMonster({ name: 'Abyssal demon' });
  const { player, notes } = buildPlayer(snap, monster);
  const l = describeLoadout(player);
  const r = calculate(player, monster);

  console.log(`\n── ${new Date().toLocaleTimeString()}  source=${snap.source}  player=${snap.playerName ?? '?'}`);
  console.log('Gear    ', Object.entries(l.equipment).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' | '));
  console.log('Levels  ', Object.entries(l.levels).map(([k, v]) => `${k} ${v}`).join('  '));
  console.log('Prayers ', l.prayers.join(', ') || '(none)');
  console.log('Style   ', l.style, l.spell ? `| spell ${l.spell}` : '');
  console.log('Target  ', snap.target ? `${snap.target.name} (#${snap.target.id})` : '(none, using default)', '| slayer task:', l.onSlayerTask);
  if (snap.source === 'dps-bridge') await printV2(snap);
  console.log(`DPS vs ${monster.name}${monster.version ? ` (${monster.version})` : ''}: ${r.dps}  max ${r.maxHit}  acc ${r.accuracyPct}%  ttk ${r.avgTtkSeconds}s`);
  for (const n of notes) console.log('  note:', n);
}

await printOnce();

if (args.includes('--watch')) {
  const BRIDGE_FILE = bridgeFile();
  console.log(`\nWatching ${BRIDGE_FILE} (Ctrl+C to stop). Change gear, drink a potion, toggle a prayer, attack something...`);
  let timer: NodeJS.Timeout | undefined;
  watch(dirname(BRIDGE_FILE), (_evt, name) => {
    if (name !== basename(BRIDGE_FILE) && name !== BANK_FILE_NAME) return;
    clearTimeout(timer);
    timer = setTimeout(printOnce, 150);
  });
}
