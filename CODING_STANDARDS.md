# Coding Standards

`mattpocock-skills:code-review` reads this file on its Standards axis. It holds judgement calls only: if a linter, type checker or test can catch it, put it in that tool. Delete each section for a stack that this repo does not use.

## Architecture

- A new service, database, queue, cache, framework, external SaaS, region or auth approach in the diff, with no 3-line ADR in the spec or `docs/adr/`, is a hard violation (Architecture Golden Rule 11).
- Identifiers, schema fields, API payloads and tool definitions use the terms in `GLOSSARY.md`. A synonym for a glossary term is a finding.
- The diff respects the accepted decisions in `docs/adr/`.

## Module design

- A module hides real complexity behind a small interface. These are findings (shallow modules, Golden Rule 5):
  - many thin interfaces over little behaviour
  - an interface with a single implementation, where nothing varies across the seam
- If each caller would configure a behaviour the same way (retry policy, model fallback, context truncation), the module holds it as a default.
- Parse external payloads into domain types at the boundary. Raw LLM SDK responses, vector-store chunks and unparsed rows stay inside the module that fetched them.
- A changed line that does not trace to the ticket (a drive-by refactor, reformat or comment edit) is a finding.
- Speculative code is a finding: a feature, option or setting that the ticket did not ask for, an abstraction with one use, or error handling for a state that the types or the domain make impossible.

## AI engineering

- An LLM or agent call in an auth, billing, data-mutation or compliance path is a hard violation if it has no schema validation, deterministic fallback and audit log (Golden Rule 10).
- Prompt assembly, output parsing, routing and state transitions stay apart from the live model call. Then tests can exercise them without the network.
- A model call that sends client personal information to a provider or region outside Canada is a hard violation (Golden Rule 7). An ADR in `docs/adr/` can name a different jurisdiction.
- Each structured model output and each tool or MCP input passes a schema check (Zod, Pydantic, or the platform's equivalent) at the boundary.
- Retrieved content and model output are data, not instructions. A tool call or write path that a retrieved document, a web page or a model output can trigger, without a schema check and an allowlist of actions, is a hard violation.
- Log each model output that reaches a user or a write path with the model ID and the prompt version. Then you can trace a bad output to its cause.
- A prompt starts inline. When it is reused or gets an eval, move it into its own module: static instructions and tools in the prefix, dynamic data at the end.
- Each agent loop, tool call and retrieval pipeline has an explicit step or retry limit, a timeout, and a structured error result.
- If the repo has evals, each change to a prompt, schema, retrieval or routing comes with a new or updated eval case.

## Tests

- Tests exercise the seam that the spec agreed. A mock of a private helper, or an assertion on internal call counts, is a finding.
- Mocks replace external boundaries only (model providers, third-party APIs, clocks), with deterministic fixtures.

## Retro log

<!-- /retro appends repo-specific judgement calls below -->
