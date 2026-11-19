// UI server (ADR-1 in spec #1): Node's built-in HTTP server for the bank-mode page.
// Read-only: the plan, a state summary, the monster search, a server-sent "changed" event, and the built page.
//
// Threat model: the Origin/Host guard protects against websites, not against local programs. A local program
// can forge both headers, and it can read state.json and bank.json from disk with no server at all.
import { watch, type FSWatcher } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import {
  findItem, searchMonsters, SLOTS, type DefenceReductions,
} from '../calc';
import {
  planBankMode, type BankModeRequest, type BoostMode, type CombatStyle, type Slot,
} from '../core/bankMode';
import { readState, type LiveState } from '../core/liveState';
import { createIconCache } from './icons';

export interface UiServerOptions {
  /** 0 = any free port. */
  port: number;
  stateFile: string;
  bankFile: string;
  /** The built page (Vite output). Static files come from this folder only. */
  pageDir: string;
  /** Where item icons are kept after the first fetch. */
  iconCacheDir: string;
  /** The wiki fetch. Tests replace it; the app uses the global `fetch`. */
  fetchIcon?: typeof fetch;
}

export interface UiServer {
  address: string;
  port: number;
  close(): Promise<void>;
}

/**
 * What the page shows next to the plan: who is logged in and what is worn.
 * The DPS of the worn setup comes from the plan's "wearing now" tier, with the plan's boosts and drains.
 */
export interface StateSummary {
  loggedIn: boolean;
  playerName: string | null;
  bankAgeMs: number | null;
  worn: Record<Slot, string | null> | null;
  /** The same slots as item ids, for the icons. */
  wornIds: Record<Slot, number | null> | null;
}

const COMBAT_STYLES: CombatStyle[] = ['melee', 'ranged', 'magic'];
const BOOST_MODES: BoostMode[] = ['planned', 'live'];
/** The drains the page can set by hand, with the MCP tool's limits. */
const DRAINS = {
  dwh: { field: 'dwhHits', max: 10 },
  elder: { field: 'elderMaulHits', max: 10 },
  bgs: { field: 'bgsDamage', max: 1000 },
} as const;
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
};
/** Windows fires 2 or 3 change events for one save. */
const CHANGE_DEBOUNCE_MS = 100;
const WATCH_RETRY_MS = 1000;
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};
// Input bounds. Node's defaults are 16 KiB of headers, 60 s for the headers, 300 s for the request,
// and no cap on connections (Node 24 `http.createServer` and `net.Server` docs). One page needs far less.
const SERVER_LIMITS = {
  maxHeaderSize: 8192, headersTimeout: 10_000, requestTimeout: 10_000, keepAliveTimeout: 5_000, connectionsCheckingInterval: 5_000,
};
const MAX_CONNECTIONS = 32;

/** An error whose message is safe to send to the page. All other errors become a plain 500. */
class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function monsterOf(query: URLSearchParams): { name: string; version?: string } | null {
  const name = query.get('monster');
  if (!name) return null;
  if (!searchMonsters(name).length) throw new HttpError(404, 'Monster not found.');
  return { name, version: query.get('version') ?? undefined };
}

/** `boosts=planned|live`. Omitted = planned, as in the MCP tool. */
function boostsOf(query: URLSearchParams): BoostMode {
  const boosts = query.get('boosts') ?? 'planned';
  if (!BOOST_MODES.includes(boosts as BoostMode)) throw new HttpError(400, 'The "boosts" parameter is planned or live.');
  return boosts as BoostMode;
}

/** `pins=weapon:4151,neck:6585`: an item id per slot (the page's ‹ › cyclers). */
function pinsOf(query: URLSearchParams): BankModeRequest['pins'] {
  const raw = query.get('pins');
  if (!raw) return undefined;
  const pins: Partial<Record<Slot, number>> = {};
  for (const pair of raw.split(',')) {
    const [slot, id, ...rest] = pair.split(':');
    if (rest.length || !SLOTS.includes(slot as Slot) || !/^\d{1,9}$/.test(id ?? '')) {
      throw new HttpError(400, 'The "pins" parameter is slot:itemId pairs, e.g. weapon:4151,neck:6585.');
    }
    pins[slot as Slot] = Number(id);
  }
  return pins;
}

