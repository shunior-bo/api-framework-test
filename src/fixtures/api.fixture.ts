/**
 * Base API fixture — the single place where API clients are constructed.
 *
 * SOLID: Single Responsibility Principle (SRP) — this file only wires clients
 *        to Playwright's `request` fixture. No auth, no assertions.
 * SOLID: Dependency Inversion Principle (DIP) — every client receives the same
 *        injected `APIRequestContext`. Tests depend on the client fixtures, never
 *        on `new XxxClient(request)`.
 * SOLID: Open/Closed Principle (OCP) — add a new resource by adding one entry to
 *        `ApiFixtures` and one fixture function below. Existing fixtures never change.
 *
 * Why this matters (coverage): this file extends coverage.fixture.ts, whose
 * `request` fixture is a recording proxy. Every client built here therefore
 * records method + path + status for every call, and tools/coverage diffs that
 * against spec/openapi.json. A test that builds its own APIRequestContext
 * (e.g. `playwright.request.newContext()`) is invisible to coverage.
 *
 * Must NOT: perform assertions, log in, or read environment variables.
 */
import { ArticlesClient } from '@src/api/ArticlesClient';
import { AuthClient } from '@src/api/AuthClient';
import { CommentsClient } from '@src/api/CommentsClient';
import { ConfigClient } from '@src/api/ConfigClient';
import { HealthClient } from '@src/api/HealthClient';
import { LabelsClient } from '@src/api/LabelsClient';
import { UsersClient } from '@src/api/UsersClient';
import { test as base, expect } from '@src/fixtures/coverage.fixture';

/**
 * Client fixtures available to every API spec.
 */
export interface ApiFixtures {
  /** Client for /api/health. */
  healthClient: HealthClient;
  /** Client for /api/login. Only auth.fixture.ts and auth.spec.ts may use it. */
  authClient: AuthClient;
  /** Client for /api/articles. */
  articlesClient: ArticlesClient;
  /** Client for /api/comments. */
  commentsClient: CommentsClient;
  /** Client for /api/users. */
  usersClient: UsersClient;
  /** Client for /api/labels. */
  labelsClient: LabelsClient;
  /** Client for /api/config (undocumented test infrastructure — hooks only). */
  configClient: ConfigClient;
}

/**
 * Playwright `test` extended with one fixture per API client.
 *
 * Public-endpoint specs import `test` and `expect` from here.
 * Specs that need a token import them from `@src/fixtures/auth.fixture` instead.
 */
const test = base.extend<ApiFixtures>({
  healthClient: async ({ request }, use) => {
    await use(new HealthClient(request));
  },
  authClient: async ({ request }, use) => {
    await use(new AuthClient(request));
  },
  articlesClient: async ({ request }, use) => {
    await use(new ArticlesClient(request));
  },
  commentsClient: async ({ request }, use) => {
    await use(new CommentsClient(request));
  },
  usersClient: async ({ request }, use) => {
    await use(new UsersClient(request));
  },
  labelsClient: async ({ request }, use) => {
    await use(new LabelsClient(request));
  },
  configClient: async ({ request }, use) => {
    await use(new ConfigClient(request));
  },
});

export { test, expect };
