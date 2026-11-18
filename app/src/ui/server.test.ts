// Seam 2 (UI server): real HTTP against a server on fixture files.
// Run with: npm run build && node --test dist/ui.test.js
import { strict as assert } from 'node:assert';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request, type IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { planBankMode } from '../core/bankMode';
import { readState } from '../core/liveState';
import { startUiServer, type UiServer } from './server';

const PAGE_HTML = '<!doctype html><title>Bank mode</title>';
let dir: string;
let server: UiServer;
let loggedOut: UiServer;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ui-server-test-'));
  await cp(resolve('fixtures', 'ironman-v2'), join(dir, 'fixture'), { recursive: true });
  await cp(resolve('fixtures', 'logged-out'), join(dir, 'logged-out'), { recursive: true });
  await writeFile(join(dir, 'index.html'), PAGE_HTML);
  await writeFile(join(dir, 'secret.txt'), 'outside the page folder');
  const page = join(dir, 'page');
  await cp(join(dir, 'index.html'), join(page, 'index.html'));
  server = await startUiServer({
    port: 0, stateFile: join(dir, 'fixture', 'state.json'), bankFile: join(dir, 'fixture', 'bank.json'), pageDir: page, iconCacheDir: join(dir, 'icons'),
  });
  loggedOut = await startUiServer({
    port: 0, stateFile: join(dir, 'logged-out', 'state.json'), bankFile: join(dir, 'logged-out', 'bank.json'), pageDir: page, iconCacheDir: join(dir, 'icons'),
  });
});

after(async () => {
  await server.close();
  await loggedOut.close();
  await rm(dir, { recursive: true, force: true });
});

interface Reply { status: number; headers: IncomingHttpHeaders; body: string }

