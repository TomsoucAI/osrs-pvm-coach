// The Briefing's selected Mechanic. Two inputs change it: a click (a timeline bar, a "What kills you" link, the URL
// anchor) and the scroll, which reports the row in view. A click starts a smooth scroll that passes other rows, so
// after a click the scroll is ignored until the clicked row is in view, or until the scroll had time to end.

/** Longer than a smooth scroll across the whole Briefing. */
const QUIET_MS = 1500;

export interface Selection {
  id: string;
  /** Set by a click: the row the scroll goes to, and when the scroll counts again even if it never got there. */
  heading: { id: string; until: number } | null;
}

export function picked(id: string, now: number): Selection {
  return { id, heading: { id, until: now + QUIET_MS } };
}

/** `#slam` → `slam`, when the notes have that Mechanic. A Mechanic's id is its anchor; a Phase's is `#phase-…`. */
export function anchorOf(hash: string, ids: string[]): string | null {
  // The schema keeps ids to lower-case words and "-", so the hash needs no decoding.
  const id = hash.slice(1);
  return ids.includes(id) ? id : null;
}

/** The scroll put row `id` in view. */
export function seen(selection: Selection, id: string, now: number): Selection {
  const { heading } = selection;
  if (heading && now < heading.until && id !== heading.id) return selection;
  return { id, heading: null };
}
