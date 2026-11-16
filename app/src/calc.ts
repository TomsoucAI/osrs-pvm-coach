// Bridges a live RuneLite snapshot to the OSRS Wiki DPS calculator engine
// (weirdgloop/osrs-dps-calc, vendored in ../vendor). All combat maths is theirs.
import merge from 'lodash.mergewith';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { getMonsters, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import { scaleMonster } from '@/lib/MonsterScaling';
import {
  availableEquipment, calculateAttackSpeed, calculateEquipmentBonusesFromGear, equipmentAliases,
} from '@/lib/Equipment';
import { getCombatStylesForCategory, getDefaultCombatStyle, PotionMap } from '@/utils';
import { Prayer } from '@/enums/Prayer';
import Potion from '@/enums/Potion';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import { spells, Spell } from '@/types/Spell';
import type {
  EquipmentPiece, Player, PlayerEquipment, PlayerSkills,
} from '@/types/Player';
import type { Monster } from '@/types/Monster';
import type { PlayerCombatStyle } from '@/types/PlayerCombatStyle';
import type { Snapshot, SkillMap } from './snapshot';

const SKILLS: (keyof PlayerSkills)[] = ['atk', 'str', 'def', 'ranged', 'magic', 'prayer', 'hp', 'mining', 'herblore', 'farming'];
export const SLOTS: (keyof PlayerEquipment)[] = ['head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'];

const monsters = getMonsters();
const equipmentById = new Map<number, EquipmentPiece>(availableEquipment.map((e) => [e.id, e]));
const aliasToBase = new Map<number, number>();
for (const [base, variants] of Object.entries(equipmentAliases)) {
  for (const v of variants) aliasToBase.set(v, Number(base));
}

// Same defaults as the Wiki calculator's PlayerStore, without its MobX UI state.
function createEmptyPlayer(name: string): Player {
  const zero = { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 };
  return {
    uuid: 'live', name,
    style: getDefaultCombatStyle(EquipmentCategory.NONE),
    skills: Object.fromEntries(SKILLS.map((k) => [k, 99])) as unknown as PlayerSkills,
    boosts: Object.fromEntries(SKILLS.map((k) => [k, 0])) as unknown as PlayerSkills,
    equipment: Object.fromEntries(SLOTS.map((k) => [k, null])) as unknown as PlayerEquipment,
    attackSpeed: 4,
    prayers: [],
    bonuses: { str: 0, ranged_str: 0, magic_str: 0, prayer: 0 },
    offensive: { ...zero },
    defensive: { ...zero },
    buffs: {
      potions: [], onSlayerTask: false, inWilderness: false, kandarinDiary: false, chargeSpell: false,
      markOfDarknessSpell: false, forinthrySurge: false, soulreaperStacks: 5, baAttackerLevel: 0,
      chinchompaDistance: 4, usingSunfireRunes: false,
      fragmentOfWind: false, fragmentOfWater: false, fragmentOfEarth: false, fragmentOfFire: false,
    },
    spell: null,
  } as Player;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function findItem(id: number): EquipmentPiece | null {
  return equipmentById.get(id) ?? equipmentById.get(aliasToBase.get(id) ?? -1) ?? null;
}

// ---------- monsters ----------

export interface MonsterHit { id: number; name: string; version: string; hp: number; def: number }

/** All matches, best first (exact name, then shortest name). */
export function searchMonsters(query: string): MonsterHit[] {
  const q = norm(query);
  return monsters
    .filter((m) => norm(m.name).includes(q))
    .sort((a, b) => (norm(a.name) === q ? -1 : 0) - (norm(b.name) === q ? -1 : 0) || a.name.length - b.name.length)
    .map((m) => ({ id: m.id, name: m.name, version: m.version ?? '', hp: m.skills.hp, def: m.skills.def }));
}

/** Defence-lowering effects landed before the fight (successful specs). */
export interface DefenceReductions {
  dwhHits?: number;
  elderMaulHits?: number;
  bgsDamage?: number;
  arclightHits?: number;
  emberlightHits?: number;
  accursed?: boolean;
  vulnerability?: boolean;
}

export function resolveMonster(opts: {
  id?: number; name?: string; version?: string; currentHp?: number; reductions?: DefenceReductions;
}): Monster {
  let found;
  if (opts.id !== undefined) found = monsters.find((m) => m.id === opts.id);
  if (!found && opts.name) {
    const q = norm(opts.name);
    const exact = monsters.filter((m) => norm(m.name) === q);
    const pool = exact.length ? exact : monsters.filter((m) => norm(m.name).includes(q));
    found = (opts.version && pool.find((m) => norm(m.version ?? '') === norm(opts.version!))) || pool[0];
  }
  if (!found) {
    throw new Error(`Monster not found (${opts.id ?? opts.name}). Use search_monsters to find the exact name.`);
  }
  const monster = merge({}, found, { inputs: INITIAL_MONSTER_INPUTS }) as Monster;
  monster.inputs.monsterCurrentHp = opts.currentHp ?? monster.skills.hp;
  const r = opts.reductions;
  if (r) {
    monster.inputs.defenceReductions = {
      ...monster.inputs.defenceReductions,
      dwh: r.dwhHits ?? 0,
      elderMaul: r.elderMaulHits ?? 0,
      bgs: r.bgsDamage ?? 0,
      arclight: r.arclightHits ?? 0,
      emberlight: r.emberlightHits ?? 0,
      accursed: r.accursed ?? false,
      vulnerability: r.vulnerability ?? false,
    };
  }
  return monster;
}

/** Defence level before and after reductions (engine applies boss-specific floors, e.g. Nex 250). */
export function defenceAfterReductions(monster: Monster) {
  return { base: monster.skills.def, effective: scaleMonster(monster).skills.def };
}

// ---------- player ----------

export interface Overrides {
  /** Prayers to use instead of the ones currently active, e.g. ["PIETY"]. Empty array = no prayers. */
  prayers?: string[];
  /** Potions to simulate on top of base levels, e.g. ["SUPER_COMBAT"]. Replaces live boosts. */
  potions?: string[];
  /** Combat style name or stance, e.g. "Lash", "Rapid", "Aggressive". */
  style?: string;
  /** Spell name for magic, e.g. "Fire Surge". */
  spell?: string;
  onSlayerTask?: boolean;
  /** Swap equipment by slot -> item name or id, e.g. { weapon: "Abyssal tentacle" }. null empties the slot. */
  equipment?: Partial<Record<keyof PlayerEquipment, string | number | null>>;
}

function itemFromNameOrId(v: string | number): EquipmentPiece {
  if (typeof v === 'number' || /^\d+$/.test(v)) {
    const item = findItem(Number(v));
    if (!item) throw new Error(`Unknown item id ${v}`);
    return item;
  }
  const q = norm(v);
  const item = availableEquipment.find((e) => norm(e.name) === q)
    ?? availableEquipment.find((e) => norm(`${e.name}${e.version}`) === q)
    ?? availableEquipment.find((e) => norm(e.name).includes(q));
  if (!item) throw new Error(`Unknown item "${v}"`);
  return item;
}

function parseEnum<T extends Record<string, string | number>>(e: T, label: string, names: string[]): T[keyof T][] {
  return names.map((n) => {
    const key = n.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!(key in e) || typeof e[key as keyof T] !== 'number') {
      const valid = Object.keys(e).filter((k) => Number.isNaN(Number(k))).join(', ');
      throw new Error(`Unknown ${label} "${n}". Valid: ${valid}`);
    }
    return e[key as keyof T];
  });
}

/**
 * The in-game attack style varp indexes into the weapon's style slots, which include
 * hidden "Other" placeholders. The calculator lists only the visible styles, in order.
 */
export function resolveLiveStyle(snap: Snapshot, styles: PlayerCombatStyle[]): PlayerCombatStyle | undefined {
  const idx = snap.attackStyleIndex;
  if (idx === undefined || idx < 0 || !styles.length) return undefined;

  if (idx >= 4) {
    // 4 = (auto)cast, 4 + castingMode(1) = defensive cast
    const defensive = (snap.castingMode ?? 0) === 1;
    return styles.find((s) => s.type === 'magic' && /defensive/i.test(s.stance ?? '') === defensive)
      ?? styles.find((s) => s.type === 'magic');
  }

  const slots = snap.styleSlots;
  let visibleIdx: number;
  if (slots && slots.length > idx) {
    visibleIdx = slots.slice(0, idx).filter((s) => s && s.toLowerCase() !== 'other').length;
  } else {
    // Fallback: 3-style weapons skip slot 2 (e.g. whip 0,1,3; bows 0,1,3)
    visibleIdx = styles.filter((s) => s.type !== 'magic').length === 3 && idx === 3 ? 2 : idx;
  }
  return styles[visibleIdx];
}

function findSpell(name: string): Spell {
  const q = norm(name);
  const s = spells.find((sp) => norm(sp.name) === q) ?? spells.find((sp) => norm(sp.name).includes(q));
  if (!s) throw new Error(`Unknown spell "${name}"`);
  return s;
}

const toSkills = (m: SkillMap | undefined, fallback: number): PlayerSkills => Object.fromEntries(
  SKILLS.map((k) => [k, m?.[k] ?? fallback]),
) as unknown as PlayerSkills;

export interface BuiltPlayer {
  player: Player;
  notes: string[];
}

export function buildPlayer(snap: Snapshot, monster: Monster, o: Overrides = {}): BuiltPlayer {
  const notes: string[] = [];
  const player = createEmptyPlayer(snap.playerName ?? 'Live');

  // Equipment
  for (const slot of SLOTS) {
    const id = snap.equipment?.[slot];
    if (id === null || id === undefined) continue;
    const item = findItem(id);
    if (item) player.equipment[slot] = item;
    else notes.push(`Item ${id} in ${slot} isn't in the Wiki calculator's data (cosmetic or very new item); ignored.`);
  }
  for (const [slot, v] of Object.entries(o.equipment ?? {})) {
    player.equipment[slot as keyof PlayerEquipment] = v === null ? null : itemFromNameOrId(v!);
  }

  // Levels: base = real levels. Boosts = live (boosted - real) unless potions are simulated.
  player.skills = toSkills(snap.realLevels, 99);
  if (o.potions) {
    const potions = parseEnum(Potion as unknown as Record<string, number>, 'potion', o.potions) as unknown as Potion[];
    player.buffs.potions = potions;
    const boosts = toSkills(undefined, 0);
    for (const p of potions) {
      const r = PotionMap[p].calculateFn(player.skills);
      for (const [k, v] of Object.entries(r)) {
        const key = k as keyof PlayerSkills;
        boosts[key] = Math.max(boosts[key], v as number);
      }
    }
    player.boosts = boosts;
  } else if (snap.boostedLevels) {
    player.boosts = Object.fromEntries(
      SKILLS.map((k) => [k, (snap.boostedLevels![k] ?? player.skills[k]) - player.skills[k]]),
    ) as unknown as PlayerSkills;
  }

  // Prayers
  const prayerNames = o.prayers ?? snap.prayers ?? [];
  player.prayers = prayerNames
    .filter((n) => {
      const ok = n.toUpperCase() in Prayer;
      if (!ok && !o.prayers) notes.push(`Prayer ${n} has no DPS effect in the calculator; ignored.`);
      return ok || !!o.prayers;
    })
    .flatMap((n) => parseEnum(Prayer as unknown as Record<string, number>, 'prayer', [n]) as unknown as Prayer[]);

  // Buffs
  Object.assign(player.buffs, {
    onSlayerTask: o.onSlayerTask ?? snap.buffs?.onSlayerTask ?? false,
    inWilderness: snap.buffs?.inWilderness ?? false,
    kandarinDiary: snap.buffs?.kandarinDiary ?? false,
    chargeSpell: snap.buffs?.chargeSpell ?? false,
  });

  // Bonuses
  const calculated = calculateEquipmentBonusesFromGear(player, monster);
  player.bonuses = calculated.bonuses;
  player.offensive = calculated.offensive;
  player.defensive = calculated.defensive;

  // Style
  const styles = getCombatStylesForCategory(player.equipment.weapon?.category ?? EquipmentCategory.UNARMED);
  let style: PlayerCombatStyle | undefined;
  if (o.style) {
    const q = norm(o.style);
    style = styles.find((s) => norm(s.name) === q) ?? styles.find((s) => norm(s.stance ?? '') === q);
    if (!style) throw new Error(`Style "${o.style}" not available. Options: ${styles.map((s) => `${s.name} (${s.stance})`).join(', ')}`);
  } else {
    style = resolveLiveStyle(snap, styles);
    if (!style) notes.push('Could not read your in-game attack style; using the first style.');
  }
  player.style = style ?? styles[0];

  // Spell
  if (o.spell) player.spell = findSpell(o.spell);
  else if (player.style?.type === 'magic' && snap.autocastSpell) {
    try { player.spell = findSpell(snap.autocastSpell); } catch { /* powered staff or unknown */ }
  }
  if (player.style?.type === 'magic' && !player.spell && player.equipment.weapon?.category !== EquipmentCategory.POWERED_STAFF) {
    notes.push('Magic style without a spell: pass `spell` (e.g. "Fire Surge") for an accurate result.');
  }

  player.attackSpeed = calculateAttackSpeed(player, monster);
  return { player, notes };
}

// ---------- calculation ----------

export function calculate(player: Player, monster: Monster) {
  const calc = new PlayerVsNPCCalc(player, monster, { loadoutName: player.name });
  const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
  const ttk = calc.getTtk();
  return {
    dps: round(calc.getDps()),
    maxHit: calc.getDistribution().getMax(),
    accuracyPct: round(calc.getHitChance() * 100, 2),
    attackRoll: calc.getMaxAttackRoll(),
    npcDefenceRoll: calc.getNPCDefenceRoll(),
    attackSpeedTicks: calc.getAttackSpeed(),
    expectedHit: round(calc.getExpectedDamage()),
    avgTtkSeconds: ttk ? round(ttk, 1) : null,
  };
}

export function describeLoadout(player: Player) {
  const lvl = (k: keyof PlayerSkills) => `${player.skills[k] + player.boosts[k]}/${player.skills[k]}`;
  return {
    equipment: Object.fromEntries(SLOTS.map((s) => [s, player.equipment[s]?.name ?? null])),
    levels: {
      attack: lvl('atk'), strength: lvl('str'), defence: lvl('def'), ranged: lvl('ranged'), magic: lvl('magic'),
    },
    prayers: player.prayers.map((p) => Prayer[p]),
    style: player.style ? `${player.style.name} (${player.style.type}, ${player.style.stance})` : null,
    spell: player.spell?.name ?? null,
    onSlayerTask: player.buffs.onSlayerTask,
    offensive: player.offensive,
    bonuses: player.bonuses,
  };
}

export const VALID = {
  prayers: Object.keys(Prayer).filter((k) => Number.isNaN(Number(k))),
  potions: Object.keys(Potion).filter((k) => Number.isNaN(Number(k))),
};
