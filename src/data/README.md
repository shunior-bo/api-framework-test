# `src/data/` — Test-Data Factories

## What belongs here

`factories.ts` — one `buildXxx(overrides?)` function per request payload (`buildArticle`, `buildComment`, `buildUser`) plus small helpers (`uniqueSuffix`, `recentIsoDate`, `NON_EXISTENT_ID`). Every builder returns a **valid and unique** payload; tests override only the fields that matter to them:

```typescript
const payload = buildArticle({ title: '' }); // invalid on purpose → expect 422
```

GAD-specific rules baked into the factories:

- `date` is 24 h in the past — GAD rejects the current UTC instant as "in future" on hosts west of UTC.
- Articles always carry `image` — GAD's DB sanity check flags articles without it and `/api/health` turns "Degraded".
- Emails use `uniqueSuffix()` — POST /api/users answers 409 on duplicates.

## SOLID principle

**Single Responsibility Principle (SRP)** — this folder only generates data. It never sends requests or asserts.

**Open/Closed Principle (OCP)** — a new resource gets a new `buildXxx()`; existing builders do not change.

## What must NOT be here

- Network calls or client usage
- Assertions
- Environment variable reads
- Hardcoded data that must be unique (emails, titles) — always add `uniqueSuffix()`

## Example file

`factories.ts` — `buildArticle()` returns a `CreateArticleRequest` with a unique title.
