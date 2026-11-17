# Security policy

## Supported versions

Only the latest commit on `main` is supported, including the committed `app/dist/` bundle. Fixes are not backported.

## Report a vulnerability

Do not open a public issue. Use **Report a vulnerability** in this repo's [Security tab](https://github.com/TomsoucAI/osrs-pvm-coach/security). The report is private: only the maintainer sees it.

Please include what you found, how to reproduce it, and what an attacker could do with it.

**Never send account secrets in a report:** no Jagex or RuneLite password, no `~/.runelite/` session files (`jagex-accounts.dat`, `credentials.properties`), no character names. They are not needed to reproduce a bug.

## Scope

In scope:
- the MCP server (`app/`), including the committed `app/dist/` bundle
- the DPS Bridge RuneLite plugin (`plugin/`)
- `install.mjs` and the CI workflows in `.github/`

Out of scope (report to the project that owns it):
- the OSRS Wiki DPS calculator engine: [weirdgloop/osrs-dps-calc](https://github.com/weirdgloop/osrs-dps-calc)
- RuneLite itself: [runelite/runelite](https://github.com/runelite/runelite)

## What to expect

This is a hobby project with one maintainer. You get an answer within 7 days. When a fix is ready, the advisory is published with credit to you, unless you ask not to be named.
