# api-framework-test

API test automation framework for **GAD** (GUI API Demo), built with **TypeScript + Playwright Test** in API mode (no browser). It is the result of a 4-day program: a hand-built baseline with consistent patterns and a conventions file that AI assistants can follow (Day 1), a deterministic coverage tool (Day 2), AI test generation verified by that tool (Day 3), and a multi-agent pipeline in GitHub Actions where a feature agent and a test agent are chained by CI ([Day 4](docs/day4-multi-agent-pipeline.md)).

The architecture mirrors the course reference project (`api-testing-playwright-ts-junior`). The patterns are adapted to GAD.

## Design principles

- `src/api/`: **SRP + DIP**. One client class per resource, with `APIRequestContext` injected through the constructor.
- `src/models/`: **SRP**. Pure TypeScript interfaces.
- `src/utils/schema.ts`: **SRP + OCP**. The only file that imports `zod`.
- `src/utils/auth.ts`: **Strategy + LSP + ISP**. Pluggable auth header strategies.
- `src/data/factories.ts`: **Factory**. Unique, valid payloads with overrides.
- `src/fixtures/coverage.fixture.ts`: **OCP**. Wraps Playwright's `request` in a recording proxy, so every request is measured with no change to clients or specs.
- `src/fixtures/api.fixture.ts`: **DIP**. The only place clients are built.
- `tools/coverage/`: a standalone, deterministic coverage CLI with no dependencies (spec × recorded requests → gaps).
- `src/fixtures/auth.fixture.ts`: **SRP**. The only place that calls `POST /api/login`.

Full rules are in **[CONVENTIONS.md](CONVENTIONS.md)**.

## Prerequisites

- Node.js 20+ (tested with Node 24)
- The GAD app checked out next to this repo (`../gad-gui-api-demo`)
- No Playwright browsers needed (`npx playwright install` is **not** required)

## Start GAD

```bash
cd ../gad-gui-api-demo
npm install
npm start                                  # listens on http://localhost:3000
curl http://localhost:3000/api/health      # → {"status":"OK", ...}
```

If port 3000 is busy, run `PORT=3001 npm start` and set `BASE_URL=http://localhost:3001` in `.env`. GAD persists data to `db/db.json`. `git checkout db/db.json` inside the GAD repo (with the server stopped) puts the seed data back.

## Setup

```bash
npm install
cp .env.example .env
```

| Variable | Meaning | Default |
|----------|---------|---------|
| `BASE_URL` | GAD origin, without `/api` | `http://localhost:3000` |
| `API_USERNAME` / `API_PASSWORD` | Seed user for `authToken` | `Moses.Armstrong@Feest.ca` / `test1` |
| `OPENAPI_PATH` | Contract used by the coverage CLI (when exported) | `spec/openapi.json` |
| `COVERAGE_RECORD` | Set to `0` to disable request recording | recording on |
| `COVERAGE_RAW_DIR` | Raw request records directory | `reports/coverage/raw` |

`spec/openapi.json` is a vendored, byte-identical copy of `gad-gui-api-demo/public/tools/schema/openapi_rest_demo.json` (OpenAPI 3.0.1). **It is the source of truth** for the contract. **`gad.ref.json`** pins the GAD repository, ref and exact sha that CI tests. Keep both in step with [`tools/spec-sync`](tools/spec-sync/README.md):

```bash
npm run spec:check -- --gad-dir ../gad-gui-api-demo     # exit 1 on drift, with the operation diff
npm run spec:sync  -- --gad-dir ../gad-gui-api-demo     # copy GAD's spec
npm run gad:pin    -- --sha <40-char GAD sha> --ref main
```

## npm scripts

| Script | What it does |
|--------|--------------|
| `npm run test:api` | API specs in `tests/api/` (needs GAD) |
| `npm run test:unit` | Unit tests in `tests/unit/` (no server) |
| `npm run test:smokeAPI` | API tests tagged `@smoke` |
| `npm run test:all` | Every project (api + unit) |
| `npm run test:api:coverage` | API specs, then the coverage report, even if tests fail (exits with the test result) |
| `npm run coverage` | Console coverage report from the last recorded run |
| `npm run coverage:json` | Writes `reports/coverage/coverage.json` and `gaps.json` |
| `npm run coverage:compare-estimate` | Day 2 experiment: compares AI coverage estimates with the tool ([docs](docs/day2-ai-estimate-vs-tool.md)) |
| `npm run coverage:mcp` | Starts the `api-coverage` MCP server on stdio (normally Claude Code starts it from `.mcp.json`) |
| `npm run spec:sync` / `spec:check` | Copy GAD's spec into `spec/openapi.json` / exit 1 on drift (`-- --gad-dir <path>`, default `../gad-gui-api-demo`) |
| `npm run gad:pin` / `gad:ref-guard` | Update `gad.ref.json` (`-- --sha <sha> --ref <branch>`) / exit 1 unless it pins `main` |
| `npm run report` | Opens the HTML report |
| `npm run typecheck` | `tsc` in strict mode, no emit (framework + `tools/coverage`, `tools/coverage-mcp`, `tools/spec-sync`) |
| `npm run lint` / `lint:fix` | ESLint (also enforces the import rules; covers `tools/**`) |
| `npm run format` / `format:check` | Prettier |

