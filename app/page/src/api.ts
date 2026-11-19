// The page's only data path: four read-only endpoints of the UI server, and its "changed" event stream.
import type { BankModePlan, BoostMode, CombatStyle, Slot } from '../../src/core/bankMode';
import type { BossNotes } from '../../src/core/briefing';
import type { StateSummary } from '../../src/ui/server';

export type { BankModePlan, BoostMode, CombatStyle, Slot, StateSummary };
export type { Setup, SetupItem, Tiers } from '../../src/core/bankMode';

/** What the URL holds. */
export interface View { boss: string; phase: string; style: CombatStyle }

/**
 * The plan's controls, sent with each plan request. `drains` is the plan endpoint's `drains` value
 * ("dwh:2", "none"), or "counted" for the drains that the plugin counted. `bgsDamage` adds a manual BGS drain:
 * like every manual drain, it replaces the counted drains.
 */
export interface Controls { boosts: BoostMode; drains: string; bgsDamage: number; pins: Partial<Record<Slot, number>> }

/** The plan endpoint's `drains` value, or null for the counted drains. */
function drainsParam({ drains, bgsDamage }: Controls): string | null {
  const preset = drains === 'counted' || drains === 'none' ? [] : [drains];
  const manual = [...preset, ...(bgsDamage > 0 ? [`bgs:${bgsDamage}`] : [])].join(',');
  if (manual) return manual;
  return drains === 'none' ? 'none' : null;
}

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
  const drains = drainsParam(controls);
  const [summary, plan] = await Promise.all([
    getJson<StateSummary>('/api/state', {}),
    getJson<BankModePlan>('/api/plan', {
      ...monster,
      style: view.style,
      boosts: controls.boosts,
      ...(drains ? { drains } : {}),
      ...(pins ? { pins } : {}),
    }),
  ]);
  return { summary, plan };
}

export type { AttackStyle, BossNotes, Mechanic, Phase, Prayer } from '../../src/core/briefing';

/** A boss's Briefing: its notes, "no notes" (404), or an error (a malformed file, no server). */
export type BriefingReply = { kind: 'notes'; notes: BossNotes } | { kind: 'none' } | { kind: 'error'; message: string };

export async function fetchBriefing(boss: string): Promise<BriefingReply> {
  try {
    const response = await fetch(`/api/briefing?${new URLSearchParams({ boss })}`);
    if (response.ok) return { kind: 'notes', notes: await response.json() as BossNotes };
    if (response.status === 404) return { kind: 'none' };
    const { error } = await response.json() as { error?: string };
    return { kind: 'error', message: error ?? `The server answered ${response.status}.` };
  } catch {
    return { kind: 'error', message: 'The UI server does not answer.' };
  }
}

/** Calls `onChanged` when the state or bank file changed, and `onConnection` when the stream opens or drops. */
export function subscribe(onChanged: () => void, onConnection: (open: boolean) => void): () => void {
  const events = new EventSource('/api/events');
  events.addEventListener('changed', onChanged);
  events.addEventListener('open', () => onConnection(true));
  events.addEventListener('error', () => onConnection(false));
  return () => events.close();
}
