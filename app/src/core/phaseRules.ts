// The single place for "this combat style cannot be used in this phase" rules.
// The engine data has no field for it, so each rule is written here with its source.
import type { Monster } from '@/types/Monster';

export type CombatStyle = 'melee' | 'ranged' | 'magic';

interface PhaseRule {
  monster: string;
  version: string;
  style: CombatStyle;
  reason: string;
}

const PHASE_RULES: PhaseRule[] = [
  // Spec #1, grill decision Q8: in the "Far" phase the Maggot King is out of melee reach.
  {
    monster: 'Maggot King', version: 'Far', style: 'melee', reason: 'Melee cannot reach the Maggot King in its Far phase.',
  },
];

/** The reason why `style` is unavailable against this monster version, or null when it is available. */
export function phaseUnavailable(monster: Pick<Monster, 'name' | 'version'>, style: CombatStyle): string | null {
  const rule = PHASE_RULES.find((r) => r.monster === monster.name && r.version === (monster.version ?? '') && r.style === style);
  return rule?.reason ?? null;
}
