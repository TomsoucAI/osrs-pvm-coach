// The Briefing tab (ticket #76): the fight as one scroll, grouped by Phase, drawn straight from the Boss notes.
// No AI is in this path. The look is prototype variant D (commit d976b26), with the Cheat sheet on top (ticket #77).
// On the left, pinned (ticket #78): the selected Mechanic's Clips, its "now" panel and the boss's HP timeline.
// The two sides are linked: a click on a bar scrolls to its row; scrolling selects the row in view. The selected
// Mechanic is the URL's anchor (#slam). Only the Clips come from another site (Player.tsx, ADR 2 in spec #72).
import { useEffect, useState, type MouseEvent } from 'react';
import {
  fetchBriefing, type AttackStyle, type BossNotes, type BriefingReply, type Mechanic, type Prayer,
} from './api';
import { CheatSheet } from './CheatSheet';
import { Fact, Hitsplat } from './NotesText';
import { Player } from './Player';
import { anchorOf, picked, seen, type Selection } from './selection';

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

/** A Mechanic's name, style and prayer: in its row and in the "now" panel. */
function MechanicHead({ m }: { m: Mechanic }) {
  return (
    <header className="br-mechanic-head">
      <h3>{m.name}</h3><StyleTag style={m.style} /><PrayerBadge prayer={m.prayer} />
    </header>
  );
}

