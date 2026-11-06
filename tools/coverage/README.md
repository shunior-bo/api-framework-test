# `tools/coverage/` — API coverage CLI

A deterministic, dependency-free tool that compares **what the API tests actually call** (the raw records written by `src/coverage/`) with **what the OpenAPI contract documents** (`spec/openapi.json`). It reports three dimensions: operations, documented status codes and parameters.

> *AI proposes, deterministic tools verify.* The same input always produces byte-identical output (except `generatedAt`), so CI can diff runs and agents can trust `gaps.json`.

## Run it

```bash
npm run test:api            # records requests into reports/coverage/raw/
npm run coverage            # console report
npm run coverage:json       # writes reports/coverage/coverage.json + gaps.json
npm run test:api:coverage   # tests, then coverage even if tests fail (keeps the test exit code)
```

The CLI runs on Node ≥ 22.18 (Node 24 in this repo), using native TypeScript type stripping. It has **no dependencies**: no Playwright, no YAML/OpenAPI parser, and no arg-parsing library (it uses `node:util` `parseArgs`). It never imports the framework (`src/`).

The CLI has three subcommands. When no subcommand is given, it runs `analyze`, so the original invocation keeps working.

| Command | Purpose |
|---|---|
| `cli.ts [analyze] …` | records × spec → `coverage.json`, `gaps.json`, `summary.md`, `index.html` |
| `cli.ts compare --base <dir> --head <dir> …` | delta between two analyzed runs → `delta.json`, `delta.md`, `index.html` with the delta embedded (see [compare](#compare-base-vs-head-delta)) |
| `cli.ts gaps …` | deterministic gap batch with resolved spec context, for agents (see [gaps](#gaps-batch-selection-for-agents)) |

Each subcommand accepts `--help`.

```
node tools/coverage/src/cli.ts [analyze] [--spec spec/openapi.json] [--records reports/coverage/raw]
     [--config tools/coverage/coverage.config.json] [--out reports/coverage]
     [--format console,json,gaps,markdown,html] [--top 15] [--include-hooks] [--only-passed]
     [--min-operations <pct>] [--min-statuses <pct>] [--min-parameters <pct>]
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--spec` | `$OPENAPI_PATH` or `spec/openapi.json` | OpenAPI 3 JSON. YAML is not supported. |
| `--records` | `reports/coverage/raw` | Directory of `*.jsonl` records |
| `--config` | `tools/coverage/coverage.config.json` | Exclusions and ignore globs |
| `--out` | `reports/coverage` | Where file formats are written |
| `--format` | `console` | Any of `console` (stdout), `json` (`coverage.json`), `gaps` (`gaps.json`), `markdown` (`summary.md`), `html` (`index.html`) |
| `--top` | `15` | Gaps listed in the console and Markdown output |
| `--include-hooks` | off | Also count requests made in `beforeAll`/`afterAll` |
| `--only-passed` | off | Count only requests of tests whose outcome matched the expectation |
| `--min-*` | — | Fail with exit 1 if that dimension's % is below the threshold |

`npm run coverage` does not load `.env`. To use another spec, pass `--spec` or export `OPENAPI_PATH`. The git metadata in the reports comes from `COVERAGE_GIT_SHA` / `COVERAGE_GIT_BRANCH` when set (CI uses this to label the base and head of a PR), then from `GITHUB_SHA` / `GITHUB_HEAD_REF` / `GITHUB_REF_NAME`, then from `git`.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Report produced. **Gaps alone never fail the run.** |
| `1` | A `--min-*` threshold was not met. The failing dimension is printed. |
| `2` | Input or usage error: unknown flag, unreadable or invalid spec, invalid config (for example, an exclusion without a reason), no records ("run `npm run test:api` first"). |

## Coverage definitions

- **Operation** (`METHOD path`): covered if at least one *counted* request matched it.
- **Documented status**: each `responses` code of each operation is one unit. It is covered if some counted request for that operation received exactly that code. A range (`2XX`) is covered by any code inside it. `default` is reported separately and does not count toward the denominator; it shows as covered when a code not documented explicitly was received. A received code that the operation does not document (and that no `default` covers) goes to `extras.undocumentedStatuses` (spec drift). It is reported but is not a gap.
- **Parameter**: each declared parameter (`in`: `path` | `query` | `header`) of each operation is one unit. **Implicit path variables** are units too: a template `{var}` that the operation doesn't declare is added with `declared: false` and reported in `extras.specWarnings`.
  - `path`: covered if the operation was exercised.
  - `query`: covered if some counted request sent that name.
  - `header`: covered if some counted request sent it explicitly (case-insensitive).
  - `cookie`: never recorded, so never covered.
  - Totals split `required` and `optional`.
- **Counted request** (default): a recorded request that got an HTTP response (`status !== null`) and whose `phase` is not `"hook"`.
  - `--include-hooks` also counts `beforeAll`/`afterAll` requests.
  - `--only-passed` keeps only non-hook requests whose test ended with `testStatus === expectedStatus`. Note that a `test.fail()` test that fails as expected *does* count. Hook requests are governed only by `--include-hooks`.
  - Requests that threw (connection refused, timeout) are counted as `errored` and never cover anything.
- **Extras describe all recorded traffic**, whatever the counting options: `unmatched`, `ignoredUnmatched` and `undocumentedStatuses`. They report what the tests did, not what is covered.

### Matching rules

1. The base path comes from `servers[0].url` (`/api` for GAD) and is stripped. Paths outside it are unmatched.
2. The trailing slash is ignored and each segment is URL-decoded.
3. A template matches when it has the same number of segments, its literal segments are equal, and its `{var}` segments are non-empty.
4. **Specificity**: the template with the most literal segments wins (`/likes/article/mylikes` beats `/likes/article/{id}`). On a tie, the first position from the left where one template has a literal and the other a variable decides. Then plain string order.
5. Matching is path-first, as in OpenAPI. If the most specific path does not document the method, the request is unmatched with `reason: "method-not-documented"`. A request that matches no path is unmatched with `reason: "path-not-documented"`.

## Configuration: `coverage.config.json`

```json
{
  "excludeOperations": [{ "method": "GET", "path": "/debug/exit", "reason": "Terminates the GAD process." }],
  "ignoreUnmatched": ["/api/config/**"]
}
```

- `excludeOperations`: operations that must not be tested (destructive, out of scope, or unreachable). They leave every denominator and appear in `excluded` with their reason and any requests that hit them anyway. **`reason` is mandatory**; the CLI exits 2 without it. An exclusion that matches no operation produces a `configWarnings` entry.
- `ignoreUnmatched`: globs over the **full** request path (with `/api`). `*` stays within one segment and `**` crosses segments. Matching requests go to `extras.ignoredUnmatched` instead of `extras.unmatched`. Use it for known test infrastructure such as `/api/config/features`.

Current exclusions and the reasons for them are listed in the config file itself and summarized in `docs/coverage/day1-baseline.md`.

## Outputs

### `coverage.json` (schemaVersion 1)

`source` (spec path/title/version/sha256, records dir/files/lines/invalidLines, git sha/branch), `options`, `requests` (recorded, counted, hooks, filteredByOutcome, errored, unmatched), `totals`, `byTag`, `operations[]` (statuses, parameters, observedStatuses, tests), `excluded[]`, `extras` (unmatched, ignoredUnmatched, undocumentedStatuses, specWarnings, configWarnings, invalidRecordLines). `pct` has two decimals and is `null` when `total` is 0. Every array is sorted. Keys use template paths relative to the base path (`POST /articles`).

### `gaps.json` (schemaVersion 1): the contract for agents

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "…",
  "spec": { "path": "spec/openapi.json", "sha256": "…" },
  "summary": { "total": 162, "high": 145, "medium": 17, "low": 0 },
  "gaps": [
    {
      "id": "status:POST /articles:400",
      "type": "status",
      "priority": "medium",
      "method": "POST",
      "path": "/articles",
      "operationId": "postArticle",
      "tags": ["articles"],
      "status": "400",
      "hint": "Documented 400 (\"Bad request - malformed JSON\") for POST /articles is never exercised. Send a malformed request (e.g. invalid JSON body)."
    }
  ]
}
```

| Priority | Gap |
|----------|-----|
| `high` | Operation never called. This is **one** gap, with its pending statuses and parameters nested under `pending`. |
| `high` | Documented 1xx/2xx/3xx status (or range) not received in a covered operation |
| `medium` | Documented 4xx/5xx status (or range) not received in a covered operation |
| `medium` | Required parameter not covered in a covered operation |
| `low` | Optional parameter not covered in a covered operation |

Ordering: priority, then path, then method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS), then type (operation, status, parameter), then code or parameter. `default` responses never become gaps.

**Stable ids** are the join key for computing new and closed gaps between two runs (Day 3):
`operation:<METHOD> <path>` · `status:<METHOD> <path>:<code>` · `parameter:<METHOD> <path>:<in>:<name>`.

Hints are built from spec data only (summary, response description, request body `$ref`), with no AI.

### `summary.md`

A totals table and the top N gaps, in GitHub-flavored Markdown. CI uses it as the job summary when there is no base to compare against.

### `index.html`

A single self-contained file, with CSS and a small filter script inline. There is no CDN or network access (a strict Content-Security-Policy enforces this), so it can be opened straight from a downloaded artifact. It contains:

- the totals cards;
- the delta block, when produced by `compare`;
- coverage by tag;
- the operations table, filterable by tag, covered state, method and free text, with expandable per-operation status/parameter detail, observed statuses and tests;
- the gaps table, filterable;
- the extras.

It works without JavaScript; the script only filters. Light and dark themes follow `prefers-color-scheme`. **Every text that comes from the spec, the records or git is HTML-escaped** (the spec is external input). The output is deterministic, and its size is about 240 KB for GAD.

## `compare`: base vs head delta

```
node tools/coverage/src/cli.ts compare --base <dir> --head <dir> [--out reports/coverage/delta]
     [--format console,json,markdown,html] [--top 10] [--fail-on-negative operations|statuses|parameters|any]
```

Each directory must contain the `coverage.json` and `gaps.json` of one analyzed run, produced from **its own** spec and config. Both must have a supported `schemaVersion`; otherwise the command exits 2. The command writes:

- `delta.json` (`schemaVersion: 1`; `generatedAt` is the only non-deterministic field):
  - `base` and `head` (git, spec sha256/version, totals) and `specChanged`;
  - `totals` per dimension, each with `{ base, head, delta: { covered, total, pct } }`, plus `required`/`optional` for parameters. `pct` is a 2-decimal difference, `null` if either side is `null`;
  - `operations.added`: in head's scope but not in base's, with a `covered` flag. A new endpoint in the spec shows up here;
  - `operations.removed`;
  - `operations.newlyCovered`;
  - `operations.noLongerCovered`: a regression;
  - `gaps.opened`: full head gaps whose `id` is not in base;
  - `gaps.closed`: base ids missing from head;
  - `gaps.summary`;
  - `verdict` and `verdictReasons`.
- `delta.md`: a headline table (`Dimension | Base | Head | Δ covered | Δ %`, with ▲/▼/＝), the verdict, added and removed operations, newly covered, regressions, the top N new gaps, then the top N head gaps. Lists longer than N collapse into `<details>`. The output is **hard-limited to 60,000 characters**; truncation is deterministic, at a line boundary, closes open `<details>` and points to the artifact. CI uses this file for the job summary and the PR comment.
- `index.html`: the head report with the delta embedded.

**Verdict rules** (deterministic):

| Signal | Kind |
|---|---|
| a dimension's `covered` decreased · a dimension's `pct` decreased · `noLongerCovered` not empty · an operation was **added** to the spec and is **not covered** | regression |
| a dimension's `covered` increased · a dimension's `pct` increased · `newlyCovered` not empty | improvement |

The verdict is `mixed` if there are both kinds of signal, `regressed` if there are only regressions, `improved` if there are only improvements, and `unchanged` otherwise.

Example: the spec adds an endpoint that nobody tests. `covered` stays the same, `total` grows and `pct` drops, so the verdict is `regressed`, with the endpoint listed in `operations.added`. Both deltas, `covered` and `pct`, are reported.

`--fail-on-negative <dim>` exits 1 when that dimension's `pct` delta is negative. `any` checks all three dimensions and also fails on a non-empty `noLongerCovered`. It is **off by default**, and CI does not enable it yet.

## `gaps`: batch selection for agents

```
node tools/coverage/src/cli.ts gaps [--from reports/coverage/gaps.json] [--spec spec/openapi.json]
     [--priority high,medium] [--type operation,status,parameter] [--tag likes,bookmarks]
     [--path-prefix /likes] [--exclude-ids <file|csv>] [--limit 5] [--format json|markdown]
```

- The same `gaps.json`, spec and filters always produce the same batch, in the canonical gap order (the comparator is shared with `gaps.json`). The output has no timestamp.
- `--tag` matches a gap that has any of the listed tags.
- `--path-prefix` is segment-aware: `/likes` matches `/likes` and `/likes/…`, but not `/likesX`.
- `--exclude-ids` takes a CSV, or a file with one id per line (`#` starts a comment) or with a JSON array. Agents use it to skip gaps they have flagged as blocked.
- `--limit 0` returns every matching gap.
- Each selected gap includes `operation`: the full spec context of its operation, with every `$ref` resolved recursively (cycle-safe, depth-capped, `xml` dropped). The context holds the method, path, `url` (with the base path), operationId, summary, description, tags, security plus the referenced security schemes, parameters, requestBody and responses with their schemas. That is about 0.5–2 KB per GAD operation.
- `source.specMatches` is `false`, with a warning on stderr, when the spec changed since `gaps.json` was produced. In that case re-run the coverage.

The `api-coverage` MCP server (`tools/coverage-mcp/`) exposes the same selection as the `coverage_list_gaps` tool.

## Source layout

```
src/
├── cli.ts                 # entrypoint (process I/O only)
├── main.ts                # run(argv, io): subcommand dispatch, analyze flags, exit codes (unit-testable)
├── spec/                  # loadSpec.ts ($ref, implicit params, warnings), operationContext.ts (deep $ref resolution), types.ts
├── records/loadRecords.ts # JSONL reader + validator (corrupt lines reported, not fatal)
├── match/pathMatcher.ts   # URL → template (specificity rules)
├── analyze/               # config.ts, coverage.ts (3 dimensions), gaps.ts, types.ts (report contracts)
├── compare/               # delta.ts (computeDelta, verdict), loadSnapshot.ts, command.ts, types.ts (delta.json contract)
├── gaps/                  # select.ts (filters + batch), command.ts
├── report/                # build.ts (coverage.json/gaps.json), console.ts, markdown.ts, deltaMarkdown.ts, html.ts
├── estimate/compare.ts    # Day 2 experiment: AI estimate vs tool (entry: compare-estimate.ts)
└── shared/                # deterministic ordering, errors, CliIo
```

Code rules: only erasable TypeScript syntax (no `enum`, `namespace` or constructor parameter properties). Relative imports use an explicit `.ts` extension. No `import.meta` outside `cli.ts`, so that Playwright's CJS transform can load the modules in unit tests. `tools/coverage/package.json` sets `"type": "module"` for this folder only. The code is type-checked by `npm run typecheck` (`tools/coverage/tsconfig.json`, `erasableSyntaxOnly`) and tested in `tests/unit/coverage/`.
