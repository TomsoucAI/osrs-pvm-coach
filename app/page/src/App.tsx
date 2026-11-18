// Bank mode page (prototype B layout): left rail = boss, phase, style; centre = two paperdolls; right rail = DPS.
// No inline styles: the server's Content-Security-Policy allows the page's own stylesheet only.
import { useCallback, useEffect, useState } from 'react';
import {
  fetchBankMode, searchMonsters, subscribe,
  type BankModePlan, type CombatStyle, type MonsterHit, type Setup, type Slot, type StateSummary, type View,
} from './api';

const STYLES: CombatStyle[] = ['melee', 'ranged', 'magic'];
const SLOTS: Slot[] = ['head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'];
/** The in-game equipment layout, row by row. */
const DOLL: (Slot | null)[] = [
  null, 'head', null,
  'cape', 'neck', 'ammo',
  'weapon', 'body', 'shield',
  null, 'legs', null,
  'hands', 'feet', 'ring',
];

function viewFromUrl(): View {
  const query = new URLSearchParams(window.location.search);
  const style = query.get('style') as CombatStyle;
  return { boss: query.get('boss') ?? '', phase: query.get('phase') ?? '', style: STYLES.includes(style) ? style : 'melee' };
}

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

function BossPicker({ view, onPick }: { view: View; onPick: (boss: string, phase: string) => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MonsterHit[]>([]);
  const [phases, setPhases] = useState<string[]>([]);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      const found = await searchMonsters(query);
      if (current) setHits(found);
    }, 150);
    return () => { current = false; clearTimeout(timer); };
  }, [query]);

  useEffect(() => {
    let current = true;
    if (view.boss) {
      searchMonsters(view.boss).then((found) => {
        if (current) setPhases(found.filter((m) => m.name === view.boss).map((m) => m.version));
      });
    }
    return () => { current = false; };
  }, [view.boss]);

  const names = [...new Set(hits.map((m) => m.name))].slice(0, 12);
  const pick = (name: string) => {
    onPick(name, hits.find((m) => m.name === name)?.version ?? '');
    setQuery('');
  };
  return (
    <>
      <label className="field">
        <span className="muted">Boss</span>
        <input type="search" placeholder="Search a boss…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {names.length > 0 && (
        <ul className="hits">
          {names.map((name) => <li key={name}><button type="button" className="btn" onClick={() => pick(name)}>{name}</button></li>)}
        </ul>
      )}
      {view.boss && <div className="picked">{view.boss}</div>}
      {phases.some((p) => p) && (
        <label className="field">
          <span className="muted">Phase</span>
          <select value={view.phase} onChange={(e) => onPick(view.boss, e.target.value)}>
            {phases.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      )}
    </>
  );
}

