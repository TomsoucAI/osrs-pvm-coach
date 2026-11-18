// Planned boosts: what the player can turn on for the fight, whatever is active in the bank right now.
//   - the best prayer of the combat style among the unlocked prayers
//   - the best potion of the combat style among the potions in the inventory and the bank
// The engine data gives the effect of each prayer and potion, so no boost number is written here.
import {
  ARM_PRAYERS, BRAIN_PRAYERS, Prayer, PrayerMap,
} from '@/enums/Prayer';
import Potion from '@/enums/Potion';
import { PotionMap } from '@/utils';
import type { PlayerSkills } from '@/types/Player';
import type { ItemStack } from './liveState';
import type { CombatStyle } from './phaseRules';

const ALL_PRAYERS = Object.values(Prayer).filter((p): p is Prayer => typeof p === 'number');

function parseUnlocked(names: string[]): Prayer[] {
  return names.map((name) => {
    const key = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    const prayer = ALL_PRAYERS.find((p) => Prayer[p] === key);
    if (prayer === undefined) {
      throw new Error(`Unknown unlocked prayer "${name}". Valid: ${ALL_PRAYERS.map((p) => PrayerMap[p].name).join(', ')}`);
    }
    return prayer;
  });
}

/** How much a prayer adds for its style: accuracy plus strength (magic: plus its damage bonus), in the engine's units. */
function gain(prayer: Prayer): number {
  const { factorAccuracy, factorStrength, magicDamageBonus } = PrayerMap[prayer];
  return ((factorAccuracy?.[0] ?? 100) - 100) + ((factorStrength?.[0] ?? 100) - 100) + (magicDamageBonus ?? 0);
}

/**
 * The best prayers the player can run together for one combat style. `unlocked` omitted = every prayer.
 * The game allows one prayer per style, or for melee one accuracy prayer with one strength prayer.
 *
 * Assumption A5: in the engine data, a set with a higher total gain is never weaker in accuracy or in strength
 * (Piety beats Chivalry beats Incredible Reflexes + Ultimate Strength on both). So the highest total gain is the best set.
 */
export function bestPrayers(combat: CombatStyle, unlocked?: string[]): Prayer[] {
  const allowed = (unlocked ? parseUnlocked(unlocked) : ALL_PRAYERS).filter((p) => PrayerMap[p].combatStyle === combat);
  const accuracyOnly = allowed.filter((p) => BRAIN_PRAYERS.includes(p));
  const strengthOnly = allowed.filter((p) => ARM_PRAYERS.includes(p));
  const sets: Prayer[][] = [
    ...allowed.map((p) => [p]),
    ...accuracyOnly.flatMap((a) => strengthOnly.map((s) => [a, s])),
  ];
  const total = (set: Prayer[]) => set.reduce((sum, p) => sum + gain(p), 0);
  return sets.reduce<Prayer[]>((best, set) => (total(set) > total(best) ? set : best), []);
}

// ---------- potions ----------

/** One potion of the game. `engine` = the engine potions with the same boost. `ids` = its items with 4, 3, 2 and 1 doses. */
interface PotionItem { name: string; engine: Potion[]; ids: [number, number, number, number] }

