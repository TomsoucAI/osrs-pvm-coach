// Bank mode core: ranks the best setups the player owns (worn + inventory + bank) against one monster version.
// Every DPS number comes from the Wiki engine for one concrete setup. The search only decides which setups to try.
//
// Search, per combat style:
//   1. An "attack" is one weapon + one of its combat styles (+ one spell for cast styles).
//   2. Per other slot, keep the items that can matter for this attack:
//        - plain items on the Pareto front of the two stats the style uses (accuracy bonus, strength bonus)
//        - items the engine names in its code (set effects, slayer helmet, tomes...), when an engine probe
//          shows that their name changes the result for this attack
//   3. Try every combination of the kept items with the engine. Keep the best setup per weapon.
//   4. Report the 3 best weapons, each with its best setup.
//
// The pruning in step 2 is exact when these hold (a test compares the result with an exhaustive search):
//   A1. A plain item changes DPS only through the two stats of the style. (Known gap: Dinh's bulwark uses defence stats.)
//   A2. More of those stats never lowers DPS.
//   A3. An item with any other effect is in engineNamedItems.json (scanned from the engine source).
//   A4. Among spells of one element, the higher base max hit never does less DPS.
//   A5. A named item, or set of named items, that changes nothing in the best plain gear changes nothing in the best setup.
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import {
  AmmoApplicability, ammoApplicability, calculateAttackSpeed, calculateEquipmentBonusesFromGear, equipmentAliases,
  getCanonicalItem,
} from '@/lib/Equipment';
import { CAST_STANCES } from '@/lib/constants';
import { getCombatStylesForCategory } from '@/utils';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import UserIssueType from '@/enums/UserIssueType';
import { spells, type Spell } from '@/types/Spell';
import type { EquipmentPiece, Player, PlayerEquipment } from '@/types/Player';
import type { Monster } from '@/types/Monster';
import type { PlayerCombatStyle } from '@/types/PlayerCombatStyle';
import {
  buildPlayer, calculate, findItem, resolveMonster, SLOTS, type DefenceReductions,
} from '../calc';
import engineNamedItems from './engineNamedItems.json';
import type { ItemStack, LiveState } from './liveState';
import { phaseUnavailable, type CombatStyle } from './phaseRules';

export type Slot = keyof PlayerEquipment;
export type ItemSource = 'worn' | 'inventory' | 'bank';
export type { CombatStyle };

export interface SetupItem { id: number; name: string; source: ItemSource }
export interface Swap { slot: Slot; from: string | null; to: string | null; source: ItemSource | null }
export interface Setup {
  items: Record<Slot, SetupItem | null>;
  /** Combat style of the weapon, e.g. "Rapid (Rapid)" or "Spell (Autocast)". */
  style: string;
  spell: string | null;
  dps: number;
  maxHit: number;
  accuracyPct: number;
  avgTtkSeconds: number | null;
  /** The slots to change from what is worn now. */
  swaps: Swap[];
}
export type StylePlan = { setups: Setup[] } | { unavailable: string };

export interface BankModeRequest {
  monster: { name: string; version?: string } | { id: number };
  /** Omitted = all three combat styles. */
  style?: CombatStyle;
  drains?: DefenceReductions;
}

export interface BankModePlan {
  monster: { id: number; name: string; version: string };
  styles: Partial<Record<CombatStyle, StylePlan>>;
  /** Age of the bank snapshot, or null when there is none. */
  bankAgeMs: number | null;
  notes: string[];
}

const COMBAT_STYLES: CombatStyle[] = ['melee', 'ranged', 'magic'];
const SETUPS_PER_STYLE = 3;
const OTHER_SLOTS = SLOTS.filter((s) => s !== 'weapon');
const ENGINE_NAMED = new Set<string>(engineNamedItems);
// A setup with one of these engine issues cannot attack as planned.
const BLOCKING_ISSUES = new Set<UserIssueType>([
  UserIssueType.EQUIPMENT_MISSING_AMMO, UserIssueType.EQUIPMENT_WRONG_AMMO, UserIssueType.SPELL_WRONG_WEAPON,
  UserIssueType.SPELL_WRONG_MONSTER, UserIssueType.WEAPON_WRONG_MONSTER,
]);

