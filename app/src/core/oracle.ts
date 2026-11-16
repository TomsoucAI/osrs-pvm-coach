// Test oracle for planBankMode: a brute-force search with no pruning.
// It tries every owned item (and the empty slot) in every slot, with every weapon, combat style and spell,
// and keeps the best setup per weapon. It shares no search code with bankMode.ts: only the engine and calc.ts.
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import {
  calculateAttackSpeed, calculateEquipmentBonusesFromGear, equipmentAliases, getCanonicalItem,
} from '@/lib/Equipment';
import { getCombatStylesForCategory } from '@/utils';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import { spells } from '@/types/Spell';
import type { EquipmentPiece, Player, PlayerEquipment } from '@/types/Player';
import {
  buildPlayer, findItem, resolveMonster, SLOTS, type DefenceReductions,
} from '../calc';
import type { LiveState } from './liveState';
import type { CombatStyle } from './phaseRules';

type Slot = keyof PlayerEquipment;

export interface OracleSetup {
  weapon: string | null;
  dps: number;
  swaps: number;
  /** How many setups reach this DPS with this number of swaps. 1 = the best setup is unique. */
  ties: number;
  items: Record<Slot, string | null>;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const ISSUES_THAT_BLOCK = ['equipment_slot_ammo_missing', 'equipment_slot_ammo_wrong', 'spell_wrong_weapon', 'spell_wrong_monster', 'equipment_slot_weapon_wrong_monster'];

export function exhaustiveSearch(
  state: LiveState,
  monsterSpec: { name: string; version?: string; reductions?: DefenceReductions },
  combat: CombatStyle,
): OracleSetup[] {
  const monster = resolveMonster(monsterSpec);
  const piece = (id: number | null | undefined): EquipmentPiece | null => {
    const item = id === null || id === undefined ? null : findItem(id);
    return item ? getCanonicalItem(item) : null;
  };

  const worn = Object.fromEntries(SLOTS.map((s) => [s, piece(state.equipment?.[s])])) as unknown as PlayerEquipment;
  const ownedIds = [
    ...Object.values(state.equipment ?? {}),
    ...state.inventory.filter((i) => i.quantity > 0).map((i) => i.id),
    ...(state.bank?.items ?? []).filter((i) => i.quantity > 0).map((i) => i.id),
  ];
  const pool = Object.fromEntries(SLOTS.map((s) => [s, [] as EquipmentPiece[]])) as Record<Slot, EquipmentPiece[]>;
  for (const id of ownedIds) {
    const p = piece(id);
    if (p && !pool[p.slot].some((o) => o.id === p.id)) pool[p.slot].push(p);
  }

  const empty = Object.fromEntries(SLOTS.map((s) => [s, null])) as Record<Slot, null>;
  const template = buildPlayer(state, monster, { equipment: empty }).player;
  const otherSlots = SLOTS.filter((s) => s !== 'weapon');
  const best = new Map<EquipmentPiece | null, OracleSetup>();

  // Same speed-up as bankMode.ts: every piece is already the base variant, so the engine's alias scan finds nothing.
  const savedAliases = Object.entries(equipmentAliases);
  for (const [base] of savedAliases) delete equipmentAliases[Number(base)];
  try {
    for (const weapon of [...pool.weapon, null]) {
      for (const style of getCombatStylesForCategory(weapon?.category ?? EquipmentCategory.UNARMED)) {
        const styleCombat = style.type === 'magic' || style.type === 'ranged' ? style.type : 'melee';
        if (style.type === null || styleCombat !== combat) continue;
        const casts = ['Autocast', 'Defensive Autocast', 'Manual Cast'].includes(style.stance ?? '');
        const spellOptions = casts ? spells.filter((s) => s.spellbook === state.spellbook && s.max_hit > 0) : [null];
        for (const spell of spellOptions) {
          const equipment = { ...empty, weapon } as PlayerEquipment;
          const visit = (i: number) => {
            if (i < otherSlots.length) {
              for (const option of [null, ...pool[otherSlots[i]]]) {
                equipment[otherSlots[i]] = option;
                visit(i + 1);
              }
              return;
            }
            if (weapon?.isTwoHanded && equipment.shield) return;
            const player: Player = {
              ...template, equipment: { ...equipment }, style, spell,
            };
            Object.assign(player, calculateEquipmentBonusesFromGear(player, monster));
            player.attackSpeed = calculateAttackSpeed(player, monster);
            const calc = new PlayerVsNPCCalc(player, monster, { loadoutName: 'oracle' });
            if (calc.userIssues.some((issue) => ISSUES_THAT_BLOCK.includes(issue.type))) return;
            // Raw DPS decides, as in bankMode.ts. It is rounded only in the returned list.
            const dps = calc.getDps();
            if (dps <= 0) return;
            const swaps = SLOTS.filter((s) => (equipment[s]?.id ?? null) !== (worn[s]?.id ?? null)).length;
            const known = best.get(weapon);
            if (known && dps === known.dps && swaps === known.swaps) {
              known.ties++;
            } else if (!known || dps > known.dps || (dps === known.dps && swaps < known.swaps)) {
              best.set(weapon, {
                weapon: weapon?.name ?? null,
                dps,
                swaps,
                ties: 1,
                items: Object.fromEntries(SLOTS.map((s) => [s, equipment[s]?.name ?? null])) as Record<Slot, string | null>,
              });
            }
          };
          visit(0);
        }
      }
    }
  } finally {
    for (const [base, variants] of savedAliases) equipmentAliases[Number(base)] = variants;
  }
  return [...best.values()].sort((a, b) => b.dps - a.dps).slice(0, 3).map((s) => ({ ...s, dps: round3(s.dps) }));
}