// Item ids: RuneLite `net.runelite.api.ItemID` (runelite-api 1.13.6), read on 2026-11-16.
// Not listed: potions that work only in a minigame or raid (overloads, smelling salts), and the imbued and
// saturated hearts (they have no doses).
const POTION_ITEMS: PotionItem[] = [
  { name: 'Attack potion', engine: [Potion.ATTACK], ids: [2428, 121, 123, 125] },
  { name: 'Strength potion', engine: [Potion.STRENGTH], ids: [113, 115, 117, 119] },
  { name: 'Combat potion', engine: [Potion.ATTACK, Potion.STRENGTH], ids: [9739, 9741, 9743, 9745] },
  { name: 'Super attack', engine: [Potion.SUPER_ATTACK], ids: [2436, 145, 147, 149] },
  { name: 'Super strength', engine: [Potion.SUPER_STRENGTH], ids: [2440, 157, 159, 161] },
  { name: 'Super combat potion', engine: [Potion.SUPER_COMBAT], ids: [12695, 12697, 12699, 12701] },
  { name: 'Divine super attack potion', engine: [Potion.SUPER_ATTACK], ids: [23697, 23700, 23703, 23706] },
  { name: 'Divine super strength potion', engine: [Potion.SUPER_STRENGTH], ids: [23709, 23712, 23715, 23718] },
  { name: 'Divine super combat potion', engine: [Potion.SUPER_COMBAT], ids: [23685, 23688, 23691, 23694] },
  { name: 'Ranging potion', engine: [Potion.RANGING], ids: [2444, 169, 171, 173] },
  { name: 'Bastion potion', engine: [Potion.RANGING], ids: [22461, 22464, 22467, 22470] },
  { name: 'Divine ranging potion', engine: [Potion.RANGING], ids: [23733, 23736, 23739, 23742] },
  { name: 'Divine bastion potion', engine: [Potion.RANGING], ids: [24635, 24638, 24641, 24644] },
  { name: 'Magic potion', engine: [Potion.MAGIC], ids: [3040, 3042, 3044, 3046] },
  { name: 'Battlemage potion', engine: [Potion.MAGIC], ids: [22449, 22452, 22455, 22458] },
  { name: 'Divine magic potion', engine: [Potion.MAGIC], ids: [23745, 23748, 23751, 23754] },
  { name: 'Divine battlemage potion', engine: [Potion.MAGIC], ids: [24623, 24626, 24629, 24632] },
  { name: 'Ancient brew', engine: [Potion.ANCIENT], ids: [26340, 26342, 26344, 26346] },
  { name: 'Forgotten brew', engine: [Potion.FORGOTTEN_BREW], ids: [27629, 27632, 27635, 27638] },
];

/** The skills whose level a potion can raise for each combat style. */
const STYLE_SKILLS: Record<CombatStyle, (keyof PlayerSkills)[]> = { melee: ['atk', 'str'], ranged: ['ranged'], magic: ['magic'] };

export interface OwnedPotion { name: string; doses: number; engine: Potion[] }

/**
 * The best potions the player owns for one combat style: per skill of the style, the owned potion with the
 * highest boost at the player's level. One potion that is the best for each skill comes alone (Super combat).
 * `owned` = the inventory and bank stacks.
 */
export function bestOwnedPotions(combat: CombatStyle, skills: PlayerSkills, owned: ItemStack[]): OwnedPotion[] {
  const dosesOf = (ids: number[]) => owned.reduce((sum, { id, quantity }) => {
    const index = ids.indexOf(id);
    return index < 0 || quantity <= 0 ? sum : sum + quantity * (4 - index);
  }, 0);
  const potions = POTION_ITEMS.map(({ name, engine, ids }) => ({ name, engine, doses: dosesOf(ids) })).filter((p) => p.doses > 0);

  const boost = (p: OwnedPotion, skill: keyof PlayerSkills) => Math.max(0, ...p.engine.map((e) => PotionMap[e].calculateFn(skills)[skill] ?? 0));
  const wanted = STYLE_SKILLS[combat];
  const top = (skill: keyof PlayerSkills) => Math.max(0, ...potions.map((p) => boost(p, skill)));
  const useful = potions.filter((p) => wanted.some((skill) => boost(p, skill) > 0)).sort((a, b) => b.doses - a.doses);

  const complete = useful.find((p) => wanted.every((skill) => boost(p, skill) === top(skill)));
  if (complete) return [complete];
  const perSkill = wanted.flatMap((skill) => useful.find((p) => boost(p, skill) === top(skill)) ?? []);
  return [...new Set(perSkill)];
}