/** `drains=dwh:2,elder:1,bgs:30`, or `drains=none`. Omitted = the drains that the plugin counted. A value replaces them. */
function drainsOf(query: URLSearchParams): DefenceReductions | undefined {
  const raw = query.get('drains');
  if (raw === null) return undefined;
  if (raw === 'none') return {};
  const drains: DefenceReductions = {};
  for (const pair of raw.split(',')) {
    const [name, value, ...rest] = pair.split(':');
    const drain = DRAINS[name as keyof typeof DRAINS];
    if (rest.length || !drain || !/^\d{1,4}$/.test(value ?? '') || Number(value) > drain.max) {
      throw new HttpError(400, 'The "drains" parameter is none, or name:count pairs: dwh (0-10), elder (0-10), bgs (damage, 0-1000).');
    }
    drains[drain.field] = Number(value);
  }
  return drains;
}

function summarize(state: LiveState): StateSummary {
  if (!state.loggedIn) {
    return {
      loggedIn: false, playerName: null, bankAgeMs: state.bank?.ageMs ?? null, worn: null, wornIds: null,
    };
  }
  const wornIds = Object.fromEntries(SLOTS.map((slot) => [slot, state.equipment?.[slot] ?? null])) as Record<Slot, number | null>;
  const worn = Object.fromEntries(SLOTS.map((slot) => {
    const id = state.equipment?.[slot];
    return [slot, id === null || id === undefined ? null : findItem(id)?.name ?? `Item ${id}`];
  })) as Record<Slot, string | null>;
  return {
    loggedIn: true, playerName: state.playerName ?? null, bankAgeMs: state.bank?.ageMs ?? null, worn, wornIds,
  };
}

/** The files of the built page, by URL path. A request never builds a file path: it can only pick one from this list. */
async function listPage(pageDir: string): Promise<Map<string, string>> {
  const entries = await readdir(pageDir, { recursive: true, withFileTypes: true });
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    files.set(`/${relative(pageDir, file).split(sep).join('/')}`, file);
  }
  const index = files.get('/index.html');
  if (!index) throw new Error(`No built page in ${pageDir}. Run: npm run build`);
  files.set('/', index);
  return files;
}