/** One raw request. `Host` defaults to the server's own; a test can replace it or add `Origin`. */
function send(path: string, opts: { method?: string; headers?: Record<string, string>; on?: UiServer } = {}): Promise<Reply> {
  const { port } = opts.on ?? server;
  return new Promise((done, fail) => {
    const req = request({
      host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers: { Host: `127.0.0.1:${port}`, ...opts.headers },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

const PLAN = '/api/plan?monster=Maggot%20King&version=Far';

test('the plan endpoint returns the core plan', async () => {
  const state = await readState(join(dir, 'fixture', 'state.json'), join(dir, 'fixture', 'bank.json'));
  const { bankAgeMs: _coreAge, ...core } = planBankMode(state, { monster: { name: 'Maggot King', version: 'Far' } });

  const reply = await send(PLAN);

  assert.equal(reply.status, 200);
  const { bankAgeMs, ...served } = JSON.parse(reply.body);
  assert.deepEqual(served, JSON.parse(JSON.stringify(core)));
  assert.equal(typeof bankAgeMs, 'number');
});

test('the plan endpoint takes one style', async () => {
  const reply = await send(`${PLAN}&style=ranged`);

  assert.deepEqual(Object.keys(JSON.parse(reply.body).styles), ['ranged']);
});

test('the state summary names the worn items and gives the DPS now against the monster', async () => {
  const reply = await send('/api/state?monster=Maggot%20King&version=Nearby');

  assert.equal(reply.status, 200);
  const summary = JSON.parse(reply.body);
  assert.equal(summary.loggedIn, true);
  assert.equal(summary.playerName, 'FixtureIron');
  assert.equal(summary.worn.weapon, 'Abyssal whip');
  assert.equal(summary.worn.ammo, null);
  assert.ok(summary.now.dps > 0, `expected a DPS, got ${reply.body}`);
  assert.equal(typeof summary.bankAgeMs, 'number');
});

test('the state summary gives no DPS now when the worn style cannot reach the phase', async () => {
  const summary = JSON.parse((await send('/api/state?monster=Maggot%20King&version=Far')).body);

  assert.match(summary.now.unavailable, /Melee cannot reach/);
});

test('a logged-out state reads as offline, and the plan endpoint answers 409', async () => {
  const summary = await send('/api/state', { on: loggedOut });
  const plan = await send(PLAN, { on: loggedOut });

  assert.equal(JSON.parse(summary.body).loggedIn, false);
  assert.equal(plan.status, 409);
});

test('the monster search returns name and version', async () => {
  const hits = JSON.parse((await send('/api/monsters?q=maggot%20king')).body) as { name: string; version: string }[];

  const versions = hits.filter((m) => m.name === 'Maggot King').map((m) => m.version);
  assert.ok(versions.includes('Far') && versions.includes('Nearby'), `got ${JSON.stringify(hits)}`);
});

/** Opens the event stream, runs `change`, and gives what the stream sent up to the first "changed" event. */
function eventsAfter(change: () => Promise<unknown>, on: UiServer = server): Promise<string> {
  return new Promise<string>((done, fail) => {
    const req = request({ host: '127.0.0.1', port: on.port, path: '/api/events' }, (res) => {
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['content-type'], 'text/event-stream');
      let seen = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        seen += chunk;
        if (seen.includes('event: changed')) {
          req.destroy();
          done(seen);
        }
      });
      change().catch(fail);
    });
    req.on('error', fail);
    req.end();
  });
}

test('a change to the state file pushes a "changed" event', async () => {
  const stateFile = join(dir, 'fixture', 'state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  // As the plugin does on a gear swap.
  state.equipment.weapon = 4587;

  const events = await eventsAfter(() => writeFile(stateFile, JSON.stringify(state)));

  assert.match(events, /event: changed\ndata: \{\}\n\n/);
});

test('a change to the bank file pushes a "changed" event', async () => {
  const bankFile = join(dir, 'fixture', 'bank.json');
  const bank = JSON.parse(await readFile(bankFile, 'utf8'));
  bank.timestamp += 1;

  const events = await eventsAfter(() => writeFile(bankFile, JSON.stringify(bank)));

  assert.match(events, /event: changed/);
});

test('with no plugin folder yet, the server starts, answers 503, and pushes once the plugin writes its files', async () => {
  const folder = join(dir, 'not-yet');
  const early = await startUiServer({
    port: 0, stateFile: join(folder, 'state.json'), bankFile: join(folder, 'bank.json'), pageDir: join(dir, 'page'), iconCacheDir: join(dir, 'icons'),
  });
  try {
    const reply = await send('/api/state', { on: early });
    assert.equal(reply.status, 503);
    assert.equal(typeof JSON.parse(reply.body).error, 'string');
    assert.ok(!reply.body.includes('not-yet') && !reply.body.includes('    at '), reply.body);

    const events = await eventsAfter(() => cp(join(dir, 'fixture'), folder, { recursive: true }), early);

    assert.match(events, /event: changed/);
    assert.equal((await send('/api/state', { on: early })).status, 200);
  } finally {
    await early.close();
  }
});

test('a foreign request with a write method gets 403, like any foreign request', async () => {
  for (const method of ['POST', 'OPTIONS']) {
    const reply = await send('/api/state', { method, headers: { Host: `evil.example:${server.port}` } });
    assert.equal(reply.status, 403, method);
  }
});

test('a foreign Origin gets 403', async () => {
  const reply = await send(PLAN, { headers: { Origin: 'https://evil.example' } });

  assert.equal(reply.status, 403);
});

test('a foreign Host with no Origin gets 403 (DNS rebinding)', async () => {
  const reply = await send(PLAN, { headers: { Host: `evil.example:${server.port}` } });

  assert.equal(reply.status, 403);
  assert.ok(!reply.body.includes('Maggot'), 'no data in a refused reply');
});

test('an Origin with the right host and another port gets 403', async () => {
  const reply = await send(PLAN, { headers: { Origin: `http://127.0.0.1:${server.port + 1}` } });

  assert.equal(reply.status, 403);
});

test('an Origin with another scheme, or the other loopback name, gets 403', async () => {
  for (const origin of [`https://127.0.0.1:${server.port}`, `http://localhost:${server.port}`, 'null']) {
    assert.equal((await send(PLAN, { headers: { Origin: origin } })).status, 403, origin);
  }
});

test('the page origin itself is accepted, by 127.0.0.1 and by localhost', async () => {
  for (const host of [`127.0.0.1:${server.port}`, `localhost:${server.port}`]) {
    const reply = await send('/api/state', { headers: { Host: host, Origin: `http://${host}` } });
    assert.equal(reply.status, 200, host);
  }
});

test('only GET and HEAD are accepted', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
    const reply = await send('/api/state', { method });
    assert.equal(reply.status, 405, method);
    assert.equal(reply.headers.allow, 'GET, HEAD');
  }
  assert.equal((await send('/api/state', { method: 'HEAD' })).status, 200);
});

test('static files come from the page folder only', async () => {
  const index = await send('/');
  assert.equal(index.status, 200);
  assert.equal(index.body, PAGE_HTML);

  for (const path of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/..\\secret.txt', '/../../.runelite/jagex-accounts.dat']) {
    const reply = await send(path);
    assert.ok(reply.status === 403 || reply.status === 404, `${path} -> ${reply.status}`);
    assert.ok(!reply.body.includes('outside the page folder'), path);
  }
});

test('every reply carries the security headers and no CORS header', async () => {
  const replies = [
    await send('/'),
    await send(PLAN),
    await send('/nope'),
    await send(PLAN, { headers: { Origin: 'https://evil.example' } }),
    await send('/api/state', { method: 'POST' }),
  ];
  for (const reply of replies) {
    assert.equal(reply.headers['content-security-policy'], "default-src 'self'; frame-ancestors 'none'");
    assert.equal(reply.headers['x-content-type-options'], 'nosniff');
    assert.equal(reply.headers['referrer-policy'], 'no-referrer');
    assert.equal(reply.headers['access-control-allow-origin'], undefined);
  }
});

test('the data endpoints are never cached', async () => {
  for (const path of [PLAN, '/api/state', '/api/monsters?q=maggot']) {
    assert.equal((await send(path)).headers['cache-control'], 'no-store', path);
  }
});

test('an error reply has no stack trace and no file path', async () => {
  const replies = [
    await send('/api/plan?monster=No%20Such%20Monster%20Xyz'),
    await send('/api/plan'),
    await send(`${PLAN}&style=fists`),
    await send(PLAN, { on: loggedOut }),
  ];
  for (const reply of replies) {
    assert.ok(reply.status >= 400 && reply.status < 500, `status ${reply.status}`);
    assert.equal(typeof JSON.parse(reply.body).error, 'string');
    assert.ok(!/\bat \w|[\\/]fixture|[A-Z]:\\|\.json|\.ts/.test(reply.body), reply.body);
  }
});

// Item icons (ticket #10): the wiki fetch is the external boundary, so a fake replaces it.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake icon')]);
const WHIP = 4151;

interface WikiCall { url: string; headers: Record<string, string> }

/** A fake wiki: answers each URL from `files`, records each call, and fails like a lost network when `offline`. */
function fakeWiki(files: Record<string, { status?: number; type?: string; body: Buffer }>, opts: { offline?: boolean } = {}) {
  const calls: WikiCall[] = [];
  const fetchIcon = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    if (opts.offline) throw new TypeError('fetch failed');
    const file = files[String(input)];
    if (!file) return new Response('no such file', { status: 404 });
    return new Response(new Uint8Array(file.body), { status: file.status ?? 200, headers: { 'Content-Type': file.type ?? 'image/png' } });
  }) as typeof fetch;
  return { calls, fetchIcon };
}

