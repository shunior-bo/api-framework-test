# `tests/api/` — Playwright API Spec Files

## What belongs here

Playwright spec files that test the GAD REST API directly — no browser. One file per resource, named `<resource>.spec.ts` (`articles.spec.ts`, `comments.spec.ts`). Each file has one `test.describe('<Resource> API', …)` block.

Every test:

- Gets its client from a fixture (`async ({ articlesClient, authToken }) => …`).
- Is titled `'<METHOD> /api/<path> <expected behavior>'`.
- Carries `{ tag: ['@smoke' | '@negative' | '@regression', '@tc-<resource>-NN'] }`.
- Follows Arrange / Act / Assert, asserting status → schema → field values.
- Deletes whatever it created in a `finally` block.

## SOLID principle

**Single Responsibility Principle (SRP)** — one spec file per resource. `health.spec.ts` tests only `/api/health`; `articles.spec.ts` tests only `/api/articles*`.

## What must NOT be here

- `request.get(...)` / `request.post(...)` or `new XxxClient(request)` — use client fixtures
- Imports from `@playwright/test` — import `test`/`expect` from `@src/fixtures/…`
- Imports from `zod` — import schemas from `@src/utils/schema`
- Calls to POST /api/login (except `auth.spec.ts`, which tests login itself)
- Hardcoded base URLs, credentials, or `process.env` reads

## Example file

`health.spec.ts` — the canonical minimal example: one test, one client call, status → schema → field assertions.
