# Day 3: AI test generation with earned trust

**Concepts:**

- **Earned trust.** Test creation is delegated to an AI only now, because two things already exist: **context** (`CONVENTIONS.md`, from Day 1) and **deterministic output control** (the coverage tool, from Day 2). The agent proposes tests, and the tool verifies each claimed gap closure.
- **Tools and MCP.** The agent reaches real systems through standardized, permissioned interfaces: the coverage tool over MCP, the repository through git, and GitHub through `gh`. It never reads reports or the spec "by eye".

Day 3 has two phases, delivered in separate PRs:

- **Phase A** (infrastructure, PR `session/03-ci-coverage-delta`) adds:
  - the CI coverage delta with an HTML report and a sticky PR comment;
  - the `compare` and `gaps` subcommands;
  - the `api-coverage` MCP server;
  - the agent definition and its permissions.
- **Phase B** (an AI-authored PR or PRs) runs the agent in a **fresh** session that has only the spec, the conventions, the gaps and the tools. The session that built Phase A must not run it, because its context would contaminate the result.

---

## 1. Design

### Inputs

| Input | How the agent gets it |
|---|---|
| Conventions | `CONVENTIONS.md`, which is mandatory reading (CLAUDE.md points to it). §8 is the recipe and §13 covers AI-generated tests. |
| Gaps + spec context | MCP `coverage_list_gaps`, or the `node tools/coverage/src/cli.ts gaps` CLI. It returns a deterministic batch, and each gap carries its operation with every `$ref` resolved. |
| Examples | `tests/api/articles.spec.ts`, `tests/api/comments.spec.ts`, and the matching client, model, schema and factory |
| Real behavior | `curl -s http://localhost:3000/api/...` against the local GAD, used only when the spec is ambiguous |
| Verification | MCP `coverage_run` (full suite + coverage) and `cli.ts compare` against the batch-start snapshot |

### Bounded loop (`.claude/agents/test-generator.md`)

```
preflight: clean tree → branch ai/<run-id> → GAD healthy → full coverage_run (must be green) → start snapshot
for batch in 1..N (N = --batches, default 4):
   select ≤ batch-size gaps (coverage_list_gaps, excluding the ones blocked so far)
   snapshot batch start
   write model → schema → client → fixture → factory → spec   (CONVENTIONS §8, @ai-generated tag)
   typecheck + lint + format:check, run only the touched specs
   on failure: fix and retry (max 3 attempts per batch)
   after 3 failures: proven GAD bug → test.fail + spec-drift evidence (curl); otherwise delete the test and mark the gap blocked
   full coverage_run (no regressions) + compare vs batch start → every target gap id must be in gaps.closed
   atomic commit(s) + a row in docs/ai-generation/<run-id>.md
   stop early: 2 consecutive batches closing 0 gaps, or no gaps left in scope
deliver: push ai/<run-id>, label ai-generated, gh pr create (log summary, delta, blocked, spec-drift, reviewer checklist)
```

### Guardrails and why each exists

| Guardrail | Why |
|---|---|
| Never edit `tools/`, `coverage.config.json`, `spec/`, `.github/` | Otherwise the agent could change the judge: edit the tool, the spec or CI so that the gaps "close". A verifier that the agent can modify gives no verification. |
| Never add exclusions | An exclusion removes units from the denominator. Using it to hide a gap would turn the metric into a lie. |
| Never edit `CONVENTIONS.md`, `CLAUDE.md`, `.claude/` | The agent works inside the contract; it does not rewrite it. It records gaps in the conventions in the log for a human. |
| No direct `request.*` or own `APIRequestContext` | The recorder only sees requests that go through the client fixtures. A bypassing request would leave its gap open, and the generated test would be invisible to coverage. |
| No `test.skip`/`.only`; `test.fail` only with curl evidence | "Green at any cost" would hide real defects. Spec drift has to be proven, not assumed. |
| Never change existing assertions | A regression in old tests must surface, not be edited away. |
| Max 3 attempts per batch; ≤ N batches; stop after 2 empty batches | This bounds cost and time, and stops loops where the agent keeps "trying things". |
| `compare` must show every target gap id in `gaps.closed` | A gap is closed by the tool's verdict, not by the agent saying so. |
| Branch `ai/*`, no push to `main`, no merge; PR labeled `ai-generated` | A human reviews and merges. Every AI change is traceable. |
| No destructive endpoints (`/restoreDB*`, `/debug/*`, `/diagnostic/*`) | They wipe or alter shared server state for the whole suite. |
| No new dependencies | This keeps the supply chain under human control. |

