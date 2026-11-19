// Bank mode page (prototype B layout): left rail = boss, phase, style, boosts, drains; centre = two paperdolls;
// right rail = DPS, tiers, thrall line.
// No inline styles: the server's Content-Security-Policy allows the page's own stylesheet only.
import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  fetchBankMode, searchMonsters, subscribe,
  type BankModePlan, type BoostMode, type CombatStyle, type Controls, type MonsterHit, type Setup, type SetupItem, type Slot,
  type StateSummary, type Tiers, type View,
} from './api';
import { addRecent, loadRecent, saveRecent } from './recentBosses';

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
const TIERS: { key: keyof Tiers; label: string; none: string }[] = [
  { key: 'bestOwned', label: 'Best owned', none: 'No setup.' },
  { key: 'upToTwoSwaps', label: '≤ 2 swaps', none: 'No setup can attack with 2 swaps or fewer.' },
  { key: 'wearingNow', label: 'Wearing now', none: 'The worn gear cannot attack with this style.' },
];
/** The drains dropdown: plan endpoint `drains` values. "counted" sends none, so the plugin's counted drains apply. */
const DRAIN_OPTIONS: { value: string; label: string }[] = [
  { value: 'counted', label: 'Counted by the plugin' },
  { value: 'none', label: 'None' },
  ...[1, 2, 3].map((n) => ({ value: `dwh:${n}`, label: `${n} DWH` })),
  ...[1, 2, 3].map((n) => ({ value: `elder:${n}`, label: `${n} Elder maul` })),
  { value: 'dwh:1,elder:1', label: 'Elder maul + DWH' },
];
const START_CONTROLS: Controls = {
  boosts: 'planned', drains: 'counted', bgsDamage: 0, pins: {},
};
/** The plan endpoint's limit for BGS damage. */
const MAX_BGS_DAMAGE = 1000;

/** Browser storage, for the recent-boss chips. Reading it can throw (blocked site data): the helper catches that. */
const browserStorage = () => window.localStorage;

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

/** ‹ › over the slot's owned items, and ↺ when the slot is pinned. `owned` comes from the plan: owned items only. */
interface Cycler { owned: SetupItem[]; pinned: boolean; onPin: (id: number) => void; onReset: () => void }