const WHIP_URL = 'https://oldschool.runescape.wiki/images/Abyssal_whip.png';

async function iconServer(cacheDir: string, fetchIcon: typeof fetch) {
  return startUiServer({
    port: 0,
    stateFile: join(dir, 'fixture', 'state.json'),
    bankFile: join(dir, 'fixture', 'bank.json'),
    pageDir: join(dir, 'page'),
    iconCacheDir: cacheDir,
    fetchIcon,
  });
}

/** One raw request that keeps the body as bytes. */
function sendBytes(path: string, on: UiServer): Promise<{ status: number; type: string | undefined; body: Buffer }> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: on.port, path, headers: { Host: `127.0.0.1:${on.port}` } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done({ status: res.statusCode ?? 0, type: res.headers['content-type'], body: Buffer.concat(chunks) }));
    });
    req.on('error', fail);
    req.end();
  });
}

test('an icon is fetched from the wiki on first use, then served from the cache with no second fetch', async () => {
  const wiki = fakeWiki({ [WHIP_URL]: { body: PNG } });
  const icons = await iconServer(join(dir, 'icons-first-use'), wiki.fetchIcon);
  try {
    const first = await sendBytes(`/api/icon?id=${WHIP}`, icons);
    const second = await sendBytes(`/api/icon?id=${WHIP}`, icons);

    assert.equal(first.status, 200);
    assert.equal(first.type, 'image/png');
    assert.deepEqual(first.body, PNG);
    assert.deepEqual(second.body, PNG);
    assert.deepEqual(wiki.calls.map((c) => c.url), [WHIP_URL]);
  } finally {
    await icons.close();
  }
});

