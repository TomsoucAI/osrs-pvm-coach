// Bank mode core: ranks the best setups the player owns (worn + inventory + bank) against one monster version.
// Every DPS number comes from the Wiki engine for one concrete setup. The search only decides which setups to try.
//
// Search, per combat style:
//   1. An "attack" is one weapon + one of its combat styles (+ one spell for cast styles).
//   2. Per other slot, sort the items in two groups for this attack:
//        - exact: items the engine names in its code (set effects, slayer helmet, tomes...), when an engine
//          probe shows that their name changes the result for this attack. Each one is tried as it is.
//        - on stats: all other items. Only the two stats the style uses count (accuracy bonus, strength bonus).
//   3. Branch and bound over the "on stats" items: an item that does not exist, with the best stats of a slot,
//      gives the engine's upper bound for a whole branch. A branch that cannot reach the top 3 is skipped.
//   4. Report the 3 best setups of the style. Setups with the same DPS count once: the one with the fewest swaps.
//
// The search is exact when these hold (a test compares the result with an exhaustive search):
//   A1. A plain item changes DPS only through the two stats of the style. (Known gap: Dinh's bulwark uses defence stats.)
//   A2. More of those stats never lowers DPS.
//   A3. An item with any other effect is in engineNamedItems.json (scanned from the engine source).
//   A4. A named item, or set of named items, that changes nothing in the best plain gear changes nothing in the best setup.
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import {
  AmmoApplicability, ammoApplicability, calculateAttackSpeed, calculateEquipmentBonusesFromGear, equipmentAliases,
  getCanonicalItem,
} from '@/lib/Equipment';
import { CAST_STANCES } from '@/lib/constants';
import { getCombatStylesForCategory } from '@/utils';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import Potion from '@/enums/Potion';
import { Prayer, PrayerMap } from '@/enums/Prayer';
import UserIssueType from '@/enums/UserIssueType';
import { spells, type Spell } from '@/types/Spell';
import type { EquipmentPiece, Player, PlayerEquipment } from '@/types/Player';
import type { Monster } from '@/types/Monster';
import type { PlayerCombatStyle } from '@/types/PlayerCombatStyle';
import {
  buildPlayer, calculate, defenceAfterReductions, findItem, resolveMonsterWithDrains, SLOTS, type DefenceReductions,
} from '../calc';
import engineNamedItems from './engineNamedItems.json';
import type { ItemStack, LiveState } from './liveState';
import { phaseUnavailable, type CombatStyle } from './phaseRules';
import { bestOwnedPotions, bestPrayers } from './plannedBoosts';
import { thrallLine, type ThrallLine } from './thrall';

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
/** `planned` = the best unlocked prayer and the best owned potion of the style. `live` = levels and prayers as they are now. */
export type BoostMode = 'planned' | 'live';
/** What Planned mode assumed for one combat style. */
export interface AssumedBoosts {
  prayers: string[];
  /** The potions to bring, each with the doses owned in the inventory and the bank. Empty = no owned potion helps this style. */
  potions: { name: string; doses: number }[];
}
/** The best setup of the style within a number of slot changes from what is worn. null = no setup can attack within that number. */
export interface Tiers {
  bestOwned: Setup;
  upToTwoSwaps: Setup | null;
  /** The worn gear as it is, with the best combat style (and spell) its weapon has for this style. */
  wearingNow: Setup | null;
}
export type StylePlan = {
  setups: Setup[];
  tiers: Tiers;
  /** null in Live mode. */
  assumed: AssumedBoosts | null;
  /** What each slot's ‹ › cycler offers: the owned items of the slot. For the weapon, only the weapons that attack with this style. */
  owned: Record<Slot, SetupItem[]>;
} | { unavailable: string };

export interface BankModeRequest {
  monster: { name: string; version?: string } | { id: number };
  /** Omitted = all three combat styles. */
  style?: CombatStyle;
  boosts: BoostMode;
  /** Prayer names that Planned mode can assume, e.g. ["Piety", "Rigour"]. Omitted = every prayer. */
  unlockedPrayers?: string[];
  /** Omitted = the drains that the plugin counted on this monster. A value replaces them. */
  drains?: DefenceReductions;
  /**
   * Item ids the player chose per slot (the page's ‹ › cyclers). Each pinned slot holds that item in every setup
   * and in the 2-swap tier; "wearing now" ignores pins. A pin of an item that is not owned is ignored, with a note.
   */
  pins?: Partial<Record<Slot, number>>;
}

