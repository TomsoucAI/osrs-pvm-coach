// The one app shell: every tab renders inside this window, so the title and the three tabs never move.
// The tab lives in the URL (`?tab=briefing`). No `tab` is Gear, so the bank-mode links of #9 keep working.
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { App as Gear } from './App';
import { Briefing } from './Briefing';
import { Goals } from './Goals';

type Tab = 'gear' | 'briefing' | 'goals';

const TABS: { key: Tab; label: string }[] = [
  { key: 'gear', label: 'Gear' },
  { key: 'briefing', label: 'Briefing' },
  { key: 'goals', label: 'Goals' },
];

function tabFromUrl(): Tab {
  const tab = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((t) => t.key === tab) ? tab as Tab : 'gear';
}

/** The tab's URL keeps the other parameters (the Gear view), so a tab change and back loses nothing. */
function tabHref(tab: Tab): string {
  const query = new URLSearchParams(window.location.search);
  if (tab === 'gear') query.delete('tab');
  else query.set('tab', tab);
  const search = query.toString();
  return search ? `?${search}` : window.location.pathname;
}

export function Shell() {
  const [tab, setTab] = useState(tabFromUrl);

  // Back and forward move between tabs too.
  useEffect(() => {
    const onPop = () => setTab(tabFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // A plain click changes the tab in place; a middle click or Ctrl+click opens the link in a new browser tab.
  const go = (e: MouseEvent<HTMLAnchorElement>, next: Tab) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (next !== tab) window.history.pushState(null, '', tabHref(next));
    setTab(next);
  };

  let body: ReactNode;
  if (tab === 'gear') body = <Gear />;
  else if (tab === 'briefing') body = <Briefing />;
  else body = <Goals />;

  return (
    <div className="shell">
      <header className="shell-title">
        <h1>PvM Coach</h1>
        <nav className="shell-tabs" aria-label="Sections">
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <a
                key={t.key}
                className={`shell-tab ${on ? 'on' : ''}`}
                href={tabHref(t.key)}
                aria-current={on ? 'page' : undefined}
                onClick={(e) => go(e, t.key)}
              >
                {t.label}
              </a>
            );
          })}
        </nav>
      </header>
      <div className="shell-body">{body}</div>
      <footer className="shell-foot">
        Game fonts, hitsplat sprites and item icons © Jagex Ltd. Icons and sprites from the <a href="https://oldschool.runescape.wiki/" rel="noreferrer" target="_blank">Old School RuneScape Wiki</a>.
        A fan project, not affiliated with or endorsed by Jagex.
      </footer>
    </div>
  );
}
