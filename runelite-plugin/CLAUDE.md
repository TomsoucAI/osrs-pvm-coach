@AGENTS.md

## Legality gate

Every new or changed feature gets a verdict from the `osrs-legality-gate` skill before any code is written. `node tools/legal-lint.mjs` runs after each edit (hook in `.claude/settings.json`) and must show no RED; an AMBER file needs a `// legal-gate: GREEN <reason>` line from a GREEN verdict.
