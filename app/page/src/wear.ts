// The Cheat sheet's "Wear" panel (ticket #77): the best owned setup from the same plan as the Gear tab, or why there
// is none. A pure function, so the reasons are tested without a browser.
import type { BankModePlan, CombatStyle, Setup, StateSummary } from './api';

/** `noBank`: the plan saw no bank snapshot, so it ranked the worn and inventory items only. */
export type Wear = { kind: 'setup'; setup: Setup; noBank: boolean } | { kind: 'why'; why: string };

/** `fresh` is what `fetchBankMode` gave, or null when it failed (no server). */
export function wearOf(fresh: { summary: StateSummary | null; plan: BankModePlan | null } | null, style: CombatStyle): Wear {
  if (!fresh?.summary) return { kind: 'why', why: 'No game state yet. Log in with the DPS Bridge plugin on.' };
  if (!fresh.summary.loggedIn) return { kind: 'why', why: 'You are logged out. Log in with the DPS Bridge plugin on to see what you own.' };
  if (!fresh.plan) return { kind: 'why', why: 'The plan for this boss failed. The Gear tab shows the same plan.' };
  const stylePlan = fresh.plan.styles[style];
  if (!stylePlan) return { kind: 'why', why: `No ${style} plan for this boss.` };
  if ('unavailable' in stylePlan) return { kind: 'why', why: stylePlan.unavailable };
  return { kind: 'setup', setup: stylePlan.tiers.bestOwned, noBank: fresh.plan.bankAgeMs === null };
}
