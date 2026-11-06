# Day 1 coverage baseline

This is the coverage of the hand-written Day 1 suite (29 API tests) against `spec/openapi.json`, as measured by `tools/coverage`. The tool output is committed as an **immutable snapshot** in [`day1-baseline/`](day1-baseline/):

- [`coverage.json`](day1-baseline/coverage.json)
- [`gaps.json`](day1-baseline/gaps.json)
- [`summary.md`](day1-baseline/summary.md)

Day 3 computes deltas against this snapshot.

| | |
|---|---|
| Spec | 🦎 GAD v1.3.3: OpenAPI 3.0.1, 136 paths, 170 operations, sha256 `1317f4717dba…` |
| Code | `session/02-coverage-tool` @ `e6b8cfd`. The Day 1 tests are unchanged; only `tc-articles-12` got the timezone-conditional `test.fail` |
| Run | `npm run test:api:coverage` against a local GAD (host at UTC-04:00) after `GET /api/restoreDB` |
| Options | default: hooks not counted, every test outcome counted |
| Requests | 67 recorded · 64 counted · 3 in `beforeAll`/`afterAll` hooks · 0 errored · 0 unmatched · 3 ignored |
| Test result | 29 passed: 28 normal tests, plus `tc-articles-12` failing as expected |

## Totals

In scope are 160 operations: 170 in the spec minus 10 exclusions.

| Dimension | Covered | Total | % |
|---|---:|---:|---:|
| Operations | 16 | 160 | 10.00% |
| Documented statuses | 27 | 374 | 7.22% |
| Parameters | 7 | 95 | 7.37% |
| ↳ required | 7 | 49 | 14.29% |
| ↳ optional | 0 | 46 | 0.00% |

## The 6 Day 1 resources (by OpenAPI tag)

| Tag | Operations | Statuses | Parameters |
|---|---|---|---|
| `healthcheck` | 1/8 (12.50%) | 1/8 (12.50%) | 0/0 (n/a) |
| `authentication` | 1/2 (50.00%) | 2/4 (50.00%) | 0/0 (n/a) |
| `articles` | 6/7 (85.71%) | 10/24 (41.67%) | 4/5 (80.00%) |
| `comments` | 4/7 (57.14%) | 7/25 (28.00%) | 2/5 (40.00%) |
| `users` | 3/7 (42.86%) | 5/25 (20.00%) | 1/5 (20.00%) |
| `labels` | 1/1 (100.00%) | 2/2 (100.00%) | 0/0 (n/a) |

The 16 covered operations are:

- `GET /health`
- `POST /login`
- `GET /labels`
- `GET`/`POST /articles`
- `GET`/`PUT`/`PATCH`/`DELETE /articles/{id}`
- `GET`/`POST /comments`
- `GET`/`DELETE /comments/{id}`
- `GET`/`POST /users`
- `DELETE /users/{id}`

`DELETE /comments/{id}` and `DELETE /users/{id}` are covered only through test **cleanup**. Cleanup requests are real requests and count, but no assertion checks their result.

## Top 20 gaps

The gap list has 162 gaps: 145 high, 17 medium and 0 low.

| # | Priority | Type | Gap |
|---:|---|---|---|
| 1 | high | operation | `GET /about` |
| 2 | high | operation | `GET /article-labels/articles/{id}` |
| 3 | high | operation | `PUT /article-labels/articles/{id}` |
| 4 | high | operation | `GET /articles/search` |
| 5 | high | status | `PUT /articles/{id}:201` |
| 6 | high | operation | `HEAD /articles/{id}` |
| 7 | high | operation | `GET /book-authors` |
| 8 | high | operation | `GET /book-genres` |
| 9 | high | operation | `GET /book-shop-account-payment-cards` |
| 10 | high | operation | `PUT /book-shop-account-payment-cards` |
| 11 | high | operation | `DELETE /book-shop-account-payment-cards` |
| 12 | high | operation | `POST /book-shop-account-payment-cards/topup` |
| 13 | high | operation | `GET /book-shop-accounts` |
| 14 | high | operation | `POST /book-shop-accounts` |
| 15 | high | operation | `POST /book-shop-accounts/files` |
| 16 | high | operation | `GET /book-shop-accounts/my-books` |
| 17 | high | operation | `GET /book-shop-accounts/{id}` |
| 18 | high | operation | `PATCH /book-shop-accounts/{id}` |
| 19 | high | operation | `POST /book-shop-authorize` |
| 20 | high | operation | `GET /book-shop-book-reviews` |

Within one priority the order is alphabetical by path. The top 20 is therefore "the first high-priority gaps", not "the most important ones". Agents should filter by tag or path (for example `tags` contains `articles`) rather than take the head of the list.

All 17 medium gaps are 4xx statuses of covered operations:

- `POST /articles` 400
- `PUT /articles/{id}` 400, 401, 404, 422
- `PATCH /articles/{id}` 400, 401, 404, 422
- `DELETE /articles/{id}` 400
- `POST /comments` 400
- `GET /comments/{id}` 400
- `DELETE /comments/{id}` 401, 404
- `POST /users` 400
- `DELETE /users/{id}` 401, 404

