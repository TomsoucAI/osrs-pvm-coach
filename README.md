# OSRS DPS MCP

[![CI](https://github.com/TomsoucAI/osrs-pvm-coach/actions/workflows/ci.yml/badge.svg)](https://github.com/TomsoucAI/osrs-pvm-coach/actions/workflows/ci.yml)

Ask Claude "what's my DPS on Vorkath?" and get the answer from your **live** RuneLite gear, boosted levels (potions), active prayers, attack style and current target, calculated by the **OSRS Wiki DPS calculator engine** (`weirdgloop/osrs-dps-calc`), the same maths as https://tools.runescape.wiki/osrs-dps.

```
RuneLite ── DPS Bridge plugin ──> ~/.runelite/plugin-data/dps_bridge/state.json ──> MCP server (Wiki calc engine) ──> Claude
          └─ (fallback) WikiSync plugin websocket :37767 ──────────────────┘
```

## Tools

| Tool | What it does |
|---|---|
| `osrs_get_loadout` | Live gear, levels (boosted/real), prayers, style, target |
| `osrs_calculate_dps` | DPS, max hit, accuracy, avg TTK vs current target or any monster. Optional overrides: `prayers`, `potions`, `style`, `spell`, `on_slayer_task`, `equipment` swaps, `defence_reductions` (DWH, Elder maul, BGS damage, Arclight, Emberlight, Accursed, Vulnerability) |
| `osrs_compare_setups` | Up to 10 variants vs one monster, sorted by DPS (live setup always included). Variants can carry their own `defence_reductions` |
| `osrs_best_owned_setup` | Best setups you **own** (worn gear, inventory, last bank snapshot) vs one monster, per combat style |
| `osrs_search_monsters` | Find exact monster name/version/id |

## Is it safe for my account?

- The plugin only **reads** game state and writes a local JSON file. It never sends input or clicks.
- Nothing asks for, reads or stores your password. The MCP server makes no internet requests.
- Details: [Account safety](#account-safety) and [Legality gate](#legality-gate-dont-get-banned).

## Quick start

Prerequisites: [Node](https://nodejs.org) 20.3+, git, and JDK 21 for the plugin (`winget install EclipseAdoptium.Temurin.21.JDK` on Windows).

```bash
git clone https://github.com/TomsoucAI/osrs-pvm-coach.git
cd osrs-pvm-coach
node install.mjs
```

`install.mjs` adds the DPS MCP to Claude Code and Claude Desktop (`node install.mjs --dry-run` shows what it would do). Then follow [TESTING.md](TESTING.md).

## Setup options

### 1. MCP server only (Node 20.3+)

`app/dist/index.js` is a self-contained bundle (engine + item/monster data); no `npm install` needed.

**Claude Code:**
```bash
claude mcp add osrs-dps -- node /ABSOLUTE/PATH/osrs-pvm-coach/app/dist/index.js
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{ "mcpServers": { "osrs-dps": { "command": "node", "args": ["C:\\path\\osrs-pvm-coach\\app\\dist\\index.js"] } } }
```

### 2. Zero-Java: WikiSync fallback

Install **WikiSync** from the RuneLite Plugin Hub. The MCP reads your gear + base levels from it automatically. WikiSync doesn't expose boosts, prayers, style or target, so pass them in the prompt ("with Piety and super combat, on Vorkath").

### 3. DPS Bridge RuneLite plugin (full live data)

Adds what WikiSync lacks: **boosted levels (potions auto-detected), active prayers, attack style, current target, slayer task, inventory, bank snapshot, and your own landed DWH / Elder maul / BGS specs**. Read-only: it writes a JSON file on change, never sends input.

The plugin is **not on the Plugin Hub yet**, so it runs only in RuneLite's developer client:

```bash
cd plugin
./gradlew run          # Windows: gradlew.bat run
```
This launches a developer RuneLite client with the plugin loaded. Enable **DPS Bridge** in the plugin list.

**Jagex account login in the dev client:** click the Jagex auth panel icon in the sidebar → *Add Jagex Account* → log in → pick your character → *Play Now*. Next launches: pick the character → *Play Now*. (If you have an old `~/.runelite/credentials.properties` from the legacy method, delete it.)

## Example prompts

- "What's my DPS on what I'm fighting?"
- "Compare my current setup vs tentacle vs Slayer helm (i) on Abyssal demon"
- "Vorkath: no spec vs 1 DWH vs 2 DWH vs elder maul, what does each do to my DPS?"
- "Piety + divine super combat vs Ultimate strength + super combat on Vorkath post-quest, which is worth it?"
- "What's the best melee setup I own for Vorkath?"

## Limits

- The autocast spell isn't read from the game: pass `spell` for standard staves (powered staves are automatic).
- Special attack hits and ToA/CoX scaling inputs aren't exposed yet; the engine supports them. Defence drains from specs are supported (`defence_reductions`).
- Soulreaper axe stacks default to 5 (Wiki calc default).

## Account safety

- Nothing here asks for, reads or stores your password. The MCP makes no internet requests; it reads a local file (or WikiSync on localhost). The plugin writes gear/levels/prayers/target only.
- Dev client login goes through Jagex's own login window. The session is stored encrypted in `~/.runelite/jagex-accounts.dat`; the key is in Windows Credential Manager / macOS Keychain. No password is stored.
- If you ever created `~/.runelite/credentials.properties` (old method), delete it.
- The repo-root `.claude/settings.json` denies Claude Code's `Read` and `Edit` of `credentials.properties` and `jagex-accounts.dat`. This also blocks Bash commands that name the file (`cat`, `head`, redirections). **Residual risk:** it does not block a command that reads the file without naming it (`grep -r`) or a subprocess (`node -e`, `sh -c`). Only the Claude Code sandbox closes that gap, and it does not run on native Windows (WSL2 only). A read gives an encrypted session, not your password. Accepted for now; see #30.
- `install.mjs` installs no third-party skills or MCP servers. Don't add other people's MCP servers, skills or "RuneLite" downloads without reading them: they run with your user's permissions.
- Turn on 2-step authentication on your Jagex account.

## Legality gate (don't get banned)

Two layers, because legality is about what a feature *does*, and code patterns only catch the obvious cases:

| Layer | When | What |
|---|---|---|
| Maintainer verdict (`osrs-legality-gate` skill) | Before any new/changed feature | GREEN / AMBER / RED verdict against RuneLite's official rules + Plugin Hub precedent |
| [`plugin/tools/legal-lint.mjs`](plugin/tools/legal-lint.mjs) | After every edit (Claude Code hook, with Claude Code opened at the repo root), in CI on every PR, or `node tools/legal-lint.mjs` in `plugin/` | RED: forbidden code (input injection, menu actions, autotype, reflection, servers…) blocks the edit. AMBER: risky APIs (projectiles, prayer tab, NPC targeting, sounds…) need a `// legal-gate: GREEN <reason>` line |

No tool guarantees anything: the Plugin Hub review is the strongest check there is. If a feature wouldn't pass it, don't run it locally either.

## Help, security and contributing

- Questions and bugs: [open an issue](https://github.com/TomsoucAI/osrs-pvm-coach/issues).
- Security problems: do not open a public issue; see [SECURITY.md](SECURITY.md).
- Contributing: see [CONTRIBUTING.md](CONTRIBUTING.md). One maintainer; a hobby project.

## For contributors

### Updating the calculator data

New items/bosses come from the Wiki calc repo:
```bash
cd app
npm install
npm run setup           # clones engine at the pinned commit into ../vendor
npm run update-calc     # or: pull latest engine + data and rebuild
npm test                # offline self-tests
```

### Building with Claude Code

[`plugin/AGENTS.md`](plugin/AGENTS.md) is RuneLite's official agent guide (copied from `runelite/example-plugin`, with `CLAUDE.md` importing it). Claude Code loads it automatically, so plugin changes follow Plugin Hub rules: Java 11, Filepath for file I/O, no input injection, combat restrictions.

### Quality checks

| Check | Command (in `app/`) |
|---|---|
| MCP smoke test (all tools, errors, pagination), uses the prebuilt `dist/` | `npm install && npm run smoke` |
| Rebuild from source + all tests | `npm run setup && npm test` |
| Strict type-check of our code | `npx tsc -p .` (errors listed under `../vendor/` are the Wiki calc's own, unchanged) |
| Interactive explorer | `npx @modelcontextprotocol/inspector node dist/index.js` |
| LLM evaluation (10 questions, needs `ANTHROPIC_API_KEY`) | `cd ../evals && pip install -r requirements.txt && python evaluation.py evaluation.xml -t stdio -c node -a ../app/dist/index.js -e DPS_BRIDGE_FILE=../examples/state.sample.json` |

## License

- `app/` (MCP server): GPL-3.0, see [`app/LICENSE`](app/LICENSE). It bundles the calculator engine (weirdgloop/osrs-dps-calc), which is GPL-3.0, so the bundled `dist/` is GPL-3.0 too.
- `plugin/` (RuneLite plugin): BSD-2, see [`plugin/LICENSE`](plugin/LICENSE), as the Plugin Hub requires.

## Credits

DPS maths: the [OSRS Wiki DPS calculator](https://github.com/weirdgloop/osrs-dps-calc). Built on [RuneLite](https://github.com/runelite/runelite). Fallback data: WikiSync. Not affiliated with Jagex, RuneLite or the OSRS Wiki.
