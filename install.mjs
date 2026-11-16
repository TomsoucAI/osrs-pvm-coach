#!/usr/bin/env node
// One-shot personal setup for Claude Code + Claude Desktop.
// Usage (from this folder):  node install.mjs            install everything
//                            node install.mjs --dry-run  show what would happen
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DRY = process.argv.includes('--dry-run');
const ROOT = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const WIN = platform() === 'win32';
const MCP_ENTRY = resolve(ROOT, 'app', 'dist', 'index.js');

const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const step = (m) => console.log(`\n▸ ${m}`);
const q = (s) => (WIN && /\s/.test(s) ? `"${s}"` : s);

function run(cmd, args, { allowFail = false, cwd } = {}) {
  const line = [cmd, ...args.map(q)].join(' ');
  if (DRY) { console.log(`    $ ${line}`); return { status: 0, stdout: '' }; }
  const r = spawnSync(cmd, WIN ? args.map(q) : args, { shell: WIN, encoding: 'utf8', cwd });
  if (r.status !== 0 && !allowFail) throw new Error(`${line}\n${r.stderr || r.stdout}`);
  return r;
}
const has = (cmd) => spawnSync(WIN ? 'where' : 'which', [cmd], { encoding: 'utf8' }).status === 0;

// ── 1. Prerequisites ─────────────────────────────────────────────
step('Checking prerequisites');
const nodeMajor = Number(process.versions.node.split('.')[0]);
nodeMajor >= 20 ? ok(`Node ${process.versions.node}`) : warn(`Node ${process.versions.node}: need 20+`);

let javaOk = false;
if (has('java')) {
  const v = spawnSync('java', ['-version'], { encoding: 'utf8', shell: WIN });
  const m = /version "(\d+)(?:\.(\d+))?/.exec(`${v.stderr}${v.stdout}`);
  const major = m ? (m[1] === '1' ? Number(m[2]) : Number(m[1])) : 0;
  javaOk = major >= 11;
  javaOk ? ok(`Java ${major}`) : warn(`Java ${major}: need 11+`);
} else warn('Java not found');
if (!javaOk) {
  console.log(WIN ? '    Install:  winget install EclipseAdoptium.Temurin.21.JDK   (then reopen the terminal)'
    : '    Install:  brew install --cask temurin@21   (macOS)  or your distro\'s openjdk-21');
}
has('git') ? ok('git') : warn(WIN ? 'git missing → winget install Git.Git' : 'git missing');
if (!existsSync(MCP_ENTRY)) throw new Error(`Missing ${MCP_ENTRY}. Run this from the osrs-dps-mcp folder.`);
ok('MCP bundle found');

// ── 2. Plugin-dev rules ──────────────────────────────────────
// Claude Code reads plugin/AGENTS.md (RuneLite's official agent guide) when you work in that folder.
// No third-party skills or MCP servers are installed.
step('Plugin-dev rules');
ok('plugin/AGENTS.md (official RuneLite guide) is loaded automatically by Claude Code');

// ── 3. Claude Code ───────────────────────────────────────────────
step('Claude Code');
const codeCmds = [
  ['mcp', 'remove', '--scope', 'user', 'osrs-dps'],
  ['mcp', 'add', '--scope', 'user', 'osrs-dps', '--', 'node', MCP_ENTRY],
];
if (has('claude')) {
  for (const a of codeCmds) {
    const r = run('claude', a, { allowFail: true });
    if (a[1] === 'remove') continue; // fine if it didn't exist
    const label = `MCP server ${a[4]} (Claude Code, user scope)`;
    r.status === 0 ? ok(label)
      : warn(`claude ${a.join(' ')} failed: ${(r.stderr || r.stdout || '').trim().split('\n')[0]}`);
  }
} else {
  warn('`claude` CLI not found. Install Claude Code, then run:');
  for (const a of codeCmds.filter((c) => c[1] !== 'remove')) console.log(`    claude ${a.map(q).join(' ')}`);
}

// ── 4. Claude Desktop (DPS questions while playing) ─────────────
step('Claude Desktop');
const desktopCfg = WIN ? join(process.env.APPDATA ?? join(HOME, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
  : platform() === 'darwin' ? join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : null;
if (!desktopCfg) {
  warn('Claude Desktop config location unknown on this OS; skipping.');
} else {
  let cfg = {};
  if (existsSync(desktopCfg)) {
    try { cfg = JSON.parse(readFileSync(desktopCfg, 'utf8')); } catch { throw new Error(`Could not parse ${desktopCfg}; fix or delete it and rerun.`); }
    if (!DRY) copyFileSync(desktopCfg, `${desktopCfg}.bak`);
  }
  cfg.mcpServers = { ...(cfg.mcpServers ?? {}), 'osrs-dps': { command: 'node', args: [MCP_ENTRY] } };
  if (!DRY) { mkdirSync(dirname(desktopCfg), { recursive: true }); writeFileSync(desktopCfg, JSON.stringify(cfg, null, 2)); }
  ok(`osrs-dps added to ${desktopCfg}${existsSync(`${desktopCfg}.bak`) ? ' (backup: .bak)' : ''}`);
  console.log('    Fully quit Claude Desktop (tray icon → Quit) and reopen it.');
  console.log('    Not showing up? Settings → Developer → Edit Config opens the file Desktop really uses; paste the osrs-dps entry there.');
}

// ── 5. Quick self-test ───────────────────────────────────────────
step('Self-test (no game needed)');
const st = run('node', [resolve(ROOT, 'app', 'dist', 'selftest.js')], { allowFail: true });
DRY || (st.status === 0 ? ok('DPS engine tests pass') : warn(`self-test failed:\n${st.stdout}`));

console.log(`
Done. Next: test the plugin → see TESTING.md
  cd plugin && ${WIN ? 'gradlew.bat' : './gradlew'} run`);
