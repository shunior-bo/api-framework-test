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

## 3. Results

Both Phase B runs used `claude-opus-5-5` (the test-generator agent) in fresh sessions with `--settings .claude/test-generator.settings.json`, against a local GAD whose DB had been restored. The figures below come from the run logs (`docs/ai-generation/`), the CI coverage comments of PRs #4 and #5, the PR timestamps and `git diff c5b668c..69d669a`.

### Metrics

| Metric | PR 1 (status-gaps) | PR 2 (likes,bookmarks) |
|---|---|---|
| Run id / PR link | [`20261109-0946-status-gaps`](ai-generation/20261109-0946-status-gaps.md) / [#4](https://github.com/shunior-bo/api-framework-test/pull/4) | [`20261109-0959-likes-bookmarks`](ai-generation/20261109-0959-likes-bookmarks.md) / [#5](https://github.com/shunior-bo/api-framework-test/pull/5) |
| Batches run / limit | 2 / 2 (stopped at the limit) | 2 / 3 (stopped early: no unblocked gaps left in scope) |
| Gaps targeted | 10 status gaps (all `articles`) | 7 operation gaps (`likes`, `bookmarks`) |
| Gaps closed (verified by `compare`) | **9 / 10** | **7 / 7**, plus 17 statuses and 4 parameters inside them |
| Gaps blocked (reasons) | 1. `status:PUT /articles/{id}:404`: unreachable, because GAD upserts unknown ids (201) and has no 404 branch | 2, both opened by the run itself. `status:POST /bookmarks/articles:201`: a "first bookmark" cannot be undone through the API, so the test is not repeatable. `status:GET /likes/article/mylikes:400`: GAD has no 400 branch. |
| Tests added | 9 (tc-articles-13..21) | 18 (tc-bookmarks-01..05, tc-likes-01..13) |
| First-attempt pass rate (batches passing on the 1st run) | 2 / 2 (100%), tests 9 / 9 | 1 / 2 (50%), tests 18 / 19 |
| Average attempts per batch | 1.0 | 1.5 (batch 1: 2, batch 2: 1) |
| Tests discarded | 0 | 1. The bookmarks 201 test passed alone but failed in the full suite, so it was removed and the gap blocked. |
| Spec drift found | 0 `test.fail`. 1 contract inconsistency (PUT documents 404 but upserts). | 2 `test.fail`: `GET /likes/article` (405 without `?id`, and its 200 body is a per-article map) and `GET /likes/article/mylikes` (its body is a map of booleans). 2 more contract issues noted: `POST /likes` requires an undocumented `userid` header, and unknown ids answer `200 {likes:0}` instead of 404. |
| Supporting `src/` changes | `ArticlesClient.*WithRawBody` (raw JSON for 400s), `MalformedJsonErrorSchema`, `buildMalformedArticleJson()` | `LikesClient`, `BookmarksClient`, their models, schemas and factories, and 2 client fixtures |
| Δ operations / Δ statuses / Δ parameters (CI comment) | 0 / **+9** (7.22% → 9.63%) / 0 · verdict `improved` | **+7** (10.00% → 14.38%) / **+17** (9.63% → 14.17%) / **+4** (7.37% → 11.58%) · verdict `improved` |
| Gaps in head (CI) | 162 → 153 (0 opened, 9 closed) | 153 → 148 (2 opened, 7 closed) |
| Agent wall-clock time (run start → PR opened) | ≈ 6 min | ≈ 10 min |
| Human review time of the PR (opened → merged) | ≈ 5 min | ≈ 2 min |
| Review changes requested | 0 (no formal GitHub review recorded) | 0 (no formal GitHub review recorded) |
| Forbidden files touched | none | none |

**Overall Day 3 delta** against the Day 1 baseline (from `main` before Phase B to `main` after it, as reported by CI):

| Dimension | Day 1 baseline | After Phase B | Δ |
|---|---:|---:|---:|
| Operations | 16/160 (10.00%) | 23/160 (14.38%) | +7 (+4.38 pp) |
| Statuses | 27/374 (7.22%) | 53/374 (14.17%) | +26 (+6.95 pp) |
| Parameters | 7/95 (7.37%) | 11/95 (11.58%) | +4 (+4.21 pp) |
| Gaps | 162 | 148 | 16 closed, 2 opened (both blocked) |

Tests: 29 → 56 API tests. The 27 new ones are all tagged `@ai-generated`, and 2 of them are `test.fail` with curl evidence. In the existing specs, only `import` lines changed; no assertion was modified.

### Conclusions

**1. Deterministic verification caught what the agent alone would have shipped.** The bookmarks 201 test was green when run alone and failed in the full suite. Its "first bookmark" leaves a record that the API cannot delete, and json-server reuses the deleted user's id. The loop's full-suite run plus `compare` exposed it. The agent then removed the test and logged the gap as **blocked** with evidence, instead of reaching for `test.skip` or `test.fail`. No claimed closure was contradicted by the tool: all 16 targeted-and-closed ids appear in `gaps.closed` both in the local `compare` and in the CI comment, and the CI numbers match the logs exactly.

**2. The guardrails held, and few of them were tested.** `git diff` shows no change under `tools/`, `spec/`, `.github/`, the coverage fixtures, CONVENTIONS, CLAUDE.md or the settings. No exclusion was added, and no existing assertion changed. The attempt limit was never reached (at most 2 attempts). The early-stop rule ended run 2 after batch 2. The logs do not record any permission denial, so the deny rules were never exercised. That is good news, but it is not evidence that they would work under pressure. One weakness: the agent switched GAD's global feature flags with `curl …/api/config/features` while investigating. `Bash(curl -s http://localhost:3000/*)` allows that, and it was restored afterwards, but it is global server state.

**3. The agent was honest about what GAD does not do.** Of 20 targeted gaps, 3 ended blocked. All 3 are real contract problems (PUT 404 unreachable, the bookmarks 201 not repeatable, the mylikes 400 unreachable), each backed by curl output and, for PUT, by GAD's source code. Together with the 2 `test.fail`s and 2 more drift notes, Phase B produced a **concrete spec-fix list** that Days 1–2 had not found. That list is input for Day 4: the spec or GAD needs fixing, not the tests.

**4. Conventions were sufficient to produce idiomatic code, but they need updates.** Both runs followed the layers, naming, tags, AAA structure, assertion order and cleanup without correction. The "insufficient" notes in the logs are consistent and actionable. A human should apply them to CONVENTIONS.md:
   - Decide whether raw-body client methods (`…WithRawBody`) are the endorsed way to cover 400 "malformed JSON". Today §8 suggests skipping those cases, but the agent found a fixture-compliant way to cover them.
   - Generalize the feature-flag rule. §6 and §9 mention only `feature_labels`, yet `feature_likes` and `feature_user_bookmark_articles` gate whole resources.
   - Add guidance for toggle endpoints with no DELETE, and for residue that cannot be removed through the API.
   - Add a seed-user id fixture (`authUserId`).
   - Explain how to get an unused id for PUT 201, and note that PATCH does not upsert, DELETE on articles is a soft delete, and GAD has other 401 messages.
   - Say in which commit the schema unit tests go (`feat:` or `test:`).

**5. Human review was the weak link.** PRs of +457 and +1,138 lines were merged 5 and 2 minutes after opening, with no formal review. The CI comment, the log and the forbidden-path check made a quick review *possible*, but the checklist items that need judgment were not realistically verified in that time, for example whether a negative test triggers the documented condition. Earned trust covers the mechanics. It does not replace reading the tests. For Day 4, a minimum review time or a required approving review on `ai-generated` PRs would make that step explicit.

**6. Cost and scope.** About 16 minutes of agent time closed 16 gaps and roughly doubled status coverage. Ordering by path made run 1 spend both batches on `articles`, so 8 unblocked status gaps remain: `DELETE /articles/{id}` 400, 4 in `comments` and 3 in `users`. A follow-up `status-gaps` run, or a `--tag` scope per resource, would continue from there.

**What changes for Day 4**, when this agent runs from CI on a feature PR:
- The agent and the CI delta work as-is. The verdict was correct in both PRs, and the `coverage-head` artifact provides the gap list.
- Decide on `--fail-on-negative`: Phase B never produced a negative delta, so it can be enabled for `operations` without false alarms today.
- Spec drift has to be routed: GAD changes and spec fixes belong to the feature agent's cross-repo flow (pinned `GAD_REF` plus spec sync), not to the test agent.
- Residue (bookmark records) and global feature flags matter more when CI and the agent share a GAD. CI starts a fresh GAD per run, so it is safe there. A shared or long-lived GAD would need `restoreDB` between runs.
- Add a required human review (or a CODEOWNERS rule) for `ai-generated` PRs before auto-triggering the agent from CI.
