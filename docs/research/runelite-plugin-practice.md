# RuneLite plugin practice: legality, API and tooling for DPS Bridge

Research date: 2026-11-16. Sources are primary (RuneLite org repos and wiki, Jagex news page, plugin source code). Claims that are not verified are marked **UNVERIFIED**. Line numbers are approximate.

## Bottom line

1. Keep the current design: the plugin writes a local JSON file through `Filepath`, and the MCP server reads the file. Do not add an HTTP or WebSocket server inside the plugin.
2. **Feature 1 (own inventory, bank snapshot, rune pouch, spellbook to a local file): GREEN.** No rule forbids it. Precedent on the Plugin Hub: Bank Memory, Inventory Setups, Data Export, CA Export (writes JSON to `.runelite`).
3. **Feature 1 over HTTP: RED.** "No exposing player information over HTTP" is in the Rejected Features page and in example-plugin `AGENTS.md`. WikiSync's loopback WebSocket is a reviewed exception, not a pattern to copy.
4. **Feature 2 (count your own landed DWH / Elder maul / BGS specs, compute target defence): GREEN.** Core plugin "Special Attack Counter" already does this and shows a defence-drain infobox. Hub plugin "Party Defence Tracker" does it with party data.
5. **Feature 2 AMBER edge:** do not turn the result into automatic in-fight prompts (what to pray, where to stand, when the boss attacks next). Those are banned boss-fight features. "No attack counters" in the rules means counting the boss's attacks, not your own specs (interpretation; the rule text does not define it).
6. API: bank = `InventoryID.BANK`, inventory = `InventoryID.INV`, gear = `InventoryID.WORN` (all `net.runelite.api.gameval`). Rune pouch = `VarbitID.RUNE_POUCH_TYPE_1..6` and `VarbitID.RUNE_POUCH_QUANTITY_1..6` with `EnumID.RUNEPOUCH_RUNE`. Spellbook = `VarbitID.SPELLBOOK` (0 standard, 1 ancient, 2 lunar, 3 arceuus).
7. Agent guidance: use the **first-party** `AGENTS.md` (+ `CLAUDE.md` that imports it) from runelite/example-plugin, added by RuneLite maintainer Adam on 2026-04-29 (commit `5370caa`), last synced 2026-10-01 (`46e14f2`). Re-sync your copy: it changed twice after it was added.
8. No official RuneLite docs MCP or `llms.txt` exists (404). Context7 indexes `/runelite/runelite` (third-party index of first-party source). Do not install any third-party "RuneLite Claude skills"; they are days old with 0 stars.
9. Dev login: use the dev client's built-in **Jagex auth panel** (wiki updated 2026-10-27). Delete any old `.runelite/credentials.properties`. Never commit it.
10. Next step: re-sync `AGENTS.md`, then run `./gradlew run` once and confirm the existing export in game before you spec features 1 and 2.

---

## 1. Official way to start and build a plugin