## Spec drift: undocumented requests and statuses

| Finding | Detail |
|---|---|
| Undocumented request (ignored by config) | `POST /api/config/features` ×3, all in `beforeAll`/`afterAll` hooks of `labels.spec.ts`. It is GAD's runtime feature-flag endpoint and is not in the spec. |
| Unmatched requests | none |
| Undocumented statuses | none: every received status is documented for its operation |
| Spec warning | `PATCH /api/books/{id}`: the template repeats the `/api` base path, so the documented URL is `/api/api/books/{id}`, which GAD does not serve (excluded) |
| Spec warning | Duplicate `operationId` `updateOrderStatus` on `PATCH /book-shop-manage/orders/{id}` and `PATCH /book-shop-orders/{id}` |
| Spec fact | 22 operations have no `operationId`, so gap ids use `METHOD path` |

## Exclusions (`tools/coverage/coverage.config.json`)

| Operation | Reason |
|---|---|
| `GET /debug/exit` | Terminates the GAD process; would kill the server under test |
| `GET /debug/restart` | Restarts the GAD process (needs a process manager); destructive for the run |
| `GET /restoreDB` | Replaces the shared database; forbidden in tests by CONVENTIONS.md |
| `GET /restoreEmptyDB` | Empties the shared database |
| `GET /restoreBigDB` | Replaces the shared database with a large dataset |
| `GET /diagnostic/toggle-metrics` | Non-idempotent global toggle; a failure between two calls leaves the server altered |
| `GET /diagnostic/toggle-diagnostics` | Same as above |
| `GET /diagnostic/toggle-logs` | Same as above |
| `POST /diagnostic/log-level` | Changes global server logging configuration; operational, out of functional scope |
| `PATCH /api/books/{id}` | Spec defect: unreachable as documented |

## How to reproduce

```bash
# terminal 1 — GAD
cd ../gad-gui-api-demo && npm start
# terminal 2 — framework
curl -s http://localhost:3000/api/restoreDB > /dev/null && sleep 3   # wait: GAD persists the restore asynchronously
npm run test:api:coverage
node -e "for (const f of ['coverage.json','gaps.json']) { \
  const strip = (p) => { const d = require(p); delete d.generatedAt; delete d.source?.git; return JSON.stringify(d); }; \
  console.log(f, strip('./reports/coverage/' + f) === strip('./docs/coverage/day1-baseline/' + f) ? 'identical' : 'DIFFERENT'); }"
```

`generatedAt` and `source.git` (commit sha) are the only fields expected to differ. On a UTC host, such as CI, `requests.counted` is 65 instead of 64, because `tc-articles-12` passes there and cleans up with one extra `DELETE`. The coverage totals are the same.

## Observations

- **Most of the spec is outside the Day 1 suite's reach.** 31 of the 37 tags have no coverage at all: book-shop (45 operations), games, quiz, surveys, messenger, stats, visits, likes, bookmarks, flashposts and others. Even inside the 6 Day 1 tags, 16 of 32 operations are uncovered: `GET /about`, `HEAD`/`PUT`/`PATCH` variants, `GET /users/{id}`, `GET /login`, `GET /ping` and the `GET /health/*` family.
- **Parameter coverage is dominated by search.** The `search` tag holds 36 of the 95 parameters (the query filters of `GET /articles|comments|users/search`). One well-parameterized search test per resource would move that dimension more than anything else.
- **Optional parameters: 0%.** No Day 1 test sends a query parameter (`_limit`, `_page`, `_sort`, …).
- **Cheapest gaps to close,** with the clients that already exist:
  1. **401 on `PUT`/`PATCH /articles/{id}` and `DELETE /comments/{id}`/`/users/{id}`.** Pass `''` as the token, exactly like `tc-articles-11`.
  2. **422 on `PUT`/`PATCH /articles/{id}`.** Use `buildArticle({ title: '' })`.
  3. **`PUT /articles/{id}` 201 (high).** GAD upserts, so a PUT on an id that does not exist creates the article. Cleanup must delete it.
  4. **`DELETE /comments/{id}` 404 and `DELETE /users/{id}` 404.** Delete twice.
  5. **One-line GETs:** `GET /users/{id}` (operation + 200/404), `GET /ping`, `GET /about`, `GET /health/*` (5 operations) and `GET /login` (200/401 with or without a token). These need new client methods but no new data.
- **Hard or impossible today:**
  - **400 "malformed JSON"** (6 medium gaps) needs a client method that can send a raw string body. The typed clients cannot do that by design.
  - **`PUT /articles/{id}` 404** is probably unreachable, because PUT upserts.
  - **`GET /comments/{id}` 400** has no obvious trigger.
  - These are candidates for documented exclusions or spec fixes, not tests.
- **Cleanup traffic counts as coverage.** `DELETE` operations covered only by `finally` blocks show as covered with 200. That is honest at the request level, but a dedicated assertion-backed test is still missing for `DELETE /comments/{id}` and `DELETE /users/{id}`. Day 3 can tell the two apart through `operations[].tests`.
