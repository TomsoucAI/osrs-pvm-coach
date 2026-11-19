// Recent-boss chips (spec #1, story 33), kept in browser storage: a per-viewer convenience, so it may fail quietly.
// Storage can be missing or throw (private window, blocked site data): the page then shows the chips of this visit only.
export interface RecentBoss { boss: string; phase: string }

const KEY = 'bank-mode.recent-bosses';
const MAX_CHIPS = 6;

/** The picked boss first, one chip per boss (its last phase), at most MAX_CHIPS. */
export function addRecent(list: RecentBoss[], pick: RecentBoss): RecentBoss[] {
  return [pick, ...list.filter((r) => r.boss !== pick.boss)].slice(0, MAX_CHIPS);
}

const isRecentBoss = (v: unknown): v is RecentBoss => typeof v === 'object' && v !== null
  && typeof (v as RecentBoss).boss === 'string' && typeof (v as RecentBoss).phase === 'string';

export function loadRecent(getStorage: () => Storage | null): RecentBoss[] {
  try {
    const stored: unknown = JSON.parse(getStorage()?.getItem(KEY) ?? '[]');
    return Array.isArray(stored) && stored.every(isRecentBoss) ? stored.slice(0, MAX_CHIPS) : [];
  } catch {
    return [];
  }
}

export function saveRecent(getStorage: () => Storage | null, list: RecentBoss[]): void {
  try {
    getStorage()?.setItem(KEY, JSON.stringify(list));
  } catch {
    // No storage: the chips last until the page closes.
  }
}
