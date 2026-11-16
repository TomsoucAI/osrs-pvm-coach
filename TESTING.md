# Testing the DPS Bridge

Each level only needs the previous one to pass. Stop at the first failure and paste the error to Claude Code.

## Level 0 · Engine works (no game, 5 s)
```bash
node app/dist/selftest.js          # expect 8 × PASS
node app/dist/inspect.js --file examples/state.sample.json
```
Expect: whip, Piety, max hit 47, DPS 7.753 vs Abyssal demon.

## Level 1 · Plugin compiles (first time ~2-5 min: downloads Gradle + RuneLite)
```bash
cd plugin
gradlew.bat build        # Windows
./gradlew build          # macOS/Linux
```
Expect `BUILD SUCCESSFUL`. If not: open Claude Code at the repo root and say *"fix the plugin build"*. It reads `plugin/AGENTS.md` (RuneLite's official rules) and has the RuneLite docs MCP.

## Level 2 · Dev client launches with the plugin
```bash
gradlew.bat run
```
1. Sidebar → Jagex auth panel → *Add Jagex Account* → log in → pick character → *Play Now*.
2. Wrench (Configuration) → search **DPS Bridge** → make sure it's on.

## Level 3 · Live data flows (the real test)
In a second terminal at the project root:
```bash
node app/dist/inspect.js --watch
```
Do each action in game and confirm the printout changes:

| Do this in game | Expect in the printout |
|---|---|
| Log in | `source=dps-bridge`, your name, your gear |
| Swap weapon | `Gear` + `Style` change |
| Change attack style (combat tab) | `Style` matches what you clicked |
| Drink a combat potion | `Levels` shows e.g. `attack 118/99` |
| Turn on Piety / Rigour / Augury | `Prayers` lists it, DPS goes up |
| Attack an NPC | `Target` = that NPC, DPS vs it |
| Log out | `✗ No live RuneLite data` (or WikiSync fallback) |

Raw file if you want to look: `~/.runelite/plugin-data/dps_bridge/state.json`
(Windows: `%USERPROFILE%\.runelite\plugin-data\dps_bridge\state.json`)

## Level 4 · Claude
Restart Claude Code / fully quit and reopen Claude Desktop, then ask:
- "What's my current loadout?"
- "What's my DPS on what I'm fighting?"
- "Compare my setup vs tentacle vs Slayer helm (i) on Abyssal demon"

## Troubleshooting
| Symptom | Fix |
|---|---|
| `java` not found / wrong version | Install JDK 21 (`winget install EclipseAdoptium.Temurin.21.JDK`), reopen terminal |
| Style wrong for one weapon | Tell Claude the weapon + style shown in game; `styleSlots` in the JSON shows what the game reported |
| `note: Item … isn't in the calculator's data` | Cosmetic/new item; `npm run update-calc` in `app/` (needs `npm install` + `npm run setup` first) |
| Plugin errors | Client log: `~/.runelite/logs/client.log`, search `DPS Bridge` / `dpsbridge` |
| Claude doesn't see the tools | Claude Code: `claude mcp list`. Desktop: Settings → Developer, check `osrs-dps` is running |