test('the icon request carries the file name and a generic User-Agent, and no personal data', async () => {
  const wiki = fakeWiki({ [WHIP_URL]: { body: PNG } });
  const icons = await iconServer(join(dir, 'icons-privacy'), wiki.fetchIcon);
  try {
    await sendBytes(`/api/icon?id=${WHIP}`, icons);

    const [call] = wiki.calls;
    assert.equal(call.url, WHIP_URL, 'no query string, no other host');
    assert.deepEqual(Object.keys(call.headers), ['user-agent']);
    assert.match(call.headers['user-agent'], /^osrs-pvm-coach\b/);
    assert.ok(!/FixtureIron|@|https?:/i.test(call.headers['user-agent']), call.headers['user-agent']);
  } finally {
    await icons.close();
  }
});

test('a missing or unusable icon answers 404, so the page shows the item name', async () => {
  const wiki = fakeWiki({ [WHIP_URL]: { type: 'text/html', body: Buffer.from('<html>') } });
  const icons = await iconServer(join(dir, 'icons-missing'), wiki.fetchIcon);
  try {
    assert.equal((await sendBytes(`/api/icon?id=${WHIP}`, icons)).status, 404, 'not a PNG');
    assert.equal((await sendBytes('/api/icon?id=11840', icons)).status, 404, 'the wiki has no file');
    assert.equal((await sendBytes('/api/icon?id=999999999', icons)).status, 404, 'no such item');
    assert.equal((await sendBytes('/api/icon?id=../../x', icons)).status, 400, 'not an item id');

    await icons.close();
    const fixed = fakeWiki({ [WHIP_URL]: { body: PNG } });
    const again = await iconServer(join(dir, 'icons-missing'), fixed.fetchIcon);
    try {
      assert.equal((await sendBytes(`/api/icon?id=${WHIP}`, again)).status, 200, 'a bad reply was not cached');
    } finally {
      await again.close();
    }
  } finally {
    await icons.close();
  }
});

test('with no network, a restarted server still serves the cached icon', async () => {
  const cacheDir = join(dir, 'icons-offline');
  const online = await iconServer(cacheDir, fakeWiki({ [WHIP_URL]: { body: PNG } }).fetchIcon);
  await sendBytes(`/api/icon?id=${WHIP}`, online);
  await online.close();

  const offlineWiki = fakeWiki({}, { offline: true });
  const offline = await iconServer(cacheDir, offlineWiki.fetchIcon);
  try {
    const reply = await sendBytes(`/api/icon?id=${WHIP}`, offline);

    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, PNG);
    assert.equal(offlineWiki.calls.length, 0);
    assert.equal((await sendBytes('/api/icon?id=11840', offline)).status, 404, 'an uncached icon with no network');
  } finally {
    await offline.close();
  }
});

test('the state summary gives the worn item ids, for the icons', async () => {
  // An earlier test swaps the fixture's weapon, so compare with the file as it is now.
  const state = JSON.parse(await readFile(join(dir, 'fixture', 'state.json'), 'utf8'));
  const summary = JSON.parse((await send('/api/state')).body);

  assert.equal(summary.wornIds.weapon, state.equipment.weapon);
  assert.equal(summary.wornIds.ammo, null);
});

test('the server binds 127.0.0.1 only: the LAN address refuses the connection', async (t) => {
  assert.equal(server.address, '127.0.0.1');
  const lan = Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal);
  if (!lan) {
    t.skip('this machine has no LAN IPv4 address');
    return;
  }
  const outcome = await new Promise<string>((done) => {
    const socket = connect({ host: lan.address, port: server.port, timeout: 2000 });
    socket.on('connect', () => { socket.destroy(); done('connected'); });
    socket.on('timeout', () => { socket.destroy(); done('timeout'); });
    socket.on('error', (e) => done((e as NodeJS.ErrnoException).code ?? 'error'));
  });
  assert.notEqual(outcome, 'connected');
});