/** One owned item. `canon` is the engine's base variant: the search evaluates it, the plan shows `item`. */
interface Owned { ownedId: number; item: EquipmentPiece; canon: EquipmentPiece; source: ItemSource }
type Gear = Record<Slot, Owned | null>;
interface Attack { weapon: Owned | null; style: PlayerCombatStyle; spell: Spell | null }
interface Candidate { attack: Attack; gear: Gear; dps: number; swaps: number }

// ---------- owned pool ----------

function collectOwned(state: LiveState) {
  const pool = Object.fromEntries(SLOTS.map((s) => [s, [] as Owned[]])) as Record<Slot, Owned[]>;
  const worn = Object.fromEntries(SLOTS.map((s) => [s, null])) as Gear;
  const unknownWorn: string[] = [];
  let notEquipment = 0;

  const add = (id: number, source: ItemSource): Owned | null => {
    const item = findItem(id);
    if (!item) return null;
    const canon = getCanonicalItem(item);
    const known = pool[item.slot].find((o) => o.canon.id === canon.id);
    if (known) return known;
    const owned = {
      ownedId: id, item, canon, source,
    };
    pool[item.slot].push(owned);
    return owned;
  };

  for (const slot of SLOTS) {
    const id = state.equipment?.[slot];
    if (id === null || id === undefined) continue;
    const owned = add(id, 'worn');
    if (owned) worn[slot] = owned;
    else unknownWorn.push(`Worn item ${id} (${slot}) isn't in the Wiki calculator's data (cosmetic or very new item); ignored.`);
  }
  const stacks: [ItemStack[], ItemSource][] = [[state.inventory, 'inventory'], [state.bank?.items ?? [], 'bank']];
  for (const [items, source] of stacks) {
    for (const { id, quantity } of items) {
      if (quantity > 0 && !add(id, source)) notEquipment++;
    }
  }
  return {
    pool, worn, unknownWorn, notEquipment,
  };
}

// ---------- attacks: weapon + combat style (+ spell) ----------

function combatStyleOf(style: PlayerCombatStyle): CombatStyle | null {
  if (style.type === 'magic' || style.type === 'ranged') return style.type;
  return style.type === null ? null : 'melee';
}

function spellCandidates(spellbook: LiveState['spellbook']): Spell[] {
  const usable = spells.filter((s) => s.spellbook === spellbook && s.max_hit > 0);
  // A4: of the spells of one element, only the one with the highest base max hit
  return usable.filter((s) => !s.element || !usable.some((o) => o.element === s.element && o.max_hit > s.max_hit));
}

function attacksFor(combat: CombatStyle, weapons: Owned[], spellbook: LiveState['spellbook']): Attack[] {
  const castable = spellCandidates(spellbook);
  const attacks: Attack[] = [];
  for (const weapon of [...weapons, null]) {
    const seen = new Set<string>();
    for (const style of getCombatStylesForCategory(weapon?.canon.category ?? EquipmentCategory.UNARMED)) {
      const key = `${style.type}|${style.stance}`;
      // Defensive Autocast does the same DPS as Autocast (it only moves XP to Defence): plan with Autocast.
      if (combatStyleOf(style) !== combat || seen.has(key) || style.stance === 'Defensive Autocast') continue;
      seen.add(key);
      if (CAST_STANCES.includes(style.stance)) attacks.push(...castable.map((spell) => ({ weapon, style, spell })));
      else attacks.push({ weapon, style, spell: null });
    }
  }
  return attacks;
}

// ---------- evaluation with the engine ----------

function playerWith(template: Player, attack: Attack, gear: Gear, monster: Monster, piece: (o: Owned) => EquipmentPiece): Player {
  const equipment = Object.fromEntries(SLOTS.map((s) => [s, gear[s] ? piece(gear[s]) : null])) as unknown as PlayerEquipment;
  const player: Player = {
    ...template, equipment, style: attack.style, spell: attack.spell,
  };
  const bonuses = calculateEquipmentBonusesFromGear(player, monster);
  Object.assign(player, bonuses);
  player.attackSpeed = calculateAttackSpeed(player, monster);
  return player;
}

/** DPS of one concrete setup, or -1 when the engine says the setup cannot attack as planned. */
function searchDps(template: Player, attack: Attack, gear: Gear, monster: Monster): number {
  const calc = new PlayerVsNPCCalc(playerWith(template, attack, gear, monster, (o) => o.canon), monster, { loadoutName: template.name });
  if (calc.userIssues.some((i) => BLOCKING_ISSUES.has(i.type))) return -1;
  return calc.getDps();
}

