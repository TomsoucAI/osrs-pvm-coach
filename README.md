# OSRS DPS MCP

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
| `osrs_search_monsters` | Find exact monster name/version/id |

Example prompts:
- "What's my DPS on what I'm fighting?"
- "Compare my current setup vs tentacle vs Slayer helm (i) on Abyssal demon"
- "Vorkath: no spec vs 1 DWH vs 2 DWH vs elder maul, what does each do to my DPS?"
- "Piety + divine super combat vs Ultimate strength + super combat on Vorkath post-quest, which is worth it?"

## Quick setup (personal use)

```bash
node install.mjs
```
Sets up Claude Code (DPS MCP; plugin work follows RuneLite's official `AGENTS.md`) and Claude Desktop (DPS MCP). Then follow **TESTING.md**.

## 1. MCP server (works now, Node 20+)

`app/dist/index.js` is a self-contained bundle (engine + item/monster data); no `npm install` needed.

**Claude Code:**
```bash
claude mcp add osrs-dps -- node /ABSOLUTE/PATH/osrs-dps-mcp/app/dist/index.js
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{ "mcpServers": { "osrs-dps": { "command": "node", "args": ["C:\\path\\osrs-dps-mcp\\app\\dist\\index.js"] } } }
```

### Zero-Java quick start: WikiSync fallback
Install **WikiSync** from the RuneLite Plugin Hub. The MCP reads your gear + base levels from it automatically. WikiSync doesn't expose boosts, prayers, style or target, so pass them in the prompt ("with Piety and super combat, on Vorkath").

## 2. DPS Bridge RuneLite plugin (full live data)

Adds what WikiSync lacks: **boosted levels (potions auto-detected), active prayers, attack style, current target, slayer task**. Read-only: it writes a JSON file on change, never sends input.

```bash
cd plugin
./gradlew run          # Windows: gradlew.bat run   (JDK 11+ required)
```
This launches a developer RuneLite client with the plugin loaded. Enable **DPS Bridge** in the plugin list.

**Jagex account login in the dev client:** click the Jagex auth panel icon in the sidebar → *Add Jagex Account* → log in → pick your character → *Play Now*. Next launches: pick the character → *Play Now*. (If you have an old `~/.runelite/credentials.properties` from the legacy method, delete it.)

> For daily use without the dev client, submit it to the Plugin Hub (`runelite/plugin-hub` PR).

## 3. Bank-mode page (local web page)

Two equipment pictures side by side for one boss and phase: what you wear now, and the best setup you own. Slots to swap have a gold outline. The page updates when the plugin's files change.

```bash
node app/dist/ui.js                                    # live: reads the plugin's state.json and bank.json
node app/dist/ui.js --fixture app/fixtures/ironman-v2  # no game needed
```
Then open `http://127.0.0.1:4780/` (`--port <n>` changes the port). `app/dist/ui.js` and `app/dist/page/` are built bundles; no `npm install` needed.

The server binds `127.0.0.1` only and has read-only endpoints. It answers a request only when `Host` is its own address and `Origin`, when the browser sends one, is its own origin (scheme, host and port). **Threat model:** this guard protects against websites, not against local programs. A local program can forge both headers, and it can read `state.json` and `bank.json` from disk with no server at all.

## Updating the calculator data

New items/bosses come from the Wiki calc repo:
```bash
cd app
npm install
npm run setup           # clones engine at the pinned commit into ../vendor
npm run update-calc     # or: pull latest engine + data and rebuild
npm test                # offline self-tests
```

## Building with Claude Code

`plugin/AGENTS.md` is RuneLite's official agent guide (copied from `runelite/example-plugin`, with `CLAUDE.md` importing it). Claude Code loads it automatically, so plugin changes follow Plugin Hub rules: Java 11, Filepath for file I/O, no input injection, combat restrictions.

## Limits (v0.1)

- Autocast spell isn't read from the game: pass `spell` for standard staves (powered staves are automatic).
- No special attacks, defence-reduction specs (DWH/BGS) or ToA/CoX scaling inputs exposed yet; the engine supports them, it's a parameter away.
- Soulreaper axe stacks default to 5 (Wiki calc default).
- The Java plugin was written against the current RuneLite API (same calls as WikiSync) but not compiled in my environment, so the first `./gradlew run` is the real test.

## License

The calculator engine is GPL-3.0 (weirdgloop/osrs-dps-calc), so the bundled `dist/` is GPL-3.0 too.

## Quality checks (built with the `mcp-builder` skill)

| Check | Command (in `app/`) |
|---|---|
| MCP smoke test (all 4 tools, errors, pagination), uses the prebuilt `dist/` | `npm install && npm run smoke` |
| Rebuild from source + all tests | `npm run setup && npm test` |
| Strict type-check of our code | `npx tsc -p .` (errors listed under `../vendor/` are the Wiki calc's own, unchanged) |
| Interactive explorer | `npx @modelcontextprotocol/inspector node dist/index.js` |
| LLM evaluation (10 questions, needs `ANTHROPIC_API_KEY`) | `cd ../evals && pip install -r requirements.txt && python evaluation.py evaluation.xml -t stdio -c node -a ../app/dist/index.js -e DPS_BRIDGE_FILE=../examples/state.sample.json` |

## Legality gate (don't get banned)

Two layers, because legality is about what a feature *does*, and code patterns only catch the obvious cases:

| Layer | When | What |
|---|---|---|
| `osrs-legality-gate` skill | Before any new/changed feature | GREEN / AMBER / RED verdict against RuneLite's official rules + Plugin Hub precedent |
| `plugin/tools/legal-lint.mjs` | After every edit (Claude Code hook, with Claude Code opened at the repo root) or `node tools/legal-lint.mjs` in `plugin/` | RED: forbidden code (input injection, menu actions, autotype, reflection, servers…) blocks the edit. AMBER: risky APIs (projectiles, prayer tab, NPC targeting, sounds…) need a `// legal-gate: GREEN <reason>` line |

No tool guarantees anything: the Plugin Hub review is the strongest check there is. If a feature wouldn't pass it, don't run it locally either.

## Account safety

- Nothing here asks for, reads or stores your password. The MCP makes no internet requests; it reads a local file (or WikiSync on localhost). The plugin writes gear/levels/prayers/target only.
- Dev client login goes through Jagex's own login window. The session is stored encrypted in `~/.runelite/jagex-accounts.dat`; the key is in Windows Credential Manager / macOS Keychain. No password is stored.
- If you ever created `~/.runelite/credentials.properties` (old method), delete it.
- The repo-root `.claude/settings.json` denies Claude Code's `Read` and `Edit` of `credentials.properties` and `jagex-accounts.dat`. This also blocks Bash commands that name the file (`cat`, `head`, redirections). **Residual risk:** it does not block a command that reads the file without naming it (`grep -r`) or a subprocess (`node -e`, `sh -c`). Only the Claude Code sandbox closes that gap, and it does not run on native Windows (WSL2 only). A read gives an encrypted session, not your password. Accepted for now; see #30.
- `install.mjs` installs no third-party skills or MCP servers. Don't add other people's MCP servers, skills or "RuneLite" downloads without reading them: they run with your user's permissions.
- Turn on 2-step authentication on your Jagex account.
