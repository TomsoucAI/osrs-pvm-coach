// The pieces that draw Boss notes text, shared by the Briefing's scroll and its Cheat sheet.

/** The game's hitsplat. A range ("15–25") shows one splat per number, lowest first. */
export function Hitsplat({ value }: { value: string }) {
  const parts = value.split('–');
  return (
    <span className="br-splats" title={`Damage if you miss it: ${parts.join(' to ')}`}>
      {parts.map((part) => <span key={part} className="br-splat">{part}</span>)}
    </span>
  );
}

/** A fact's text. Each "To confirm" (a gap in the draft) is marked in place, so it is never read as a fact. */
export function Fact({ text }: { text: string }) {
  return <>{text.split(/(to confirm)/i).map((part, i) => (i % 2 ? <span key={i} className="br-confirm">{part}</span> : part))}</>;
}