/**
 * The engine looks up the base variant of each item with a linear scan of its alias table, in every evaluation:
 * about 3 ms per setup, against 0.25 ms without the scan (measured). The search passes base variants only (`canon`),
 * so the scan can find nothing. This empties the table for the duration of `fn` and restores it after.
 * `fn` must be synchronous: no other code runs while the table is empty.
 */
function withoutAliasScan<T>(fn: () => T): T {
  const saved = Object.entries(equipmentAliases);
  for (const [base] of saved) delete equipmentAliases[Number(base)];
  try {
    return fn();
  } finally {
    for (const [base, variants] of saved) equipmentAliases[Number(base)] = variants;
  }
}

// ---------- candidates per slot ----------

function needsAmmo(attack: Attack): boolean {
  return attack.style.stance !== 'Manual Cast' && !!attack.weapon
    && ammoApplicability(attack.weapon.canon.id, undefined) === AmmoApplicability.INVALID;
}

/** The two stats through which a plain item changes the DPS of this style (A1). */
function styleStats(owned: Owned | null, style: PlayerCombatStyle): [number, number] {
  if (!owned) return [0, 0];
  const { offensive, bonuses } = owned.canon;
  if (style.type === 'magic') return [offensive.magic, bonuses.magic_str];
  if (style.type === 'ranged') return [offensive.ranged, bonuses.ranged_str];
  return [offensive[style.type!], bonuses.str];
}

/**
 * The items of one slot that an attack can use. `fixed` = every item listed is tried (no pruning on stats).
 * Else `plain` items compete on stats, and `named` items are probed first for an effect of their own.
 */
interface SlotItems { fixed: boolean; plain: (Owned | null)[]; named: Owned[] }

function slotItems(slot: Slot, attack: Attack, owned: Owned[], worn: Owned | null): SlotItems {
  if (slot === 'shield' && attack.weapon?.canon.isTwoHanded) return { fixed: true, plain: [null], named: [] };
  if (slot === 'ammo') {
    // Ammo counts only for a weapon that fires it. For all other weapons, keep what is worn.
    if (!needsAmmo(attack)) return { fixed: true, plain: [worn], named: [] };
    const fits = owned.filter((o) => ammoApplicability(attack.weapon!.canon.id, o.canon.id) === AmmoApplicability.INCLUDED);
    return { fixed: true, plain: fits, named: [] };
  }
  return {
    fixed: false,
    plain: [null, ...owned.filter((o) => !ENGINE_NAMED.has(o.canon.name))],
    named: owned.filter((o) => ENGINE_NAMED.has(o.canon.name)),
  };
}

/** The items that no other item beats or equals on both stats of the style (A1, A2). */
function paretoFront(items: (Owned | null)[], style: PlayerCombatStyle, worn: Owned | null): (Owned | null)[] {
  // On equal stats, keep the worn item (no swap), then the empty slot, then the lowest id.
  const rank = (o: Owned | null) => (o === worn ? -2 : o?.canon.id ?? -1);
  return items.filter((p) => {
    const [pa, ps] = styleStats(p, style);
    return !items.some((q) => {
      if (q === p) return false;
      const [qa, qs] = styleStats(q, style);
      return qa >= pa && qs >= ps && (qa > pa || qs > ps || rank(q) < rank(p));
    });
  });
}

/** Above this many combinations of quiet named items, the set probe is skipped and all of them stay in the search. */
const MAX_SET_PROBES = 64;

/**
 * The engine-named items that do something for this attack. Most named items do nothing for a given attack
 * (a void ranger helm in a melee setup), and each one kept multiplies the search.
 *
 * Probe: put the item in the best plain gear, then replace it by a "ghost" with the same stats and no name.
 * If the engine's result changes, the item has an effect of its own. Items with no effect alone are then probed
 * together, one per slot, to find set effects (void needs 4 pieces).
 */
