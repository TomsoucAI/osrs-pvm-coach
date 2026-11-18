## Never list

A plugin that breaks Jagex's or RuneLite's rules can get its users banned. Before you add or change a plugin feature, get a verdict from the `osrs-legality-gate` skill.

<!-- never-list: keep this block identical in README.md and AGENTS.md -->
The plugin reads game state and writes local files. The app reads those files and answers questions before a trip. Never build any of these:

1. **No game input.** No code sends clicks, key presses, mouse moves, menu actions or camera moves to the game client.
2. **No modified client.** Run the official RuneLite client or its developer client (`gradlew run`). Never an injected, patched or third-party client.
3. **No HTTP from the plugin.** The plugin opens no socket and no server, and calls no URL. Its only output is files under `~/.runelite/plugin-data/dps_bridge/`.
4. **No in-fight prayer, attack or position prompts.** Nothing tells the player what to pray, what to attack or where to stand during a fight. The allowed output is planning: gear, DPS, a defence number.
5. **No Computer Use.** No agent reads the screen or drives the game window, keyboard or mouse.
<!-- /never-list -->

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, each string equal to its role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.
