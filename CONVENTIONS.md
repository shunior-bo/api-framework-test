# Conventions

This file is the contract for writing code in this framework. It is written so that a person **or an AI assistant** can add a correct test without reading the rest of the code. If something here conflicts with existing code, this file wins. Fix the code.

Stack: TypeScript (strict) + Playwright Test in API mode (no browser) + Zod + @faker-js/faker. App under test: **GAD**, with its REST API under `/api`.

---

## 1. Hard rules (read these first)

1. **All HTTP goes through a client in `src/api/`, and clients come from fixtures.** Tests never call `request.get/post/...` and never write `new XxxClient(request)`.
   *Why:* the coverage recorder (§12) wraps the `request` fixture, and every client is built from it in `src/fixtures/api.fixture.ts`. A request made any other way (for example `playwright.request.newContext()` or an external HTTP library) is **left out of coverage**, and the tool will then report as untested an endpoint that the test does exercise.
2. **`spec/openapi.json` is the source of truth** for paths, methods, status codes and body shapes. It is a byte-identical copy of `gad-gui-api-demo/public/tools/schema/openapi_rest_demo.json` at the GAD commit pinned in `gad.ref.json`. Never edit it by hand: change GAD, then `npm run spec:sync` (§14). `OPENAPI_PATH` in `.env` points to it.
3. **Only `src/fixtures/auth.fixture.ts` logs in.** Tests get tokens from `authToken` or `loginAs(...)`. The single exception is `tests/api/auth.spec.ts`, because login is its feature under test.
4. **Only `src/utils/schema.ts` imports `zod`.** ESLint enforces this rule.
5. **Always use the `@src/` alias. Never use relative imports** (`./` or `../`). ESLint enforces this rule.
6. **No hardcoded URLs or credentials.** The base URL comes from `BASE_URL`, and credentials come from `API_USERNAME` / `API_PASSWORD` through fixtures. Only `playwright.config.ts` and `src/fixtures/` read `process.env`. The one exception is `src/coverage/globalSetup.ts`, which only *writes* `COVERAGE_RUN_ID`. The standalone CLI in `tools/coverage/` may read env vars because it is a tool and not a framework layer.
7. **No `any`.** Response bodies are typed `unknown` and narrowed with a schema. ESLint enforces this rule.
8. **Every test cleans up what it creates** in a `finally` block, using the client's `delete`.
9. **Never bend an assertion to match a GAD bug.** Keep the assertion the contract demands and mark the test with `test.fail(true, '<reason>')` plus a comment that explains the spec-vs-actual discrepancy.

---

## 2. Folder structure and layer responsibilities

```
api-framework-test/
├── .github/workflows/         # CI (api-coverage, feature-agent, test-agent, pr-guards, repin-gad)
├── gad.ref.json               # GAD revision under test (§14)
├── spec/openapi.json          # Contract (source of truth)
├── src/
│   ├── api/                   # XxxClient.ts — one class per resource
│   ├── models/                # xxx.model.ts — pure interfaces
│   ├── data/                  # factories.ts — buildXxx() payload builders
│   ├── coverage/              # RequestRecorder (Proxy over `request`), raw JSONL writer
│   ├── fixtures/              # coverage.fixture.ts → api.fixture.ts (clients) → auth.fixture.ts (tokens)
│   └── utils/                 # schema.ts (Zod), auth.ts (auth strategies)
├── tools/coverage/            # Standalone coverage CLI (no Playwright, no deps)
├── tools/spec-sync/           # gad.ref.json pin + spec sync / drift check (no deps)
├── tests/
│   ├── api/                   # xxx.spec.ts — one spec per resource (needs GAD)
│   └── unit/                  # xxx.spec.ts — pure logic, no network
│       └── coverage/          # tests of tools/coverage + the recorder
├── docs/                      # Experiments, reports, coverage baselines
├── playwright.config.ts       # projects: api, unit; globalSetup stamps the coverage run
└── CONVENTIONS.md             # This file
```

