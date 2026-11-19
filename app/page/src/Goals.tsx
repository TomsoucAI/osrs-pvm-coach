// The Goals tab (ticket #79): the Player profile's Goals and a typed kc, kept in a file on the player's PC.
// A Goal is picked from the boss's Boss notes: an item drop (with its drop rate) or a combat achievement.
// The server does the dry math; this page only draws it. Account type is "unknown" until the Hiscores reader (ticket 7).
// The look is the prototype's Goals mock (commit d976b26). No inline styles: the CSP allows the page's own stylesheet only.
import {
  useEffect, useRef, useState, type FormEvent,
} from 'react';
import {
  fetchBriefing, fetchProfile, saveProfile,
  type BossNotes, type Goal, type PlayerProfile, type ProfileReply, type ProfileView,
} from './api';
import { DEFAULT_BOSS } from './Briefing';

type Shown = ProfileView['goals'][number];

/** The profile schema's highest kc. */
const MAX_KC = 1_000_000;

const count = (n: number) => n.toLocaleString('en');
const percent = (chance: number) => `${(chance * 100).toFixed(1)}%`;

/** The profile to save: the view without the server's dry math. */
function profileOf(view: ProfileView, change: (profile: PlayerProfile) => PlayerProfile): PlayerProfile {
  return change({ goals: view.goals.map(({ dry: _dry, ...goal }) => goal as Goal), kc: view.kc });
}

const same = (a: Goal, b: Goal) => a.kind === b.kind && a.boss === b.boss
  && (a.kind === 'item' ? a.item === (b as typeof a).item : a.name === (b as typeof a).name);

function KcField({ boss, kc, onSave }: { boss: string; kc: number | undefined; onSave: (kc: number) => void }) {
  const [typed, setTyped] = useState(kc === undefined ? '' : String(kc));
  useEffect(() => setTyped(kc === undefined ? '' : String(kc)), [kc]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (/^\d{1,7}$/.test(typed) && Number(typed) <= MAX_KC && Number(typed) !== kc) onSave(Number(typed));
  };
  return (
    <form className="gl-kc" onSubmit={submit}>
      <label className="field">
        <span className="muted">Your {boss} kc</span>
        <input type="number" min="0" max={MAX_KC} step="1" inputMode="numeric" value={typed} placeholder="Type your kc" onChange={(e) => setTyped(e.target.value)} />
      </label>
      <button type="submit" className="btn">Save kc</button>
    </form>
  );
}

function AddGoal({ notes, goals, onAdd }: { notes: BossNotes; goals: Goal[]; onAdd: (goal: Goal) => void }) {
  const options: { key: string; label: string; goal: Goal }[] = [
    ...notes.drops.map((d) => ({
      key: `item:${d.item}`, label: `${d.item} (1/${count(d.oneIn)})`, goal: { kind: 'item', boss: notes.boss, item: d.item, oneIn: d.oneIn, done: false } as Goal,
    })),
    ...notes.combatAchievements.map((ca) => ({
      key: `ca:${ca.name}`, label: `${ca.name} (${ca.tier} combat achievement)`, goal: { kind: 'combatAchievement', boss: notes.boss, name: ca.name, done: false } as Goal,
    })),
  ].filter((o) => !goals.some((g) => same(g, o.goal)));
  const [picked, setPicked] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const option = options.find((o) => o.key === picked);
    if (option) { onAdd(option.goal); setPicked(''); }
  };
  return (
    <form className="gl-add" onSubmit={submit}>
      <label className="field">
        <span className="muted">Add a Goal from the {notes.boss} Boss notes</span>
        <select value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">Pick a drop or a combat achievement…</option>
          {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </label>
      <button type="submit" className="btn" disabled={!picked}>Add Goal</button>
    </form>
  );
}