function Doll({
  names, ids, swapSlots, sources, cyclers,
}: {
  names: Record<Slot, string | null>; ids: Record<Slot, number | null>; swapSlots: Set<Slot>; sources?: Setup['items'];
  cyclers?: Record<Slot, Cycler>;
}) {
  return (
    <div className="doll">
      {DOLL.map((slot, i) => {
        if (slot === null) return <div key={i} className="slot empty" />;
        const cycler = cyclers?.[slot];
        const at = cycler ? cycler.owned.findIndex((o) => o.id === ids[slot]) : -1;
        // From an item outside the list (an empty slot), › goes to the first item and ‹ to the last.
        const step = (by: number) => {
          const { owned } = cycler!;
          const next = at === -1 ? (by > 0 ? 0 : owned.length - 1) : (at + by + owned.length) % owned.length;
          cycler!.onPin(owned[next].id);
        };
        const canCycle = !!cycler && cycler.owned.length > (at === -1 ? 0 : 1);
        return (
          <div key={slot} className={`slot ${swapSlots.has(slot) ? 'swap' : ''} ${cycler?.pinned ? 'pinned' : ''}`} data-slot={slot}>
            <span className="slot-key">{slot}</span>
            {/* The name stays under the icon, so a missing icon (404) leaves the name. */}
            {ids[slot] !== null && (
              <img key={ids[slot]} className="slot-icon" src={`/api/icon?id=${ids[slot]}`} alt="" onError={(e) => { e.currentTarget.hidden = true; }} />
            )}
            <span className="slot-name">{names[slot] ?? '—'}</span>
            {sources?.[slot] && <span className={`badge ${sources[slot].source}`}>{sources[slot].source}</span>}
            {cycler && (canCycle || cycler.pinned) && (
              <div className="cycle">
                <button type="button" className="cycle-btn" title="Previous owned item" disabled={!canCycle} onClick={() => step(-1)}>‹</button>
                {cycler.pinned && <button type="button" className="cycle-btn" title="Back to the optimizer's pick" onClick={cycler.onReset}>↺</button>}
                <button type="button" className="cycle-btn" title="Next owned item" disabled={!canCycle} onClick={() => step(1)}>›</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="tile"><div className="muted">{label}</div><div className="tile-value">{value}</div></div>;
}

export function App() {
  const [view, setView] = useState(viewFromUrl);
  const [controls, setControls] = useState(START_CONTROLS);
  const [tier, setTier] = useState<keyof Tiers>('bestOwned');
  const [recent, setRecent] = useState(() => loadRecent(browserStorage));
  // The last data read while logged in. It stays on screen, greyed, while offline.
  const [summary, setSummary] = useState<StateSummary | null>(null);
  const [plan, setPlan] = useState<BankModePlan | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [now, setNow] = useState(Date.now);
  /** Only the reply to the latest request goes on screen. */
  const latest = useRef(0);

  const show = (next: View) => {
    const query = new URLSearchParams({ boss: next.boss, phase: next.phase, style: next.style });
    window.history.replaceState(null, '', `?${query}`);
    // Pins name items of one boss and style: a new view starts from the optimizer's pick.
    if (next.boss !== view.boss || next.phase !== view.phase || next.style !== view.style) {
      setControls((c) => ({ ...c, pins: {} }));
      setTier('bestOwned');
    }
    setView(next);
  };
  const setPins = (pins: Controls['pins']) => {
    setControls((c) => ({ ...c, pins }));
    setTier('bestOwned');
  };

  const load = useCallback(async () => {
    if (!view.boss) return;
    const request = ++latest.current;
    const fresh = await fetchBankMode(view, controls).catch(() => null);
    if (request !== latest.current) return;
    setLoggedIn(fresh?.summary?.loggedIn ?? false);
    // Logged out or unreachable: keep the last known data on screen. The page greys it.
    if (!fresh?.summary?.loggedIn || !fresh.plan) return;
    setSummary(fresh.summary);
    setPlan(fresh.plan);
    setFetchedAt(Date.now());
  }, [view, controls]);

  // One event stream for the page's life: it calls the latest `load`, so a control change does not reconnect it.
  const loadLatest = useRef(load);
  loadLatest.current = load;
  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribe(
    () => loadLatest.current(),
    (open) => { setConnected(open); if (open) loadLatest.current(); },
  ), []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (view.boss) setRecent((list) => addRecent(list, { boss: view.boss, phase: view.phase }));
  }, [view.boss, view.phase]);
  useEffect(() => saveRecent(browserStorage, recent), [recent]);

  const live = connected && loggedIn;
  const sameView = plan !== null && plan.monster.name === view.boss && plan.monster.version === view.phase;
  const stylePlan = sameView ? plan.styles[view.style] : undefined;
  const ranked = stylePlan && 'setups' in stylePlan ? stylePlan : null;
  const tierInfo = TIERS.find((t) => t.key === tier)!;
  const shown = ranked?.tiers[tier] ?? null;
  const swapSlots = new Set(shown?.swaps.map((s) => s.slot));
  // "Now" comes from the plan, so it has the same boosts and drains as the setups it is compared with.
  const dpsNow = ranked?.tiers.wearingNow ?? null;
  const shownNames = shown && Object.fromEntries(SLOTS.map((s) => [s, shown.items[s]?.name ?? null])) as Record<Slot, string | null>;
  const shownIds = shown && Object.fromEntries(SLOTS.map((s) => [s, shown.items[s]?.id ?? null])) as Record<Slot, number | null>;
  const hasPins = Object.keys(controls.pins).length > 0;
  // Cyclers change the best-owned setup only: the other tiers are fixed answers.
  const cyclers = ranked && tier === 'bestOwned'
    ? Object.fromEntries(SLOTS.map((slot) => [slot, {
      owned: ranked.owned[slot],
      pinned: controls.pins[slot] !== undefined,
      onPin: (id: number) => setPins({ ...controls.pins, [slot]: id }),
      onReset: () => {
        const { [slot]: _reset, ...rest } = controls.pins;
        setPins(rest);
      },
    }])) as Record<Slot, Cycler>
    : undefined;
  const { base, effective } = plan?.defence ?? { base: 0, effective: 0 };

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
          {recent.length > 0 && (
            <div className="chips" data-testid="recent-bosses">
              {recent.map((r) => (
                <button
                  key={r.boss}
                  type="button"
                  className={`btn chip-btn ${r.boss === view.boss ? 'on' : ''}`}
                  onClick={() => show({ ...view, boss: r.boss, phase: r.phase })}
                >
                  {r.boss}{r.phase ? ` · ${r.phase}` : ''}
                </button>
              ))}
            </div>
          )}
          <div className="field">
            <span className="muted">Style</span>
            <div className="segmented">
              {STYLES.map((s) => (
                <button key={s} type="button" className={`btn ${s === view.style ? 'on' : ''}`} onClick={() => show({ ...view, style: s })}>{s}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="muted">Boosts</span>
            <div className="segmented" data-testid="boosts">
              {(['planned', 'live'] as BoostMode[]).map((b) => (
                <button key={b} type="button" className={`btn ${b === controls.boosts ? 'on' : ''}`} onClick={() => setControls({ ...controls, boosts: b })}>{b}</button>
              ))}
            </div>
            {ranked?.assumed && (
              <span className="muted note">
                Assumed: {[...ranked.assumed.prayers, ...ranked.assumed.potions.map((p) => `${p.name} (${p.doses} doses owned)`)].join(' · ') || 'nothing owned helps'}
              </span>
            )}
            {controls.boosts === 'live' && <span className="muted note">Your levels and prayers as they are now.</span>}
          </div>
          <label className="field">
            <span className="muted">Defence drains</span>
            <select value={controls.drains} onChange={(e) => setControls({ ...controls, drains: e.target.value })} data-testid="drains">
              {DRAIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="muted">BGS damage</span>
            <input
              type="number"
              min={0}
              max={MAX_BGS_DAMAGE}
              step={1}
              value={controls.bgsDamage}
              data-testid="bgs"
              onChange={(e) => {
                const damage = Math.min(MAX_BGS_DAMAGE, Math.max(0, Math.trunc(Number(e.target.value) || 0)));
                setControls({ ...controls, bgsDamage: damage });
              }}
            />
            {controls.drains === 'counted' && controls.bgsDamage > 0 && (
              <span className="muted note">A manual drain replaces the counted drains.</span>
            )}
            {sameView && (
              <span className="muted note" data-testid="defence">
                Defence {base}
                {effective !== base ? ` → ${effective} (−${Math.round((1 - effective / base) * 100)}%)` : ' (no drain)'}
              </span>
            )}
          </label>
        </aside>

        <main className="data">
          {!view.boss && <div className="panel muted">Search a boss on the left to start.</div>}
          {view.boss && !sameView && <div className="panel muted">{live ? 'Loading…' : 'Offline: no data for this boss yet. Log in with the DPS Bridge plugin on.'}</div>}
          {sameView && summary?.worn && summary.wornIds && (
            <>
              <div className="dolls">
                <section className="panel">
                  <h2>Wearing now{dpsNow ? ` · ${dpsNow.dps.toFixed(2)} DPS` : ''}</h2>
                  <Doll names={summary.worn} ids={summary.wornIds} swapSlots={swapSlots} />
                </section>
                <div className="arrow">
                  <div className="big gold">→</div>
                  <div data-testid="swap-count">{shown ? `${swapSlots.size} swap${swapSlots.size === 1 ? '' : 's'}` : ''}</div>
                </div>
                <section className="panel">
                  <h2>
                    {tierInfo.label}{shown ? ` · ${shown.dps.toFixed(2)} DPS` : ''}
                    {hasPins && <button type="button" className="btn reset-pins" onClick={() => setPins({})}>↺ all</button>}
                  </h2>
                  {shown && shownNames && shownIds
                    ? <Doll names={shownNames} ids={shownIds} swapSlots={swapSlots} sources={shown.items} cyclers={cyclers} />
                    : <div className="bad">{stylePlan && 'unavailable' in stylePlan ? stylePlan.unavailable : tierInfo.none}</div>}
                </section>
              </div>

              {shown && (
                <section className="panel">
                  <h2>Setup · {shown.style}{shown.spell ? ` · ${shown.spell}` : ''}</h2>
                  <table>
                    <thead><tr><th>Slot</th><th>Wearing now</th><th /><th>{tierInfo.label}</th><th>Where</th></tr></thead>
                    <tbody>
                      {SLOTS.map((slot) => (
                        <tr key={slot} className={swapSlots.has(slot) ? 'swap-row' : ''}>
                          <td className="muted">{slot}</td>
                          <td>{summary.worn![slot] ?? '—'}</td>
                          <td>{swapSlots.has(slot) ? '→' : '✓'}</td>
                          <td>{shown.items[slot]?.name ?? '—'}{controls.pins[slot] !== undefined && tier === 'bestOwned' ? ' (pinned)' : ''}</td>
                          <td className="muted">{shown.items[slot]?.source ?? ''}</td>
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
            <span className="big gold">{shown ? shown.dps.toFixed(2) : '—'}</span>
          </div>
          <div className="muted">now → {tierInfo.label.toLowerCase()}</div>
          {ranked && !dpsNow && <p className="muted note">Now: the worn gear cannot attack with {view.style}.</p>}
          {shown && dpsNow && (
            <div className={swapSlots.size ? 'gold' : 'good'}>
              {swapSlots.size ? `${shown.dps >= dpsNow.dps ? '+' : ''}${(shown.dps - dpsNow.dps).toFixed(2)} DPS after the swaps` : 'Setup complete ✓'}
            </div>
          )}
          <div className="tiles">
            <Tile label="Max hit" value={shown ? String(shown.maxHit) : '—'} />
            <Tile label="Accuracy" value={shown ? `${shown.accuracyPct.toFixed(1)}%` : '—'} />
            <Tile label="Time to kill" value={shown?.avgTtkSeconds != null ? `${shown.avgTtkSeconds.toFixed(0)} s` : '—'} />
          </div>
          {sameView && plan.thrall && (
            <p className="thrall" data-testid="thrall">
              + {plan.thrall.name} <b className="good">+{plan.thrall.dps.toFixed(2)} DPS</b>
              <span className="muted"> · on top, not in the numbers above</span>
            </p>
          )}
          {ranked && (
            <div className="tier-cards" data-testid="tiers">
              {TIERS.map((t) => {
                const setup = ranked.tiers[t.key];
                return (
                  <button key={t.key} type="button" className={`tier-card ${t.key === tier ? 'on' : ''}`} onClick={() => setTier(t.key)}>
                    <span className="tier-label">{t.label}</span>
                    <span className="tier-dps">{setup ? setup.dps.toFixed(2) : '—'}</span>
                    <span className="muted">{setup ? `${setup.swaps.length} swap${setup.swaps.length === 1 ? '' : 's'}` : 'no setup'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
