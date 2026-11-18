// The page's only data path: three read-only endpoints of the UI server, and its "changed" event stream.
import type { BankModePlan, CombatStyle } from '../../src/core/bankMode';
import type { StateSummary } from '../../src/ui/server';

export type { BankModePlan, CombatStyle, StateSummary };
export type { Setup, Slot } from '../../src/core/bankMode';

/** What the URL holds. */
export interface View { boss: string; phase: string; style: CombatStyle }

export interface MonsterHit { name: string; version: string }

async function getJson<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const response = await fetch(`${path}?${new URLSearchParams(params)}`);
  return response.ok ? await response.json() as T : null;
}

export const searchMonsters = async (q: string) => await getJson<MonsterHit[]>('/api/monsters', { q }) ?? [];

/** The plan is null when the server has none to give (logged out, or no readable state). */
export async function fetchBankMode(view: View): Promise<{ summary: StateSummary | null; plan: BankModePlan | null }> {
  const monster = { monster: view.boss, version: view.phase };
  const [summary, plan] = await Promise.all([
    getJson<StateSummary>('/api/state', monster),
    getJson<BankModePlan>('/api/plan', { ...monster, style: view.style }),
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
