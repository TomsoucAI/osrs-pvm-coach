// The rule, on every tab: a max hit always shows as the game's max-hit hitsplat (the sprite is in pieces.css).

export function MaxHit({ value }: { value: number }) {
  return <span className="max-hit" title="Max hit">{value}</span>;
}
