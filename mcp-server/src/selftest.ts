// Offline checks against known Wiki-calculator scenarios (no RuneLite needed).
import { buildPlayer, calculate, resolveMonster, searchMonsters } from './calc';
import type { Snapshot } from './snapshot';

const maxed = { atk: 99, str: 99, def: 99, ranged: 99, magic: 99, prayer: 99, hp: 99, mining: 99, herblore: 99, farming: 99 };
const snap: Snapshot = {
  source: 'manual',
  equipment: { weapon: 4151, head: 10828, neck: 6585, body: 10551, legs: 1079, hands: 7462, feet: 11840, cape: 6570, ring: 11773, shield: 12954 },
  realLevels: maxed,
  boostedLevels: { ...maxed, atk: 118, str: 118 },
  prayers: ['PIETY'],
  attackStyleIndex: 1,
  styleSlots: ['Accurate', 'Aggressive', 'Other', 'Defensive'],
  target: { id: 415, name: 'Abyssal demon' },
};

let failures = 0;
const check = (label: string, ok: boolean, info: unknown) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`, info); if (!ok) failures++; };

const m = resolveMonster({ name: 'Abyssal demon' });
const live = buildPlayer(snap, m);
const r = calculate(live.player, m);
check('whip lash style resolved', live.player.style.name === 'Lash', live.player.style);
check('live boosts +19 atk/str', live.player.boosts.atk === 19 && live.player.boosts.str === 19, live.player.boosts);
// Hand calc: eff str floor(118*1.23)+1+8=154; str bonus 131 -> floor((154*195+320)/640)=47
  check('max hit matches hand calc (47)', r.maxHit === 47, r);

const noPray = calculate(buildPlayer(snap, m, { prayers: [] }).player, m);
check('piety increases dps', r.dps > noPray.dps, { piety: r.dps, none: noPray.dps });

const pots = buildPlayer(snap, m, { potions: ['SUPER_COMBAT'] });
check('super combat sim = +19', pots.player.boosts.str === 19, pots.player.boosts);

const flick = buildPlayer({ ...snap, attackStyleIndex: 3 }, m);
check('slot 3 -> Deflect', flick.player.style.name === 'Deflect', flick.player.style);

const task = calculate(buildPlayer(snap, m, { onSlayerTask: true, equipment: { head: 'Slayer helmet (i)' } }).player, m);
check('slayer helm on task beats base', task.dps > r.dps, { task: task.dps });

check('search works', searchMonsters('vorkath').length > 0, searchMonsters('vorkath').slice(0, 2));
process.exit(failures ? 1 : 0);
