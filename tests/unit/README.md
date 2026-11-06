# `tests/unit/` — Unit Tests (no network)

## What belongs here

Fast Playwright tests for pure logic in `src/utils/` and `src/data/`: auth strategies, Zod schemas, test-data factories. One spec per source file (`auth.spec.ts` ↔ `src/utils/auth.ts`). They run without GAD: `npm run test:unit`.

## SOLID principle

**Single Responsibility Principle (SRP)** — each spec verifies one utility module. A broken schema or factory fails here with a clear message instead of failing dozens of API tests for the wrong reason.

## What must NOT be here

- HTTP requests or API client usage
- Fixtures that need a running server (`request`, `authToken`, client fixtures)
- Imports from `zod` — import from `@src/utils/schema`

## Example file

`schema.spec.ts` — proves every schema accepts the documented GAD shape and rejects invalid ones.