| Layer | Responsible for | SOLID | Must NOT |
|-------|-----------------|-------|----------|
| `src/api/` | Sending one HTTP request per method and returning the raw `APIResponse` | SRP + DIP | `expect`, `process.env`, body parsing, branching on responses, full URLs |
| `src/models/` | Request/response shapes as `interface`s with JSDoc on each field | SRP | classes, methods, zod, playwright imports |
| `src/utils/schema.ts` | Every Zod schema, plus the re-export of `z` | SRP + OCP | network, assertions |
| `src/utils/auth.ts` | `AuthStrategy`, `TokenAuth`, `BasicAuth`, `authHeaders()` | OCP + LSP + ISP | network, env reads |
| `src/data/` | `buildXxx(overrides)` factories that return valid, unique payloads | SRP + OCP | network, assertions, env reads |
| `src/coverage/` | Recording every request (names only) as raw JSONL | SRP + OCP | assertions, changing requests/responses, recording values |
| `src/fixtures/` | Recording proxy (`coverage.fixture.ts`), building clients (`api.fixture.ts`) and the login flow (`auth.fixture.ts`) | SRP + OCP + DIP | feature assertions, HTTP logic |
| `tools/coverage/` | Coverage CLI: spec × records → coverage.json / gaps.json | SRP | Playwright, `src/` imports, dependencies, non-deterministic output |
| `tests/api/` | One spec per resource, with happy path and negative cases | SRP | raw `request`, `zod`, `@playwright/test` imports, login calls |
| `tests/unit/` | Tests for `src/utils`, `src/data`, `src/coverage` and `tools/coverage` with no network | SRP | HTTP, server fixtures |

Every source file starts with a JSDoc header that names its SOLID principle(s) and has a `Must NOT:` section. Every folder has a `README.md` with these sections: *What belongs here / SOLID principle / What must NOT be here / Example file*.

---

## 3. Naming

| Thing | Convention | Example |
|-------|------------|---------|
| Client file / class | `PascalCase` + `Client`, plural resource | `ArticlesClient.ts` / `class ArticlesClient` |
| Client methods | `getAll`, `getById`, `create`, `update` (PUT), `patch`, `delete`, `search` | `articlesClient.patch(id, data, token)` |
| Auth parameter | `token: string`, always the **last** parameter | `create(data, token)` |
| Model file | `kebab/lower` + `.model.ts`, singular | `article.model.ts` |
| Model interfaces | Entity `Xxx`, body `CreateXxxRequest`, filters `XxxSearchFilters` | `Article`, `CreateArticleRequest` |
| Schemas | Entity `XxxSchema`, list `XxxsSchema` | `ArticleSchema`, `ArticlesSchema` |
| Factory | `buildXxx(overrides?)` | `buildArticle({ title: '' })` |
| Client fixture | camelCase class name | `articlesClient` |
| Spec file | plural resource + `.spec.ts` | `articles.spec.ts` |
| Describe block | `'<Resource> API'` | `test.describe('Articles API', …)` |
| Test title | `'<METHOD> /api/<path> <expected behavior>'` with `{id}` for path params | `'POST /api/articles returns 201 and the created article'` |
| Tags | one of `@smoke` (happy path), `@negative` (error status), `@regression` (other) **plus** `@tc-<resource>-NN` (unique, sequential per file) | `{ tag: ['@negative', '@tc-articles-05'] }` |

---

## 4. Imports

