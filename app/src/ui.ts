#!/usr/bin/env node
// The `ui` entry point: starts the bank-mode page server on 127.0.0.1.
//   node dist/ui.js                      live: reads the DPS Bridge plugin's files
//   node dist/ui.js --fixture <dir>      reads <dir>/state.json and <dir>/bank.json
//   node dist/ui.js --port <n>           default 4780
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { bridgeFile } from './snapshot';
import { startUiServer } from './ui/server';

const DEFAULT_PORT = '4780';

const { values } = parseArgs({ options: { fixture: { type: 'string' }, port: { type: 'string', default: DEFAULT_PORT } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`--port takes a number from 1 to 65535, got "${values.port}".`);
  process.exit(1);
}
const stateFile = values.fixture ? resolve(values.fixture, 'state.json') : bridgeFile();

try {
  const server = await startUiServer({
    port,
    stateFile,
    bankFile: join(dirname(stateFile), 'bank.json'),
    pageDir: join(dirname(fileURLToPath(import.meta.url)), 'page'),
    iconCacheDir: join(homedir(), '.osrs-pvm-coach', 'icons'),
    // dist/ui.js → the repo's top-level boss-notes/ folder.
    bossNotesDir: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'boss-notes'),
  });
  console.log(`Bank mode: http://127.0.0.1:${server.port}/  (${values.fixture ? 'fixture' : 'live'}: ${dirname(stateFile)})`);
  console.log('Stop with Ctrl+C.');
} catch (e) {
  console.error(`The UI server did not start: ${(e as Error).message}`);
  process.exit(1);
}
