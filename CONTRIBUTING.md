# Contributing

Thanks for helping. This project has two parts:

| Folder | What it is | Language | Licence |
|---|---|---|---|
| `app/` | MCP server that runs the OSRS Wiki DPS engine | TypeScript, Node 20.3+ | GPL-3.0 |
| `plugin/` | DPS Bridge RuneLite plugin (read-only game data export) | Java 11 (build with JDK 21) | BSD-2 |

By opening a pull request, you agree that your contribution is released under the licence of the folder it changes.

## Before you write code

1. **Open an issue first** for a new feature or a behaviour change. Describe what it does in game or in Claude. Small fixes (a typo, a clear bug with a test) can go straight to a PR.
2. **Plugin features need a legality verdict before any code.** A plugin that breaks Jagex's or RuneLite's rules can get its users banned. The maintainer gives a GREEN / AMBER / RED verdict on the issue. RED features are refused. The rules are in [`plugin/AGENTS.md`](plugin/AGENTS.md) ("Plugin Rules & Restrictions"). In short: the plugin only **reads** game state. It never sends input, never adds menu actions, and never adds boss-mechanic cues or prayer advice.

## Set up and run the checks

The same checks run in CI on every pull request. All three must pass before a merge.

**App** (needs Node 20.3+ and git; `npm run setup` clones the Wiki DPS engine at a pinned commit into `vendor/`):

```bash
cd app
npm ci
npm run setup
npm test
```

**Plugin** (needs JDK 21):

```bash
cd plugin
./gradlew build          # Windows: gradlew.bat build
node tools/legal-lint.mjs
```

`legal-lint` must report no RED. A file with an AMBER finding needs a `// legal-gate: GREEN <reason>` line that matches the verdict on the issue.

## Pull requests

- Fork the repo, make a branch, and open the PR against `main`. Nobody pushes to `main` directly; PRs are squash-merged.
- Keep one change per PR. Do not mix reformatting with a feature.
- **If you change `app/src/`, commit the rebuilt `app/dist/`.** `npm test` rebuilds it. Users run `app/dist/index.js` directly, without a build.
- Java follows RuneLite's code conventions (tabs, braces on the next line). A new Java file starts with the BSD-2 header from `DpsBridgePlugin.java`. See [`plugin/CLAUDE.md`](plugin/CLAUDE.md).
- CI for a PR from a fork waits until the maintainer approves the run.
- Changes to `.github/`, `.claude/`, `plugin/tools/`, `install.mjs`, the Gradle wrapper or `package.json` scripts get extra review, because they run code on contributors' machines.

## Keep accounts and data private

- Never commit or paste anything from `~/.runelite/` except `plugin-data/dps_bridge/` output, and remove your character name from that output first.
- Use synthetic data in fixtures and examples (see `examples/state.sample.json`).
- Never commit a key, a token or a password. Secret push protection is on, and it will block the push.
- To report a security problem, do not open a public issue with the details. Open an issue that asks for a private contact instead.
