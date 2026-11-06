# `src/models/` — TypeScript Interface Definitions

## What belongs here

TypeScript `interface` / `type` declarations that describe the shape of GAD request and response bodies. One file per resource (`article.model.ts`, `user.model.ts`, …) plus `common.model.ts` for shared types such as `ResourceId` (`number | string`, mirroring the OpenAPI `oneOf: [integer, string]`).

Naming: the entity is `Xxx` (`Article`), the request body is `CreateXxxRequest` (`CreateArticleRequest`), filters are `XxxSearchFilters`. Every field has a JSDoc comment.

## SOLID principle

**Single Responsibility Principle (SRP)** — models describe *what data looks like*. They have no methods, no behavior, and no validation. Clients describe *how to request data*. Schemas describe *how to validate data*. These three concerns never mix.

**Dependency Inversion Principle (DIP)** — clients and factories depend on these typed interfaces rather than raw objects, making the code self-documenting and refactoring-safe.

## What must NOT be here

- Class definitions (use `interface`, not `class`)
- Methods or computed properties
- Zod schemas or any validation logic
- Imports from `zod` or `@playwright/test`

## Example file

`article.model.ts` — exports the `Article` and `CreateArticleRequest` interfaces.
