# Bank Bridge (Plugin Hub): loopback WebSocket review for DPS Bridge

Research date: 2026-11-16. Issue: #19. Sources are primary: the plugin source at the commit pinned in the Hub manifest, the runelite/plugin-hub PRs and commits, the RuneLite wiki (git history of `runelite/runelite.wiki`), WikiSync source, and the consuming site's own page. Claims that are not verified are marked **UNVERIFIED**. Inferences are marked *(inference)*. Companion notes: [runelite-plugin-practice.md](runelite-plugin-practice.md) (legality, precedent), [runelite-developer-guide.md](runelite-developer-guide.md) (forbidden APIs), [osrsbestinslot-ux.md](osrsbestinslot-ux.md) (page layout, unlock-data gap).

The plugin was not installed or run. Source was cloned read-only; no build tool was run.

Code links point to the pinned commit: https://github.com/theshane0314/bank-bridge-plugin/tree/c5392d7805483a91cccc8e15ae06478cbd4af06b

## Bottom line

1. **Bank Bridge is a new hub plugin, merged 2026-08-25, with a loopback WebSocket that serves bank, inventory, worn gear, levels, username and quest/diary/CA state.** It was merged two years after "Plugins which expose player information over HTTP" went onto the Rejected Features page (added 2024-06-21). The line is still there today.
2. **No reviewer said anything about the WebSocket, the origin allowlist or the warning.** The two review comments were about a third-party dependency and `Thread.interrupt`. The bot merged both PRs. No written rule reconciles the HTTP line with this plugin or with WikiSync.
3. **WikiSync's WebSocket was approved by a RuneLite org member on 2024-03-19, three months before the HTTP line existed.** So WikiSync can be read as grandfathered. Bank Bridge cannot: it is the first new-plugin precedent after the rule.
4. **Bank Bridge also predates the 2026-10-05 forbidden-API rewrite, and breaks it today.** It writes its bank cache with `java.io.File` and `java.nio.file.Files`, not `Filepath`. The wiki says older plugins are grandfathered and that an existing plugin "does not guarantee it is allowed". So it is weak proof of what a new submission would pass now.
5. **Revised verdict for "serve own data over a loopback WebSocket from the plugin": AMBER (was RED).** There is precedent (two hub plugins, one new), but the rule text is unchanged, and no reviewer has stated the boundary. A plain HTTP server in the plugin stays **RED**. For DPS Bridge, keep the file design: a WebSocket buys us almost nothing (section 7).
6. **The architecture is a near copy of WikiSync's**, with the Java-WebSocket library replaced by a hand-written RFC 6455 server on `java.net.ServerSocket`: bind `127.0.0.1`, ports 37767-37776 with fallback, `Origin` **host** allowlist (`osrs.plaincandle.dev`, `localhost`, `127.0.0.1` + a user config field), request/response JSON plus a "bank changed" notification push. No token, no pairing.
7. **The origin check compares the host only.** Scheme and port are ignored, so any page on any `localhost` port passes. A local program can forge `Origin` (the install warning says so). Neither plugin checks `Host`.
8. **Most useful to borrow:** the `bankSource`/`bankAvailable` freshness fields (our plugin already skips placeholders and writes a `timestamp`), notification-only push (send "changed", let the page re-fetch), the quest/diary/CA read code for the Playbook's unlock data, and a stricter version of its origin check for #8 (full-origin match plus `Host`).
9. **Licence: BSD-2-Clause.** Copying is allowed if we keep the copyright notice and licence text. WikiSync is also BSD-2.

---

## 1. Manifest

