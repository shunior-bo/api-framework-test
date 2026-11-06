# Day 1 experiment: AI output without vs. with a conventions file

**Goal:** measure how much a conventions file (`CONVENTIONS.md` + `CLAUDE.md`) changes the quality of tests an AI assistant writes for an endpoint this framework does not cover yet.

**Concept under test:** *Context.* AI output is only as good as what it knows about your project.

**Target endpoints** (deliberately uncovered by the baseline; both exist in `spec/openapi.json`):

| Operation | Documented responses | Auth |
|-----------|---------------------|------|
| `POST /api/likes` | 200, 201, 400, 404, 422 | bearerAuth |
| `GET /api/likes/article/{id}` | 200, 404 | none |

---

## 1. The prompt (use it verbatim in both runs)

```text
Add API tests for the `POST /api/likes` and `GET /api/likes/article/{id}` endpoints of GAD to this framework.
```

Don't add hints, don't answer follow-up questions with project knowledge, and don't correct the AI mid-run. If it asks a question, reply: `Use your best judgment.`

---

## 2. Controlling the context (do this for both runs)

The two runs must differ **only** in whether `CLAUDE.md` and `CONVENTIONS.md` exist.

- **Remove this file (`docs/day1-ai-comparison.md`) in BOTH runs.** It contains the rubric, which would tell the AI what is expected.

- Start a **new** Claude Code session for each run, with no `/resume` and no `--continue`.
- Launch it from `api-framework-test/` **without** `--add-dir`, so it can't read the reference project.
- Check that there is no `CLAUDE.md` in parent folders (`/home/junior/ses/task`, `/home/junior/ses`) or in `~/.claude/CLAUDE.md`, and that the project memory folder (`~/.claude/projects/-home-junior-ses-task-api-framework-test/memory/`) is empty or absent.
- Use the same model and effort level in both runs, and write them down below.
- GAD must be running at `BASE_URL`, so the AI is able to execute the tests if it chooses to.
- Note: in both runs the folder `README.md` files and the JSDoc headers still exist. Run A measures "code + READMEs, without the conventions file", not "zero context".

Record the following:

| | Run A | Run B |
|-|-------|-------|
| Date | | |
| Model / effort | | |
| Base commit | | |
| Wall-clock time | | |
| # of AI turns / tool calls | | |

---

## 3. Run A: without conventions

```bash
git switch session/01-api-framework-baseline
git switch -c experiment/day1-without-conventions
git rm -q CLAUDE.md CONVENTIONS.md docs/day1-ai-comparison.md
git commit -m "chore: remove conventions files and experiment doc for day 1 run A"
claude                          # new session, then paste the prompt
```

When the AI finishes:

```bash
npm run lint; npm run format:check; npm run typecheck; npm run test:api
git add -A src tests            # only the AI's output
git commit -m "test: AI-generated likes tests without conventions (run A)"
```

Save the lint and test results (pass/fail counts) in the rubric below.

## 4. Run B: with conventions

```bash
git switch session/01-api-framework-baseline
git switch -c experiment/day1-with-conventions
git rm -q docs/day1-ai-comparison.md
git commit -m "chore: remove experiment doc for day 1 run B"
claude                          # new session, then paste the same prompt
```

When the AI finishes, run the same checks and commit:

```bash
npm run lint; npm run format:check; npm run typecheck; npm run test:api
git add -A src tests
git commit -m "test: AI-generated likes tests with conventions (run B)"
```

## 5. Compare

```bash
git diff session/01-api-framework-baseline experiment/day1-without-conventions --stat -- src tests
git diff session/01-api-framework-baseline experiment/day1-with-conventions   --stat -- src tests
git diff experiment/day1-without-conventions experiment/day1-with-conventions -- src tests
```

Clean up GAD afterwards: stop the server and run `git checkout db/db.json` in `gad-gui-api-demo`.

---

## 6. Rubric

Score each cell ✅ (follows the pattern), ⚠️ (partially), ❌ (violates), and add a short note or file:line.

| # | Criterion | How to check | Without conventions (A) | With conventions (B) |
|---|-----------|--------------|-------------------------|----------------------|
| 1 | Uses the `src/api` client layer (new `LikesClient`; no raw `request.*` in specs) | `grep -n "request\.\(get\|post\)" tests/` | | |
| 2 | Client obtained from a fixture (`likesClient` registered in `api.fixture.ts`; no `new XxxClient(` in tests) | `grep -n "new .*Client(" tests/` | | |
| 3 | Uses the `@src/` alias (no relative imports) | `npm run lint` | | |
| 4 | Schemas defined in, and imported from, `@src/utils/schema` (no `zod` import elsewhere) | `grep -rn "from 'zod'" src tests` | | |
| 5 | Model interfaces added in `src/models/like.model.ts` | file exists, interfaces only | | |
| 6 | Auth through the fixture (`authToken`; no `/api/login` in the spec) | `grep -n "login" tests/api/likes*` | | |
| 7 | Title format `'<METHOD> /api/<path> <behavior>'` and `describe('<Resource> API')` | read titles | | |
| 8 | Tags: `@smoke`/`@negative` + `@tc-likes-NN` | read tags | | |
| 9 | Arrange / Act / Assert structure with separators | read tests | | |
| 10 | Assertion order: status → schema → fields | read tests | | |
| 11 | Test data from factories (`buildXxx`) with no hardcoded values | read tests | | |
| 12 | Data cleanup (`finally` + client `delete`; likes toggled back, articles deleted) | compare like counts before/after a run | | |
| 13 | Covers the documented status codes (200/201/404/422 for POST, 200/404 for GET) | count tests per code | | |
| 14 | `npm run lint`, `format:check`, `typecheck` pass | command output | | |
| 15 | `npm run test:api` passes (or failures justified with `test.fail`) | command output | | |
| 16 | Files in the correct location and named correctly (`LikesClient.ts`, `like.model.ts`, `likes.spec.ts`) | `git diff --stat` | | |
| 17 | No `any` / unsafe casts on response bodies | `npm run lint`, `grep -n " as " tests/` | | |
| 18 | Did not modify unrelated files or add dependencies | `git diff --stat`, `package.json` | | |
| | **Total ✅** | | | |

---

## 7. Conclusions

_To be filled in after both runs._

- What did run A get right without the conventions file (inferred from the code)?
- Which violations disappeared in run B?
- Which violations remained in run B? These suggest what `CONVENTIONS.md` is missing or should state more strongly.
- Did either run discover GAD behaviors on its own (for example, the date/timezone issue or the read-after-write race)?
- Changes to make to `CONVENTIONS.md` before Day 3:
