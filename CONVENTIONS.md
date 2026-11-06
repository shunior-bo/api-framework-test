# Conventions

This file is the contract for writing code in this framework. It is written so that a person **or an AI assistant** can add a correct test without reading the rest of the code. If something here conflicts with existing code, this file wins. Fix the code.

Stack: TypeScript (strict) + Playwright Test in API mode (no browser) + Zod + @faker-js/faker. App under test: **GAD**, with its REST API under `/api`.

---

## 1. Hard rules (read these first)

1. **All HTTP goes through a client in `src/api/`, and clients come from fixtures.** Tests never call `request.get/post/...` and never write `new XxxClient(request)`.
   *Why:* the Day 2 coverage tool records every request at this single point (the `request` fixture → client fixtures in `src/fixtures/api.fixture.ts`). A request made any other way is invisible to coverage.
2. **`spec/openapi.json` is the source of truth** for paths, methods, status codes and body shapes. It is a vendored copy of `gad-gui-api-demo/public/tools/schema/openapi_rest_demo.json`. `OPENAPI_PATH` in `.env` points to it.
3. **Only `src/fixtures/auth.fixture.ts` logs in.** Tests get tokens from `authToken` or `loginAs(...)`. The single exception is `tests/api/auth.spec.ts`, because login is its feature under test.
4. **Only `src/utils/schema.ts` imports `zod`.** ESLint enforces this rule.
5. **Always use the `@src/` alias. Never use relative imports** (`./` or `../`). ESLint enforces this rule.
6. **No hardcoded URLs or credentials.** The base URL comes from `BASE_URL`, and credentials come from `API_USERNAME` / `API_PASSWORD` through fixtures. Only fixtures read `process.env`.
7. **No `any`.** Response bodies are typed `unknown` and narrowed with a schema. ESLint enforces this rule.
8. **Every test cleans up what it creates** in a `finally` block, using the client's `delete`.
9. **Never bend an assertion to match a GAD bug.** Keep the assertion the contract demands and mark the test with `test.fail(true, '<reason>')` plus a comment that explains the spec-vs-actual discrepancy.

---

## 2. Folder structure and layer responsibilities

```
api-framework-test/
├── spec/openapi.json          # Contract (source of truth)
├── src/
│   ├── api/                   # XxxClient.ts — one class per resource
│   ├── models/                # xxx.model.ts — pure interfaces
│   ├── data/                  # factories.ts — buildXxx() payload builders
│   ├── fixtures/              # api.fixture.ts (clients), auth.fixture.ts (tokens)
│   └── utils/                 # schema.ts (Zod), auth.ts (auth strategies)
├── tests/
│   ├── api/                   # xxx.spec.ts — one spec per resource (needs GAD)
│   └── unit/                  # xxx.spec.ts — pure logic, no network
├── docs/                      # Experiments and reports
├── playwright.config.ts       # projects: api, unit
└── CONVENTIONS.md             # This file
```

| Layer | Responsible for | SOLID | Must NOT |
|-------|-----------------|-------|----------|
| `src/api/` | Sending one HTTP request per method and returning the raw `APIResponse` | SRP + DIP | `expect`, `process.env`, body parsing, branching on responses, full URLs |
| `src/models/` | Request/response shapes as `interface`s with JSDoc on each field | SRP | classes, methods, zod, playwright imports |
| `src/utils/schema.ts` | Every Zod schema, plus the re-export of `z` | SRP + OCP | network, assertions |
| `src/utils/auth.ts` | `AuthStrategy`, `TokenAuth`, `BasicAuth`, `authHeaders()` | OCP + LSP + ISP | network, env reads |
| `src/data/` | `buildXxx(overrides)` factories that return valid, unique payloads | SRP + OCP | network, assertions, env reads |
| `src/fixtures/` | Building clients (`api.fixture.ts`) and the login flow (`auth.fixture.ts`) | SRP + OCP + DIP | feature assertions, HTTP logic |
| `tests/api/` | One spec per resource, with happy path and negative cases | SRP | raw `request`, `zod`, `@playwright/test` imports, login calls |
| `tests/unit/` | Tests for `src/utils` and `src/data` with no network | SRP | HTTP, server fixtures |

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

- Error responses (401/409/422) are validated with `ErrorMessageSchema` (`{ error: { message } }`), then the message is checked.
- GAD's 404 body is `{}`, so assert `expect(body).toEqual({})`.
- To use an interface with `toMatchObject`, spread it: `toMatchObject({ ...payload })`.
- In **Arrange**, when you create prerequisite data, check its status first and then parse it strictly: `expect(r.status()).toBe(201); const created = ArticleSchema.parse(await r.json());`

---

## 6. Test data and cleanup

- Build every payload with `buildXxx()` from `@src/data/factories`. Override only what the test is about: `buildUser({ email: 'not-an-email' })`.
- Factories add `uniqueSuffix()` so that tests don't collide (for example, the 409 on duplicate email).
- For invalid payloads, override a field with an empty or invalid value. Don't delete keys or cast types.
- To get a 404 on GET, use `NON_EXISTENT_ID`. Never PUT to it: GAD upserts and would create the record.
- **Cleanup:** wrap Act and Assert in `try { … } finally { await client.delete(id, token); }`. If the resource is created in Act, delete it only if the parse succeeded: `if (parsed.success) await client.delete(parsed.data.id, authToken);`
- Delete children before parents (a comment before its article).
- **Users can only delete themselves.** Clean up with `loginAs({ email, password })` and then `usersClient.delete(id, ownToken)`.
- Never call `/api/restoreDB*` from a test. It resets data for every test that is running.
- Only `labels.spec.ts` changes GAD's global feature flags (`configClient.setFeatures`), and it restores them in `afterAll`. That endpoint is not in the contract.

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

Then add a unit test for it in `tests/unit/schema.spec.ts` (one case that is accepted and one that is rejected).

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

Every documented status code should have a test, or a written reason why it doesn't (for example, "400 needs malformed JSON, which the typed client can't send").

---

## 9. Known GAD behaviors that tests must respect

| Behavior | Consequence for tests |
|----------|-----------------------|
| PUT on an unknown id creates the record and answers 201 (upsert) | Never PUT to `NON_EXISTENT_ID` |
| GET `/api/users*` masks `email`, `lastname` and `password` as `"****"` | Don't assert on those fields after a GET |
| DELETE/PUT/PATCH on `/api/users/{id}` need **that user's** token | Use `loginAs` |
| `feature_labels` is off by default, so `/api/labels` returns 404 | Turn it on in `beforeAll` through `configClient` and restore it in `afterAll` |
| Validation reads `db.json` from disk while writes land asynchronously | The suite runs with `workers: 1`. Don't enable parallelism |
| The current UTC time is rejected as a "future date" on hosts west of UTC | Use the factory dates (`recentIsoDate()`) |

---

## 10. Don'ts checklist

- [ ] No `request.get/post/put/patch/delete` and no `new XxxClient(` in `tests/`
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

- Never commit to `main`. Use a branch: `session/NN-short-description` for session work, `fix/short-description` for fixes, `experiment/<name>` for experiments.
- Commit prefixes are lowercase: `feat:` (client, fixture, schema, factory), `test:` (specs), `fix:`, `chore:` (config, tooling, deps), `docs:`.
- Make small atomic commits, one per layer (models → schema → client → fixture → spec).
- Stage files explicitly (no blind `git add .`) and never commit `.env`.
- On the first push, run `git push -u origin <branch>`, then open a PR against `main`.
