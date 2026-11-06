# api-framework-test

API test automation framework for **GAD** (GUI API Demo), built with **TypeScript + Playwright Test** in API mode (no browser). This is Day 1 of a 4-day program: a hand-built baseline with consistent patterns, a conventions file that AI assistants can follow, and a single HTTP entry point that the Day 2 coverage tool will instrument.

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

`spec/openapi.json` is a vendored copy of `gad-gui-api-demo/public/tools/schema/openapi_rest_demo.json` (OpenAPI 3.0.1, 136 paths). **It is the source of truth** for the contract. To refresh it, copy the file again and commit it with `chore:`.

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
| `npm run report` | Opens the HTML report |
| `npm run typecheck` | `tsc` in strict mode, no emit (framework + `tools/coverage`) |
| `npm run lint` / `lint:fix` | ESLint (also enforces the import rules; covers `tools/**`) |
| `npm run format` / `format:check` | Prettier |

## Project structure

```
api-framework-test/
├── .github/workflows/       # api-coverage.yml (CI)
├── spec/openapi.json        # GAD contract (source of truth)
├── src/
│   ├── api/                 # API clients, one per resource
│   ├── coverage/            # Request recorder (Proxy) + raw JSONL writer
│   ├── data/                # Test-data factories
│   ├── fixtures/            # Coverage → client → auth fixtures
│   ├── models/              # TypeScript interfaces
│   └── utils/               # schema.ts (Zod), auth.ts
├── tools/coverage/          # Coverage CLI (Node-native TS, zero deps)
├── tests/
│   ├── api/                 # Playwright API specs
│   └── unit/                # Unit tests (no network), incl. unit/coverage
├── docs/                    # Experiments + coverage baselines (docs/coverage/)
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

`.github/workflows/api-coverage.yml` runs on pull requests, on pushes to `main` and `session/**`, and on manual dispatch. It checks out GAD (`shunior-bo/gad-gui-api-demo`, ref `GAD_REF` or a `workflow_dispatch` input) into `./gad`, starts it, runs `npm run test:api` and the coverage CLI, writes the totals and top 10 gaps to the job summary, and uploads the `api-coverage`, `playwright-report` and (on failure) `gad-logs` artifacts. The job fails only if the API tests fail. If the GAD repository is private, add a `GAD_REPO_TOKEN` secret with read access. CI pins `TZ=UTC` (see Known GAD issues).

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