function GoalRow({ goal, notes, onToggle, onRemove }: { goal: Shown; notes: BossNotes | null; onToggle: () => void; onRemove: () => void }) {
  const task = goal.kind === 'combatAchievement' ? notes?.combatAchievements.find((ca) => ca.name === goal.name)?.task : undefined;
  return (
    <article className={`gl-goal br-inset ${goal.done ? 'done' : ''}`}>
      <div className="gl-main">
        <h3>{goal.kind === 'item' ? goal.item : goal.name}</h3>
        <p className="muted">{goal.boss}{goal.kind === 'combatAchievement' ? ' · combat achievement' : ''}{goal.done ? ' · done' : ''}</p>
        {task && <p>{task}</p>}
        {goal.kind === 'item' && goal.dry && (
          <>
            <p>
              Drop rate <b className="gold">1/{count(goal.oneIn)}</b> · expected kills <b className="gold">{count(goal.dry.expectedKills)}</b>
            </p>
            {goal.dry.chance === null
              ? <p className="muted">Type your kc to see your chance by now.</p>
              : (
                <p className="gl-chance">
                  <progress value={goal.dry.chance} max={1} />
                  <span>Your chance by kc {count(goal.dry.kc ?? 0)}: <b className="gold">{percent(goal.dry.chance)}</b></span>
                </p>
              )}
          </>
        )}
      </div>
      <div className="gl-actions">
        <button type="button" className={`btn ${goal.done ? 'on' : ''}`} aria-pressed={goal.done} onClick={onToggle}>{goal.done ? 'Done' : 'Mark done'}</button>
        <button type="button" className="btn" onClick={onRemove}>Remove</button>
      </div>
    </article>
  );
}

export function Goals() {
  const boss = new URLSearchParams(window.location.search).get('boss') || DEFAULT_BOSS;
  const [reply, setReply] = useState<ProfileReply | null>(null);
  const [notes, setNotes] = useState<BossNotes | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Each save sends the whole profile, built from the last saved one. One save at a time, so a quick second
  // change cannot start from a stale profile and undo the first.
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let current = true;
    fetchProfile().then((r) => { if (current) setReply(r); });
    fetchBriefing(boss).then((r) => { if (current) setNotes(r.kind === 'notes' ? r.notes : null); });
    return () => { current = false; };
  }, [boss]);

  if (!reply) return <section className="shell-panel"><p>Loading the Goals…</p></section>;
  if (reply.kind === 'error') return <section className="shell-panel"><h2>Goals</h2><p>{reply.message}</p></section>;
  const { view } = reply;

  // Each change saves the whole profile; the page shows what the server saved, with its dry math.
  const save = async (change: (profile: PlayerProfile) => PlayerProfile) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    const saved = await saveProfile(profileOf(view, change));
    if (saved.kind === 'profile') { setReply(saved); setSaveError(null); } else setSaveError(saved.message);
    inFlight.current = false;
    setSaving(false);
  };
  const items = view.goals.filter((g) => g.kind === 'item');
  const achievements = view.goals.filter((g) => g.kind === 'combatAchievement');
  const row = (goal: Shown) => (
    <GoalRow
      key={JSON.stringify([goal.kind, goal.boss, goal.kind === 'item' ? goal.item : goal.name])}
      goal={goal}
      notes={notes}
      onToggle={() => save((p) => ({ ...p, goals: p.goals.map((g) => (same(g, goal) ? { ...g, done: !g.done } : g)) }))}
      onRemove={() => save((p) => ({ ...p, goals: p.goals.filter((g) => !same(g, goal)) }))}
    />
  );

  return (
    // A disabled fieldset disables every control inside it while a save is in flight.
    <fieldset className="gl-body" disabled={saving}>
      <aside className="gl-side">
        <section className="br-inset">
          <h2>Player profile</h2>
          <p><span className="muted">Account type:</span> {view.accountType}</p>
          <p className="muted">Kept in a file on your PC only.</p>
        </section>
        <section className="br-inset">
          <KcField boss={boss} kc={view.kc[boss]} onSave={(kc) => save((p) => ({ ...p, kc: { ...p.kc, [boss]: kc } }))} />
        </section>
        <section className="br-inset">
          {notes
            ? <AddGoal notes={notes} goals={view.goals} onAdd={(goal) => save((p) => ({ ...p, goals: [...p.goals, goal] }))} />
            : <p className="muted">No Boss notes for {boss}: no Goal to pick from.</p>}
        </section>
        {saveError && <p className="gl-error br-inset" role="alert">Not saved: {saveError}</p>}
      </aside>
      <main className="gl-list">
        <section>
          <h2 className="gl-head">Item drops <span className="muted">{items.length} goal{items.length === 1 ? '' : 's'}</span></h2>
          {items.length ? items.map(row) : <p className="muted">No item Goal yet.</p>}
        </section>
        <section>
          <h2 className="gl-head">Combat achievements <span className="muted">{achievements.length} goal{achievements.length === 1 ? '' : 's'}</span></h2>
          {achievements.length ? achievements.map(row) : <p className="muted">No combat achievement Goal yet.</p>}
        </section>
      </main>
    </fieldset>
  );
}
