// The Cheat sheet's "Wear" panel (ticket #77): the best owned setup from the same plan as the Gear tab, or why there
// is none. A pure function, so the reasons are tested without a browser.
import type {
  BankModePlan, CombatStyle, Controls, Setup, StateSummary,
} from './api';

/**
 * The controls of the Wear panel's request, fixed. Legality condition (spec #72): nothing in them comes from the
 * fight. No drains (never the drains that the plugin counted) and Planned boosts (never the live levels).
 */
export const STATIC_CONTROLS: Controls = { boosts: 'planned', drains: 'none', bgsDamage: 0, pins: {} };

/** `noBank`: the plan saw no bank snapshot, so it ranked the worn and inventory items only. */
export type Wear = { kind: 'setup'; setup: Setup; noBank: boolean } | { kind: 'why'; why: string };

/** `fresh` is what `fetchBankMode` gave, or null when it failed (no server). */
export function wearOf(fresh: { summary: StateSummary | null; plan: BankModePlan | null } | null, style: CombatStyle): Wear {
  if (!fresh?.summary) return { kind: 'why', why: 'No game state yet. Log in with the DPS Bridge plugin on.' };
  if (!fresh.summary.loggedIn) return { kind: 'why', why: 'You are logged out. Log in with the DPS Bridge plugin on to see what you own.' };
  if (!fresh.plan) return { kind: 'why', why: 'The setup search for this boss failed. Open the Gear tab to see the error.' };
  const stylePlan = fresh.plan.styles[style];
  if (!stylePlan) return { kind: 'why', why: `No ${style} setup for this boss.` };
  if ('unavailable' in stylePlan) return { kind: 'why', why: stylePlan.unavailable };
  return { kind: 'setup', setup: stylePlan.tiers.bestOwned, noBank: fresh.plan.bankAgeMs === null };
}
