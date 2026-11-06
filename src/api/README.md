# `src/api/` — API Client Classes

## What belongs here

One class per GAD API resource (`ArticlesClient`, `CommentsClient`, `UsersClient`, …). Each class encapsulates all HTTP request logic for its resource and returns raw `APIResponse` objects. Method names follow a fixed vocabulary:

| Method | HTTP | Path |
|--------|------|------|
| `getAll()` | GET | `/api/<resource>` |
| `getById(id)` | GET | `/api/<resource>/{id}` |
| `create(data, token)` | POST | `/api/<resource>` |
| `update(id, data, token)` | PUT | `/api/<resource>/{id}` |
| `patch(id, data, token)` | PATCH | `/api/<resource>/{id}` |
| `delete(id, token)` | DELETE | `/api/<resource>/{id}` |
| `search(filters)` | GET | `/api/<resource>?…` |

Endpoints that need auth take `token: string` as the **last** parameter and build the header with `authHeaders(new TokenAuth(token))` from `@src/utils/auth`.

## SOLID principle

**Single Responsibility Principle (SRP)** — each client has one reason to change: if its resource's contract in `spec/openapi.json` changes, only that client changes.

**Dependency Inversion Principle (DIP)** — every client receives `APIRequestContext` through its constructor. The class never creates its own HTTP connection. Clients are instantiated **only** in `src/fixtures/api.fixture.ts` — this is the single point the Day 2 coverage tool intercepts.

## What must NOT be here

- Assertions (`expect(...)`)
- Schema validation (`Schema.safeParse(...)`)
- Environment variable reads (`process.env.*`)
- Business logic or conditional branching based on response content
- Response body parsing (return the raw `APIResponse`, let the caller parse it)
- Full URLs — paths only (`'/api/articles'`); the base URL comes from `playwright.config.ts`

## Example file

`ArticlesClient.ts` — `getAll`, `getById`, `create`, `update`, `patch`, `delete` for `/api/articles`.