### Permissions

The rules are enforced by Claude Code, not just written in the prompt. Both files were verified empirically with headless probes.

| File | Applies to | Contents |
|---|---|---|
| `.claude/settings.json` | every session in this project | **allow:** `npm run *`, `npx playwright test *`, `node tools/coverage/src/cli.ts *`, git `status/diff/log/add/commit/checkout -b/switch`, `git push -u origin ai/*`, `gh pr create/view`, `gh label *`, `curl -s http://localhost:3000/*`, `mcp__api-coverage__*`, and Edit under `src/api`, `src/models`, `src/utils/schema.ts`, `src/data`, `src/fixtures/api.fixture.ts`, `tests/api`, `docs/ai-generation`. **deny:** pushes to `main`, force pushes, `rm -rf`, `npm install`/`npm i`, and curl to `restore*DB`, `debug/exit\|restart`, `diagnostic/*`. Also `enabledMcpjsonServers: ["api-coverage"]`. |
| `.claude/test-generator.settings.json` | agent runs, loaded with `--settings` | **deny** Edit on `tools/`, `spec/`, `.github/`, `src/coverage/`, the coverage/auth fixtures, `CONVENTIONS.md`, `CLAUDE.md`, `README.md`, `playwright.config.ts`, `package*.json`, `eslint.config.mjs`, `tsconfig.json`, `.mcp.json`, `.claude/`. Also denies `git checkout/switch main`, `git merge`, `git rebase`, `git reset --hard`, `gh pr merge`. |

Why the path denies live in a separate file: deny rules always win, so a narrower allow anywhere else cannot reopen them. In the shared `.claude/settings.json` they would also block the **Day 4 feature agent**, which must edit `spec/`, and every maintainer session. Loading them with `--settings` scopes them to test-generation runs.

Verified rule syntax for files loaded with `--settings`:

- `Edit(./tools/**)` and `Edit(tools/**)` deny correctly.
- **`Edit(/tools/**)` does not.** In a `--settings` file, a leading `/` is relative to that file and not to the project.
- Exact files use `Edit(./CLAUDE.md)`.
- One `Edit(...)` rule also covers the Write tool.

Some restrictions cannot be fully expressed as rules, so they live in the agent instructions:

- "never commit on `main`": the rules see command text, not the current branch;
- "no new exclusions": `coverage.config.json` sits under the denied `tools/`, so in practice this one is enforced;
- "no `request.*` / `test.skip`": code content, which reviewers and lint check;
- Bash rules match command text, so `sh -c '…'` or absolute binary paths could bypass them. Claude Code documents that permission rules are not a sandbox.

---

## 2. Phase B: how to run it (after the Phase A PR is merged)

### Prerequisites

```bash
cd api-framework-test
git checkout main && git pull
npm ci
# GAD running in another terminal, with a fresh DB:
#   cd ../gad-gui-api-demo && npm start
curl -s http://localhost:3000/api/restoreDB > /dev/null && sleep 3   # wait: GAD persists the restore asynchronously
curl -s http://localhost:3000/api/health | grep '"status": "OK"'
npm run test:api:coverage            # baseline must be green (29 passed incl. tc-articles-12 expected fail)
```

### PR 1: status gaps of resources that are already covered (cheap; proves the loop)

