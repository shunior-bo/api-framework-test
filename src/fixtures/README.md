# `src/fixtures/` — Playwright Custom Fixtures

## What belongs here

Playwright fixture files that extend the base `test` object with reusable setup/teardown logic.

| File | Provides | Use it when |
|------|----------|-------------|
| `coverage.fixture.ts` | Overrides `request` with a recording proxy (`src/coverage/`) plus the auto `coverageScope` fixture | Never import it in specs; `api.fixture.ts` extends it |
| `api.fixture.ts` | One fixture per API client (`healthClient`, `articlesClient`, `commentsClient`, `usersClient`, `labelsClient`, `authClient`, `configClient`) | The spec only hits public endpoints |
| `auth.fixture.ts` | Everything in `api.fixture.ts` **plus** `seedCredentials`, `authToken`, `loginAs(credentials)` | The spec needs a token |

The chain is `@playwright/test` → `coverage.fixture.ts` → `api.fixture.ts` → `auth.fixture.ts`. A spec imports `test` and `expect` from exactly one of `api.fixture.ts` or `auth.fixture.ts`.

## SOLID principle

**Single Responsibility Principle (SRP)** — client construction lives only in `api.fixture.ts`; the login flow lives only in `auth.fixture.ts`. If POST /api/login changes (URL, token field `access_token`, …), only `auth.fixture.ts` changes.

**Open/Closed Principle (OCP)** — `auth.fixture.ts` extends the API fixture instead of modifying it. A new resource is added by adding one fixture entry; nothing else changes.

**Why a single construction point matters:** every request a test makes flows through a client built here from Playwright's `request` fixture, and `coverage.fixture.ts` makes that `request` a recording proxy. A request made any other way is left out of coverage.

## What must NOT be here

- Assertions about the feature under test (a precondition check such as "login returned 200" is fine)
- HTTP request logic (that belongs in `src/api/`)
- Environment variable reads other than the credentials in `auth.fixture.ts`

## Example file

`auth.fixture.ts` — extends the API fixture with `authToken: string`, authenticating against POST /api/login using `.env` credentials before each test that requests it.