## Project structure

```
api-framework-test/
├── .claude/                 # feature-developer + test-generator agents, /fill-coverage-gaps, permissions
├── .github/                 # workflows (coverage, feature/test agents, PR guards, re-pin) + scripts/
├── gad.ref.json             # GAD revision under test (repository, ref, sha, specPath)
├── spec/openapi.json        # GAD contract (source of truth, synced by tools/spec-sync)
├── src/
│   ├── api/                 # API clients, one per resource
│   ├── coverage/            # Request recorder (Proxy) + raw JSONL writer
│   ├── data/                # Test-data factories
│   ├── fixtures/            # Coverage → client → auth fixtures
│   ├── models/              # TypeScript interfaces
│   └── utils/               # schema.ts (Zod), auth.ts
├── tools/coverage/          # Coverage CLI (Node-native TS, zero deps): analyze, compare, gaps
├── tools/coverage-mcp/      # api-coverage MCP server (stdio) wrapping the CLI's functions
├── tools/spec-sync/         # gad.ref.json pin + spec sync/drift check (Node-native TS, zero deps)
├── tests/
│   ├── api/                 # Playwright API specs
│   └── unit/                # Unit tests (no network), incl. unit/coverage
├── docs/                    # Experiments, coverage baselines (docs/coverage/), AI runs (docs/ai-generation/)
├── .mcp.json                # Project MCP servers (api-coverage)
├── CONVENTIONS.md           # How to write code here (mandatory reading)
├── CLAUDE.md                # Pointer for AI assistants
└── playwright.config.ts
```

Each folder has a `README.md` that explains what belongs there and what must not.

## Reports

Every run writes:

- an HTML report to `reports/html` (`npm run report`)
- JUnit XML to `reports/results.xml`
- raw request records to `reports/coverage/raw/*.jsonl` (API project only)

`npm run test:api:coverage` (or `npm run coverage -- --format console,json,gaps,markdown`) adds:

- `reports/coverage/coverage.json`: totals, per-tag and per-operation coverage, exclusions, spec drift
- `reports/coverage/gaps.json`: a prioritized gap list with stable ids (the input for test-generation agents)
- `reports/coverage/summary.md`: a Markdown summary (used by CI)

The coverage definitions and the CLI flags are in [tools/coverage/README.md](tools/coverage/README.md). The committed Day 1 baseline is in [docs/coverage/day1-baseline.md](docs/coverage/day1-baseline.md).

## CI

`.github/workflows/api-coverage.yml` runs on pull requests, on pushes to `main` and `session/**`, and on manual dispatch (with an optional `gad_ref`). It pins `TZ=UTC` (see Known GAD issues).

| Event | Jobs | Output |
|---|---|---|
| `pull_request` | `coverage (head)` + `coverage (base)` in parallel → `report` | delta (`compare`), HTML report, job summary, **sticky PR comment** |
| `push` / `workflow_dispatch` | `coverage (head)` → `report` | head summary + HTML report (no delta, no comment) |

