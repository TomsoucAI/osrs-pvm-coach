// Test tool: print what the MCP sees, without Claude.
//   node dist/inspect.js                 one-shot (live RuneLite data)
//   node dist/inspect.js --watch         re-print every time the plugin file changes
//   node dist/inspect.js --file x.json   use a saved/sample state file
//   node dist/inspect.js --monster "Vorkath"
import { watch } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import {
  buildPlayer, calculate, describeLoadout, resolveMonster,
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
  console.log(`DPS vs ${monster.name}${monster.version ? ` (${monster.version})` : ''}: ${r.dps}  max ${r.maxHit}  acc ${r.accuracyPct}%  ttk ${r.avgTtkSeconds}s`);
  for (const n of notes) console.log('  note:', n);
}

await printOnce();

if (args.includes('--watch')) {
  const BRIDGE_FILE = bridgeFile();
  console.log(`\nWatching ${BRIDGE_FILE} (Ctrl+C to stop). Change gear, drink a potion, toggle a prayer, attack something...`);
  let timer: NodeJS.Timeout | undefined;
  watch(dirname(BRIDGE_FILE), (_evt, name) => {
    if (name !== basename(BRIDGE_FILE)) return;
    clearTimeout(timer);
    timer = setTimeout(printOnce, 150);
  });
}