function effectiveNamed(template: Player, attack: Attack, slots: SlotItems[], monster: Monster): Set<Owned> {
  const base = { weapon: attack.weapon } as Gear;
  slots.forEach((items, i) => {
    const total = (o: Owned | null) => styleStats(o, attack.style)[0] + styleStats(o, attack.style)[1];
    base[OTHER_SLOTS[i]] = items.plain.reduce((a, b) => (total(b) > total(a) ? b : a), items.plain[0] ?? null);
  });
  const ghost = (o: Owned): Owned => ({ ...o, canon: { ...o.canon, id: -1, name: '' } });
  const result = (items: Owned[]) => {
    const gear = { ...base };
    for (const o of items) gear[o.canon.slot] = o;
    const player = playerWith(template, attack, gear, monster, (o) => o.canon);
    const calc = new PlayerVsNPCCalc(player, monster, { loadoutName: template.name });
    return JSON.stringify([calc.getDps(), calc.getDistribution().getMax(), calc.getHitChance(), player.bonuses, player.offensive]);
  };
  /** True when the names of `ghosted` (a part of `items`) change the engine's result. */
  const namesMatter = (items: Owned[], ghosted: Owned[]) => result(items) !== result(items.map((o) => (ghosted.includes(o) ? ghost(o) : o)));

  const kept = new Set<Owned>();
  const quietBySlot: Owned[][] = [];
  for (const { named } of slots) {
    const quiet = named.filter((item) => {
      if (namesMatter([item], [item])) kept.add(item);
      return !kept.has(item);
    });
    if (quiet.length) quietBySlot.push(quiet);
  }

  if (quietBySlot.reduce((n, quiet) => n * quiet.length, 1) > MAX_SET_PROBES) {
    for (const item of quietBySlot.flat()) kept.add(item);
    return kept;
  }
  const combos = quietBySlot.reduce<Owned[][]>((acc, quiet) => acc.flatMap((combo) => quiet.map((item) => [...combo, item])), [[]]);
  for (const combo of combos) {
    if (combo.length < 2 || !namesMatter(combo, combo)) continue;
    for (const item of combo) if (namesMatter(combo, [item])) kept.add(item);
  }
  return kept;
}

// ---------- search ----------

const countSwaps = (gear: Gear, worn: Gear) => SLOTS.filter((s) => gear[s] !== worn[s]).length;

function bestForAttack(template: Player, attack: Attack, pool: Record<Slot, Owned[]>, worn: Gear, monster: Monster): Candidate | null {
  const slots = OTHER_SLOTS.map((slot) => slotItems(slot, attack, pool[slot], worn[slot]));
  if (slots.some((items) => items.plain.length === 0)) return null;
  const effective = effectiveNamed(template, attack, slots, monster);
  // A named item with no effect of its own for this attack competes on stats, like a plain item.
  const options = slots.map((items, i) => {
    if (items.fixed) return items.plain;
    const onStats = [...items.plain, ...items.named.filter((item) => !effective.has(item))];
    return [...paretoFront(onStats, attack.style, worn[OTHER_SLOTS[i]]), ...items.named.filter((item) => effective.has(item))];
  });

  let best: Candidate | null = null;
  const gear = { ...worn, weapon: attack.weapon };
  const visit = (i: number) => {
    if (i === OTHER_SLOTS.length) {
      const dps = searchDps(template, attack, gear, monster);
      const swaps = countSwaps(gear, worn);
      if (dps > 0 && (!best || dps > best.dps || (dps === best.dps && swaps < best.swaps))) {
        best = {
          attack, gear: { ...gear }, dps, swaps,
        };
      }
      return;
    }
    for (const option of options[i]) {
      gear[OTHER_SLOTS[i]] = option;
      visit(i + 1);
    }
  };
  visit(0);
  return best;
}

/** Puts a worn item back wherever it gives exactly the same DPS: the plan never asks for a swap that gains nothing. */
function keepWornWhereEqual(template: Player, c: Candidate, worn: Gear, monster: Monster): Candidate {
  const gear = { ...c.gear };
  for (const slot of OTHER_SLOTS) {
    if (gear[slot] === worn[slot]) continue;
    if (slot === 'shield' && c.attack.weapon?.canon.isTwoHanded) continue;
    const chosen = gear[slot];
    gear[slot] = worn[slot];
    if (searchDps(template, c.attack, gear, monster) !== c.dps) gear[slot] = chosen;
  }
  return { ...c, gear, swaps: countSwaps(gear, worn) };
}

