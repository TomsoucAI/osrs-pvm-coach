# RuneLite Developer Guide: analysis for osrs-pvm-coach

Source: https://github.com/runelite/runelite/wiki/Developer-Guide and the plugin-dev pages it links (read 2026-11-16).
Companion note: `runelite-plugin-practice.md` (legality, precedent, Plugin Hub).

## Bottom line

1. The wiki is a **map, not a manual**. It covers setup, dev flags, vars, logging, code style and the forbidden-API list. It does **not** cover the client thread, events by name, ItemManager, gameval, enums or structs.
2. For everything the wiki skips, the ground truth is, in order: the API/client **Javadoc**, **core plugin sources** in `runelite/runelite`, and the first-party `plugin/AGENTS.md` (from `runelite/example-plugin`). Context7 indexes `/runelite/runelite`.
3. The wiki says to learn from **core** plugins, not hub plugins: hub plugins' "API usage is not always correct". Core plugins to read for our next features: `specialcounter` (own spec hits), `runepouch`, `bank`, `attackstyles`, `opponentinfo`, `itemstats`.

## What the guide gives us

| Topic | Fact | Source page |
|---|---|---|
| JDK | Java 11 language level, Temurin 11 recommended. Plugins must be written in Java. | Building-with-IntelliJ-IDEA, Rejected-or-Rolled-Back-Features |
| Dev client | The gradle `run` task starts the client from the test-source main class with `-ea`, `--developer-mode`, `--debug`. | example-plugin `build.gradle`, Using-the-client-developer-tools |
| Login | Jagex auth sidebar panel → Add Jagex Account → pick character → Play Now. Delete old `credentials.properties`. | Using-Jagex-Accounts |
| Finding vars | DevTools **Var inspector**: open it, do the in-game action, watch which var changes, double-check. Some state lives in ItemContainers or Actor state, not vars. | VarPlayers,-VarBits,-and-VarClients |
| Var timing | Varps/varbits come from the server each tick, but clientscripts can set a predicted value early. | same |
| Events | `@Subscribe` methods must be in the plugin class. Event classes are listed in the Javadoc `events` packages. | Developer-Guide |
| Logging | Lombok `@Slf4j`. Developer detail at DEBUG, little at INFO (INFO reaches user logs). Custom `logback-test.xml` goes in `src/test/resources`. | Plugin-Development-Logging |
| Style | Tabs, braces on the next line, BSD-2 copyright header on each new file, imports in one block. Checkstyle via the repo's `checkstyle.xml`. | Code-Conventions |
| Forbidden APIs | `java.io` file APIs (use `Filepath`; `Filepath.Unchecked` forces manual review), creating your own `Gson` or OkHttp client, reflection, JNI/JNA, subprocesses, `java.lang.Runtime`, `Thread.sleep`, `Thread.interrupt`, `Desktop.open/browse`, `Robot`, `Client.menuAction`. | Rejected-or-Rolled-Back-Features |
| Resources | Load with `getResourceAsStream`; the plugin jar is not unpacked on disk. | plugin-hub README |
| Dependencies | Anything not already a transitive dependency of `runelite-client` needs hash verification and manual review. Avoid. | plugin-hub README |

## Our plugin against these rules (checked 2026-11-16, `DpsBridgePlugin.java`)

| Rule | Status |
|---|---|
| File IO through `Filepath` | Pass |
| Injected `Gson`, never `new Gson()` | Pass |
| No reflection, sleep, interrupt, subprocess, HTTP | Pass (grep found none) |
| Disk IO off the client thread | Pass (single-thread executor) |
| Tabs, next-line braces | Pass (222 tab-indented lines, 0 space-indented) |
| Java 11 | Pass (`options.release.set(11)`) |
| **gameval constants, no magic numbers** (`AGENTS.md`) | **Fail: 5 raw ids** at lines 50–54 (`VARP_ATTACK_STYLE = 43`, `VARBIT_WEAPON_CATEGORY = 357`, `VARBIT_DEFENSIVE_CASTING = 2668`, `ENUM_WEAPON_STYLES = 3908`, `PARAM_ATTACK_STYLE_NAME = 1407`). The legality gate's step 6 also needs each id resolved to its gameval name. |
| BSD-2 copyright header per file | Missing (only matters if published) |
| Real tests | **None.** `DpsBridgePluginTest` is only the dev-client launcher (`main` → `RuneLite.main`). Gradle's `test` task passing proves nothing about behaviour. |

## Gaps to fill from Javadoc and core plugin sources

- Client-thread rules and `ClientThread.invoke` / `invokeLater`.
- Events we need: `GameTick`, `ItemContainerChanged` (worn, inventory, bank), `VarbitChanged`, `HitsplatApplied` (own hits), `InteractingChanged`, bank open/close.
- Rune pouch and spellbook varbits (research note gives the gameval names; confirm with the Var inspector).
- `ItemManager` / `ItemComposition`, enum and struct lookups.
- `Filepath` API details, executor shutdown (`shutdownNow` interrupts internally; the wiki does not say whether that counts against the interrupt rule).

## How to use the guide during development

1. Before a plugin ticket: read the matching core plugin source, then the Javadoc for each API it uses.
2. During Level 3 testing and new features: use the Var inspector to confirm each varbit (rune pouch, spellbook) before writing code.
3. After each edit: `node tools/legal-lint.mjs` (forbidden APIs) and the Code-Conventions style.
