# GitHub repo hardening: .gitignore, secrets, settings and README for a public repo

Research date: 2026-11-17. Sources are primary (git-scm.com, docs.github.com, the `github/gitignore` repo, OpenSSF Scorecard docs, npm docs, Gradle docs, Claude Code docs). Repo facts come from read-only `git` and `gh api` calls on 2026-11-17. Claims that are not verified are marked **UNVERIFIED**.

## Bottom line

1. **The base is good.** Public repo, a ruleset on `main`, secret scanning, push protection, private vulnerability reporting, fork CI approval for all outside contributors, read-only `GITHUB_TOKEN`, and a `pull_request` CI with `contents: read`. Keep all of it.
2. **Biggest open item: your personal email is in public history.** 14 author entries and 4 committer entries use a personal address, not the noreply address. Changing the config now does not change old commits. Decide: accept it, or rewrite history now while the repo is one day old and has 0 forks.
3. **Turn on Dependabot alerts and security updates.** They are off. Then add `.github/dependabot.yml` for `npm` (`/app`), `gradle` (`/plugin`), `github-actions` (`/`) and `pip` (`/evals`). A Dependabot npm PR needs a rebuilt `app/dist/` before merge.
4. **Pin the three CI actions to full commit SHAs**, then turn on "Require actions to be pinned to a full-length commit SHA" and allow only GitHub-made actions. The `@v7` tag can be moved; a SHA cannot.
5. **Add `SECURITY.md`** that points to private vulnerability reporting. CONTRIBUTING already says it, but GitHub and Scorecard look for the file.
6. **Extend `.gitignore`** with secrets (`.env`), Claude Code personal files, Python caches, IDE and OS files, and logs. Never add the template lines `dist` or `*.jar`: they would hide `app/dist/` and the Gradle wrapper.
7. **Add `.github/CODEOWNERS`**, but do not turn on "Require review from Code Owners" while you are the only maintainer. You cannot approve your own PR, so it would block you.
8. **Add `"private": true` to `app/package.json`.** npm then refuses to publish it by mistake.
9. **Fix the README.** It is rich, but it has stale facts (wrong folder name, a "Limits (v0.1)" list that contradicts the tools table, "not compiled in my environment"). Add a clone step, a CI badge and a short Contributing / Security section. Set a repo description and topics.
10. **Licence detection:** GitHub shows no licence for the repo, because there is no root licence file. Decide how to show two licences at the root (see section 3.10).

---

## 1. `.gitignore`

### 1.1 How it works

