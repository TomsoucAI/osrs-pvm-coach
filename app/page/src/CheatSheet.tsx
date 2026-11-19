// The Cheat sheet at the top of the Briefing (ticket #77): what kills you, what to wear, what to bring.
// The look is prototype variant D's top panel (commit d976b26).
//
// Legality condition (spec #72): the Briefing never reacts to live fight state. So "Wear" asks the plan with no
// drains (never the drains that the plugin counted in a fight) and Planned boosts (never the live levels), and loads
// it once, on open: it does not follow the plugin's "changed" events.
import { useEffect, useState } from 'react';
import { DOLL } from './App';
import {
  fetchBankMode, searchMonsters, type BossNotes, type CombatStyle,
} from './api';
import { MaxHit } from './MaxHit';
import { Fact, Hitsplat } from './NotesText';
import { STATIC_CONTROLS, wearOf, type Wear } from './wear';

const STYLES: CombatStyle[] = ['melee', 'ranged', 'magic'];
/** The game's inventory: 4 × 7 slots. */
const INVENTORY_SLOTS = 28;

function Killers({ notes }: { notes: BossNotes }) {
  return (
    <ol className="cs-killers">
      {notes.killers.map((id) => {
        const m = notes.mechanics.find((x) => x.id === id)!;
        return (
          <li key={id}>
            {/* The Mechanic's id is its anchor in the scroll: the link scrolls to its row. */}
            <a href={`#${id}`}>
              <b>{m.name}</b>
              {m.missDamage && <Hitsplat value={m.missDamage} />}
              <span className="cs-do"><Fact text={m.do} /></span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The plan the Gear tab shows for this boss: the Gear tab's version and style when its URL names this boss, else the
 * boss's first version and melee (the Gear tab's own defaults).
 */
async function loadWear(boss: string): Promise<{ wear: Wear; style: CombatStyle }> {
  const query = new URLSearchParams(window.location.search);
  const sameBoss = query.get('boss')?.trim().toLowerCase() === boss.toLowerCase();
  const asked = query.get('style') as CombatStyle;
  const style = sameBoss && STYLES.includes(asked) ? asked : 'melee';
  const phase = (sameBoss ? query.get('phase') : null)
    ?? (await searchMonsters(boss).catch(() => [])).find((m) => m.name === boss)?.version ?? '';
  const fresh = await fetchBankMode({ boss, phase, style }, STATIC_CONTROLS).catch(() => null);
  return { wear: wearOf(fresh, style), style };
}

function WearPanel({ boss }: { boss: string }) {
  const [loaded, setLoaded] = useState<{ wear: Wear; style: CombatStyle } | null>(null);

  useEffect(() => {
    let current = true;
    loadWear(boss).then((l) => { if (current) setLoaded(l); });
    return () => { current = false; };
  }, [boss]);

  if (!loaded) return <p className="cs-why">Loading your setup…</p>;
  const { wear, style } = loaded;
  if (wear.kind === 'why') return <p className="cs-why">{wear.why}</p>;
  const { setup, noBank } = wear;
  return (
    <>
      <div className="cs-box cs-doll" aria-label="Equipment to wear">
        {DOLL.map((slot, i) => {
          if (slot === null) return <span key={i} />;
          const item = setup.items[slot];
          return (
            <span key={slot} className="cs-slot" title={item ? `${slot}: ${item.name} (${item.source})` : `${slot}: empty`}>
              {item && <img src={`/api/icon?id=${item.id}`} alt={item.name} onError={(e) => { e.currentTarget.hidden = true; }} />}
            </span>
          );
        })}
      </div>
      <p className="cs-gear-line">
        <span className={`style-${style}`}>{style}</span>
        <b>{setup.dps.toFixed(2)} DPS</b>
        <MaxHit value={setup.maxHit} />
      </p>
      {noBank && <p className="cs-why">No bank snapshot yet: open your bank once. Only worn and inventory items were ranked.</p>}
    </>
  );
}

function Bring({ inventory }: { inventory: BossNotes['inventory'] }) {
  const slots = Array.from({ length: INVENTORY_SLOTS }, (_, i) => inventory.items[i] ?? null);
  return (
    <>
      <div className="cs-box cs-inventory" aria-label="Inventory to bring">
        {slots.map((slot, i) => (
          <span key={i} className="cs-slot" title={slot?.item}>
            {slot && <img src={`/api/icon?id=${slot.id}`} alt={slot.item} onError={(e) => { e.currentTarget.hidden = true; }} />}
          </span>
        ))}
      </div>
      <p className="cs-why"><Fact text={inventory.note} /></p>
    </>
  );
}

export function CheatSheet({ notes }: { notes: BossNotes }) {
  return (
    <section className="cs br-inset" aria-label="Cheat sheet">
      <div className="cs-part cs-grow">
        <h2>What kills you</h2>
        <Killers notes={notes} />
      </div>
      <div className="cs-part">
        <h2>Wear · best you own</h2>
        <WearPanel boss={notes.boss} />
      </div>
      <div className="cs-part">
        <h2>Bring</h2>
        <Bring inventory={notes.inventory} />
      </div>
    </section>
  );
}