Read with `gh api repos/runelite/plugin-hub/contents/plugins/bank-bridge` and `gh api "repos/runelite/plugin-hub/commits?path=plugins/bank-bridge"` on 2026-11-16 ([manifest](https://github.com/runelite/plugin-hub/blob/master/plugins/bank-bridge)).

| Field | Value |
|---|---|
| `repository=` | `https://github.com/theshane0314/bank-bridge-plugin.git` |
| `commit=` (pinned) | `c5392d7805483a91cccc8e15ae06478cbd4af06b` (2026-08-27, plugin `version=1.2.2`). This is also the repo's current `main` HEAD. |
| `authors=` | `theshane0314` (`author=Shalysa` in [`runelite-plugin.properties`](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/runelite-plugin.properties)) |
| `warning=` | Paraphrase: it opens a WebSocket on `127.0.0.1` so a gear-planning site can read bank, inventory, worn equipment, levels and completed quests, diaries and combat achievements; nothing is uploaded; only allowlisted sites can connect. Second paragraph: another program on the same machine "could forge the origin check" and read the same data; it cannot see the bank PIN or typed input. |
| Tags | Not in the manifest. In `runelite-plugin.properties` and `@PluginDescriptor` ([L39](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/BankBridgePlugin.java#L39)): `bank, sync, gear, dps, websocket, local, setup, inventory, quest, diary`. |
| `build=` | `standard` (no third-party dependencies). |
| Added | 2026-08-25, plugin-hub commit [`58332392`](https://github.com/runelite/plugin-hub/commit/58332392432510e6a223d11d6d08bf49d52e3a1f) ("create bank-bridge"), via PR [#14607](https://github.com/runelite/plugin-hub/pull/14607). First pinned commit `f3b078b`. |
| Last update | 2026-08-27, commit [`8d41beb6`](https://github.com/runelite/plugin-hub/commit/8d41beb62e3db6959dfbcc81a1196230737e3a14), via PR [#15560](https://github.com/runelite/plugin-hub/pull/15560). The warning text was widened to name quests, diaries and CAs. |
| `disabled=` | None. |

Plugin repo: created 2026-08-02, last push 2026-08-27, 0 stars (`gh api repos/theshane0314/bank-bridge-plugin`).

## 2. Hub review record

**PR [#14607](https://github.com/runelite/plugin-hub/pull/14607) "add bank-bridge"** (opened 2026-08-02, merged 2026-08-25 by `runelite-github-app[bot]`):

- The author's PR body states the design and the risks up front: loopback bind, port range shared with WikiSync on purpose, origin allowlist, missing `Origin` rejected, and the forged-origin limit. It argues a local program "could equally read the RuneLite directory", so it is not an escalation.
- The bot posted: "This plugin requires a review from a Plugin Hub maintainer." Reviewer and maintainer details are in a private Discord link (**UNVERIFIED** who approved).
- `ldavid432` (2026-08-16): not a required change, but the Java-WebSocket dependency cannot be auto-reviewed; OkHttp plus `build=standard` would be reviewed much faster. The author answered that OkHttp has no WebSocket *server*, and replaced the library with a hand-written server on `ServerSocket`.
- `Alexsuperfly` (2026-08-19): "use of thread interrupt is not allowed". The author removed it (commit `f3b078b`).
- **Nobody commented on the WebSocket itself, the origin allowlist, the HTTP rule or the warning text.** Both reviewers show as `CONTRIBUTOR` in the GitHub API, not org `MEMBER`; whether they are Hub reviewers is **UNVERIFIED**.

**PR [#15560](https://github.com/runelite/plugin-hub/pull/15560) "bank-bridge: update to 1.2.2"** (opened and merged 2026-08-27, bot merge, same "requires a review" note): adds the `unlocks` block (quests, diaries, CA tiers) behind a toggle, and updates the warning. No human comments.

Note: the first PR body says the plugin reads no varbits. That was true at `f3b078b`. At the pinned `c5392d7` it reads 58 varbit/varp constants (section 3). PR #15560 states this change.

## 3. Architecture at the pinned commit

| Topic | Fact | Source |
|---|---|---|
| WebSocket library | None. Hand-written RFC 6455 server on `java.net.ServerSocket` (`ws/WSWebsocketServer.java`, `ws/WSConnection.java`, `ws/Handshake.java`). Java-WebSocket 1.5.6 is test-only. | [build.gradle](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/build.gradle), PR #14607 comments |
| Bind | `new InetSocketAddress("127.0.0.1", port)`, backlog 8, `setReuseAddress(false)` so a second bind on Windows cannot sit on top of WikiSync. | [WSWebsocketServer L19-L32, L113-L118](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/ws/WSWebsocketServer.java#L19-L118) |
| Ports | 37767-37776, the same range as WikiSync. Bind failure → `onError(null)` → next port, once per port. A `@Schedule(period = 30s)` retries if all were busy. | [WebSocketManager L44-L45, L97-L109, L192-L208](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/WebSocketManager.java#L44-L208); [BankBridgePlugin L112-L116](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/BankBridgePlugin.java#L112-L116) |
| Origin allowlist | `ImmutableSet.of("osrs.plaincandle.dev", "localhost", "127.0.0.1")` plus the comma-separated `extraOrigins` config. | [WebSocketManager L52-L56, L266-L284](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/WebSocketManager.java#L52-L284) |
| Origin check | In `onOpen`: path must be `/`; empty `Origin` → reject; `new URI(origin).getHost()`, lower-cased, must be in the set. **Scheme and port are not checked.** On failure the connection is closed with no data. Note: the 101 upgrade response is already sent at that point; only the payload is withheld. | [WebSocketManager L129-L156, L238-L264](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/WebSocketManager.java#L129-L264); [WSConnection L138-L178](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/ws/WSConnection.java#L138-L178) |
| `Host` header | Not checked. | same |
| Auth / token / pairing | None ("no token" in the README). | [README L3-L6](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/README.md#L3-L6) |
| Limits | Handshake ≤ 8192 bytes, 10 s handshake timeout, messages ≤ 64 KiB (close 1009), unmasked frames → 1002, binary → 1003. No cap on connection count: each accepted socket gets its own thread. | [Handshake L24](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/ws/Handshake.java#L24); [WSConnection L54-L57](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/ws/WSConnection.java#L54-L57); [WSWebsocketServer L153-L164](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/ws/WSWebsocketServer.java#L153-L164) |
| Threading | All game reads run on the client thread in `@Subscribe` handlers. Results go into `SnapshotStore` as immutable lists behind `volatile` fields. `WebSocketManager` has no `Client` or `ClientThread` reference; requests are answered from the cache. Sends run on one daemon executor `bank-bridge-ws-%d`. | [SnapshotStore L19-L49](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/SnapshotStore.java#L19-L49); [WebSocketManager L28-L35, L67-L68](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/WebSocketManager.java#L28-L68) |
| Protocol | JSON text frames, `_wsType` discriminator. On connect the server pushes `Hello` (`pluginVersion`, `schemaVersion` 2, `username`, `bankAvailable`, `capturedAt`). Client sends `{"_wsType":"GetBank","sequenceId":N}`; server answers `GetBank` with the same `sequenceId` and a `payload`. On each bank change the server broadcasts `BankUpdated` with `capturedAt` only, and pages re-request. Bad input → `Error`. | [README L51-L90, L149-L160](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/README.md#L51-L160); [WebSocketManager L112-L189](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/WebSocketManager.java#L112-L189) |
| Payload | `version, capturedAt, username, bankAvailable, bankSource ("live"/"cache"/"none"), bank[], inventory[], equipment[]` (each `{id, qty}`, **per slot, not summed**), `levels` (real levels, lower-case skill name), `unlocks {quests, questIds, questPoints, diaries, combatAchievementTiers}`. | [PlayerData](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/PlayerData.java#L12-L40); [README L372-L373](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/README.md#L372-L373) |
| Item reads | Only from `ItemContainerChanged` for `InventoryID.BANK`, `InventoryID.INV`, `InventoryID.WORN` (gameval). It never calls `getItemContainer`. Skips `id <= 0`, `qty <= 0`, and in the bank any item whose `ItemComposition.getPlaceholderTemplateId() != -1`. | [BankBridgePlugin L120-L145, L214-L244](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/BankBridgePlugin.java#L120-L244) |
| Levels | `client.getRealSkillLevel(skill)` for every `Skill`, on each `StatChanged`. | [BankBridgePlugin L147-L151, L271-L285](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/BankBridgePlugin.java#L147-L285) |
| Unlocks | Every 50 game ticks (~30 s), on `GameTick`: `Quest.getState(client)` for every `Quest`; `VarPlayerID.QP`; 48 diary varbits `VarbitID.<REGION>_DIARY_<TIER>_COMPLETE` (Karamja easy/med/hard are `ATJUN_EASY_DONE` / `ATJUN_MED_DONE` / `ATJUN_HARD_DONE`), non-zero = done; 6 `VarbitID.CA_TIER_STATUS_*` served raw (2 = done, observed). | [AccountUnlocks L56-L95, L133-L260](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/AccountUnlocks.java#L56-L260); [BankBridgePlugin L59, L255-L268](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/BankBridgePlugin.java#L255-L268) |
| When bank is read | Only when the server sends the bank container (you open the bank). Cached in memory and, by default, on disk. `restore()` loads the disk cache on login unless a live bank was already read. `bankAvailable=false` until either exists. | [BankBridgePlugin L153-L183](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/BankBridgePlugin.java#L153-L183); [SnapshotStore L197-L229](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/SnapshotStore.java#L197-L229) |
| Account switch | On `LOGGED_IN` with a new `getAccountHash()`: clear, then restore that account's cache. On `LOGIN_SCREEN`: clear everything. A world hop keeps the data. | [BankBridgePlugin L153-L183](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/BankBridgePlugin.java#L153-L183) |
| Config | `shareInventory`, `shareEquipment`, `shareLevels`, `shareUnlocks`, `rememberBank`: **all default `true`**. `extraOrigins` default empty. There is no toggle for the bank itself. Off = served as empty, not absent. | [BankBridgeConfig L12-L76](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/BankBridgeConfig.java#L12-L76); [SnapshotStore L141-L155](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/SnapshotStore.java#L141-L155) |
| Lifecycle | `startUp()` starts the socket. `shutDown()` stops the socket, clears the store and resets state. Stop closes the `ServerSocket` (no interrupt, no join). | [BankBridgePlugin L91-L107](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/BankBridgePlugin.java#L91-L107); [WSWebsocketServer L72-L94](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/ws/WSWebsocketServer.java#L72-L94) |
| Files written | Yes: `.runelite/bank-bridge/bank-<unsigned accountHash>.json` (`{version, capturedAt, items[]}`, ids and quantities only), written 5 s after the last bank change, tmp file then atomic move, off the client thread. **Uses `java.io.File`, `java.nio.file.Files` and `RuneLite.RUNELITE_DIR`, not `Filepath`.** | [SnapshotStore L5-L8, L35, L59-L65, L162-L190, L241-L244](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/SnapshotStore.java#L35-L244); [BankBridgePlugin L46, L291-L306](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/BankBridgePlugin.java#L291-L306) |

**Its "account safety" gate.** A Gradle task `accountSafetyCheck` regex-scans the source and fails the build on widget, key/mouse, `VarClientStr`/`VarClientInt`, chat, menu, script-hook, `runScript`/`getIntStack` and credential-shaped names. Var reads are allowed only in `AccountUnlocks.java` and only for named constant families ([build.gradle L103-L142, L144](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/build.gradle#L103-L144)). With `build=standard` the Hub replaces `build.gradle`, so this gate does not run in Hub CI (the author says so in both PRs).

Two gaps in that gate *(inference from the code)*:
- `Quest.getState(client)` itself calls `client.runScript(ScriptID.QUEST_STATUS_GET, id)` and reads `client.getIntStack()[0]` ([RuneLite Quest.java L257-L269](https://github.com/runelite/runelite/blob/ac615d94d50b52786849fe93be3aad83ac13226a/runelite-api/src/main/java/net/runelite/api/Quest.java#L257-L269)). So the plugin does run a game script, through a core API. That is fine under RuneLite rules (`Client.runScript` is a "Sensitive API", allowed), but the plugin's "runScript banned" claim is weaker than it reads. A regex scan cannot see calls made inside library code.
- The allowlist still permits a `POH_` family after 1.2.1 removed all house reads, and the README says "four" families but lists three ([README L203](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/README.md#L203)). Cosmetic.

**Other observations.**
- `Hello` sends the display name to any allowed page at connect, before any request ([WebSocketManager L149-L155](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/WebSocketManager.java#L149-L155)).
- The README's in-game test section tells developers to use `--insecure-write-credentials` ([README L328-L331](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/README.md#L328-L331)). Our practice note (section 6) says not to use that flow. Do not copy it.
- No text in the code, README, PR comments or site page was addressed to an AI agent. Nothing was acted on.

## 4. Consuming site

- The README says it is built for [osrs.plaincandle.dev](https://osrs.plaincandle.dev), and that "the protocol is generic" ([README L8](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/README.md#L8)). It also says it replaces the Hub plugin `osrs-bank-sync`, which pushes the bank to an HTTP URL ([README L12-L16](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/README.md#L12-L16); that plugin's [manifest](https://github.com/runelite/plugin-hub/blob/master/plugins/osrs-bank-sync) defaults to `http://127.0.0.1:8484`).
- The site page (fetched 2026-11-16) has a "Fit builds to what I own" mode. It tells the user to install Bank Bridge, open the bank once, then connect. It says the bank is never uploaded, and that the plugin refuses every other site. One exception: an "Ask the sim" action sends one skill level in a request header to the site's server.
- The site text is **stale**: it still says the plugin is "awaiting Plugin Hub approval", and says the plugin serves item ids and quantities only. At `c5392d7` it also serves username, levels and unlocks.
- How the page connects: the repo ships a reference browser client, [`test-page/bank-bridge.js`](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/test-page/bank-bridge.js#L11-L95). It scans `ws://127.0.0.1:37767` to `37776`, waits up to 1.5 s per port for a `Hello`, then correlates replies by `sequenceId` and listens for `BankUpdated`. That the live site uses this exact file is **UNVERIFIED**.
- The README says browsers allow `ws://127.0.0.1` from an `https://` page because loopback is a "potentially trustworthy origin" ([README L22-L25](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/README.md#L22-L25)). This browser behaviour was not checked against a browser spec here (**UNVERIFIED**); the wiki DPS calculator relies on the same behaviour with WikiSync.

## 5. Compared with WikiSync

WikiSync source read at its Hub-pinned commit `1ff4ea06` ([manifest](https://github.com/runelite/plugin-hub/blob/master/plugins/wikisync); [WebSocketManager.java](https://github.com/weirdgloop/WikiSync/blob/1ff4ea0653395b552844d658d3668815d82e0a79/src/main/java/com/andmcadams/wikisync/dps/WebSocketManager.java#L34-L147); [WSWebsocketServer.java](https://github.com/weirdgloop/WikiSync/blob/1ff4ea0653395b552844d658d3668815d82e0a79/src/main/java/com/andmcadams/wikisync/dps/ws/WSWebsocketServer.java#L15)).

| Aspect | WikiSync | Bank Bridge |
|---|---|---|
| Hub approval of the WebSocket | PR [#5694](https://github.com/runelite/plugin-hub/pull/5694), merged by hand 2024-03-19 by `raiyni` (org `MEMBER`). Only review note: change `log.info` to `log.debug`. | PR #14607, bot merge 2026-08-25 after a required maintainer review. No comment on the socket. |
| Date vs HTTP rule (2024-06-21) | Before | After |
| Library | Java-WebSocket 1.5.6 (`build.gradle`) | None (own RFC 6455 code), `build=standard` |
| Bind | `127.0.0.1` | `127.0.0.1` |
| Ports | 37767-37776, fallback | same range, same fallback code shape |
| Allowlist | host in `localhost`, `dps.osrs.wiki`, `tools.runescape.wiki` | host in `osrs.plaincandle.dev`, `localhost`, `127.0.0.1` + user field |
| Check shape | `new URI(origin).getHost()` in set; scheme and port ignored. Its own comment: "This is not foolproof". | Same, plus explicit empty-`Origin` reject. |
| Request handling | `GetPlayer` runs `clientThread.invokeLater` per request | Answered from a cache; socket code has no client reference |
| Data | Worn gear, levels, username (for the DPS calc) | Bank, inventory, worn, levels, username, quests, diaries, CA tiers |
| Read-only | Yes (one request type) | Yes (one request type) |
| Install warning about the socket | **No.** The WikiSync `warning=` is about its hiscore-style upload, not the socket. | Yes, including the forged-origin caveat |

What both share, and what looks like the accepted pattern *(inference)*: loopback-only bind, a fixed allowlist of named first-party sites, read-only data about the player's own account, one request type, no remote upload by the plugin. Bank Bridge's code reuses WikiSync's names and structure (`ALLOWED_ORIGIN_HOSTS`, `nextPort`, `ensureActive`, `onError(null)` fallback, `WSWebsocketServer`) *(inference: derived from WikiSync, which is BSD-2)*.

The warning is not part of a shared pattern: WikiSync has none for its socket. The [Information about the Plugin Hub](https://github.com/runelite/runelite/wiki/Information-about-the-Plugin-Hub) page requires a warning only for plugins that talk to **third-party servers**. Bank Bridge's warning is voluntary *(inference)*.

## 6. Re-evaluating the RED verdict

**The rule text today.** The [Rejected or Rolled Back Features](https://github.com/runelite/runelite/wiki/Rejected-or-Rolled-Back-Features/1bf149190bd67811e81056aba45454eb124f09b2) page (wiki revision `1bf1491`, 2026-11-10) still lists "Plugins which expose player information over HTTP." (line 35 of the page source). The line was added on 2024-06-21 in wiki commit `f64bfaa` "Rejected-Features: add http plugins (#93)" and has not changed since. Example-plugin [`AGENTS.md`](https://github.com/runelite/example-plugin/blob/46e14f2c448fab6cbc599df1015b9631dcf1fc52/AGENTS.md#L160) line 160 still says "No exposing player information over HTTP".

**What else the page says now.**
- Wiki commit `0b82e79` (2026-10-05, after Bank Bridge was merged) added the forbidden-function list: `java.io` file APIs (use `Filepath`), any network client other than OkHttp, own `Gson`/OkHttp instances. It also added: "some older plugins are grandfathered into these rules", and an existing plugin "does not guarantee it is allowed".
- "Network IO" and `Client.runScript` are "Sensitive APIs": allowed, with extra review.
- Nothing on the page mentions WebSocket, loopback, origin allowlists or install warnings. **No stated rule reconciles the HTTP line with WikiSync or Bank Bridge.**

**How to read the evidence.**

| Evidence | Points to |
|---|---|
| HTTP line still on the page; also in first-party `AGENTS.md` | RED |
| WikiSync's socket was approved before the HTTP line existed | Neutral (grandfathered) |
| Bank Bridge: new plugin, approved after the HTTP line, socket design stated in the PR body, no objection | AMBER: reviewers accept a loopback WebSocket with a fixed allowlist, at least in 2026-08 |
| Bank Bridge would fail the 2026-10-05 `java.io` rule today; the grandfather clause | Its approval is weaker evidence for a new submission now |
| Who approved, and whether they weighed the HTTP line: private Discord | **UNVERIFIED** |

Possible reading *(inference, UNVERIFIED)*: reviewers treat "over HTTP" as a plain HTTP API (e.g. the `runelite-dev-mcp` style `localhost:3000` server in our practice note), and tolerate a WebSocket gated by a named-site allowlist. The rule text does not say this.

**Revised verdicts:**

| Feature | Old | New | Why |
|---|---|---|---|
| Plain HTTP server in the plugin serving player data | RED | **RED** | Literal rule text. No precedent found. |
| Loopback WebSocket in the plugin, fixed origin allowlist, read-only own data | RED | **AMBER** | One post-rule new-plugin precedent, no reviewer objection, but the rule text is unchanged and the approval reasoning is not public. Expect manual review; a rejection is possible. |
| DPS Bridge's choice | file + stdio | **keep file + stdio** | Section 7: a socket gives us almost nothing, and it adds review risk, a thread-per-connection server, and a security surface. Under our own rule (reviewer-reject = bannable), AMBER is not worth taking for no gain. |

Update for `runelite-plugin-practice.md` (not edited here): finding 3 and the verdict table row should read AMBER for a loopback WebSocket, with a link to this note. Change it only when you approve.

## 7. What we can borrow

### For our plugin (bank export, #1)

Note: this section was first written against `main` at `374f603`, which had no bank code. At `80822a7`, `DpsBridgePlugin.java` already writes `bank.json` (`timestamp` + `items`) on each `ItemContainerChanged(BANK)` and already skips empty slots, `BANK_FILLER` and placeholders (`DpsBridgePlugin.java` L182-L212). Items 1 and 2 are checked against `80822a7`.

1. **Skip placeholders:** already done in our plugin (`getPlaceholderTemplateId() != -1`, L209-L210), the same rule as Bank Bridge ([L229-L238](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/BankBridgePlugin.java#L229-L238)). Nothing to borrow.
2. **Freshness fields** in `bank.json`: we already write `timestamp` (epoch ms), the same role as Bank Bridge's `capturedAt`. Not yet in our file: a `bankSource` (`live` / `cache`) value and an `available` flag. #8's "bank snapshot age" chip can use `timestamp` as it is.
3. **Per-slot list or summed map: decide it in the spec.** Bank Bridge serves per slot and tells consumers to sum by id. For our optimizer a summed `{id: qty}` map is simpler; per-slot keeps tab order. Parking-lot question for `/to-spec`.
4. **Account handling:** key the file by `getAccountHash()` (Bank Bridge puts the hash in the file name, not in the file), clear on `LOGIN_SCREEN`, restore on `LOGGED_IN` with a new hash, and keep data on a world hop ([L153-L183](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/BankBridgePlugin.java#L153-L183)).
5. **Debounced write:** coalesce bursts of `ItemContainerChanged(BANK)` (one per deposited item) into one write after 5 s, off the client thread, tmp file then move ([L291-L306](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/BankBridgePlugin.java#L291-L306)). Use `Filepath` for the I/O, not Bank Bridge's `java.io` code.
6. **Unlock data for the Playbook** (the open question in [osrsbestinslot-ux.md](osrsbestinslot-ux.md) section 6): copy the read shape of [AccountUnlocks.java](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/AccountUnlocks.java#L56-L260): `Quest.getState` for all quests (full vocabulary, plus `questIds`), `VarPlayerID.QP`, the 48 diary varbits including the Karamja `ATJUN_*` names, the 6 `CA_TIER_STATUS_*` varbits. Poll every 50 ticks instead of on `VarbitChanged`. Confirm each varbit in the Var inspector first (developer-guide note). This is new scope: park it for the spec.
7. **Per-data-type toggles, served as empty, not absent.** Useful if we ever publish. Bank Bridge defaults everything to on; for a published build, our own preference should be decided in the spec.
8. **Static gate idea:** add Bank Bridge's banned patterns (`Widget`, `KeyListener`, `VarClientStr`, `ChatMessage`, `MenuEntry`, `runScript`) to `tools/legal-lint.mjs` as warnings. Know the limit: a regex cannot see calls inside library code (`Quest.getState` runs a script).

### For #8 (UI server in `app/`, Origin/Host guard)

The RuneLite rules do not apply to `app/` (it is not a hub plugin), but the threat model is the same.

1. **Reject a missing `Origin` on anything that is not a plain same-origin page load,** and parse it with a URL parser, not string matching ([WebSocketManager L238-L264](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/WebSocketManager.java#L238-L264)).
2. **Do better than host-only:** compare the full origin (scheme + host + port) to the exact value `http://127.0.0.1:<our port>` (and the `localhost` form if we serve it). Bank Bridge and WikiSync ignore the port, so any page on any `localhost` port passes their check.
3. **Check `Host` too.** Neither plugin does. For a WebSocket, `Origin` blocks a DNS-rebinding page. For our plain HTTP GET and SSE endpoints, a same-origin request from a rebinding page may carry no `Origin` header, so the `Host` check is the guard that matters *(inference from how browsers set `Origin`; UNVERIFIED here: check against the Fetch standard and add a test that sends a foreign `Host` with no `Origin`)*. The #8 acceptance criteria already ask for "foreign Host → 403".
4. **Bound input:** handshake/header size, a header timeout, a body cap, and a connection cap. Node's `http` server has defaults for some of these (**UNVERIFIED**: check the Node docs through Context7 before writing #8).
5. **Notification-only push:** send "changed" plus `capturedAt` on SSE, and let the page re-fetch the plan. Bank Bridge does this with `BankUpdated` ([WebSocketManager L112-L126](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/WebSocketManager.java#L112-L126)). It keeps SSE events small and keeps one code path for data.
6. **State the threat model in plain words, like the Bank Bridge warning:** the guard protects against **websites**, not against **local programs**. A local program can forge `Origin` and `Host`. It can also simply read `~/.runelite/plugin-data/dps_bridge/state.json` and `bank.json` from disk, with no server at all. So #8's guard adds no risk beyond our files, and claims no protection against local malware.
7. **A `Hello`-style version field:** put `schemaVersion` in `state.json`/`bank.json` so the app can refuse a file it does not understand.

### Would a WebSocket in our plugin give us anything?

Little.
- **Live push to the browser:** #8 already gets it with plugin → file → Node file watcher → SSE. The extra latency is the file-watch debounce, well under a game tick budget for between-fight planning *(inference)*.
- **Third-party sites reading our data:** not a goal.
- **Cost:** AMBER review risk, a hand-written or third-party socket server inside the client, per-connection threads, and a network-reachable data surface.

One side option, **parked** for triage: Bank Bridge allowlists `localhost` and `127.0.0.1` on purpose, for "developing your own page" ([BankBridgeConfig L67-L76](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/src/main/java/com/plaincandle/bankbridge/BankBridgeConfig.java#L67-L76)). So our #8 page on `http://127.0.0.1:<port>` could read Bank Bridge from the browser, for users who already run it. It would not replace our plugin: Bank Bridge has no rune pouch, spellbook, attack style or target. It adds a dependency on a third-party plugin.

## 8. Licence

- Bank Bridge: **BSD-2-Clause**, "Copyright (c) 2026, Shalysa" ([LICENSE](https://github.com/theshane0314/bank-bridge-plugin/blob/c5392d7805483a91cccc8e15ae06478cbd4af06b/LICENSE); GitHub API `license.spdx_id = BSD-2-Clause`).
- Copying is allowed. Source redistribution must keep the copyright notice, the two conditions and the disclaimer; binary redistribution must reproduce them in docs or other materials. Put the notice in a header on any copied file. Our plugin is also meant to carry BSD-2 headers (developer-guide note).
- WikiSync, which Bank Bridge appears to derive from, is also BSD-2-Clause (GitHub API).
- Copy patterns and small snippets (placeholder skip, unlock reads). Do not copy the hand-written WebSocket server: we do not need it, and it is the least-reviewed part.

## Open questions

- Who approved PR #14607, and did they weigh the HTTP line? (private Discord, **UNVERIFIED**)
- Would Bank Bridge pass review today under the 2026-10-05 `java.io` rule? *(inference: no, without a `Filepath` change)*
- Browser rules for `ws://127.0.0.1` from `https://` pages and for `Origin` on same-origin GET/SSE: not checked against a spec here.
- Does the live osrs.plaincandle.dev use `test-page/bank-bridge.js` as is? (**UNVERIFIED**)

## Sources

- Hub manifest and history: https://github.com/runelite/plugin-hub/blob/master/plugins/bank-bridge ; commits https://github.com/runelite/plugin-hub/commit/58332392432510e6a223d11d6d08bf49d52e3a1f , https://github.com/runelite/plugin-hub/commit/8d41beb62e3db6959dfbcc81a1196230737e3a14
- Hub PRs: https://github.com/runelite/plugin-hub/pull/14607 , https://github.com/runelite/plugin-hub/pull/15560 ; WikiSync: https://github.com/runelite/plugin-hub/pull/5694 , https://github.com/runelite/plugin-hub/pull/5855
- Plugin source at the pinned commit: https://github.com/theshane0314/bank-bridge-plugin/tree/c5392d7805483a91cccc8e15ae06478cbd4af06b
- RuneLite `Quest.java`: https://github.com/runelite/runelite/blob/ac615d94d50b52786849fe93be3aad83ac13226a/runelite-api/src/main/java/net/runelite/api/Quest.java#L257-L269
- Rejected or Rolled Back Features (revision `1bf1491`): https://github.com/runelite/runelite/wiki/Rejected-or-Rolled-Back-Features/1bf149190bd67811e81056aba45454eb124f09b2 ; wiki git history: https://github.com/runelite/runelite.wiki.git (commits `f64bfaa`, `0b82e79`)
- Information about the Plugin Hub: https://github.com/runelite/runelite/wiki/Information-about-the-Plugin-Hub
- Example-plugin `AGENTS.md` (`46e14f2`): https://github.com/runelite/example-plugin/blob/46e14f2c448fab6cbc599df1015b9631dcf1fc52/AGENTS.md
- WikiSync at its pinned commit: https://github.com/weirdgloop/WikiSync/tree/1ff4ea0653395b552844d658d3668815d82e0a79
- osrs-bank-sync manifest: https://github.com/runelite/plugin-hub/blob/master/plugins/osrs-bank-sync
- Consuming site: https://osrs.plaincandle.dev (read 2026-11-16)