| What you need | Import from | Never import from |
|---------------|-------------|-------------------|
| `test`, `expect` (spec with **public** endpoints only) | `@src/fixtures/api.fixture` | `@playwright/test` |
| `test`, `expect` (spec that needs a token) | `@src/fixtures/auth.fixture` | `@playwright/test` |
| `z`, `ArticleSchema`, `ErrorMessageSchema`, … | `@src/utils/schema` | `zod` |
| Payload builders, `NON_EXISTENT_ID` | `@src/data/factories` | — (don't inline payloads) |
| Types (`ResourceId`, `CreateArticleRequest`) | `@src/models/<x>.model` with `import { type … }` | relative paths |
| A client **type** for a helper's signature | `import { type ArticlesClient } from '@src/api/ArticlesClient'` | creating an instance in a test |
| `APIRequestContext`, `APIResponse` (clients only) | `@playwright/test` | — |
| Coverage tool / MCP modules (only in `tests/unit/coverage/`) | `@coverage/<module>` (alias of `tools/coverage/src/*`), `@coverage-mcp/<module>` (alias of `tools/coverage-mcp/src/*`) | relative paths; these aliases anywhere else (ESLint) |
| Anything, from inside `tools/coverage/src/` | relative path **with `.ts`** (`./spec/loadSpec.ts`) | `@src/*`, `@playwright/*`, `zod` (ESLint) |

`tests/unit/*.spec.ts` import `test`/`expect` from `@playwright/test`, because they need no fixtures.

---

## 5. Assertion style and order

Read the body as `unknown`, then assert in this fixed order:

1. **Status code:** `expect(response.status()).toBe(201);`
2. **Schema:** `const parsed = XxxSchema.safeParse(body); expect(parsed.success, parsed.error?.message).toBe(true);`
3. **Field values**, read through `parsed.data?.…`

```typescript
const response = await articlesClient.create(payload, authToken);
const body: unknown = await response.json();

// --- ASSERT ----------------------------------------------------------
expect(response.status()).toBe(201);

const parsed = ArticleSchema.safeParse(body);
expect(parsed.success, parsed.error?.message).toBe(true);

expect(parsed.data).toMatchObject({ ...payload });
```

- Error responses (401/409/422) are validated with `ErrorMessageSchema` (`{ error: { message } }`), then the message is checked. The 401 message depends on the resource: articles and comments answer `"Access token not provided!"` without a token, while likes and bookmarks answer `"Access token for given user is invalid!"` even for an empty token. Assert the message the resource really sends (check it with `curl` first).
- **400 "malformed JSON"** is covered with a client method `<method>WithRawBody(rawBody, …)` that sends the exact text as `application/json` (e.g. `ArticlesClient.createWithRawBody`, `updateWithRawBody`, `patchWithRawBody`, `LikesClient.createWithRawBody`), with the body built by a factory (`buildMalformedArticleJson()`). It still goes through the fixture's `request`, so coverage sees it. This is the endorsed way: add one only where the spec documents a 400 for malformed JSON.
- GAD's 404 body is `{}`, so assert `expect(body).toEqual({})`.
- To use an interface with `toMatchObject`, spread it: `toMatchObject({ ...payload })`.
- In **Arrange**, when you create prerequisite data, check its status first and then parse it strictly: `expect(r.status()).toBe(201); const created = ArticleSchema.parse(await r.json());`

---

## 6. Test data and cleanup

- Build every payload with `buildXxx()` from `@src/data/factories`. Override only what the test is about: `buildUser({ email: 'not-an-email' })`.
- Factories add `uniqueSuffix()` so that tests don't collide (for example, the 409 on duplicate email).
- For invalid payloads, override a field with an empty or invalid value. Don't delete keys or cast types.
- To get a 404 on GET or PATCH, use `NON_EXISTENT_ID`. Never PUT to it: GAD upserts and would create the record (and every later run would find it). For **PUT 201** ("created"), PUT to an id above every existing one, read from `getAll()` (`Math.max(...ids) + 1000`, as tc-articles-13 does), and delete it in `finally`.
- **Cleanup:** wrap Act and Assert in `try { … } finally { await client.delete(id, token); }`. If the resource is created in Act, delete it only if the parse succeeded: `if (parsed.success) await client.delete(parsed.data.id, authToken);`
- Delete children before parents (a comment before its article).
- **Users can only delete themselves.** Clean up with `loginAs({ email, password })` and then `usersClient.delete(id, ownToken)`.
- Never call `/api/restoreDB*` from a test. It resets data for every test that is running.
- **Feature flags.** Some resources sit behind GAD feature flags that are **OFF by default**; while a flag is off, every request to its resource answers `404 {}`. Known ones: `feature_labels` (`/api/labels`, `/api/article-labels`), `feature_likes` (`/api/likes*`), `feature_user_bookmark_articles` (`/api/bookmarks*`); the full list is GAD's `config/config-features.js`. The spec of a flag-gated resource, and only that spec:
  - runs in serial mode (`test.describe.configure({ mode: 'serial' })`);
  - turns its flag on in `beforeAll` with `configClient.setFeatures({ <flag>: true })` and asserts 200;
  - restores GAD's default in `afterAll`.

  Examples: `labels.spec.ts`, `likes.spec.ts`, `bookmarks.spec.ts`. Never switch flags with `curl` or from another resource's spec. `/api/config/features` is test infrastructure, not part of the contract. When GAD's only way to produce a documented bare 404 is the disabled flag (likes answer `200 {"likes":0}` for unknown ids), cover it in a `describe('with <flag> disabled (GAD default)')` block and say so in a comment (tc-labels-02, tc-likes-11/12).
- **Toggle endpoints with no DELETE** (`POST /api/likes` adds the like the first time and removes it the second): clean up by calling the toggle again in `finally`.
- **Residue the API cannot delete** (for example the first bookmark record of a user: there is no DELETE, and json-server reuses deleted user ids): a test that passes only once is not acceptable. Report the gap as **blocked** with that reason (Day 3: `status:POST /bookmarks/articles:201`) instead of writing it.

**GAD data quirks that the factories already handle:** the `date` is 24 h in the past (GAD rejects the current UTC time as "in future"), and articles always include `image` (without it `/api/health` reports "Degraded").

---

## 7. Auth

| Scenario | How |
|----------|-----|
| Token for the seed user | destructure `authToken` from `@src/fixtures/auth.fixture` |
| Token for another user (one you just created) | `const token = await loginAs({ email, password });` |
| Seed credentials as data (only in `auth.spec.ts`) | destructure `seedCredentials` |
| No token (expect 401) | pass `''` as the token. GAD answers 401 `"Access token not provided!"` |
| Invalid token (expect 401) | pass `'invalid-token'` |
| Public endpoint | don't destructure `authToken`. If the whole file is public, import from `@src/fixtures/api.fixture` |

Clients always send `Authorization: Bearer <token>`, built with `authHeaders(new TokenAuth(token))`. The login response field is **`access_token`**.

---

## 8. Recipe: how to add a test for a new endpoint

The example below uses an **illustrative** resource, `/api/widgets`, that does not exist in GAD. Replace the name, fields and status codes with the real ones from the spec.

### Step 1: Read the operation in the spec

```bash
node -e "const s=require('./spec/openapi.json');console.log(JSON.stringify(s.paths['/widgets'],null,2))"
```

Write down, for each method: the request body schema (`$ref`), the documented response codes, whether `security: bearerAuth` is set, and the path parameters. Then resolve the `$ref`s in `components.schemas`.

### Step 2: Model, `src/models/widget.model.ts`

```typescript
import { type ResourceId } from '@src/models/common.model';

/**
 * Widget resource returned by GET /api/widgets/{id} (`components.schemas.Widget`).
 *
 * SOLID: Single Responsibility Principle (SRP) — data shape only.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface Widget {
  /** Unique identifier assigned by the API. */
  id: ResourceId;
  /** Display name. */
  name: string;
}

/**
 * Request body for POST /api/widgets (`components.schemas.WidgetCreate`).
 *
 * SOLID: Dependency Inversion Principle (DIP) — WidgetsClient depends on this interface.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface CreateWidgetRequest {
  /** Display name. */
  name: string;
}
```

### Step 3: Schema, appended to `src/utils/schema.ts`

```typescript
/**
 * Validates a single widget (`components.schemas.Widget`).
 *
 * Expected shape: { id, name }
 */
export const WidgetSchema = z.object({
  id: IdSchema,
  name: z.string(),
});

/** Validates the response body of GET /api/widgets. */
export const WidgetsSchema = z.array(WidgetSchema);
```

Then add a unit test for it in `tests/unit/schema.spec.ts` (one case that is accepted and one that is rejected). The schema and its unit test go in the **same `feat:` commit** (the schema layer), not in the `test:` commit of the API spec.

### Step 4: Client, `src/api/WidgetsClient.ts`

```typescript
import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { type ResourceId } from '@src/models/common.model';
import { type CreateWidgetRequest } from '@src/models/widget.model';
import { authHeaders, TokenAuth } from '@src/utils/auth';

/**
 * Handles all widget resource requests to /api/widgets.
 *
 * SOLID: Single Responsibility Principle (SRP) — this class owns only widget endpoints.
 * SOLID: Dependency Inversion Principle (DIP) — `APIRequestContext` is injected by the caller.
 *
 * Must NOT: validate responses, read environment variables, perform assertions,
 *           or parse response bodies. Return the raw APIResponse.
 */
export class WidgetsClient {
  private readonly request: APIRequestContext;

  /**
   * @param request - The Playwright APIRequestContext injected by the caller.
   */
  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * Sends GET /api/widgets/{id} — retrieves a single widget (no auth required).
   *
   * @param id - The ID of the widget to retrieve.
   * @returns The raw APIResponse containing the widget (200) or `{}` (404).
   */
  async getById(id: ResourceId): Promise<APIResponse> {
    return this.request.get(`/api/widgets/${id}`);
  }

  /**
   * Sends POST /api/widgets — creates a widget (auth required).
   *
   * @param data - The `CreateWidgetRequest` payload.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse containing the created widget (201).
   */
  async create(data: CreateWidgetRequest, token: string): Promise<APIResponse> {
    return this.request.post('/api/widgets', {
      data,
      headers: authHeaders(new TokenAuth(token)),
    });
  }

  /**
   * Sends DELETE /api/widgets/{id} — removes a widget (auth required).
   *
   * @param id - The ID of the widget to delete.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse — 200 on success.
   */
  async delete(id: ResourceId, token: string): Promise<APIResponse> {
    return this.request.delete(`/api/widgets/${id}`, {
      headers: authHeaders(new TokenAuth(token)),
    });
  }
}
```

### Step 5: Register the client, `src/fixtures/api.fixture.ts`

```typescript
import { WidgetsClient } from '@src/api/WidgetsClient';

export interface ApiFixtures {
  // …existing clients…
  /** Client for /api/widgets. */
  widgetsClient: WidgetsClient;
}

const test = base.extend<ApiFixtures>({
  // …existing fixtures…
  widgetsClient: async ({ request }, use) => {
    await use(new WidgetsClient(request));
  },
});
```

Then add a factory to `src/data/factories.ts`:

```typescript
/**
 * Builds a valid POST /api/widgets payload.
 *
 * @param overrides - Fields to replace in the generated payload.
 * @returns A `CreateWidgetRequest` with a unique name.
 */
export function buildWidget(overrides: Partial<CreateWidgetRequest> = {}): CreateWidgetRequest {
  return {
    name: `[api-test] ${faker.commerce.productName()} ${uniqueSuffix()}`,
    ...overrides,
  };
}
```

### Step 6: Spec, `tests/api/widgets.spec.ts`

Write one test per documented status code: the happy path (`@smoke`), and each documented 4xx (`@negative`).

```typescript
/**
 * Tests for /api/widgets and /api/widgets/{id}.
 */
import { buildWidget, NON_EXISTENT_ID } from '@src/data/factories';
import { test, expect } from '@src/fixtures/auth.fixture';
import { ErrorMessageSchema, WidgetSchema } from '@src/utils/schema';

test.describe('Widgets API', () => {
  test(
    'POST /api/widgets returns 201 and the created widget',
    { tag: ['@smoke', '@tc-widgets-01'] },
    async ({ widgetsClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const payload = buildWidget();

      // --- ACT -------------------------------------------------------------
      const response = await widgetsClient.create(payload, authToken);
      const body: unknown = await response.json();
      const parsed = WidgetSchema.safeParse(body);

      try {
        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(201);

        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data).toMatchObject({ ...payload });
      } finally {
        // --- CLEANUP -------------------------------------------------------
        if (parsed.success) {
          await widgetsClient.delete(parsed.data.id, authToken);
        }
      }
    },
  );

  test(
    'POST /api/widgets returns 401 without an access token',
    { tag: ['@negative', '@tc-widgets-02'] },
    async ({ widgetsClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      const payload = buildWidget();

      // --- ACT -------------------------------------------------------------
      const response = await widgetsClient.create(payload, '');
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(401);

      const parsed = ErrorMessageSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);
    },
  );

  test(
    'GET /api/widgets/{id} returns 404 for a non-existent widget',
    { tag: ['@negative', '@tc-widgets-03'] },
    async ({ widgetsClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      const missingId = NON_EXISTENT_ID;

      // --- ACT -------------------------------------------------------------
      const response = await widgetsClient.getById(missingId);
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(404);
      expect(body).toEqual({});
    },
  );
});
```

### Step 7: Verify

```bash
npm run lint && npm run format:check && npm run typecheck
npm run test:unit
npm run test:api           # GAD must be running at BASE_URL
```

### Step 8: Confirm the gap closed

```bash
npm run test:api:coverage
node -e "const g=require('./reports/coverage/gaps.json').gaps;console.log(g.filter(x=>x.path==='/widgets'))"
```

The gaps you targeted (for example `operation:POST /widgets` or `status:POST /widgets:401`) must have disappeared from `reports/coverage/gaps.json`. If a gap is still there, the test did not really exercise it: check the status code that was actually received in `coverage.json` → `operations[].observedStatuses`.

Every documented status code should have a test, or a written reason why it doesn't (for example, "PUT 404 is unreachable: GAD upserts unknown ids"). A 400 "malformed JSON" is **not** such a reason: use a `…WithRawBody` client method (§5).

---

## 9. Known GAD behaviors that tests must respect

| Behavior | Consequence for tests |
|----------|-----------------------|
| PUT on an unknown id creates the record and answers 201 (upsert); a PUT 404 is unreachable | Never PUT to `NON_EXISTENT_ID`; for PUT 201 use an id above every existing one and delete it (§6) |
| PATCH does **not** upsert: an unknown id answers 404 | Use `NON_EXISTENT_ID` for PATCH 404 |
| DELETE `/api/articles/{id}` is a **soft delete**: the record stays in `db.json` with `"_inactive": true`, and GET then answers 404 | Assert the 404 after delete; a deleted id is never free for reuse |
| GET `/api/users*` masks `email`, `lastname` and `password` as `"****"` | Don't assert on those fields after a GET |
| DELETE/PUT/PATCH on `/api/users/{id}` need **that user's** token | Use `loginAs` |
| `feature_labels`, `feature_likes`, `feature_user_bookmark_articles` (and others in GAD's `config/config-features.js`) are off by default, so their resources return 404 | Only the resource's own spec turns its flag on in `beforeAll` (serial mode) and restores it in `afterAll` (§6) |
| `POST /api/likes` needs a `userid` header equal to the token owner's id (undocumented) | `LikesClient` sends it; JSDoc documents it |
| The seed user's id is not in the login response nor in the JWT (`{ email, data, iat, exp }`) | Read it from data the test creates (`article.user_id`). There is no `authUserId` fixture on purpose: getting the id would need an extra request (`GET /api/users?email=…`) that the recorder would count, changing coverage |
| Validation reads `db.json` from disk while writes land asynchronously | The suite runs with `workers: 1`. Don't enable parallelism |
| The current UTC time is rejected as a "future date" on hosts west of UTC | Use the factory dates (`recentIsoDate()`) |

---

## 10. Don'ts checklist

- [ ] No `request.get/post/put/patch/delete` and no `new XxxClient(` in `tests/`
- [ ] No own `APIRequestContext` (`playwright.request.newContext()`) or other HTTP library: invisible to coverage
- [ ] No `import … from '@playwright/test'` in `tests/api/`
- [ ] No `import … from 'zod'` outside `src/utils/schema.ts`
- [ ] No `../` or `./` imports
- [ ] No `any`, and no `as` casts on response bodies (narrow with a schema)
- [ ] No `process.env` outside `playwright.config.ts` and `src/fixtures/`
- [ ] No hardcoded `http://…` URLs, emails or passwords in tests
- [ ] No POST `/api/login` outside `auth.fixture.ts` / `auth.spec.ts`
- [ ] No `expect` inside `src/api/`, `src/models/`, `src/data/` or `src/utils/`
- [ ] No test that creates data without a `finally` cleanup
- [ ] No `restoreDB` calls, and no PUT to non-existent ids
- [ ] No assertion weakened to make a GAD bug pass; use `test.fail(true, reason)` with a comment
- [ ] No new dependencies without approval

---

## 11. Git workflow and commits

- Never commit to `main`. Use a branch: `session/NN-short-description` for session work, `fix/short-description` for fixes, `experiment/<name>` for experiments. `feature/<issue>-<slug>` and `ai/<run-id>` are reserved for the agents (§13, §14).
- Commit prefixes are lowercase: `feat:` (client, fixture, schema, factory), `test:` (specs), `fix:`, `chore:` (config, tooling, deps), `docs:`.
- Make small atomic commits, one per layer (models → schema → client → fixture → spec).
- Stage files explicitly (no blind `git add .`) and never commit `.env`.
- On the first push, run `git push -u origin <branch>`, then open a PR against `main`.

---

## 12. Coverage

The framework measures how much of `spec/openapi.json` the API tests exercise. There are two parts:

| Part | Where | What it does |
|------|-------|--------------|
| Recorder | `src/coverage/` + `src/fixtures/coverage.fixture.ts` | Records every request the tests make, as raw JSONL |
| CLI | `tools/coverage/` | Compares the records with the spec and writes `coverage.json`, `gaps.json` and `summary.md`, plus the console report |

### How the recorder works

- **Fixture chain:** `@playwright/test` → `coverage.fixture.ts` → `api.fixture.ts` → `auth.fixture.ts`. `coverage.fixture.ts` overrides Playwright's `request` fixture with a `Proxy` (`RequestRecorder`). Every client is built from that `request`, so every call is recorded with no change to clients or specs.
- Records are buffered per test and written in the fixture teardown, once the test outcome (`testStatus` / `expectedStatus`) is known. The file is `reports/coverage/raw/requests-<runId>-w<worker>.jsonl`, one per worker, so recording is parallel-safe.
- **Phase:** requests in a test body, `beforeEach` or `afterEach` get `phase: "test"`. Requests in `beforeAll`/`afterAll` get `phase: "hook"`. The heuristic: Playwright never instantiates auto fixtures for `beforeAll`/`afterAll`, so a `request` created outside the auto `coverageScope` window belongs to one of those hooks. Hook requests do not count by default (`--include-hooks` changes that).
- **Run isolation:** coverage always reflects **the last run that made API requests**. Each run gets a run id, and the first record of a new run deletes the raw files of older runs. `npm run test:smokeAPI` followed by `npm run coverage` therefore measures only the smoke tests. `npm run test:unit` records nothing and leaves the previous data intact.
- **Recorded:** method, path, query **names**, header **names** that the client sent explicitly, top-level body **keys**, status, duration, test file/title/id, phase and outcome.
- **Never recorded:** header values (tokens), query values, bodies, passwords. A unit test guards this.
- `COVERAGE_RECORD=0` disables recording. `COVERAGE_RAW_DIR` changes the raw directory.

### Commands

```bash
npm run test:api:coverage   # run the API tests, then the coverage report (keeps the test exit code)
npm run coverage            # console report from the last recorded run
npm run coverage:json       # also write reports/coverage/coverage.json and gaps.json
node tools/coverage/src/cli.ts gaps --tag likes --limit 5               # next batch of gaps, with spec context
node tools/coverage/src/cli.ts compare --base <dir> --head reports/coverage   # delta between two runs
```

Agents use the same functions through the `api-coverage` MCP server (`.mcp.json`): `coverage_summary`, `coverage_list_gaps`, `coverage_get_operation`, `coverage_run`, `coverage_compare`. In CI every PR gets a sticky comment with the delta against its base branch (see README → CI).

The definitions of a covered operation, status and parameter, and of a counted request, are in [`tools/coverage/README.md`](tools/coverage/README.md#coverage-definitions).

### Reading `gaps.json`

Each gap has a **stable `id`**, a `type` (`operation` | `status` | `parameter`), a `priority` and a deterministic `hint` built from the spec. Gaps are ordered with `high` first, then by path and method.

- `operation:GET /likes/article/{id}` (high): the endpoint is never called. What is left to cover is nested under `pending`. Write the happy path first, then one test per pending status.
- `status:POST /articles:400` (2xx is high, 4xx/5xx medium): the operation is tested, but this documented code is never received. Write a negative or alternative test.
- `parameter:GET /articles:query:_limit` (required is medium, optional low): send the parameter through the client (`params`).

A gap closes only when a counted request actually receives that code or sends that parameter. Read `coverage.json` → `operations[].observedStatuses` to see what was received.

### Adding an exclusion

Exclude an operation only when it must not be tested: destructive to the shared server, out of functional scope, or unreachable because of a spec defect. Add it to `tools/coverage/coverage.config.json` with a **mandatory `reason`**:

```json
{ "method": "GET", "path": "/debug/exit", "reason": "Terminates the GAD process." }
```

`path` is the spec template without `/api`. Excluded operations leave every denominator and are listed under `excluded`. For known test-infrastructure calls that are not in the spec (for example `/api/config/features`), add a glob to `ignoreUnmatched` instead. Commit config changes with `chore:` and say why in the PR.

---

## 13. AI-generated tests

The `test-generator` agent (`.claude/agents/test-generator.md`, launched with `/fill-coverage-gaps`) writes tests under these same conventions. See `docs/day3-ai-test-generation.md` for how it works and why.

- Every test it adds carries the tag **`@ai-generated`**, next to the usual `@smoke|@negative|@regression` and `@tc-<resource>-NN`. Run them with `npx playwright test --grep @ai-generated`.
- AI-written changes arrive only as PRs labeled `ai-generated`: from `ai/<run-id>` branches (local runs), or as `Agent: test-generator` commits on a `feature/*` PR (CI, `--mode ci-pr`, §14). Each run has a log in `docs/ai-generation/<run-id>.md`.
- `test.fail(...)` in an AI test must cite curl evidence in that log (spec drift). A gap the agent could not close is reported as **blocked**, never hidden.
- When a human edits an AI test, keep `@ai-generated` (it records the origin, not the authorship).

**Reviewer checklist for an AI PR:**

- [ ] The CI coverage comment shows the expected gaps closed, with no "no longer covered" regressions.
- [ ] `git diff --stat main...<branch>` touches only `src/api`, `src/models`, `src/utils/schema.ts`, `src/data`, `src/fixtures/api.fixture.ts`, `tests/api`, `tests/unit/schema.spec.ts`, `docs/ai-generation`.
- [ ] Each new test asserts the behavior the spec documents (status → schema → fields), not just whatever GAD returned.
- [ ] Negative tests really trigger the documented condition (e.g. a 422 caused by an invalid field, not by a missing token).
- [ ] Data is created with factories and cleaned up in `finally`, with no hardcoded ids or credentials.
- [ ] Every `test.fail` has evidence in the log, and every blocked gap has a credible reason.
- [ ] No existing test, assertion or exclusion was changed.
- [ ] Read the log's "Where CONVENTIONS.md was insufficient" notes and decide whether to update this file (humans only).

---

## 14. Agent lanes and `gad.ref.json` (Day 4)

**`gad.ref.json`** (repository root) is the single source of truth for which GAD the framework tests: `{ repository, ref, sha, specPath }`. On `main` it always pins a GAD `main` commit; on a feature PR it pins the GAD feature branch commit. CI checks out GAD at that sha on each side of a PR and fails on drift between `spec/openapi.json` and GAD's spec. Change both files **only** with the scripts:

```bash
npm run spec:sync -- --gad-dir ../gad-gui-api-demo   # spec/openapi.json ← GAD (byte-identical)
npm run spec:check -- --gad-dir ../gad-gui-api-demo  # exit 1 on drift
npm run gad:pin -- --sha <40-char sha> --ref main    # gad.ref.json
```

**Agent lanes.** Every commit an agent makes ends with a trailer `Agent: <name>`. The `lane-check` job (`pr-guards.yml`) fails a PR labeled `ai-generated` when a commit leaves its lane:

| `Agent:` | May change |
|---|---|
| `feature-developer` | `spec/openapi.json`, `gad.ref.json` (through the scripts). In GAD: a new endpoint helper, its dispatch in `routes/validations.route.js`, GAD's OpenAPI. |
| `test-generator` | `src/api/**`, `src/models/**`, `src/utils/schema.ts`, `src/data/**`, `src/fixtures/api.fixture.ts`, `tests/api/**`, `tests/unit/schema.spec.ts`, `docs/ai-generation/**` |
| `repin-gad` (workflow) | `spec/openapi.json`, `gad.ref.json` |
| none (human) | anything; listed in the summary |

Agent commits must not add coverage exclusions, change non-import lines of test files that existed before the PR, or add `.only` / `test.skip` / `test.fixme`. A PR labeled `ai-generated` also needs the label `human-reviewed` (added by a person after reading it; a new push removes it), and a PR into `main` must pin GAD `main`. The full flow, merge order and failure modes are in [`docs/day4-multi-agent-pipeline.md`](docs/day4-multi-agent-pipeline.md).