function rankStyle(template: Player, combat: CombatStyle, pool: Record<Slot, Owned[]>, worn: Gear, spellbook: LiveState['spellbook'], monster: Monster): Candidate[] {
  const bestByWeapon = new Map<Owned | null, Candidate>();
  for (const attack of attacksFor(combat, pool.weapon, spellbook)) {
    const found = bestForAttack(template, attack, pool, worn, monster);
    const known = bestByWeapon.get(attack.weapon);
    if (found && (!known || found.dps > known.dps || (found.dps === known.dps && found.swaps < known.swaps))) {
      bestByWeapon.set(attack.weapon, found);
    }
  }
  return [...bestByWeapon.values()]
    .sort((a, b) => b.dps - a.dps)
    .slice(0, SETUPS_PER_STYLE)
    .map((c) => keepWornWhereEqual(template, c, worn, monster));
}

// ---------- plan ----------

function describe(template: Player, c: Candidate, worn: Gear, monster: Monster): Setup {
  const result = calculate(playerWith(template, c.attack, c.gear, monster, (o) => o.item), monster);
  const { style } = c.attack;
  return {
    items: Object.fromEntries(SLOTS.map((s) => {
      const o = c.gear[s];
      return [s, o ? { id: o.ownedId, name: o.item.name, source: o.source } : null];
    })) as Record<Slot, SetupItem | null>,
    style: `${style.displayNameOverride ?? style.name} (${style.stance})`,
    spell: c.attack.spell?.name ?? null,
    dps: result.dps,
    maxHit: result.maxHit,
    accuracyPct: result.accuracyPct,
    avgTtkSeconds: result.avgTtkSeconds,
    swaps: SLOTS.filter((s) => c.gear[s] !== worn[s]).map((s) => ({
      slot: s, from: worn[s]?.item.name ?? null, to: c.gear[s]?.item.name ?? null, source: c.gear[s]?.source ?? null,
    })),
  };
}

export function planBankMode(state: LiveState, request: BankModeRequest): BankModePlan {
  if (!state.loggedIn) throw new Error('The player is logged out: there is no live state to plan from. Log in with the DPS Bridge plugin on.');

  const monster = resolveMonster({ ...request.monster, reductions: request.drains });
  const {
    pool, worn, unknownWorn, notEquipment,
  } = collectOwned(state);
  const empty = Object.fromEntries(SLOTS.map((s) => [s, null])) as Record<Slot, null>;
  // Live boosts: levels, prayers and buffs as they are now. Gear, style and spell come from the search.
  const template = buildPlayer(state, monster, { equipment: empty }).player;

  const wanted = request.style ? [request.style] : COMBAT_STYLES;
  const styles: BankModePlan['styles'] = {};
  for (const combat of wanted) {
    const unavailable = phaseUnavailable(monster, combat);
    if (unavailable) {
      styles[combat] = { unavailable };
      continue;
    }
    const ranked = withoutAliasScan(() => rankStyle(template, combat, pool, worn, state.spellbook, monster));
    styles[combat] = ranked.length
      ? { setups: ranked.map((c) => describe(template, c, worn, monster)).sort((a, b) => b.dps - a.dps) }
      : { unavailable: `No owned setup can attack with ${combat}.` };
  }

  const notes = [...unknownWorn];
  if (notEquipment) {
    notes.push(`${notEquipment} owned items in the inventory and bank are not equipment in the Wiki calculator's data (supplies, or very new gear); ignored.`);
  }
  if (state.autocastSpell && !spells.some((s) => s.name.toLowerCase() === state.autocastSpell!.toLowerCase())) {
    notes.push(`Spell "${state.autocastSpell}" isn't in the Wiki calculator's data; ignored.`);
  }
  if (!state.bank) {
    notes.push('No bank snapshot yet: open the bank once with the DPS Bridge plugin on. Only worn and inventory items were ranked.');
  }
  if (wanted.includes('magic')) {
    notes.push(state.spellbook
      ? 'Magic: runes and spell level requirements are not checked.'
      : 'Spellbook unknown (state file version 1): magic ranks powered staves only.');
  }
  return {
    monster: { id: monster.id, name: monster.name, version: monster.version ?? '' },
    styles,
    bankAgeMs: state.bank?.ageMs ?? null,
    notes,
  };
}
