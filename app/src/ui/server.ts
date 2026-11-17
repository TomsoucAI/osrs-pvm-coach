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
  buildPlayer, calculate, findItem, resolveMonster, searchMonsters, SLOTS,
} from '../calc';
import { planBankMode, type CombatStyle, type Slot } from '../core/bankMode';
import { readState, type LiveState } from '../core/liveState';
import { phaseUnavailable } from '../core/phaseRules';

export interface UiServerOptions {
  /** 0 = any free port. */
  port: number;
  stateFile: string;
  bankFile: string;
  /** The built page (Vite output). Static files come from this folder only. */
  pageDir: string;
}

export interface UiServer {
  address: string;
  port: number;
  close(): Promise<void>;
}

/** What the page shows next to the plan: who is logged in, what is worn, and the DPS of the worn setup. */
export interface StateSummary {
  loggedIn: boolean;
  playerName: string | null;
  bankAgeMs: number | null;
  worn: Record<Slot, string | null> | null;
  /** Null when the request names no monster, or when the player is logged out. */
  now: { dps: number; maxHit: number; accuracyPct: number; avgTtkSeconds: number | null } | { unavailable: string } | null;
}

const COMBAT_STYLES: CombatStyle[] = ['melee', 'ranged', 'magic'];
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
/** Windows fires 2 or 3 change events for one save. */
const CHANGE_DEBOUNCE_MS = 100;
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

function summarize(state: LiveState, monsterQuery: { name: string; version?: string } | null): StateSummary {
  if (!state.loggedIn) {
    return {
      loggedIn: false, playerName: null, bankAgeMs: state.bank?.ageMs ?? null, worn: null, now: null,
    };
  }
  const worn = Object.fromEntries(SLOTS.map((slot) => {
    const id = state.equipment?.[slot];
    return [slot, id === null || id === undefined ? null : findItem(id)?.name ?? `Item ${id}`];
  })) as Record<Slot, string | null>;

  let now: StateSummary['now'] = null;
  if (monsterQuery) {
    const monster = resolveMonster(monsterQuery);
    const { player } = buildPlayer(state, monster);
    const type = player.style?.type;
    const unavailable = phaseUnavailable(monster, type === 'magic' || type === 'ranged' ? type : 'melee');
    if (unavailable) now = { unavailable };
    else {
      const {
        dps, maxHit, accuracyPct, avgTtkSeconds,
      } = calculate(player, monster);
      now = {
        dps, maxHit, accuracyPct, avgTtkSeconds,
      };
    }
  }
  return {
    loggedIn: true, playerName: state.playerName ?? null, bankAgeMs: state.bank?.ageMs ?? null, worn, now,
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
        const state = await readLiveState();
        if (!state.loggedIn) throw new HttpError(409, 'The player is logged out.');
        return sendJson(res, 200, planBankMode(state, { monster, style: style as CombatStyle | undefined }));
      }
      case '/api/state':
        return sendJson(res, 200, summarize(await readLiveState(), monsterOf(query)));
      case '/api/monsters': {
        const q = query.get('q') ?? '';
        const hits = q.length < 2 ? [] : searchMonsters(q).slice(0, 50).map(({ name, version }) => ({ name, version }));
        return sendJson(res, 200, hits);
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
  const watched = new Set([options.stateFile, options.bankFile].map((f) => basename(f)));
  const watchers: FSWatcher[] = [...new Set([options.stateFile, options.bankFile].map((f) => dirname(f)))].map((dir) => (
    watch(dir, (_event, filename) => {
      if (filename !== null && !watched.has(filename)) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        for (const stream of streams) stream.write('event: changed\ndata: {}\n\n');
      }, CHANGE_DEBOUNCE_MS);
    })
  ));

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
      for (const watcher of watchers) watcher.close();
      for (const stream of streams) stream.end();
      server.close(() => done());
      server.closeAllConnections();
    }),
  };
}
