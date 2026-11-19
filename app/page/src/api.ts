// The page's only data path: three read-only endpoints of the UI server, and its "changed" event stream.
import type { BankModePlan, BoostMode, CombatStyle, Slot } from '../../src/core/bankMode';
import type { StateSummary } from '../../src/ui/server';

export type { BankModePlan, BoostMode, CombatStyle, Slot, StateSummary };
export type { Setup, SetupItem, Tiers } from '../../src/core/bankMode';

/** What the URL holds. */
export interface View { boss: string; phase: string; style: CombatStyle }

/**
 * The plan's controls, sent with each plan request. `drains` is the plan endpoint's `drains` value
 * ("dwh:2", "none"), or "counted" for the drains that the plugin counted.
 */
export interface Controls { boosts: BoostMode; drains: string; pins: Partial<Record<Slot, number>> }

export interface MonsterHit { name: string; version: string }

async function getJson<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const response = await fetch(`${path}?${new URLSearchParams(params)}`);
  return response.ok ? await response.json() as T : null;
}

export const searchMonsters = async (q: string) => await getJson<MonsterHit[]>('/api/monsters', { q }) ?? [];

/** The plan is null when the server has none to give (logged out, or no readable state). */
export async function fetchBankMode(view: View, controls: Controls): Promise<{ summary: StateSummary | null; plan: BankModePlan | null }> {
  const monster = { monster: view.boss, version: view.phase };
  const pins = Object.entries(controls.pins).map(([slot, id]) => `${slot}:${id}`).join(',');
  const [summary, plan] = await Promise.all([
    getJson<StateSummary>('/api/state', monster),
    getJson<BankModePlan>('/api/plan', {
      ...monster,
      style: view.style,
      boosts: controls.boosts,
      ...(controls.drains === 'counted' ? {} : { drains: controls.drains }),
      ...(pins ? { pins } : {}),
    }),
  ]);
  return { summary, plan };
}

/** Calls `onChanged` when the state or bank file changed, and `onConnection` when the stream opens or drops. */
export function subscribe(onChanged: () => void, onConnection: (open: boolean) => void): () => void {
  const events = new EventSource('/api/events');
  events.addEventListener('changed', onChanged);
  events.addEventListener('open', () => onConnection(true));
  events.addEventListener('error', () => onConnection(false));
  return () => events.close();
}