**Template.** Start from runelite/example-plugin, a public GitHub template repo ([repo](https://github.com/runelite/example-plugin)). Root files: `build.gradle`, `settings.gradle`, `gradlew`/`gradlew.bat`, `runelite-plugin.properties`, `src/`, `README.md`, `AGENTS.md`, `CLAUDE.md`.

**`build.gradle`** ([file](https://github.com/runelite/example-plugin/blob/master/build.gradle)):
- `runeLiteVersion = 'latest.release'`; repos: mavenLocal, `repo.runelite.net` (only `net.runelite` group), mavenCentral.
- `compileOnly` the RuneLite client; client + jshell on the test classpath; Lombok 1.18.30; JUnit 4.12.
- Java 11 target, UTF-8 encoding.
- A `run` task starts the test class (`ExamplePluginTest`) with `-ea`, `--developer-mode`, `--debug`. So `./gradlew run` starts a full RuneLite dev client with your plugin loaded.
- A `shadowJar` task builds a fat jar `<name>-<version>-all.jar`.

**Plugin Hub README steps** ([README](https://github.com/runelite/plugin-hub/blob/master/README.md)):
1. Generate a public repo from the template.
2. Open it in IntelliJ (Java 11, Eclipse Temurin recommended) and run the `run` Gradle task. Log in through the Jagex account panel.
3. Rename package, plugin, config and test classes. Update `pluginMainClass` in `build.gradle`.
4. Set `@PluginDescriptor` name; fill in `runelite-plugin.properties` (`displayName`, `author`, `description`, `tags`, `plugins`, `version`, `build=standard|gradle`).
5. Optional `icon.png` (max 48x72 px). Write a README. Add a BSD-2 licence.
- Resources: use `getResourceAsStream`, not `getResource` (plugins run from a jar).

**Developer Guide** ([wiki](https://github.com/runelite/runelite/wiki/Developer-Guide)): most development happens on the Plugin Hub. Learn the API from core plugins (agility, woodcutting, implings); hub plugins are a weaker reference because "their API usage isn't always correct". A plugin has a `Plugin` subclass with `@PluginDescriptor`, a `Config` interface, `Overlay`s, `@Subscribe` handlers in the plugin class, and optional Swing panels.

**Dev login ("Using Jagex Accounts")** ([wiki](https://github.com/runelite/runelite/wiki/Using-Jagex-Accounts), last edited 2026-10-27): start the client in developer mode from the IDE, open the **Jagex auth panel** in the sidebar, add the Jagex account in the popup, pick the character, click Play Now. Next launches: pick character, Play Now. See section 6 for the security note.

**Developer mode** ([wiki](https://github.com/runelite/runelite/wiki/Using-the-client-developer-tools)): `--developer-mode` program argument and `-ea` VM argument; `--debug` for more logs. The DevTools Var inspector shows varbit changes as you play ([wiki](https://github.com/runelite/runelite/wiki/VarPlayers%2C-VarBits%2C-and-VarClients)).

## 2. Plugin Hub submission and the rules

**Manifest** ([README](https://github.com/runelite/plugin-hub/blob/master/README.md)): one file in `plugins/` with `repository=<https clone url>` and `commit=<40-char sha>`. Fork, branch, open a PR. Two CI checks run (`build.yml` and "RuneLite Plugin Hub Checks"). Push fixes to the same PR. To update, change `commit=`.

**Other manifest keys (seen in real manifests, not in the README):**
- `authors=`, `warning=` (text shown at install), `disabled=`.
- `disabled=true` and `disabled=unmaintained` both exist. Examples: [`plugins/zoom`](https://github.com/runelite/plugin-hub/blob/master/plugins/zoom) (`disabled=true`, crash warning); [`plugins/rshub`](https://github.com/runelite/plugin-hub/blob/master/plugins/rshub) (`disabled=unmaintained`, uploaded bank and account state to a third-party app); [`plugins/mystix`](https://github.com/runelite/plugin-hub/blob/master/plugins/mystix) (`disabled=true`, sent RSN, bank, equipment to a third-party server). GitHub code search counted 331 manifests with `disabled=`. The exact reason codes are **UNVERIFIED** (I did not find the packager code that reads them).

**What reviewers check** (README): the plugin is not malicious, does not break Jagex's rules, and is not on the Rejected Features list. Quote: "If it is difficult for us to ensure the plugin isn't against the rules we will not merge it." The [Plugin Hub Review](https://github.com/runelite/runelite/wiki/Plugin-Hub-Review) wiki adds: human reviewers plus an automated review bot since April 2026; game-rule checks are "best-effort"; reviews do not check that a plugin works.

**Third-party dependencies** (README): any dependency not already in runelite-client needs Gradle hash verification (`thirdParty` config in `package/verification-template/build.gradle`, then `./gradlew --write-verification-metadata sha256`) and manual maintainer review. Avoid them. `build=standard` replaces your build files and allows faster review.

**Third-party servers:** a plugin that talks to a third-party server must show a warning describing what data it sends ([Information about the Plugin Hub](https://github.com/runelite/runelite/wiki/Information-about-the-Plugin-Hub)). `AGENTS.md` adds: such features need a `@ConfigItem` that is off by default with an IP-address warning.

**Rejected or Rolled Back Features** ([wiki](https://github.com/runelite/runelite/wiki/Rejected-or-Rolled-Back-Features)), relevant entries:
- "Plugins that expose player information over HTTP".
- "Plugins that simulate content for any purpose".
- "Plugins that crowdsource data about other players".
- "Any new high-end PvM boss plugins".
- Forbidden code: reflection, JNI/JNA, subprocesses, runtime code download, `java.io` file APIs (use `Filepath`), own `Gson`/`OkHttp` instances, `Thread.sleep`, `net.runelite` package name. `Filepath.Unchecked` needs manual review. Network I/O triggers extra review.
- New (2026-10-14): new plugins with significant functionality behind paid external services are prohibited.
- The page says nothing about bank, rune pouch, special attacks, defence reduction or DPS calculators.

**Jagex Third-Party Client Guidelines** ([page](https://secure.runescape.com/m=news/third-party-client-guidelines?oldschool=1), 2022-06-01): RuneLite and HDOS are approved. Banned in boss fights (incl. raids sub-bosses, slayer bosses, demi-bosses, Fight Caves, Inferno): next-attack prediction, projectile target/landing markers, prayer-switch indicators, **attack counters**, automatic stand-here indicators, boss-mechanic start/end indicators. Also banned: unhiding hidden components (e.g. spec bar), resizing click zones (inventory, equipment, spellbook, prayer), menu entries that send server actions. The list "is not exhaustive". The page does not mention bank, rune pouch, data export, special-attack tracking or DPS.

**Example-plugin `AGENTS.md` "Plugin Rules & Restrictions"** ([file](https://github.com/runelite/example-plugin/blob/master/AGENTS.md), lines ~87-167): mirrors the two lists above. Relevant lines: "No attack counters"; "No NPC focus identification (which player the NPC is targeting)"; "No content simulation (e.g. boss fight simulators)"; "No exposing player information over HTTP"; "No crowdsourcing data about other players"; "All file i/o must go through the Filepath utility."

**Verdicts for DPS Bridge:**

| Feature | Verdict | Why |
|---|---|---|
| Read own inventory, bank, rune pouch, spellbook | GREEN | No rule forbids reading your own state. Core and hub plugins do it (section 3). |
| Write own data to a local file via `Filepath` | GREEN | Required I/O path per `AGENTS.md`. CA Export writes JSON to `.runelite`. |
| Serve own data over HTTP/WebSocket from the plugin | RED | Rejected Features + `AGENTS.md` Data & Privacy. |
| Send data to any remote server | AMBER | Allowed with warning and off-by-default config, but extra review. Not needed here. |
| Count own landed specs, compute target defence | GREEN | Core Special Attack Counter does exactly this, with a defence-drain infobox. |
| Show automatic in-fight advice from that number | AMBER/RED | Can drift into banned boss-fight indicators or "content simulation". Keep DPS output out of the game overlay; keep it in the MCP side, used between fights. |
| Track the boss's attacks / which player it targets | RED | Explicitly banned. |

Note on the current design: exporting "current NPC target" means the local player's own `getInteracting()`. The core Special Attack Counter uses the same call. The ban on "NPC focus identification" is about which player the NPC targets, so the export is not affected (interpretation).

## 3. Precedent

Status = whether the manifest has `disabled=` (checked 2026-11-16 via the GitHub API).

| Plugin | Where | Status | What it does |
|---|---|---|---|
| Bank (core) | [source](https://github.com/runelite/runelite/blob/master/runelite-client/src/main/java/net/runelite/client/plugins/bank/BankPlugin.java) | active | Reads `InventoryID.BANK` for bank value text and value search. No export. |
| Bank Tags (core) | [folder](https://github.com/runelite/runelite/tree/master/runelite-client/src/main/java/net/runelite/client/plugins/banktags) | active | Tags and lays out bank items. |
| Rune Pouch (core) | [overlay](https://github.com/runelite/runelite/blob/master/runelite-client/src/main/java/net/runelite/client/plugins/runepouch/RunepouchOverlay.java) | active | Reads pouch varbits and draws contents on the pouch. |
| Spellbook (core) | [source](https://github.com/runelite/runelite/blob/master/runelite-client/src/main/java/net/runelite/client/plugins/spellbook/SpellbookPlugin.java) | active | "Reorder and hide spells"; reads `VarbitID.SPELLBOOK`. |
| Special Attack Counter (core) | [source](https://github.com/runelite/runelite/blob/master/runelite-client/src/main/java/net/runelite/client/plugins/specialcounter/SpecialCounterPlugin.java) | active, off by default | "Track special attacks used on NPCs"; defence-drain infobox for DWH and Elder maul. |
| Bank Memory | [manifest](https://github.com/runelite/plugin-hub/blob/master/plugins/bank-memory), [repo](https://github.com/Lazyfaith/runelite-bank-memory-plugin) | active | Saves bank per account when you open it; compare saves; TSV export. |
| Inventory Setups | [manifest](https://github.com/runelite/plugin-hub/blob/master/plugins/inventory-setups), [repo](https://github.com/dillydill123/inventory-setups) | active | Saves inventory, gear, rune pouch and spellbook per setup; clipboard export. |
| Data Export | [manifest](https://github.com/runelite/plugin-hub/blob/master/plugins/data-export), [repo](https://github.com/ConradicalMel/DataExport) | active (repo last push 2021) | Exports account data to the clipboard for spreadsheets. Data types **UNVERIFIED**. |
| CA Export | [manifest](https://github.com/runelite/plugin-hub/blob/master/plugins/ca-export), [repo](https://github.com/cdfisher/ca-export) | active | Writes own combat achievements to `.runelite/ca_exporter/<username>.json`. Closest precedent for a local JSON file. |
| WikiSync | [manifest](https://github.com/runelite/plugin-hub/blob/master/plugins/wikisync), [repo](https://github.com/weirdgloop/WikiSync) | active, has `warning=` | Uploads quests/skills/diaries to the wiki server. Also runs a WebSocket on `127.0.0.1`, ports 37767-37776, origin allow-list `localhost`, `dps.osrs.wiki`, `tools.runescape.wiki`, so the wiki DPS calc can load your gear (`InventoryID.WORN`) and real levels ([WebSocketManager.java](https://github.com/weirdgloop/WikiSync/blob/master/src/main/java/com/andmcadams/wikisync/dps/WebSocketManager.java), [WSWebsocketServer.java](https://github.com/weirdgloop/WikiSync/blob/master/src/main/java/com/andmcadams/wikisync/dps/ws/WSWebsocketServer.java), [DpsDataFetcher.java](https://github.com/weirdgloop/WikiSync/blob/master/src/main/java/com/andmcadams/wikisync/dps/DpsDataFetcher.java)). |
| Party Defence Tracker | [manifest](https://github.com/runelite/plugin-hub/blob/master/plugins/party-defence-tracker), [repo](https://github.com/Hyftar/party-defence-tracker) | active | Computes boss defence from party specs; infobox. |
| RSHub / Mystix | [rshub](https://github.com/runelite/plugin-hub/blob/master/plugins/rshub), [mystix](https://github.com/runelite/plugin-hub/blob/master/plugins/mystix) | disabled | Uploaded bank and account state to third-party servers. Shows remote upload of bank data is the risky part, not reading it. |

**How core Special Attack Counter detects landed hits** (`SpecialCounterPlugin.java`):
1. `onVarbitChanged` filters `VarPlayerID.SA_ENERGY` (~line 301). A drop in energy = a spec was used.
2. It defers with `clientThread.invokeLater`, records `client.getTickCount()`, reads the weapon from `InventoryID.WORN` slot `EquipmentInventorySlot.WEAPON` and matches the `SpecialWeapon` enum (~486-509).
3. Target = `client.getLocalPlayer().getInteracting()`, NPCs only (~321-331).
4. Expected hit tick = now + `SpecialWeapon.getHitDelay(distance)`.
5. `onHitsplatApplied` keeps only `hitsplat.isMine()` hitsplats on that target on that tick (~360-380).
6. `onGameTick` resolves the hit. Elder maul uses an HP/XP-change flag (`onStatChanged`, `onFakeXpDrop`) instead of a hitsplat.
7. Drain: `SpecialWeapon.computeDrainPercent()` gives a defence multiplier of 0.7 for DWH and 0.65 for Elder maul on a hit (0.95 vs Tekton), else 1 (no drain). BGS is a `damage=true` weapon: the counter records damage dealt ([SpecialWeapon.java](https://github.com/runelite/runelite/blob/master/runelite-client/src/main/java/net/runelite/client/plugins/specialcounter/SpecialWeapon.java)).
8. **Scope:** no boss allow-list. Any NPC you interact with counts. An `IGNORED_NPCS` list (Vorkath spawn, dark core, POH dummies, etc.) only stops counter resets. Counters reset on new target, NPC despawn, Sotetseg fade, Duke death. In a party it sends `SpecialCounterUpdate` to party members.
9. Party Defence Tracker subscribes to the same `SpecialCounterUpdate` event plus its own `HitsplatApplied` check, and limits itself to a `BossInfo` list ([source](https://github.com/Hyftar/party-defence-tracker/blob/master/src/main/java/com/partydefencetracker/DefenceTrackerPlugin.java), lines ~264-394).

Practical option for feature 2: copy the core detection logic (BSD-2) rather than invent your own. A plugin cannot read another plugin's private state; subscribing to `SpecialCounterUpdate` only works for party messages (inference from the Party Defence Tracker code, **UNVERIFIED** whether your own hits are re-delivered).

## 4. API facts (from runelite/runelite source)

All constants below come from `net.runelite.api.gameval` ([InventoryID.java](https://github.com/runelite/runelite/blob/master/runelite-api/src/main/java/net/runelite/api/gameval/InventoryID.java)).

**Inventory and gear.** `InventoryID.INV` (93), `InventoryID.WORN` (94). Read with `client.getItemContainer(InventoryID.INV)`; listen to `ItemContainerChanged` and check `event.getContainerId()`.

**Bank.** `InventoryID.BANK` (95); seed vault `InventoryID.SEED_VAULT` (626).
- Core Bank plugin pattern: `onItemContainerChanged` with `containerId == InventoryID.BANK`; `client.getItemContainer(InventoryID.BANK)`; skip `ItemID.BANK_FILLER`. Bank open/close: `onWidgetLoaded` / `onWidgetClosed` for `InterfaceID.BANKMAIN`.
- Snapshot-on-close plan: cache the container on `ItemContainerChanged(BANK)`; write the file on `WidgetClosed(InterfaceID.BANKMAIN)`. Do the disk write off the client thread (`AGENTS.md`: no blocking I/O on the client thread).
- The server sends the bank only after you open it. Bank Memory states it "only captures data when you're logged in and have opened your bank". Whether `getItemContainer(BANK)` stays readable after close until logout: **UNVERIFIED**; cache it yourself.
- Group storage (GIM) is a different container; not relevant for a solo ironman.

**Rune pouch** (`RunepouchOverlay.java`, ~lines 54-128):
- `NUM_SLOTS = 6`; `VarbitID.RUNE_POUCH_TYPE_1..6` and `VarbitID.RUNE_POUCH_QUANTITY_1..6`, read with `client.getVarbitValue(...)`.
- Type value to item: `client.getEnum(EnumID.RUNEPOUCH_RUNE).getIntValue(type)` returns the rune item id. Type 0 = empty slot.
- Pouch items checked: `ItemID.BH_RUNE_POUCH`, `ItemID.BH_RUNE_POUCH_TROUVER`, `ItemID.DIVINE_RUNE_POUCH`, `ItemID.DIVINE_RUNE_POUCH_TROUVER`.
- Listen to `VarbitChanged` for updates.

**Spellbook.** `VarbitID.SPELLBOOK` (core Spellbook plugin, ~lines 226 and 404). Values: 0 standard, 1 ancient, 2 lunar, 3 arceuus ([OSRS Wiki varbit 4070](https://oldschool.runescape.wiki/w/RuneScape:Varbit/4070)).

**Spec energy.** `VarPlayerID.SA_ENERGY` (core Special Attack Counter).

**General rules for this code** (`AGENTS.md`): gameval constants, not magic numbers; all file I/O through `Filepath` with the descriptor's `internalName`; injected `Gson`; unregister everything in `shutDown()`; track NPCs through spawn/despawn events, not per-tick scans.

## 5. Agent skills, templates and docs for AI coding agents

**First-party (RuneLite org):**
- `AGENTS.md` in runelite/example-plugin, 167 lines. Added with `CLAUDE.md` (content: `@AGENTS.md`) by Adam (RuneLite maintainer) in [`5370caa`](https://github.com/runelite/example-plugin/commit/5370caa0f5f6a5bba4fbb42931722ca535ad3fd5) on 2026-04-29, "add agent guidelines". Re-synced in [`b507ced`](https://github.com/runelite/example-plugin/commit/b507ced13a385bf7798d8f77ba91803e20f7fa0c) (2026-09-15) and [`46e14f2`](https://github.com/runelite/example-plugin/commit/46e14f2c448fab6cbc599df1015b9631dcf1fc52) (2026-10-01). Your copy may be stale: diff it against master.
- Its Testing section tells the agent: do not use screen-capture or computer-use tools on RuneScape ("will get the user's account banned"); offer `./gradlew run`; send the user to "Using Jagex Accounts"; wait for in-game confirmation. Its Submitting section asks for a `Generated-by: Claude Code` footer on plugin-hub PRs.
- No official docs MCP. `https://runelite.net/llms.txt` returns 404. Official API docs are Javadoc: [API](https://static.runelite.net/runelite-api/apidocs/), [client](https://static.runelite.net/runelite-client/apidocs/).
- Context7 lists `/runelite/runelite` (reputation High). It is Context7's index of the first-party source, not a RuneLite product.

**Third-party (not installed, not run; read-only look):**

| Item | Publisher / stats | Trust assessment |
|---|---|---|
| [idyet/runelite-claude-skills](https://github.com/idyet/runelite-claude-skills) | Individual; created 2026-11-13; 0 stars; BSD-2. Skills `rl-check-concept`, `rl-dupe-plugin-check`, `rl-new-plugin`, `rl-presubmit`, `rl-bump`; ships `hub_search.py`, uses curl/python3/gh. | Low: 3 days old, unreviewed, runs scripts. The design (fetch the three rule sources live) is sound; copy the idea, not the code. |
| [Rakvadium/osrs-agent](https://github.com/Rakvadium/osrs-agent) | Individual; created 2026-10-27; 0 stars. Snapshot plugin + Claude Code skills for planning. | Low: new, unproven. Not a plugin-building aid. |
| [runbunbun/runelite-dev-mcp](https://github.com/runbunbun/runelite-dev-mcp) | Individual; 7 stars; MIT; last push 2026-07-03. Plugin with an HTTP server on `localhost:3000` exposing bank and game state. | Do not use: in-plugin HTTP exposure is on the Rejected list; not found on the Hub. |
| Similar export + MCP repos: [isaachansen/runelite-json-export](https://github.com/isaachansen/runelite-json-export), [Nichster/claude-export-plugin](https://github.com/Nichster/claude-export-plugin), [tomascabralh/wise-old-ai](https://github.com/tomascabralh/wise-old-ai), [Bakon/runelite-mcp](https://github.com/Bakon/runelite-mcp), [Sleepywalker69/OSRS-MCP-Companion](https://github.com/Sleepywalker69/OSRS-MCP-Companion), [damian909/gielinor-companion](https://github.com/damian909/gielinor-companion) | Individuals; 1-5 stars each. | Reference only. None found in plugin-hub code search (search index may be incomplete, **UNVERIFIED**). The file-export ones match your design; the HTTP ones do not. |

No Cursor rules file for RuneLite surfaced in the GitHub repo search. Your own skill list includes `osrs-legality-gate` (your own, not RuneLite's); its content was not reviewed here.

## 6. Security practice

- **Login:** use the Jagex auth panel in the dev client ([wiki](https://github.com/runelite/runelite/wiki/Using-Jagex-Accounts)). If an old `.runelite/credentials.properties` exists, the wiki says "it is recommended to delete it for account security purposes." Treat it as a session secret: never in the repo, never in context, never in a log. The older `--insecure-write-credentials` flow is not on the current page (**UNVERIFIED** whether it still works; do not use it).
- **No game automation:** `AGENTS.md` forbids agents from using screen or input tools on RuneScape. Jagex guidelines ban injected input. Claude must never drive the game client.
- **Sideloaded / dev plugins:** a dev build runs with full client access and no hub review. Only run code you built from your own repo. RuneLite's wiki mentions a `sideloaded-plugins` directory for developer mode ([Building with IntelliJ IDEA](https://github.com/runelite/runelite/wiki/Building-with-IntelliJ-IDEA); seen via search snippet, **UNVERIFIED** directly). I found no RuneLite page that endorses sideloading other people's jars.
- **Hub plugins:** RuneLite says third-party plugins "commonly cause bugs and client instability" and to install conservatively ([Plugin Hub Review](https://github.com/runelite/runelite/wiki/Plugin-Hub-Review)). Safe mode disables hub plugins ([Launcher Configuration](https://github.com/runelite/runelite/wiki/RuneLite-Launcher-Configuration)).
- **Your own rule (reviewer-reject = bannable):** under it, the safe envelope is: own data only, local file only, no in-plugin server, no remote upload, no boss-mechanic overlays, no input. Write the JSON to a `Filepath`-managed folder, and keep the MCP server on stdio so no network port exposes the data.

## Sources

- runelite/example-plugin: https://github.com/runelite/example-plugin ; build.gradle: https://github.com/runelite/example-plugin/blob/master/build.gradle ; AGENTS.md: https://github.com/runelite/example-plugin/blob/master/AGENTS.md ; commits: https://github.com/runelite/example-plugin/commits/master/AGENTS.md
- runelite/plugin-hub README: https://github.com/runelite/plugin-hub/blob/master/README.md
- Plugin-hub manifests: https://github.com/runelite/plugin-hub/tree/master/plugins (wikisync, bank-memory, inventory-setups, data-export, ca-export, party-defence-tracker, zoom, rshub, mystix)
- Rejected or Rolled Back Features: https://github.com/runelite/runelite/wiki/Rejected-or-Rolled-Back-Features
- Jagex Third-Party Client Guidelines: https://secure.runescape.com/m=news/third-party-client-guidelines?oldschool=1
- Developer Guide: https://github.com/runelite/runelite/wiki/Developer-Guide
- Using Jagex Accounts: https://github.com/runelite/runelite/wiki/Using-Jagex-Accounts
- Using the client developer tools: https://github.com/runelite/runelite/wiki/Using-the-client-developer-tools
- VarPlayers, VarBits, and VarClients: https://github.com/runelite/runelite/wiki/VarPlayers%2C-VarBits%2C-and-VarClients
- Information about the Plugin Hub: https://github.com/runelite/runelite/wiki/Information-about-the-Plugin-Hub
- Plugin Hub Review: https://github.com/runelite/runelite/wiki/Plugin-Hub-Review
- Core sources: BankPlugin.java, RunepouchOverlay.java, SpellbookPlugin.java, SpecialCounterPlugin.java, SpecialWeapon.java, SpecialCounterConfig.java under https://github.com/runelite/runelite/tree/master/runelite-client/src/main/java/net/runelite/client/plugins ; gameval InventoryID.java: https://github.com/runelite/runelite/blob/master/runelite-api/src/main/java/net/runelite/api/gameval/InventoryID.java
- WikiSync: https://github.com/weirdgloop/WikiSync ; RS:SYNC: https://oldschool.runescape.wiki/w/RuneScape:SYNC
- OSRS Wiki varbit 4070: https://oldschool.runescape.wiki/w/RuneScape:Varbit/4070
- Hub precedent repos: https://github.com/Lazyfaith/runelite-bank-memory-plugin ; https://github.com/dillydill123/inventory-setups ; https://github.com/ConradicalMel/DataExport ; https://github.com/cdfisher/ca-export ; https://github.com/Hyftar/party-defence-tracker
- Third-party AI repos: listed in section 5.
- Context7 library: /runelite/runelite (resolved 2026-11-16).