- **Sources and precedence.** Git reads patterns from four places. Highest first: the command line, `.gitignore` files, `$GIT_COMMON_DIR/info/exclude`, then the file named by `core.excludesFile`. Inside one level, "the last matching pattern decides the outcome." A `.gitignore` in a deeper folder overrides one in a higher folder ([gitignore](https://git-scm.com/docs/gitignore)).
- **Who shares it.** The repo `.gitignore` is committed, so every clone gets it ([gitignore](https://git-scm.com/docs/gitignore); [GitHub: Ignoring files](https://docs.github.com/en/get-started/git-basics/ignoring-files)). `.git/info/exclude` is for patterns that "do not need to be shared." The global file (`core.excludesFile`, default `$XDG_CONFIG_HOME/git/ignore` or `~/.config/git/ignore`) applies to all repos on one machine only ([gitignore](https://git-scm.com/docs/gitignore)).
- **Consequence for this repo.** Your global ignore of `docs/explain/` protects this PC only. A contributor, your second machine without the same global file, or a fresh clone does not get it.
- **Negation.** A `!` prefix re-includes a file that an earlier pattern excluded. But "it is not possible to re-include a file if a parent directory of that file is excluded" ([gitignore](https://git-scm.com/docs/gitignore)). So `!gradle-wrapper.jar` works after `*.jar`, but not after `plugin/gradle/`.
- **Slashes.** A trailing `/` matches only directories. A leading or middle `/` anchors the pattern to the folder of that `.gitignore`. Without one, the pattern matches at any depth. `**/` matches in all folders ([gitignore](https://git-scm.com/docs/gitignore)).
- **Already-tracked files are not affected.** "Files already tracked by Git are not affected." To stop tracking a file, run `git rm --cached <file>`, then add it to `.gitignore` ([gitignore](https://git-scm.com/docs/gitignore); [GitHub: Ignoring files](https://docs.github.com/en/get-started/git-basics/ignoring-files)). This does not remove the file from history (see section 2.3).
- **Check a rule.** `git check-ignore -v <path>` shows which pattern matched. The gitignore page only lists it under "See also" ([gitignore](https://git-scm.com/docs/gitignore)); the exact output format is **UNVERIFIED** here.
- **Templates.** GitHub keeps "an official list of recommended `.gitignore` files" in [github/gitignore](https://github.com/github/gitignore) ([GitHub: Ignoring files](https://docs.github.com/en/get-started/git-basics/ignoring-files)).

### 1.2 What the templates say, and what does not fit this repo

| Template | Useful lines for this repo | Lines you must NOT copy |
|---|---|---|
| [Node.gitignore](https://github.com/github/gitignore/blob/main/Node.gitignore) | `node_modules/`, `*.log`, `npm-debug.log*`, `*.tsbuildinfo`, `*.tgz`, `coverage`, `.env`, `.env.*`, `!.env.example` | `dist` (would ignore the committed `app/dist/`), `out`, `build/Release` |
| [Gradle.gitignore](https://github.com/github/gitignore/blob/main/Gradle.gitignore) | `.gradle`, `**/build/`, `!**/src/**/build/`, `!gradle-wrapper.jar`, `!gradle-wrapper.properties`, `.gradletasknamecache` | none |
| [Java.gitignore](https://github.com/github/gitignore/blob/main/Java.gitignore) | `*.class`, `hs_err_pid*`, `replay_pid*` | `*.jar` and `*.zip` (would ignore `gradle-wrapper.jar` unless you also add `!gradle-wrapper.jar`) |
| [Python.gitignore](https://github.com/github/gitignore/blob/main/Python.gitignore) (for `evals/`) | `__pycache__/`, `*.py[codz]`, `.venv`, `venv/`, `.pytest_cache/` | `dist/`, `build/`, `lib/` (too broad for this repo) |
| [Global/JetBrains.gitignore](https://github.com/github/gitignore/blob/main/Global/JetBrains.gitignore), [Global/VisualStudioCode.gitignore](https://github.com/github/gitignore/blob/main/Global/VisualStudioCode.gitignore) | `.idea/` files, `*.iws`, `.vscode/*` with its `!` exceptions | none |

Gradle says the wrapper JAR belongs in version control: "Adding the JAR file to version control is expected" ([Gradle Wrapper](https://docs.gradle.org/current/userguide/gradle_wrapper.html)). RuneLite's `plugin/AGENTS.md` forbids committed build output: "no `.class` files, `out/` directories, or `.tmp` directories."

Claude Code adds `**/.claude/settings.local.json` to your **global** excludes the first time it writes that file. If someone creates it by hand, they must "add it to `.gitignore` yourself" ([Claude Code settings](https://code.claude.com/docs/en/settings)). For `CLAUDE.local.md` the docs say: "Add `CLAUDE.local.md` to your `.gitignore`" ([Claude Code memory](https://code.claude.com/docs/en/memory)). `.claude/settings.json` is meant to be committed ([Claude Code settings](https://code.claude.com/docs/en/settings)), and this repo does so.

### 1.3 Current state

Current `.gitignore` (5 lines): `node_modules/`, `vendor/`, `app/dist/*.test.js`, `plugin/build/`, `plugin/.gradle/`. `git status --ignored` today shows only expected files: `app/dist/core.test.js`, `app/node_modules/`, `docs/explain/` (global), `plugin/.gradle/`, `plugin/build/`, `vendor/`. `git ls-files` shows no build output, no `.env`, no credential file. **Status: Done for today's files, Gap for files that a contributor or a new tool can create.**

### 1.4 Recommended `.gitignore` for this repo

Keep the five current lines. Add the rest. Each line traces to a template above or to this repo's tools.

```gitignore
# Dependencies
node_modules/

# Wiki DPS engine, cloned by app/setup.mjs (GPL, not ours to commit)
vendor/

# app/dist/ is committed on purpose: users run app/dist/index.js without a build.
# Only the test bundle is ignored. Never add a bare "dist" line.
app/dist/*.test.js

# Gradle (the wrapper in plugin/gradle/wrapper/ stays committed)
plugin/build/
plugin/.gradle/
.gradletasknamecache

# Java
*.class
hs_err_pid*
replay_pid*

# Python (evals/)
__pycache__/
*.py[codz]
.venv/
venv/
.pytest_cache/

# Node logs and caches
*.log
npm-debug.log*
*.tsbuildinfo
*.tgz
coverage/

# Secrets and local environment (evals need ANTHROPIC_API_KEY)
.env
.env.*
!.env.example

# RuneLite account files: never commit, even by mistake
credentials.properties
jagex-accounts.dat

# Claude Code personal files
.claude/settings.local.json
CLAUDE.local.md

# Editors and OS
.idea/
*.iml
*.iws
out/
.vscode/
.DS_Store
Thumbs.db
desktop.ini
```

Notes:
- `out/` is safe here: no tracked path is named `out`. Check with `git ls-files | grep /out/` before you add it.
- `docs/explain/`: optional. If you want explainer pages to stay local on both machines and in every clone, add `docs/explain/` here too. If you may publish one later, leave it in the global file only. Your call.
- After the edit, `git status --ignored --short` must show the same list as today, and `git ls-files -ci --exclude-standard` must print nothing (no tracked file matches an ignore rule). The flags of that second command are **UNVERIFIED** in the fetched docs; run it and read the output.

---

## 2. What must never be in a public repo

### 2.1 The list

| Never commit | Why / source | This repo |
|---|---|---|
| Secrets: API keys, tokens, passwords, private keys | Secret scanning scans "your entire Git history on all branches" and public repos get it free ([About secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/about-secret-scanning)). A leak is public the moment you push. | None tracked. Push protection on. `evals/` reads `ANTHROPIC_API_KEY` from the environment, which is correct. |
| Credentials and session files | Same as above. | `.claude/settings.json` denies Claude reads of `~/.runelite/credentials.properties` and `jagex-accounts.dat`. Add both names to `.gitignore` too (1.4). |
| Local config: `.env`, IDE folders, `settings.local.json`, `CLAUDE.local.md` | Templates and Claude Code docs in 1.2. | Not tracked today. Gap in `.gitignore` only. |
| Personal data: real character names, account IDs, emails | CONTRIBUTING already requires synthetic fixtures. | Fixtures look synthetic (`examples/state.sample.json`). Commit emails: Gap, see 2.4. |
| Build output and generated binaries | Scorecard Binary-Artifacts (High risk): generated executables "can't be meaningfully reviewed" ([Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md#binary-artifacts)). RuneLite `AGENTS.md`: no `.class`, `out/`, `.tmp`. | `app/dist/*.js` is a deliberate exception (see 2.2). `gradle-wrapper.jar` is expected by Gradle. |
| Large files | Git warns over 50 MiB; GitHub blocks files over 100 MiB; keep the repo "ideally less than 1 GB" ([About large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)). For binaries, GitHub suggests releases instead of tracked files (same page). | Largest file is `app/dist/index.js` at about 6 MB. GitHub reports the repo at about 2.6 MB packed. Fine. |

### 2.2 The committed `app/dist/` bundle

- It is JavaScript, so a person can read it in principle. Scorecard allows files that are "both reviewable source and executable" ([Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md#binary-artifacts)). Whether Scorecard flags a 6 MB minified bundle is **UNVERIFIED**.
- Each rebuild adds a new 5 to 6 MB blob to history. Today history holds 15 blobs over 1 MB (about 82 MB unpacked). This is far from the 1 GB guide. Watch it, do not act on it now.
- Risk to manage: a PR can change `app/dist/` so that it does not match `app/src/`. A reviewer cannot see that in the diff. Parking-lot idea: a CI step that rebuilds and fails on `git diff --exit-code app/dist`. This would need a deterministic build. **UNVERIFIED** that esbuild output is byte-stable here.
- Long term, GitHub's suggested home for a built artifact is a release asset ([About large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)). That changes how users install, so it needs a spec.

### 2.3 If a secret is already committed: rotate first

GitHub's order is clear:

1. **Revoke or rotate the secret first.** After rotation, rewriting history "may not be warranted" ([Removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)).
2. A rewrite has real costs. All later commit hashes change. Signatures are lost. Forks and old clones keep the data. Cached views and PR refs still point to old commits. PR diffs can be lost (same page).
3. If you must rewrite: use `git-filter-repo` 2.47 or later with `--sensitive-data-removal`, verify, then `git push --force --mirror origin`. Protected branches may need protection off for the push. Then ask GitHub Support to remove cached views and PR refs. Support helps only when rotation cannot handle the risk (same page).
4. Prevent repeats: `.gitignore`, environment variables, a pre-commit secret scanner, stage files one by one, review `git diff --cached`, and keep push protection on (same page).

Push protection lets anyone with write access bypass a block with a reason, and the bypass creates an alert ([About push protection](https://docs.github.com/en/code-security/concepts/secret-security/about-push-protection)). Your account also has user-level push protection, on by default for public repos (same page).

### 2.4 Commit email exposure

- Every commit stores an author and a committer email. Anyone who clones can read them with `git log --format=%ae`. (Verified locally on this repo, 2026-11-17.)
- GitHub gives each account a noreply address of the form `ID+USERNAME@users.noreply.github.com` ([Email addresses reference](https://docs.github.com/en/account-and-profile/reference/email-addresses-reference)).
- `git config user.email` inside a repo overrides the global value for that repo only. Old commits keep the old address: "Any commits you made prior to changing your commit email address are still associated with your previous email address" ([Setting your commit email address](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)).
- Account setting **"Block command line pushes that expose my email"** (Settings, Emails) blocks a push when the latest commit uses a private email of yours ([Blocking command line pushes](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/blocking-command-line-pushes-that-expose-your-personal-email-address)). It checks only the most recent commit (same page).

**This repo today:** the repo config uses the noreply address. But history has 14 author entries and 4 committer entries with a personal address, and 3 author / 13 committer entries with GitHub addresses. The repo was created 2026-11-16, has 0 forks and 0 stars, and about 49 PRs and issues.

Two paths. You decide:
- **A. Accept.** The address is already public. Turn on "Keep my email addresses private" and "Block command line pushes that expose my email" so it does not grow. No force-push. A `.mailmap` file only changes how `git log` shows names; the old address stays in the objects (**UNVERIFIED** in a fetched doc, but this is how `.mailmap` works: it maps display only).
- **B. Rewrite now.** It is cheapest now: no forks, few clones. Use `git-filter-repo` (email or mailmap callback), force-push `main`, and ask Support to clean PR refs and cached views. Costs from 2.3 apply: every SHA changes, PR diffs may break, the ruleset's "block force pushes" must be bypassed for the push. Exact `git-filter-repo` email flags are **UNVERIFIED** here; read its manual before you run it. This is a history rewrite, so it needs your explicit go-ahead.

---

## 3. Repo hardening settings

### 3.1 Ruleset on `main`

Current ruleset "Protect main" (read with `gh api .../rulesets/27491863`): target `~DEFAULT_BRANCH`, no bypass actors, rules: `deletion`, `non_fast_forward`, `pull_request` (0 approvals, squash only), `required_status_checks` (`legal-lint`, `app`, `plugin`, not strict).

- Available rules include restrict deletions, block force pushes, require linear history, require signed commits, require a PR (with stale-approval dismissal, code owner review, last-push approval, conversation resolution, allowed merge methods), require status checks (optionally "up to date"), require code scanning results ([Available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)).
- "Pull request authors cannot approve their own pull requests" ([Approving a PR](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/approving-a-pull-request-with-required-reviews)). So 0 required approvals is the right setting for a solo maintainer.
- Scorecard Branch-Protection is tiered. Tier 1 (no force push, no deletion) is met. Tier 2 needs at least one reviewer, so you will not reach it alone ([Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md#branch-protection)). Accept that score.
- Optional: turn on "Require conversation resolution before merging". It costs nothing and stops a merge with an open review comment from an outside reviewer.
- Optional cleanliness: in Settings, General, untick "Allow merge commits" and "Allow rebase merging". The ruleset already forces squash; this only hides buttons that would fail.

### 3.2 Secret scanning and push protection

- Done: secret scanning on, push protection on ([About secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/about-secret-scanning); [About push protection](https://docs.github.com/en/code-security/concepts/secret-security/about-push-protection)).
- Off: `secret_scanning_non_provider_patterns` (generic patterns such as private keys and connection strings) and `secret_scanning_validity_checks`. If the toggles show in Settings, Advanced Security, turn on generic patterns. Whether a personal-account public repo can turn them on is **UNVERIFIED** (the pages do not say).

### 3.3 Private vulnerability reporting

Done (`{"enabled":true}`). Owners of public repos can let researchers report privately ([Configuring private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configuring-private-vulnerability-reporting-for-a-repository)). Add `SECURITY.md` so people find it (3.8).

### 3.4 Dependabot

Current state: alerts off (`/vulnerability-alerts` returns 404), security updates off, no `dependabot.yml`.

- Dependabot alerts depend on the dependency graph and fire when it changes ([About Dependabot alerts](https://docs.github.com/en/code-security/concepts/supply-chain-security/about-dependabot-alerts)). Whether the graph is on by default for public repos is **UNVERIFIED** (the page does not say).
- Turn on security updates: Settings, Advanced Security, "Dependabot security updates", Enable ([Configuring Dependabot security updates](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configuring-dependabot-security-updates)). Turn on "Dependabot alerts" on the same page.
- Supported ecosystems: `npm`, `gradle`, `github-actions`, `pip` ([Supported ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)).
- Gradle limits: Dependabot reads `build.gradle` without running Gradle. It runs Gradle to update the wrapper (`gradle-wrapper.properties`, `gradlew`, `gradlew.bat`, `gradle-wrapper.jar`). For Gradle **security** updates, support "is limited to manual uploads of the dependency graph data using the dependency submission API" (same page). So Gradle alerts need a dependency-submission workflow. That is a new CI component; spec it before you add it. How Dependabot treats `runeLiteVersion = 'latest.release'` is **UNVERIFIED**.
- GitHub Actions: Dependabot updates actions in the `owner/repo@ref` form, also SHA-pinned ones, and updates the version comment on the same line (same page). Dependabot "will not create alerts for actions pinned to SHA values" ([Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)), so version updates are what keep pinned actions fresh.
- A default 3-day cooldown applies to version updates, not to security updates ([Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)).
- Scorecard Dependency-Update-Tool (High) passes with a Dependabot config file ([Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md#dependency-update-tool)).

Proposed `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "npm"
    directory: "/app"
    schedule:
      interval: "weekly"
    groups:
      npm-minor-patch:
        update-types: ["minor", "patch"]
  - package-ecosystem: "gradle"
    directory: "/plugin"
    schedule:
      interval: "monthly"
  - package-ecosystem: "pip"
    directory: "/evals"
    schedule:
      interval: "monthly"
```

Repo-specific catch: users run the committed `app/dist/`. A Dependabot npm PR changes `package-lock.json` but not `app/dist/`. CI rebuilds in the runner but does not commit. Before you merge such a PR, check out its branch, run `npm test` in `app/`, and commit the rebuilt `app/dist/`. Otherwise users keep running the old dependency. The `groups` key syntax is from the options reference; check it against [the reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference) when you write the file.

### 3.5 GitHub Actions hardening

| Practice | Source | This repo | Change |
|---|---|---|---|
| Least-privilege `GITHUB_TOKEN` | "make sure that the `GITHUB_TOKEN` is granted the minimum required permissions" ([Secure use](https://docs.github.com/en/actions/reference/security/secure-use)). Scorecard Token-Permissions wants read-only top-level permissions ([checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md#token-permissions)). | Done: repo default `read`, `can_approve_pull_request_reviews: false`, workflow `permissions: contents: read`. | None. |
| `pull_request`, not `pull_request_target` | `pull_request_target` "runs in the context of the default branch of the base repository"; avoid it "if you need to build or run code from the pull request." Fork PRs under `pull_request` get no secrets and a read-only token ([Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)). Scorecard Dangerous-Workflow is Critical risk ([checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md#dangerous-workflow)). | Done. No `${{ github.event.* }}` in `run:` lines, so no script injection path. | None. Keep it so. |
| Fork PR approval | Options: first-time contributors new to GitHub, first-time contributors, all external contributors ([Managing Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)). | Done: all external contributors (strictest). | None. |
| Pin actions to a full commit SHA | "Pin actions to a full-length commit SHA"; a tag "can be moved or deleted" ([Secure use](https://docs.github.com/en/actions/reference/security/secure-use)). Scorecard Pinned-Dependencies counts a tag as pinned only if it is "backed by a published immutable release" ([checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md#pinned-dependencies)). | Gap. `@v7`, `@v6` are floating major tags. `actions/checkout` releases are not immutable (`immutable: false`). | Pin, see below. |
| Require SHA pinning by policy | Setting "Require actions to be pinned to a full-length commit SHA" ([Managing Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)). | Gap: `sha_pinning_required: false`. | Turn on after pinning. |
| Limit which actions may run | Option "Allow OWNER, and select non-OWNER, actions and reusable workflows", then "Allow actions created by GitHub" (same page). | Gap: `allowed_actions: all`. | Select that option and tick only "Allow actions created by GitHub". CI uses only `actions/*`. |
| Do not keep the token in `.git/config` | `actions/checkout` persists the auth token for later git commands; "Set `persist-credentials: false` to opt-out" ([actions/checkout README](https://github.com/actions/checkout)). | Gap (minor). CI never runs an authenticated git command. | Add `with: persist-credentials: false` to each checkout step. |
| No self-hosted runners on public repos | Any user can open a PR and "compromise the environment" ([Secure use](https://docs.github.com/en/actions/reference/security/secure-use)). | Done: `ubuntu-latest`. | None. |
| CODEOWNERS on workflow files | Changes to owned workflow files "require approval from a designated reviewer" ([Secure use](https://docs.github.com/en/actions/reference/security/secure-use)). | Gap. | See 3.6. |
| Workflow lockfile | GitHub now documents `.github/workflows/actions.lock`, made by the `gh actions-lock` extension, which "supersedes SHA pinning" ([Workflow dependency lockfiles](https://docs.github.com/en/actions/concepts/security/workflow-dependency-lockfiles)). | Not used. | Availability and status for personal public repos are **UNVERIFIED**. Use SHA pinning now; revisit later. |
| Gradle wrapper JAR check | A committed wrapper JAR could be replaced by an attacker. "The Setup Gradle GitHub Action automatically validates the Wrapper JAR" ([Gradle Wrapper](https://docs.gradle.org/current/userguide/gradle_wrapper.html)). | Partial: `distributionSha256Sum` is set (it checks the downloaded distribution, not the JAR). | Parking lot: a wrapper JAR check in CI. It adds a non-GitHub action (`gradle/actions`), so it would also need an allow-list entry. |

Pinned lines (SHAs resolved from the current major tags on 2026-11-17 with `gh api repos/<action>/git/ref/tags/<tag>`; resolve again on the day you change the file):

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
- uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7
- uses: actions/setup-java@d1374f8ac74474200d16ef8ecee22c7ae7a51880 # v6
```

### 3.6 CODEOWNERS

- Location: `.github/`, root, or `docs/`; GitHub uses the first it finds. "The last matching pattern takes the most precedence." Owners need write access. Protect the file itself by owning `/.github/` ([About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)).
- Solo-maintainer catch: authors cannot approve their own PRs (3.1). If you tick "Require review from Code Owners", your own PRs would need a bypass. Do not tick it now.
- Value now: GitHub requests your review on outside PRs, and the file documents the sensitive paths CONTRIBUTING already names.

Proposed `.github/CODEOWNERS`:

```
*                    @TomsoucAI
/.github/            @TomsoucAI
/.claude/            @TomsoucAI
/plugin/tools/       @TomsoucAI
/plugin/gradle/      @TomsoucAI
/plugin/gradlew      @TomsoucAI
/plugin/gradlew.bat  @TomsoucAI
/install.mjs         @TomsoucAI
/app/package.json    @TomsoucAI
/app/setup.mjs       @TomsoucAI
```

### 3.7 Code scanning (CodeQL)

- Default setup: Settings, Advanced Security, "CodeQL analysis", Set up, Default ([Configuring default setup](https://docs.github.com/en/code-security/how-tos/scan-code-for-vulnerabilities/configure-code-scanning/configuring-default-setup-for-code-scanning)). Private repos need a Code Security licence; public ones do not ([About code scanning](https://docs.github.com/en/code-security/concepts/code-scanning/about-code-scanning)).
- This repo: `not-configured`. The API already lists `actions`, `java-kotlin`, `javascript-typescript`, `python` as detected languages.
- Scorecard SAST (Medium) looks for CodeQL ([checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md#sast)).
- Default setup runs as GitHub Actions and uses minutes (same page). It is a GitHub-managed setting, not a new component in the code. Recommend: turn it on. Do not add "Require code scanning results" to the ruleset until you have seen a few clean runs.

### 3.8 SECURITY.md and other community health files

- SECURITY.md should give "information about supported versions of your project and how to report a vulnerability" ([Adding a security policy](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/adding-a-security-policy-to-your-repository)).
- Health files and places: `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md` in `.github/`, root or `docs/` (that order); issue and PR templates in `.github/ISSUE_TEMPLATE` ([Default community health files](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)).
- Scorecard Security-Policy: contact info 6 points, free text 3, disclosure wording 1 ([checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md#security-policy)).
- GitHub's community profile for this repo today: 28 %. Present: README, CONTRIBUTING. Missing: licence (not detected), code of conduct, issue template, PR template.

Proposed `SECURITY.md` content (root), short:
- Supported versions: only the latest commit on `main` and the current `app/dist/` bundle.
- How to report: Security tab, "Report a vulnerability" (private). Do not open a public issue.
- What is in scope: the MCP server, the DPS Bridge plugin, `install.mjs`, CI. Out of scope: the Wiki DPS engine (report to its own repo) and RuneLite itself.
- What to expect: an acknowledgement time you can keep (for example 7 days). Say it is a hobby project with one maintainer.
- Account-safety note: never send your Jagex password, session files or `~/.runelite` contents in a report.

Optional, lower value: a PR template with a checklist (rebuilt `app/dist/`, legal-lint clean, legality verdict on the issue) and an issue template that asks for the in-game behaviour. A code of conduct is recommended by [Open Source Guides](https://opensource.guide/starting-a-project/) (published from the `github/opensource.guide` repo).

### 3.9 Smaller settings

- `app/package.json`: add `"private": true`. "If you set `"private": true` in your package.json, then npm will refuse to publish it" ([npm package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)). The package has a `bin` entry, so an accidental `npm publish` would ship a GPL bundle under an unclaimed name.
- Account: "Keep my email addresses private" and "Block command line pushes that expose my email" (2.4). Done: both are on (GH007 refusal on 2026-11-17).
- Repo "About": no description, no topics. Topics help "other people find and contribute to your project"; up to 20, 50 characters each ([Topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)). Example: `osrs`, `runelite`, `runelite-plugin`, `mcp`, `mcp-server`, `dps-calculator`, `claude`.
- Unused features: wiki and projects are on. If you do not use them, turn them off to keep the repo tidy. No primary source ranks this as a security control; it is cleanliness only.

### 3.10 Licence at the root

- GitHub detects a licence with Licensee by comparing the repo's `LICENSE` file to known licences. Most projects put it in the root. If a repo has "multiple licenses or other complexity," GitHub suggests a simple `LICENSE` file and an explanation elsewhere, such as the README ([Licensing a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)).
- Scorecard License looks for a licence file at the top level or in a `LICENSES/` folder ([checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md#license)).
- This repo has two licences in `app/LICENSE` (GPL-3.0) and `plugin/LICENSE` (BSD-2). Root: none. The API's `license` field is null.
- Options for you: (a) leave it, accept "no licence" in the sidebar; (b) add a root `LICENSES/` folder with both texts, plus the README note you already have. Whether GitHub's sidebar shows anything for (b) is **UNVERIFIED**. Do not put one licence file at the root: it would imply the whole repo uses that licence. A licence change is a legal decision, so it is yours.

### 3.11 OpenSSF Scorecard: expected result after the changes

| Check | Risk | Today | After changes |
|---|---|---|---|
| Binary-Artifacts | High | `gradle-wrapper.jar` is a binary; Scorecard docs say nothing special about it. **UNVERIFIED** effect. | Same. Accept. |
| Branch-Protection | High | Tier 1 met. | Same (needs a second human for tier 2). |
| CI-Tests | Low | Met (CI on every PR). | Same. |
| Code-Review | High | Low (solo, 0 approvals). | Same. Accept. |
| Dangerous-Workflow | Critical | Met. | Same. |
| Dependency-Update-Tool | High | Fail. | Met (dependabot.yml). |
| License | Low | Partial or fail (no top-level file). | Better with option (b). |
| Pinned-Dependencies | Medium | Fail (tag refs). | Met for actions. |
| SAST | Medium | Fail. | Met (CodeQL default setup). |
| Security-Policy | Medium | Fail. | Met (SECURITY.md). |
| Token-Permissions | High | Met. | Same. |
| Vulnerabilities | High | Unknown. | Visible through Dependabot alerts. |
| Signed-Releases, Packaging, SBOM, Fuzzing | various | Not applicable: no releases, no package. | Same. |

Source for all check names and rules: [Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md). The "Today" column is my reading of those rules, not a Scorecard run (**UNVERIFIED** until you run Scorecard).

---

## 4. A clean README

### 4.1 What GitHub says a README should do

- A README "is often the first item a visitor will see." It typically says what the project does, why it is useful, how to get started, where to get help, and who maintains and contributes ([About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)). [Open Source Guides](https://opensource.guide/starting-a-project/) lists the same four user questions.
- GitHub shows a README from `.github/`, then root, then `docs/`. It truncates content beyond 500 KiB. It builds an outline from headings automatically ([About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)).
- Use relative links for files in the repo: GitHub rewrites them per branch, and they work in clones. "Links starting with `/` will be relative to the repository root" ([Relative links](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes#relative-links-and-image-paths-in-markdown-files)). Use relative paths for images in the repo too ([Basic formatting: images](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#images)).
- Images need alt text: "a short text equivalent of the information in the image" (same page).
- Licence: put the text in a `LICENSE` file; the README can explain complexity ([Licensing a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)). Detailed contribution rules go in `CONTRIBUTING.md` (health files, 3.8).
- Status badge URL: `https://github.com/OWNER/REPO/actions/workflows/WORKFLOW-FILE/badge.svg`, optional `?branch=` and `?event=` ([Add a status badge](https://docs.github.com/en/actions/how-tos/monitor-workflows/add-a-status-badge)).

A fixed section order is not in any fetched GitHub page. The outline below follows the order of GitHub's five questions.

### 4.2 What the current README does well

- The first line says what it does, in user words ("what's my DPS on Vorkath?").
- An ASCII data-flow diagram right after it.
- A tools table and real example prompts.
- A zero-Java path (WikiSync) for users who will not build the plugin.
- Strong account-safety and legality sections, with the residual risk named honestly.
- The licence split is explained per folder.

### 4.3 What to change

1. **Stale facts.** "Limits (v0.1)" says defence-reduction specs are not exposed, but the tools table lists `defence_reductions` (shipped in #13). "Not compiled in my environment" is false now: CI builds the plugin on every PR. Remove or update both.
2. **Wrong folder name.** Paths say `osrs-dps-mcp/app/dist/index.js`; a clone is named `osrs-pvm-coach`. `install.mjs` has the same old name in an error message (code change, separate ticket).
3. **No clone step.** "Quick setup" starts at `node install.mjs`. Add `git clone https://github.com/TomsoucAI/osrs-pvm-coach` and `cd` first, plus the prerequisites (Node 20.3+, JDK for the plugin).
4. **Badges.** Add one CI badge (`.../actions/workflows/ci.yml/badge.svg`). A licence badge is optional; skip it while GitHub detects no root licence, because it would contradict the sidebar.
5. **Help and contributing.** Add a short "Contributing" section that links to `CONTRIBUTING.md`, and a "Security" line that links to `SECURITY.md`. Say where to ask for help (Issues).
6. **Move developer content down or out.** "Quality checks", "Building with Claude Code" and "Updating the calculator data" are for contributors. Move them below the user sections, or into `CONTRIBUTING.md` / `TESTING.md`.
7. **Relative links.** Mentions of `TESTING.md`, `app/LICENSE`, `plugin/LICENSE`, `plugin/AGENTS.md` are plain text. Make them relative links.
8. **"Who maintains it".** One line: one maintainer, hobby project, not affiliated with Jagex, RuneLite or the OSRS Wiki.
9. **A picture.** One screenshot or short GIF of Claude answering a DPS question, stored in the repo (for example `docs/images/`), with alt text. Use synthetic data; no real character name.
10. **Plugin Hub line.** The quote block about submitting to the Plugin Hub reads as a to-do. Say the plugin is not on the Plugin Hub yet, and what that means for the user (dev client only).

### 4.4 Recommended outline for this README

1. Title + one-line value + CI badge.
2. What it does: the example question, the diagram, the tools table (keep as is).
3. Is it safe? Three bullets from "Account safety" (no password, local file only, read-only plugin) with a link to the full section below.
4. Quick start: prerequisites, clone, `node install.mjs`, then a link to `TESTING.md`.
5. Options: 5a. MCP server only (manual Claude Code / Claude Desktop config). 5b. Zero-Java WikiSync fallback. 5c. DPS Bridge plugin (dev client, Jagex login).
6. Example prompts.
7. Limits (current, not v0.1).
8. Account safety (full) and Legality gate.
9. Getting help: Issues. Security: `SECURITY.md`.
10. Contributing: link to `CONTRIBUTING.md`; move the dev sections there or below.
11. Licence: the per-folder split, with relative links.
12. Credits: OSRS Wiki DPS calculator (`weirdgloop/osrs-dps-calc`), RuneLite, WikiSync. Not affiliated with Jagex.

---

## 5. Gap list

| # | Practice | Status | Change |
|---|---|---|---|
| 1 | `.gitignore`: current build and dependency output | Done | None |
| 2 | `.gitignore`: secrets, Claude Code local files, Python, IDE, OS, logs, RuneLite account files | Gap | Add the lines in 1.4 |
| 3 | Never `dist` or `*.jar` in `.gitignore` | Done | Keep a comment that says why |
| 4 | `docs/explain/` ignore beyond this PC | Owner's call | Add `docs/explain/` to `.gitignore` if explainers must stay local everywhere |
| 5 | No secrets or credentials tracked | Done | None |
| 6 | Commit email exposure in history | Gap | Choose path A (accept) or B (rewrite now) in 2.4 |
| 7 | Account email privacy settings | Done | Both are on: on 2026-11-17 a push of a commit with the personal email was refused with GH007. The repo config now uses the noreply address |
| 8 | Ruleset on `main` | Done | Optional: require conversation resolution |
| 9 | Repo merge buttons match the ruleset | Optional | Untick merge commits and rebase merging |
| 10 | Secret scanning + push protection | Done | Optional: generic (non-provider) patterns if offered |
| 11 | Private vulnerability reporting | Done | None |
| 12 | Dependabot alerts | Gap | Settings, Advanced Security, Dependabot alerts: Enable |
| 13 | Dependabot security updates | Gap | Same page: Enable |
| 14 | Dependabot version updates | Gap | Add `.github/dependabot.yml` (3.4); rebuild `app/dist/` on npm PRs |
| 15 | Token permissions | Done | None |
| 16 | `pull_request` not `pull_request_target` | Done | None |
| 17 | Fork PR approval | Done | None |
| 18 | Actions pinned to full SHA | Gap | Pin the three `uses:` lines (3.5) |
| 19 | Require SHA pinning policy | Gap | Turn on "Require actions to be pinned to a full-length commit SHA" |
| 20 | Allowed actions | Gap | "Allow OWNER, and select non-OWNER..." + "Allow actions created by GitHub" only |
| 21 | `persist-credentials: false` on checkout | Gap (minor) | Add to the three checkout steps |
| 22 | Self-hosted runners | Not applicable | None |
| 23 | Gradle wrapper JAR validation in CI | Parking lot | Needs a spec (new action) |
| 24 | CODEOWNERS | Gap | Add `.github/CODEOWNERS` (3.6); do not require code owner review yet |
| 25 | CodeQL default setup | Gap | Settings, Advanced Security, CodeQL analysis: Default |
| 26 | SECURITY.md | Gap | Add root `SECURITY.md` (3.8) |
| 27 | CODE_OF_CONDUCT, issue/PR templates | Optional | Add when outside contributors appear |
| 28 | Root licence detection | Owner's call | Leave, or add `LICENSES/` with both texts (3.10) |
| 29 | `"private": true` in `app/package.json` | Gap | Add the field |
| 30 | Repo description and topics | Gap | Set in the About panel (3.9) |
| 31 | Large files / repo size | Done | Watch `app/dist/` growth |
| 32 | Committed `app/dist/` matches `app/src/` | Parking lot | CI rebuild-and-diff check; needs a spec |
| 33 | README fixes | Gap | Items in 4.3, outline in 4.4 |

Changes 14, 18, 21, 24, 26 and 29 edit files that run or configure CI and the build. Per the repo's process they go through a ticket, not a drive-by edit. Settings changes (12, 13, 19, 20, 25) change no code; you make them in the GitHub UI.