export interface BankModePlan {
  monster: { id: number; name: string; version: string };
  /** The monster's Defence level: `base` before the drains of the request, `effective` after them (boss floors applied). */
  defence: { base: number; effective: number };
  boosts: BoostMode;
  styles: Partial<Record<CombatStyle, StylePlan>>;
  /** A greater thrall's DPS, to add on top of a setup's DPS. It is in no setup's DPS. null = the player cannot cast one. */
  thrall: ThrallLine | null;
  /** Age of the bank snapshot, or null when there is none. */
  bankAgeMs: number | null;
  notes: string[];
}

const COMBAT_STYLES: CombatStyle[] = ['melee', 'ranged', 'magic'];
const SETUPS_PER_STYLE = 3;
const TIER_SWAPS = 2;
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
type Pins = Partial<Record<Slot, Owned>>;
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

export function combatStyleOf(style: PlayerCombatStyle): CombatStyle | null {
  if (style.type === 'magic' || style.type === 'ranged') return style.type;
  return style.type === null ? null : 'melee';
}

function spellCandidates(spellbook: LiveState['spellbook']): Spell[] {
  // The strongest spells first: they fill the top 3 early, and the weak spells are then cut at their bound.
  return spells.filter((s) => s.spellbook === spellbook && s.max_hit > 0).sort((a, b) => b.max_hit - a.max_hit);
}

