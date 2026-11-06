# `src/utils/` — Cross-cutting Utilities

## What belongs here

| File | Responsibility |
|------|----------------|
| `schema.ts` | Every Zod schema (`ArticleSchema`, `ArticlesSchema`, `ErrorMessageSchema`, …) and the re-export of `z`. The **only** file that imports `zod`. |
| `auth.ts` | `AuthStrategy` interface, `TokenAuth` / `BasicAuth` strategies, and `authHeaders()` used by every client. |

Schema naming: `XxxSchema` for one entity, `XxxsSchema` (plural) for a list response. Each schema names the OpenAPI component it mirrors (`components.schemas.Article`).

## SOLID principle

**Single Responsibility Principle (SRP)** — `schema.ts` is the single home of validation rules; swapping Zod for another library touches one file.

**Open/Closed Principle (OCP)** — add a schema or a new auth strategy by adding an export/class; existing code never changes.

**Liskov Substitution + Interface Segregation (LSP + ISP)** — `AuthStrategy` has a single `apply()` method, and any strategy can replace another.

## What must NOT be here

- Network calls
- Assertions (`expect(...)`)
- Environment variable reads
- `import { z } from 'zod'` anywhere except `schema.ts` (ESLint enforces this)

## Example file

`schema.ts` — `ArticleSchema` validates `{ id, user_id, title, body, date, image? }`.