function MechanicRow({ m, notes, selected }: { m: Mechanic; notes: BossNotes; selected: boolean }) {
  return (
    <article id={m.id} data-mechanic={m.id} className={`br-mechanic br-inset ${selected ? 'on' : ''}`}>
      <MechanicHead m={m} />
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

function Scroll({ notes, selected }: { notes: BossNotes; selected: string }) {
  return (
    <div className="br-scroll">
      <p className={`br-status br-inset ${notes.status}`}>
        <b>{notes.boss}</b>
        {notes.status === 'draft' ? ' · Draft notes, not reviewed yet' : ' · Reviewed notes'} · checked on {notes.checkedOn}
      </p>
      <CheatSheet notes={notes} />
      {notes.phases.map((p) => (
        // A Mechanic's id is its deep-link anchor (#slam), so a Phase takes a prefix: Phase and Mechanic ids can be equal.
        <section key={p.id} id={`phase-${p.id}`} className="br-phase">
          <header className="br-phase-head">
            <h2><span className="br-phase-hp">{p.from}% HP</span> {p.name}</h2>
          </header>
          <p className="br-phase-sum"><Fact text={p.summary} /></p>
          <p className="br-mistake"><b>Top mistake:</b> <Fact text={p.topMistake} /></p>
          {/* A Mechanic sits in the Phase where it starts. */}
          {notes.mechanics.filter((m) => m.from <= p.from && m.from > p.to).map((m) => <MechanicRow key={m.id} m={m} notes={notes} selected={m.id === selected} />)}
          <SourceLine refs={p.sources} notes={notes} />
        </section>
      ))}
      <p className="br-credit">{notes.credit}</p>
    </div>
  );
}

/** The boss's HP bar, left 100% to right 0%, with a tick per Phase and a bar per Mechanic on its HP range. */
function Timeline({ notes, selected, onPick }: { notes: BossNotes; selected: Mechanic; onPick: (id: string) => void }) {
  const at = (hp: number) => `${100 - hp}%`;
  const span = (from: number, to: number) => ({ left: at(from), width: `${from - to}%` });
  return (
    <section className="br-inset tl" aria-label="Mechanics on the boss's HP">
      <div className="tl-hp" title="Boss HP">
        <span className="tl-hp-lost" style={{ width: at(selected.from) }} />
        <span className="tl-hp-text">{selected.from}% HP</span>
        {notes.phases.slice(1).map((p) => <span key={p.id} className="tl-tick" style={{ left: at(p.from) }} />)}
      </div>
      <div className="tl-phases">
        {notes.phases.map((p) => <span key={p.id} style={span(p.from, p.to)}>{p.name}</span>)}
      </div>
      {notes.mechanics.map((m) => (
        <div key={m.id} className="tl-track">
          <button
            type="button" className={`tl-bar style-${m.style} ${m.id === selected.id ? 'on' : ''}`} style={span(m.from, m.to)}
            aria-pressed={m.id === selected.id} title={`${m.name}: ${m.from}% to ${m.to}% HP`} onClick={() => onPick(m.id)}
          >
            {m.name}
          </button>
        </div>
      ))}
    </section>
  );
}

/** The pinned side: the player, the "now" panel and the timeline, all for the selected Mechanic. */
function Pinned({ notes, selected, onPick }: { notes: BossNotes; selected: Mechanic; onPick: (id: string) => void }) {
  return (
    <aside className="br-pinned">
      <section className="br-inset">
        {/* A new Mechanic starts at its first Clip. */}
        <Player key={selected.id} clips={selected.clips} />
      </section>
      <section className="br-inset br-now">
        <MechanicHead m={selected} />
        <p className="br-now-do"><Fact text={selected.do} /></p>
      </section>
      <Timeline notes={notes} selected={selected} onPick={onPick} />
    </aside>
  );
}

const scrollToRow = (id: string, behavior: ScrollBehavior) => document.getElementById(id)?.scrollIntoView({ behavior, block: 'center' });

/** Both sides, linked both ways through one selection (selection.ts holds the rule). */
function Linked({ notes }: { notes: BossNotes }) {
  const ids = notes.mechanics.map((m) => m.id);
  const [selection, setSelection] = useState<Selection>(() => ({ id: anchorOf(window.location.hash, ids) ?? notes.killers[0], heading: null }));

  const pick = (id: string, behavior: ScrollBehavior) => {
    setSelection(picked(id, Date.now()));
    scrollToRow(id, behavior);
  };

  // A link to a row inside the page (the Cheat sheet's) selects through the same path as a bar: one smooth scroll,
  // and it works for the Mechanic that is already selected too. A Ctrl+click or middle click stays the browser's.
  const onLinkClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = (e.target as Element).closest('a')?.getAttribute('href');
    const id = href && anchorOf(href, ids);
    if (!id) return;
    e.preventDefault();
    pick(id, 'smooth');
  };

  // The URL anchor: on open (a link from the Coach), and on a change (a link typed or pasted into this tab).
  useEffect(() => {
    const linked = anchorOf(window.location.hash, ids);
    if (linked) pick(linked, 'auto');
    const onHash = () => {
      const id = anchorOf(window.location.hash, ids);
      if (id) pick(id, 'smooth');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [notes]);

  // The row in a band at about 40% of the window's height is the row in view.
  useEffect(() => {
    const spy = new IntersectionObserver((entries) => {
      const hit = entries.find((e) => e.isIntersecting);
      const id = hit && (hit.target as HTMLElement).dataset.mechanic;
      if (id) setSelection((s) => seen(s, id, Date.now()));
    }, { rootMargin: '-35% 0px -55% 0px' });
    document.querySelectorAll('[data-mechanic]').forEach((row) => spy.observe(row));
    return () => spy.disconnect();
  }, [notes]);

  // The URL always names the selected Mechanic. `replaceState` fires no hashchange, so this does not loop.
  useEffect(() => {
    if (window.location.hash !== `#${selection.id}`) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${selection.id}`);
    }
  }, [selection.id]);

  const selected = notes.mechanics.find((m) => m.id === selection.id)!;
  return (
    <div className="br-body" onClick={onLinkClick}>
      <Pinned notes={notes} selected={selected} onPick={(id) => pick(id, 'smooth')} />
      <Scroll notes={notes} selected={selection.id} />
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
  // A new boss starts a new selection: an id of the old notes can never reach the new ones.
  return <Linked key={boss} notes={reply.notes} />;
}