```bash
claude --settings .claude/test-generator.settings.json     # FRESH session at api-framework-test
# First time only: approve the project MCP server "api-coverage" if prompted.
# It is pre-enabled through enabledMcpjsonServers in .claude/settings.json in trusted folders.
# Check it with: claude mcp get api-coverage   (→ ✔ Connected)
> /fill-coverage-gaps status-gaps --batches 2 --batch-size 5
```

### PR 2: new resources (start a new session)

```bash
git checkout main && git pull        # after reviewing or merging PR 1
claude --settings .claude/test-generator.settings.json
> /fill-coverage-gaps likes,bookmarks --batches 3 --batch-size 4
```

### Headless alternative

The flags below exist in Claude Code 2.1.x: `-p` expands a project slash command, `--permission-mode acceptEdits` auto-accepts file edits, and `--settings` adds the agent denies. Bash commands and MCP tools are pre-approved by `.claude/settings.json`; anything else is denied in `-p` mode instead of prompting.

```bash
claude -p "/fill-coverage-gaps status-gaps --batches 2 --batch-size 5" \
  --settings .claude/test-generator.settings.json \
  --permission-mode acceptEdits \
  --max-turns 250 \
  --output-format text | tee docs/ai-generation/headless-$(date +%Y%m%d-%H%M).log
```

### Suggested scopes

| Scope | Why |
|---|---|
| `status-gaps` | The 18 `status` gaps of resources that are already covered, such as `PUT /articles/{id}` 201/401/422, `DELETE /comments/{id}` 401/404 and `POST /articles` 400. The clients already exist, so this is cheap and proves the loop. Expect some to end **blocked**: 400 "malformed JSON" cannot be sent by the typed clients, and `PUT /articles/{id}` 404 is probably unreachable because GAD upserts. |
| `likes,bookmarks` | Left out on purpose on Day 1. Small resources that need new clients and models. |
| `flashposts` | Same as above; a good third PR. |
| **Avoid at first** | book-shop and payments (long dependency chains), global-state endpoints (diagnostic, config) and anything excluded in `coverage.config.json`. |

### What to check in each AI PR

1. The **CI delta comment** (`<!-- api-coverage-report -->`): the verdict should be `improved`, there should be no "Regressions — no longer covered", and "New gaps" should contain only follow-ups of the newly covered operations.
2. **`docs/ai-generation/<run-id>.md`**: the batch rows, the blocked gaps with reasons, and the spec drift with curl evidence.
3. **`@ai-generated`** tags on every new test (`grep -rn "@ai-generated" tests/api`).
4. **No forbidden files touched:**
   `git diff --stat main...ai/<run-id> -- tools spec .github src/coverage src/fixtures/coverage.fixture.ts CONVENTIONS.md CLAUDE.md playwright.config.ts .claude .mcp.json package.json` must be empty.
5. The review checklist in CONVENTIONS.md §13.

---

## 3. Results (fill in after Phase B)

### Metrics

| Metric | PR 1 (status-gaps) | PR 2 (likes,bookmarks) |
|---|---|---|
| Run id / PR link | | |
| Gaps targeted | | |
| Gaps closed (verified by `compare`) | | |
| Gaps blocked (reasons) | | |
| Tests added | | |
| First-attempt pass rate (batches passing on the 1st run) | | |
| Average attempts per batch | | |
| Tests discarded | | |
| Spec drift found | | |
| Δ operations / Δ statuses / Δ parameters (CI comment) | | |
| Agent wall-clock time | | |
| Human review time of the PR | | |
| Review changes requested | | |

### Conclusions

_To be filled in._

- Did the deterministic verification catch claims that were wrong (gaps the agent believed closed that the tool did not confirm)?
- Which guardrails were triggered (permission denials, attempt limit, early stop)?
- Where were the conventions insufficient? (Gather the "notes" sections of the logs; a human then updates CONVENTIONS.md.)
- What changes for Day 4, when this agent runs from CI on a feature PR?