function Doll({ names, swapSlots, sources }: {
  names: Record<Slot, string | null>; swapSlots: Set<Slot>; sources?: Setup['items'];
}) {
  return (
    <div className="doll">
      {DOLL.map((slot, i) => (slot === null
        ? <div key={i} className="slot empty" />
        : (
          <div key={slot} className={`slot ${swapSlots.has(slot) ? 'swap' : ''}`} data-slot={slot}>
            <span className="slot-key">{slot}</span>
            <span className="slot-name">{names[slot] ?? '—'}</span>
            {sources?.[slot] && <span className={`badge ${sources[slot].source}`}>{sources[slot].source}</span>}
          </div>
        )))}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="tile"><div className="muted">{label}</div><div className="tile-value">{value}</div></div>;
}

export function App() {
  const [view, setView] = useState(viewFromUrl);
  // The last data read while logged in. It stays on screen, greyed, while offline.
  const [summary, setSummary] = useState<StateSummary | null>(null);
  const [plan, setPlan] = useState<BankModePlan | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [now, setNow] = useState(Date.now);

  const show = (next: View) => {
    const query = new URLSearchParams({ boss: next.boss, phase: next.phase, style: next.style });
    window.history.replaceState(null, '', `?${query}`);
    setView(next);
  };

  const load = useCallback(async () => {
    if (!view.boss) return;
    const fresh = await fetchBankMode(view).catch(() => null);
    setLoggedIn(fresh?.summary?.loggedIn ?? false);
    // Logged out or unreachable: keep the last known data on screen. The page greys it.
    if (!fresh?.summary?.loggedIn || !fresh.plan) return;
    setSummary(fresh.summary);
    setPlan(fresh.plan);
    setFetchedAt(Date.now());
  }, [view]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribe(load, (open) => { setConnected(open); if (open) load(); }), [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const live = connected && loggedIn;
  const sameView = plan !== null && plan.monster.name === view.boss && plan.monster.version === view.phase;
  const stylePlan = sameView ? plan.styles[view.style] : undefined;
  const best = stylePlan && 'setups' in stylePlan ? stylePlan.setups[0] : null;
  const swapSlots = new Set(best?.swaps.map((s) => s.slot));
  const dpsNow = summary?.now && 'dps' in summary.now ? summary.now : null;
  const bestNames = best && Object.fromEntries(SLOTS.map((s) => [s, best.items[s]?.name ?? null])) as Record<Slot, string | null>;

  return (
    <div className={`page ${live ? '' : 'offline'}`}>
      <header className="status">
        <h1>Bank mode</h1>
        <span className="grow" />
        {summary?.playerName && <span className="muted">{summary.playerName}</span>}
        <span className={`chip ${live ? 'live' : ''}`} data-testid="live-chip">{live ? '● live' : '○ offline'}</span>
        <span className="chip" data-testid="bank-chip">
          {plan?.bankAgeMs == null ? 'no bank snapshot' : `bank seen ${formatAge(plan.bankAgeMs + (now - fetchedAt))}`}
        </span>
      </header>

      <div className="columns">
        <aside className="panel rail">
          <BossPicker view={view} onPick={(boss, phase) => show({ ...view, boss, phase })} />
          <div className="field">
            <span className="muted">Style</span>
            <div className="segmented">
              {STYLES.map((s) => (
                <button key={s} type="button" className={`btn ${s === view.style ? 'on' : ''}`} onClick={() => show({ ...view, style: s })}>{s}</button>
              ))}
            </div>
          </div>
        </aside>

        <main className="data">
          {!view.boss && <div className="panel muted">Search a boss on the left to start.</div>}
          {view.boss && !sameView && <div className="panel muted">{live ? 'Loading…' : 'Offline: no data for this boss yet. Log in with the DPS Bridge plugin on.'}</div>}
          {sameView && summary?.worn && (
            <>
              <div className="dolls">
                <section className="panel">
                  <h2>Wearing now{dpsNow ? ` · ${dpsNow.dps.toFixed(2)} DPS` : ''}</h2>
                  <Doll names={summary.worn} swapSlots={swapSlots} />
                </section>
                <div className="arrow">
                  <div className="big gold">→</div>
                  <div data-testid="swap-count">{best ? `${swapSlots.size} swap${swapSlots.size === 1 ? '' : 's'}` : ''}</div>
                </div>
                <section className="panel">
                  <h2>Best you own{best ? ` · ${best.dps.toFixed(2)} DPS` : ''}</h2>
                  {best && bestNames
                    ? <Doll names={bestNames} swapSlots={swapSlots} sources={best.items} />
                    : <div className="bad">{stylePlan && 'unavailable' in stylePlan ? stylePlan.unavailable : 'No setup.'}</div>}
                </section>
              </div>

              {best && (
                <section className="panel">
                  <h2>Setup · {best.style}{best.spell ? ` · ${best.spell}` : ''}</h2>
                  <table>
                    <thead><tr><th>Slot</th><th>Wearing now</th><th /><th>Best you own</th><th>Where</th></tr></thead>
                    <tbody>
                      {SLOTS.map((slot) => (
                        <tr key={slot} className={swapSlots.has(slot) ? 'swap-row' : ''}>
                          <td className="muted">{slot}</td>
                          <td>{summary.worn![slot] ?? '—'}</td>
                          <td>{swapSlots.has(slot) ? '→' : '✓'}</td>
                          <td>{best.items[slot]?.name ?? '—'}</td>
                          <td className="muted">{best.items[slot]?.source ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {plan.notes.map((note) => <p key={note} className="muted note">{note}</p>)}
                </section>
              )}
            </>
          )}
        </main>

        <aside className="panel rail data">
          <h2>DPS{view.boss ? ` vs ${view.boss}${view.phase ? ` (${view.phase})` : ''}` : ''}</h2>
          <div className="hero" data-testid="hero">
            <span className="big">{dpsNow ? dpsNow.dps.toFixed(2) : '—'}</span>
            <span className="muted"> → </span>
            <span className="big gold">{best ? best.dps.toFixed(2) : '—'}</span>
          </div>
          <div className="muted">now → best you own</div>
          {summary?.now && 'unavailable' in summary.now && sameView && <p className="muted note">Now: {summary.now.unavailable}</p>}
          {best && dpsNow && (
            <div className={swapSlots.size ? 'gold' : 'good'}>
              {swapSlots.size ? `+${(best.dps - dpsNow.dps).toFixed(2)} DPS after the swaps` : 'Setup complete ✓'}
            </div>
          )}
          <div className="tiles">
            <Tile label="Max hit" value={best ? String(best.maxHit) : '—'} />
            <Tile label="Accuracy" value={best ? `${best.accuracyPct.toFixed(1)}%` : '—'} />
            <Tile label="Time to kill" value={best?.avgTtkSeconds != null ? `${best.avgTtkSeconds.toFixed(0)} s` : '—'} />
          </div>
        </aside>
      </div>
    </div>
  );
}
