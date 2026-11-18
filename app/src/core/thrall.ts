// The "+ greater thrall DPS" line: a thrall's damage next to the Wiki-calc DPS, never added into it (spec #1, Q10).
// The Wiki DPS engine has no thralls, so the numbers are constants from the OSRS Wiki, with their source.
import type { LiveState } from './liveState';

export interface ThrallLine {
  name: string;
  dps: number;
  maxHit: number;
  attackSeconds: number;
  source: { url: string; readOn: string };
}

// OSRS Wiki, Thralls page: greater thralls (ghost, skeleton, zombie) "always deal successful hits" of 0 to 3,
// once every 2.4 seconds (4 ticks). The page gives their DPS as 0.625. Casting needs Magic 76 and
// 10 fire, 5 blood and 1 cosmic runes. Item ids: RuneLite `net.runelite.api.ItemID` (runelite-api 1.13.6), read on 2026-11-18.
const GREATER_THRALL_MAGIC_LEVEL = 76;
const GREATER_THRALL_RUNES = [
  { id: 554, quantity: 10 }, // FIRE_RUNE
  { id: 565, quantity: 5 }, // BLOOD_RUNE
  { id: 564, quantity: 1 }, // COSMIC_RUNE
];
const GREATER_THRALL: ThrallLine = {
  name: 'Greater thrall',
  dps: 0.625,
  maxHit: 3,
  attackSeconds: 2.4,
  source: { url: 'https://oldschool.runescape.wiki/w/Thralls', readOn: '2026-11-18' },
};

/** The greater thrall line, or null when the player cannot cast a greater thrall. */
export function thrallLine(state: LiveState): ThrallLine | null {
  if (state.spellbook !== 'arceuus') return null;
  // The game checks the current level: a potion boost counts, and so does a drain.
  const magic = state.boostedLevels?.magic ?? state.realLevels?.magic ?? 0;
  if (magic < GREATER_THRALL_MAGIC_LEVEL) return null;
  const owned = [
    ...state.runePouch.map(({ runeItemId, quantity }) => ({ id: runeItemId, quantity })),
    ...state.inventory,
    ...(state.bank?.items ?? []),
  ];
  const count = (id: number) => owned.reduce((sum, s) => (s.id === id && s.quantity > 0 ? sum + s.quantity : sum), 0);
  if (GREATER_THRALL_RUNES.some(({ id, quantity }) => count(id) < quantity)) return null;
  return GREATER_THRALL;
}