/** `weapons` holds `null` for the unarmed attacks. */
function attacksFor(combat: CombatStyle, weapons: (Owned | null)[], spellbook: LiveState['spellbook']): Attack[] {
  const castable = spellCandidates(spellbook);
  const attacks: Attack[] = [];
  for (const weapon of weapons) {
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

function slotItems(slot: Slot, attack: Attack, owned: Owned[], worn: Owned | null, pin: Owned | undefined): SlotItems {
  const twoHanded = slot === 'shield' && !!attack.weapon?.canon.isTwoHanded;
  // A pinned shield cannot go with a two-handed weapon: no item fits, so the attack is skipped.
  if (pin) return { fixed: true, plain: twoHanded ? [] : [pin], named: [] };
  if (twoHanded) return { fixed: true, plain: [null], named: [] };
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

/** One item per different pair of style stats (A1: equal stats give equal DPS), the strongest first. */
function distinctByStats(items: (Owned | null)[], style: PlayerCombatStyle, worn: Owned | null): (Owned | null)[] {
  // On equal stats, keep the worn item (no swap), then the empty slot, then the lowest id.
  const rank = (o: Owned | null) => (o === worn ? -2 : o?.canon.id ?? -1);
  const byStats = new Map<string, Owned | null>();
  for (const item of items) {
    const key = styleStats(item, style).join('|');
    const known = byStats.get(key);
    if (!byStats.has(key) || rank(item) < rank(known!)) byStats.set(key, item);
  }
  const total = (o: Owned | null) => styleStats(o, style)[0] + styleStats(o, style)[1];
  return [...byStats.values()].sort((a, b) => total(b) - total(a));
}

/**
 * An item that does not exist: the best accuracy bonus and the best strength bonus of `options` in one piece.
 * With it in a slot, the engine gives an upper bound on the DPS of every real option for that slot (A1, A2).
 */
function upperBoundItem(slot: Slot, options: (Owned | null)[], style: PlayerCombatStyle): Owned {
  const stats = options.map((o) => styleStats(o, style));
  const accuracy = Math.max(...stats.map(([a]) => a));
  const strength = Math.max(...stats.map(([, s]) => s));
  const zero = {
    stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0,
  };
  const canon: EquipmentPiece = {
    name: '', id: -1, version: '', slot, image: '', weight: 0, speed: 0, category: EquipmentCategory.NONE, isTwoHanded: false,
    offensive: { ...zero, [style.type!]: accuracy },
    defensive: { ...zero },
    bonuses: {
      str: 0, ranged_str: 0, magic_str: 0, prayer: 0, [style.type === 'magic' ? 'magic_str' : style.type === 'ranged' ? 'ranged_str' : 'str']: strength,
    },
  };
  return {
    ownedId: -1, item: canon, canon, source: 'bank',
  };
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
  const fingerprint = (items: Owned[]) => {
    const gear = { ...base };
    for (const o of items) gear[o.canon.slot] = o;
    const player = playerWith(template, attack, gear, monster, (o) => o.canon);
    const calc = new PlayerVsNPCCalc(player, monster, { loadoutName: template.name });
    return JSON.stringify([calc.getDps(), calc.getDistribution().getMax(), calc.getHitChance(), player.bonuses, player.offensive]);
  };
  /** True when the names of `ghosted` (a part of `items`) change the engine's result. */
  const namesMatter = (items: Owned[], ghosted: Owned[]) => fingerprint(items) !== fingerprint(items.map((o) => (ghosted.includes(o) ? ghost(o) : o)));

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

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The best setups found so far for one combat style: one per DPS value (as shown, 3 decimals), at most
 * SETUPS_PER_STYLE values. Setups with the same DPS are one entry: the one with the fewest swaps.
 */
class TopSetups {
  private byDps = new Map<number, Candidate>();

  /** A branch whose upper bound is below this value cannot enter the list. */
  floor(): number {
    return this.byDps.size < SETUPS_PER_STYLE ? 0 : Math.min(...this.byDps.keys());
  }

  offer(c: Candidate) {
    const dps = round3(c.dps);
    const known = this.byDps.get(dps);
    if (known ? c.swaps >= known.swaps : dps < this.floor()) return;
    this.byDps.set(dps, c);
    if (this.byDps.size > SETUPS_PER_STYLE) this.byDps.delete(Math.min(...this.byDps.keys()));
  }

  ranked(): Candidate[] {
    return [...this.byDps.values()].sort((a, b) => b.dps - a.dps);
  }
}

/**
 * Searches every setup of one attack and offers each one that can enter `top`. Branch and bound:
 * the slots not chosen yet hold an upper-bound item, so one engine call bounds a whole branch.
 * `maxSwaps` = the most slots a setup can change from what is worn: a branch that is already over it is skipped.
 */
function searchAttack(
  template: Player, attack: Attack, pool: Record<Slot, Owned[]>, worn: Gear, monster: Monster, top: TopSetups, maxSwaps: number, pins: Pins,
) {
  const slots = OTHER_SLOTS.map((slot) => slotItems(slot, attack, pool[slot], worn[slot], pins[slot]));
  if (slots.some((items) => items.plain.length === 0)) return;
  const effective = effectiveNamed(template, attack, slots, monster);

  // An upper-bound item has no name and no id, so it cannot stand for an item with an effect of its own
  // or for ammo. Those are `exact` choices: each one is tried as it is. All other items are `onStats`.
  const choices = slots.map((items, i) => {
    if (items.fixed) return { exact: items.plain, onStats: [] as (Owned | null)[] };
    // A named item with no effect of its own for this attack competes on stats, like a plain item.
    const quiet = items.named.filter((item) => !effective.has(item));
    return {
      exact: items.named.filter((item) => effective.has(item)) as (Owned | null)[],
      onStats: distinctByStats([...items.plain, ...quiet], attack.style, worn[OTHER_SLOTS[i]]),
    };
  });

  const gear = { ...worn, weapon: attack.weapon };
  // Phase 2: the slots in `open` take an item on stats, strongest first, under the bound.
  const bound = (open: number[], from: number) => {
    const bounded = { ...gear };
    for (const i of open.slice(from)) bounded[OTHER_SLOTS[i]] = upperBoundItem(OTHER_SLOTS[i], choices[i].onStats, attack.style);
    return searchDps(template, attack, bounded, monster);
  };
  const chooseOnStats = (open: number[], from: number) => {
    const notChosen = new Set<Slot>(open.slice(from).map((i) => OTHER_SLOTS[i]));
    if (SLOTS.filter((s) => !notChosen.has(s) && gear[s] !== worn[s]).length > maxSwaps) return;
    const dps = bound(open, from);
    if (dps <= 0 || round3(dps) < top.floor()) return;
    if (from === open.length) {
      top.offer({
        attack, gear: { ...gear }, dps, swaps: countSwaps(gear, worn),
      });
      return;
    }
    for (const option of choices[open[from]].onStats) {
      gear[OTHER_SLOTS[open[from]]] = option;
      chooseOnStats(open, from + 1);
    }
  };
  // Phase 1: per slot, take one exact choice, or leave the slot open for phase 2.
  const chooseExact = (i: number, open: number[]) => {
    if (i === OTHER_SLOTS.length) {
      chooseOnStats(open, 0);
      return;
    }
    for (const option of choices[i].exact) {
      gear[OTHER_SLOTS[i]] = option;
      chooseExact(i + 1, open);
    }
    if (choices[i].onStats.length) chooseExact(i + 1, [...open, i]);
  };
  chooseExact(0, []);
}

function rankStyle(
  template: Player, combat: CombatStyle, pool: Record<Slot, Owned[]>, worn: Gear, spellbook: LiveState['spellbook'], monster: Monster,
  maxSwaps = Infinity, pins: Pins = {},
): Candidate[] {
  const top = new TopSetups();
  const weapons = pins.weapon ? [pins.weapon] : [...pool.weapon, null];
  for (const attack of attacksFor(combat, weapons, spellbook)) searchAttack(template, attack, pool, worn, monster, top, maxSwaps, pins);
  return top.ranked();
}

/** The owned item of each pin. A pin of an item that is not owned, or not for its slot, is left out with a note. */
function resolvePins(pins: BankModeRequest['pins'], pool: Record<Slot, Owned[]>): { pinned: Pins; notes: string[] } {
  const pinned: Pins = {};
  const notes: string[] = [];
  for (const [slot, id] of Object.entries(pins ?? {}) as [Slot, number][]) {
    const item = findItem(id);
    const canonId = item && getCanonicalItem(item).id;
    const owned = pool[slot]?.find((o) => o.ownedId === id || o.canon.id === canonId);
    if (owned) pinned[slot] = owned;
    else notes.push(`Pinned item ${item?.name ?? id} isn't an owned ${slot} item; the pin is ignored.`);
  }
  return { pinned, notes };
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

  const { monster, drainNotes } = resolveMonsterWithDrains(request.monster, state, request.drains);
  const {
    pool, worn, unknownWorn, notEquipment,
  } = collectOwned(state);
  const { pinned, notes: pinNotes } = resolvePins(request.pins, pool);
  const empty = Object.fromEntries(SLOTS.map((s) => [s, null])) as Record<Slot, null>;
  // Live boosts: levels, prayers and buffs as they are now. Gear, style and spell come from the search.
  const live = buildPlayer(state, monster, { equipment: empty }).player;

  const wanted = request.style ? [request.style] : COMBAT_STYLES;
  const styles: BankModePlan['styles'] = {};
  for (const combat of wanted) {
    const unavailable = phaseUnavailable(monster, combat);
    if (unavailable) {
      styles[combat] = { unavailable };
      continue;
    }
    let template = live;
    let assumed: AssumedBoosts | null = null;
    if (request.boosts === 'planned') {
      const prayers = bestPrayers(combat, request.unlockedPrayers);
      const potions = bestOwnedPotions(combat, live.skills, [...state.inventory, ...(state.bank?.items ?? [])]);
      // Planned boosts replace the live ones: base levels with these potions, and these prayers only.
      template = buildPlayer(state, monster, {
        equipment: empty,
        prayers: prayers.map((p) => Prayer[p]),
        potions: potions.flatMap((p) => p.engine.map((e) => Potion[e])),
      }).player;
      assumed = {
        prayers: prayers.map((p) => PrayerMap[p].name),
        potions: potions.map(({ name, doses }) => ({ name, doses })),
      };
    }
    const rank = (maxSwaps: number | undefined, withPins: Pins) => withoutAliasScan(
      () => rankStyle(template, combat, pool, worn, state.spellbook, monster, maxSwaps, withPins),
    );
    const ranked = rank(undefined, pinned);
    if (!ranked.length) {
      const withPins = Object.keys(pinned).length ? ' with the pinned items' : '';
      styles[combat] = { unavailable: `No owned setup can attack with ${combat}${withPins}.` };
      continue;
    }
    const setups = ranked.map((c) => describe(template, c, worn, monster)).sort((a, b) => b.dps - a.dps);
    // The best setup has the fewest swaps of all setups with its DPS: when it fits a tier, it is that tier's answer.
    const within = (maxSwaps: number, withPins: Pins): Setup | null => {
      if (withPins === pinned && setups[0].swaps.length <= maxSwaps) return setups[0];
      const [best] = rank(maxSwaps, withPins);
      return best ? describe(template, best, worn, monster) : null;
    };
    // "Wearing now" is the worn gear as it is: pins do not apply to it.
    const unpinned = Object.keys(pinned).length ? {} : pinned;
    const toItem = (o: Owned): SetupItem => ({ id: o.ownedId, name: o.item.name, source: o.source });
    const owned = Object.fromEntries(SLOTS.map((s) => [s, pool[s]
      .filter((o) => s !== 'weapon' || attacksFor(combat, [o], state.spellbook).length > 0)
      .map(toItem)])) as Record<Slot, SetupItem[]>;
    styles[combat] = {
      setups, assumed, owned, tiers: { bestOwned: setups[0], upToTwoSwaps: within(TIER_SWAPS, pinned), wearingNow: within(0, unpinned) },
    };
  }

  const notes = [...unknownWorn, ...drainNotes, ...pinNotes];
  if (notEquipment) {
    notes.push(`${notEquipment} owned items in the inventory and bank are not equipment in the Wiki calculator's data (supplies, or very new gear); ignored.`);
  }
  if (wanted.includes('magic') && state.autocastSpell && !spells.some((s) => s.name.toLowerCase() === state.autocastSpell!.toLowerCase())) {
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
    defence: defenceAfterReductions(monster),
    boosts: request.boosts,
    styles,
    thrall: thrallLine(state),
    bankAgeMs: state.bank?.ageMs ?? null,
    notes,
  };
}
