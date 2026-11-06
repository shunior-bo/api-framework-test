You are estimating the API test coverage of this repository **by reading code only**. Do not run commands, do not start servers, and do not look for reports or tools outside this folder. There is no coverage tool here; your estimate is the measurement.

## What to read

1. `spec/openapi.json`: the OpenAPI 3.0.1 contract. The server base path is `/api` (`servers[0].url`). Template paths in the spec are relative to it: a request to `/api/articles/5` is the operation `GET /articles/{id}`.
2. `tests/api/*.spec.ts`: the API tests.
3. `src/api/*.ts`, `src/fixtures/*.ts` and `src/data/*.ts`: to know which HTTP requests each client method and fixture really sends. This includes the login made by the `authToken` fixture and the cleanup requests in `finally` blocks.

## Definitions (use exactly these)

- **Counted request**: any request made while a test runs (test body, `beforeEach`, `afterEach`, fixtures used by the test, and cleanup in `finally`) that receives an HTTP response. Requests made in `test.beforeAll` / `test.afterAll` are **not** counted. Assume every test runs and all of them pass. A test marked `test.fail(...)` still runs and its requests count.
- **Operation** (`METHOD path`): covered if at least one counted request matches it. A literal path segment beats a `{variable}` segment (`/articles/search` is not `/articles/{id}`). A request whose path is not in the spec, or whose method is not documented for that path, matches nothing.
- **Documented status**: each response code of each operation is one unit. It is covered if some counted request for that operation **received exactly that code**. Reason about which code GAD returns for each request the tests make.
- **Parameter**: each declared parameter (`in`: `path`, `query`, `header`) of each operation is one unit.
  - A `path` parameter is covered if its operation is covered.
  - A `query` parameter is covered if some counted request sent that query name.
  - A `header` parameter is covered if some counted request explicitly sent that header (case-insensitive).
- **Totals** cover only in-scope operations. These 10 operations are **excluded** from every total:
  `GET /debug/exit`, `GET /debug/restart`, `GET /restoreDB`, `GET /restoreEmptyDB`, `GET /restoreBigDB`, `GET /diagnostic/toggle-metrics`, `GET /diagnostic/toggle-diagnostics`, `GET /diagnostic/toggle-logs`, `POST /diagnostic/log-level`, `PATCH /api/books/{id}`.
- `pct` = covered / total × 100, rounded to 2 decimals.

## Gaps (for `topGaps`)

List the first 20 gaps in this order and format:

- Gap ids:
  - `operation:<METHOD> <path>`: an operation that is not covered (one gap per operation).
  - `status:<METHOD> <path>:<code>`: a documented status not received, in a **covered** operation.
  - `parameter:<METHOD> <path>:<in>:<name>`: a parameter not covered, in a **covered** operation.
- Priority:
  - `high`: an uncovered operation, or a 1xx/2xx/3xx status.
  - `medium`: a 4xx/5xx status, or a required parameter.
  - `low`: an optional parameter.
- Order:
  1. priority (high → medium → low);
  2. path, in plain character order;
  3. method, in the order GET, POST, PUT, PATCH, DELETE, HEAD;
  4. type, in the order operation, status, parameter.

## Answer format

Explain your reasoning briefly. Then end your answer with **exactly one** fenced JSON block of this shape. Use integers for `covered`/`total`, a number for `pct`, and paths without `/api`:

```json
{
  "operations": { "covered": 0, "total": 0, "pct": 0 },
  "statuses": { "covered": 0, "total": 0, "pct": 0 },
  "parameters": { "covered": 0, "total": 0, "pct": 0 },
  "coveredOperations": ["GET /articles"],
  "topGaps": ["operation:GET /about"]
}
```