- Each side checks out its own commit (head is the PR merge ref; base is the PR base sha) and **GAD at the sha of its own `gad.ref.json`** (a feature PR tests its GAD feature commit, its base tests GAD main; a side without the file falls back to GAD's default branch; the dispatch input `gad_ref` overrides both). Head then runs `spec:check`: drift fails the workflow. Each side runs `npm run test:api` and analyzes **its own records against its own `spec/openapi.json` and `coverage.config.json`**, so spec changes show up in the delta. `compare` always runs with the head version of the tool.
- A broken base (no tool, failing tests, GAD down) **never** turns the workflow red. The comment then says "Base coverage unavailable" and shows head only. The workflow fails only if the **head** API tests fail (the last step of `report`).
- **The sticky comment** is created once and updated on every push. It is identified by the hidden marker `<!-- api-coverage-report -->` and built by `.github/scripts/upsert-pr-comment.js` through `actions/github-script`. Only the `report` job has `pull-requests: write`. PRs from forks get a read-only token, so the comment is skipped with a notice (the alternative is a separate `workflow_run` workflow, not implemented).
- **Negative-delta policy (Day 4):** non-`feature/*` PRs run `compare --fail-on-negative operations` (the workflow fails if operation coverage drops). On `feature/*` PRs a negative delta is expected and is the trigger of the test agent, so it shows as a ⚠️ note in the comment and summary instead.

Day 4 workflows (details in [docs/day4-multi-agent-pipeline.md](docs/day4-multi-agent-pipeline.md)):

| Workflow | Trigger | What it does |
|---|---|---|
| `feature-agent.yml` | issue labeled `feature-request` (trusted author and labeler) | `feature-developer` agent: GAD PR + framework PR (spec sync + pin) |
| `test-agent.yml` | `workflow_run` of API coverage on a `feature/*` PR with a regressed delta | `test-generator` (`ci-pr` mode) pushes tests for `delta.gaps.opened` to the same PR; ≤ 2 runs per PR |
| `pr-guards.yml` | PR pushes and label changes | `lane-check` (agent lanes), `human-review` (label `human-reviewed`), `gad-ref-guard` (PRs into main pin GAD main) |
| `repin-gad.yml` | manual (`pr_number`) | re-pins a feature PR to GAD main after the GAD PR is merged |

**Artifacts** (retention 14 days; stable names, so Day 4 can download `coverage-head` to read `gaps.json`):

| Artifact | Contents |
|---|---|
| `coverage-head`, `coverage-base` | `reports/coverage/**` of each side: `coverage.json`, `gaps.json`, `summary.md`, `index.html` (head), `raw/*.jsonl`, `run-meta.json` (test outcome) |
| `coverage-report-html` | `index.html`: a self-contained HTML report with the embedded delta on PRs, plus `delta.json` and `delta.md` |
| `playwright-report-head`, `playwright-report-base` | `reports/html` + `reports/results.xml` |
| `gad-logs-head`, `gad-logs-base` | GAD server log (only when something failed) |

GAD is checked out with `AGENT_PAT`, else `GAD_REPO_TOKEN`, else the default token (enough while GAD is public).

## Coverage tool for agents (MCP)

`.mcp.json` registers the **`api-coverage`** MCP server (`tools/coverage-mcp`, stdio, built on `@modelcontextprotocol/sdk`). It exposes the coverage tool's own functions; it does not parse console output.

| Tool | What it does | Side effects |
|---|---|---|
| `coverage_summary` | Totals, per-tag coverage and gap counts of `reports/coverage` | none |
| `coverage_list_gaps` | Deterministic batch (filters: priority, type, tag, pathPrefix, excludeIds, limit), each gap with its resolved spec context | none |
| `coverage_get_operation` | Coverage detail, open gaps and resolved spec of one `METHOD /path` | none |
| `coverage_run` | Runs the API tests (optional `grep`/`files`) and re-analyzes coverage; returns counts, failed tests and totals | runs tests against the local GAD; a filtered run replaces the recorded data |
| `coverage_compare` | Delta between two snapshot directories | writes `delta.json` / `delta.md` |

`.claude/settings.json` pre-enables the server (`enabledMcpjsonServers`) in trusted folders. Otherwise Claude Code asks for approval the first time you run `claude` in this folder. Check it with `claude mcp get api-coverage` (it should show ✔ Connected), and reset your choice with `claude mcp reset-project-choices`. The same features are available without MCP through `node tools/coverage/src/cli.ts gaps|compare`.

## AI test generation

`/fill-coverage-gaps <scope> [--batches N] [--batch-size N]` delegates to the **`test-generator`** subagent (`.claude/agents/test-generator.md`). The agent reads gaps through MCP, writes tests by the CONVENTIONS recipe in bounded batches, verifies every closed gap with `compare`, logs the run to `docs/ai-generation/<run-id>.md`, and opens an `ai-generated` PR. Run it in a **fresh** session with the agent's extra denies:

```bash
claude --settings .claude/test-generator.settings.json
> /fill-coverage-gaps status-gaps --batches 2 --batch-size 5
```

The design, permissions, guardrails and the Phase B instructions are in [docs/day3-ai-test-generation.md](docs/day3-ai-test-generation.md).

## Multi-agent pipeline (Day 4)

An issue labeled `feature-request` starts the **`feature-developer`** agent in CI: it implements a new endpoint in GAD, documents it in GAD's OpenAPI and opens a GAD PR plus a framework PR that syncs the spec and pins GAD. The coverage CI reports the new operations as uncovered, which starts the **`test-generator`** agent (`/fill-coverage-gaps --mode ci-pr --gap-ids <file>`) on the same framework PR. Independent checks (coverage delta, `spec:check`, `lane-check`) judge both agents; a human reviews (`human-reviewed` label) and merges GAD first, then the re-pinned framework PR. See [docs/day4-multi-agent-pipeline.md](docs/day4-multi-agent-pipeline.md).

## Known GAD issues

These were found while building the baseline. They are documented in tests rather than hidden:

| Issue | Where |
|-------|-------|
| The current UTC date-time is rejected as "in future" (422) on hosts west of UTC | `tc-articles-12`: `test.fail` only when the host is west of UTC; a normal passing test in CI (TZ=UTC) |
| Read-after-write race: validation reads `db.json` from disk while json-server writes asynchronously, so a just-created article can 404 on PATCH/DELETE under parallel load | Suite runs with `workers: 1` |
| Articles without `image` (optional in the spec) make `/api/health` report "Degraded" | Factories always send `image` |
| `GET /api/labels` is 404 unless the `feature_labels` flag is enabled through the undocumented `/api/config/features` | `labels.spec.ts` |

## Git workflow

Work on `session/NN-description` branches, never on `main`. Commit prefixes are `feat:`, `test:`, `fix:`, `chore:` and `docs:`. See [CONVENTIONS.md §11](CONVENTIONS.md#11-git-workflow-and-commits).
