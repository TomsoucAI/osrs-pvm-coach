// The Briefing tab (ticket #76): the fight as one scroll, grouped by Phase, drawn straight from the Boss notes.
// No AI is in this path. The look is prototype variant D's main column (commit d976b26); the Cheat sheet (ticket 4)
// and the pinned player, Clips and HP timeline (ticket 5) are not here yet.
// The page loads nothing from another site: the hitsplat is drawn in CSS and the style icons are inline SVG.
import { useEffect, useState } from 'react';
import {
  fetchBriefing, type AttackStyle, type BossNotes, type BriefingReply, type Mechanic, type Prayer,
} from './api';

/** v1 holds one boss. The Gear tab's boss, when it has one, stays the same on this tab. */
const DEFAULT_BOSS = 'Maggot King';

type Sources = Mechanic['sources'];

const STYLE_LABEL: Record<AttackStyle, string> = { melee: 'Melee', ranged: 'Ranged', magic: 'Magic', typeless: 'Typeless' };
// 16×16 paths from the prototype: a sword, a bow, a star, a diamond. Colour is never the only signal.
const GLYPH: Record<AttackStyle, string> = {
  melee: 'M13 1l2 2-7 7 1.5 1.5-1.5 1.5-1.5-1.5L4 14l-2 .5.5-2 2.5-2.5L3.5 8.5 5 7l1.5 1.5z',
  ranged: 'M3 1c6 1 9 6 9 12l-1.2-.3C10.6 8 8.3 4 3.3 2.4zM3 1l1.2.4L12 13l-1 .7zM2 14l2.5-4 1.5 1.5z',
  magic: 'M8 1l1.8 4.6L14.5 6l-3.6 3 1.2 4.8L8 11.2 3.9 13.8 5.1 9 1.5 6l4.7-.4z',
  typeless: 'M8 1l6 7-6 7-6-7z',
};
/** A protection prayer, as a shield. */
const SHIELD = 'M8 1l6 2v5c0 3.5-2.6 6-6 7-3.4-1-6-3.5-6-7V3z';

function Glyph({ d }: { d: string }) {
  return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={d} fill="currentColor" /></svg>;
}

function StyleTag({ style }: { style: AttackStyle }) {
  return <span className={`br-tag br-${style}`}><Glyph d={GLYPH[style]} />{STYLE_LABEL[style]}</span>;
}

const PRAYER: Record<Exclude<Prayer, 'off'>, { style: AttackStyle; name: string }> = {
  melee: { style: 'melee', name: 'Melee' },
  missiles: { style: 'ranged', name: 'Missiles' },
  magic: { style: 'magic', name: 'Magic' },
};

function PrayerBadge({ prayer }: { prayer?: Prayer }) {
  if (!prayer) return null;
  if (prayer === 'off') {
    return <span className="br-tag br-prayer-off" title="Turn protection prayers off"><span className="br-struck"><Glyph d={SHIELD} /></span>Prayer OFF</span>;
  }
  const { style, name } = PRAYER[prayer];
  return <span className={`br-tag br-${style}`} title={`Protect from ${name}`}><Glyph d={SHIELD} />Protect from {name}</span>;
}

/** The game's hitsplat. A range ("15–25") shows one splat per number, lowest first. */
function Hitsplat({ value }: { value: string }) {
  const parts = value.split('–');
  return (
    <span className="br-splats" title={`Damage if you miss it: ${parts.join(' to ')}`}>
      {parts.map((part) => <span key={part} className="br-splat">{part}</span>)}
    </span>
  );
}

/** A fact's text. Each "To confirm" (a gap in the draft) is marked in place, so it is never read as a fact. */
function Fact({ text }: { text: string }) {
  return <>{text.split(/(to confirm)/i).map((part, i) => (i % 2 ? <span key={i} className="br-confirm">{part}</span> : part))}</>;
}

/** Each source of a fact, with its date; two sources that disagree each show what they say. */
function SourceLine({ refs, notes }: { refs: Sources; notes: BossNotes }) {
  return (
    <p className="br-sources">
      Source{refs.length > 1 ? 's' : ''}:{' '}
      {refs.map(({ ref, says }, i) => {
        const source = notes.sources[ref];
        return (
          <span key={ref}>
            {i > 0 && ' · '}
            <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a> ({source.date}){says && <>: “{says}”</>}
          </span>
        );
      })}
    </p>
  );
}

function MechanicRow({ m, notes }: { m: Mechanic; notes: BossNotes }) {
  return (
    <article id={m.id} className="br-mechanic br-inset">
      <header className="br-mechanic-head">
        <h3>{m.name}</h3><StyleTag style={m.style} /><PrayerBadge prayer={m.prayer} />
      </header>
      <dl className="br-table">
        <div className="br-line"><dt>Tell</dt><dd><Fact text={m.tell} /></dd></div>
        <div className="br-line br-do"><dt>Do</dt><dd><Fact text={m.do} /></dd></div>
        <div className="br-line"><dt>Miss</dt><dd>{m.missDamage && <Hitsplat value={m.missDamage} />}<Fact text={m.miss} /></dd></div>
        <div className="br-line"><dt>Why</dt><dd><Fact text={m.why} /> Active from {m.from}% to {m.to}% HP.</dd></div>
      </dl>
      <SourceLine refs={m.sources} notes={notes} />
    </article>
  );
}

function Scroll({ notes }: { notes: BossNotes }) {
  return (
    <div className="br-scroll">
      <p className={`br-status br-inset ${notes.status}`}>
        <b>{notes.boss}</b>
        {notes.status === 'draft' ? ' · Draft notes, not reviewed yet' : ' · Reviewed notes'} · checked on {notes.checkedOn}
      </p>
      {notes.phases.map((p) => (
        // A Mechanic's id is its deep-link anchor (#slam), so a Phase takes a prefix: Phase and Mechanic ids can be equal.
        <section key={p.id} id={`phase-${p.id}`} className="br-phase">
          <header className="br-phase-head">
            <h2><span className="br-phase-hp">{p.from}% HP</span> {p.name}</h2>
          </header>
          <p className="br-phase-sum"><Fact text={p.summary} /></p>
          <p className="br-mistake"><b>Top mistake:</b> <Fact text={p.topMistake} /></p>
          {/* A Mechanic sits in the Phase where it starts. */}
          {notes.mechanics.filter((m) => m.from <= p.from && m.from > p.to).map((m) => <MechanicRow key={m.id} m={m} notes={notes} />)}
          <SourceLine refs={p.sources} notes={notes} />
        </section>
      ))}
      <p className="br-credit">{notes.credit}</p>
    </div>
  );
}

export function Briefing() {
  const boss = new URLSearchParams(window.location.search).get('boss') || DEFAULT_BOSS;
  const [reply, setReply] = useState<BriefingReply | null>(null);

  useEffect(() => {
    let current = true;
    fetchBriefing(boss).then((r) => { if (current) setReply(r); });
    return () => { current = false; };
  }, [boss]);

  if (!reply) return <section className="shell-panel"><p>Loading the Briefing…</p></section>;
  if (reply.kind === 'none') return <section className="shell-panel"><h2>{boss}</h2><p>No Boss notes for this boss yet.</p></section>;
  if (reply.kind === 'error') return <section className="shell-panel"><h2>{boss}</h2><p>{reply.message}</p></section>;
  return <Scroll notes={reply.notes} />;
}