export async function startUiServer(options: UiServerOptions): Promise<UiServer> {
  const streams = new Set<ServerResponse>();
  const pageFiles = await listPage(options.pageDir);
  const icons = createIconCache(options.iconCacheDir, options.fetchIcon ?? fetch);
  /** Set once the server listens: `http://127.0.0.1:<port>` and `http://localhost:<port>`. */
  let ownOrigins = new Set<string>();

  // A request passes when `Host` is this server, and `Origin`, when there is one, is the same origin: scheme,
  // host and port. A browser sends no `Origin` on a same-origin GET, and none on a same-origin EventSource
  // request (Fetch standard, "append a request Origin header"), so a missing `Origin` is not refused.
  // On those requests `Host` is the guard: a DNS-rebinding page arrives with its own name in `Host`.
  const isOwnPage = (req: IncomingMessage) => {
    const own = `http://${req.headers.host}`;
    const { origin } = req.headers;
    return ownOrigins.has(own) && (origin === undefined || origin === own);
  };

  const readLiveState = async () => {
    try {
      return await readState(options.stateFile, options.bankFile);
    } catch (e) {
      console.error(e);
      throw new HttpError(503, 'No readable state. Log in with the DPS Bridge plugin on.');
    }
  };

  const sendJson = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://local');
    const query = url.searchParams;
    switch (url.pathname) {
      case '/api/plan': {
        const monster = monsterOf(query);
        if (!monster) throw new HttpError(400, 'The "monster" parameter is required.');
        const style = query.get('style') ?? undefined;
        if (style !== undefined && !COMBAT_STYLES.includes(style as CombatStyle)) {
          throw new HttpError(400, 'The "style" parameter is melee, ranged or magic.');
        }
        const request: BankModeRequest = {
          monster, style: style as CombatStyle | undefined, boosts: boostsOf(query), pins: pinsOf(query), drains: drainsOf(query),
        };
        const state = await readLiveState();
        if (!state.loggedIn) throw new HttpError(409, 'The player is logged out.');
        return sendJson(res, 200, planBankMode(state, request));
      }
      case '/api/state':
        return sendJson(res, 200, summarize(await readLiveState()));
      case '/api/monsters': {
        const q = query.get('q') ?? '';
        const hits = q.length < 2 ? [] : searchMonsters(q).slice(0, 50).map(({ name, version }) => ({ name, version }));
        return sendJson(res, 200, hits);
      }
      case '/api/icon': {
        const id = query.get('id') ?? '';
        if (!/^\d{1,9}$/.test(id)) throw new HttpError(400, 'The "id" parameter is an item id.');
        const icon = await icons.get(Number(id));
        if (!icon) throw new HttpError(404, 'No icon for this item.');
        // Icons do not change: the browser may keep them (the other replies stay no-store).
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' });
        return res.end(icon);
      }
      case '/api/events':
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (req.method === 'HEAD') return res.end();
        res.write('retry: 2000\n\n');
        streams.add(res);
        res.on('close', () => streams.delete(res));
        return undefined;
      default: {
        const file = pageFiles.get(url.pathname);
        if (!file) throw new HttpError(404, 'Not found.');
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
        return res.end(body);
      }
    }
  }

  const server = createServer(SERVER_LIMITS, (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    if (!isOwnPage(req)) return sendJson(res, 403, { error: 'Forbidden.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }
    route(req, res).catch((e: unknown) => {
      if (!(e instanceof HttpError)) console.error(e);
      if (res.headersSent) res.end();
      else if (e instanceof HttpError) sendJson(res, e.status, { error: e.message });
      else sendJson(res, 500, { error: 'Internal error.' });
    });
    return undefined;
  });
  server.maxConnections = MAX_CONNECTIONS;

  // The page gets a small "changed" event and fetches the plan again: one code path for data.
  let debounce: NodeJS.Timeout | undefined;
  const pushChanged = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      for (const stream of streams) stream.write('event: changed\ndata: {}\n\n');
    }, CHANGE_DEBOUNCE_MS);
  };
  const watched = new Set([options.stateFile, options.bankFile].map((f) => basename(f)));
  const watchers = new Set<FSWatcher>();
  const retries = new Map<string, NodeJS.Timeout>();
  // The plugin creates its folder on the first login. Until the folder exists, try again; then push once,
  // because the files can be there already.
  const watchFolder = (dir: string, isRetry: boolean) => {
    const retry = () => retries.set(dir, setTimeout(() => watchFolder(dir, true), WATCH_RETRY_MS));
    try {
      const watcher = watch(dir, (_event, filename) => {
        if (filename === null || watched.has(filename)) pushChanged();
      });
      watcher.on('error', () => {
        watcher.close();
        watchers.delete(watcher);
        retry();
      });
      watchers.add(watcher);
      if (isRetry) pushChanged();
    } catch {
      retry();
    }
  };
  for (const dir of new Set([options.stateFile, options.bankFile].map((f) => dirname(f)))) watchFolder(dir, false);

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    // The literal loopback address: never `localhost` (can resolve elsewhere), never all interfaces.
    server.listen(options.port, '127.0.0.1', () => done());
  });
  const { address, port } = server.address() as AddressInfo;
  ownOrigins = new Set(['127.0.0.1', 'localhost'].map((host) => new URL(`http://${host}:${port}`).origin));

  return {
    address,
    port,
    close: () => new Promise<void>((done) => {
      clearTimeout(debounce);
      for (const retry of retries.values()) clearTimeout(retry);
      for (const watcher of watchers) watcher.close();
      for (const stream of streams) stream.end();
      server.close(() => done());
      server.closeAllConnections();
    }),
  };
}
