/**
 * Authentication fixture for Playwright tests.
 *
 * SOLID: Single Responsibility Principle (SRP) — this is the ONLY place in the
 *        framework that handles the login flow. If POST /api/login changes
 *        (different URL, different response shape, different token field), this
 *        is the only file that needs updating.
 * SOLID: Open/Closed Principle (OCP) — extends the base API fixture instead of
 *        modifying it, so every client fixture is still available.
 *
 * Rule: Never call POST /api/login inside a test body.
 *       Use `authToken` (seed user from .env) or `loginAs(credentials)` (any
 *       other user, e.g. one the test just created) instead.
 *       The only exception is tests/api/auth.spec.ts, which tests login itself.
 *
 * How it works:
 *   1. Playwright calls `authToken` before each test that destructures it.
 *   2. It POSTs to /api/login with API_USERNAME / API_PASSWORD from `.env`.
 *   3. It validates the response and extracts `access_token` (GAD's field name).
 *   4. The test runs with `authToken` available as a string.
 *
 * Must NOT: contain assertions about the feature under test, or read env vars
 *           other than the credentials.
 */
import { type LoginRequest, type LoginResponse } from '@src/models/auth.model';
import { test as base, expect } from '@src/fixtures/api.fixture';

/**
 * Auth fixtures added on top of the API client fixtures.
 */
export interface AuthFixtures {
  /** Seed-user credentials from `.env` (API_USERNAME / API_PASSWORD). */
  seedCredentials: LoginRequest;
  /** A valid `access_token` for the seed user configured in `.env`. */
  authToken: string;
  /** Logs in with arbitrary credentials and resolves to that user's `access_token`. */
  loginAs: (credentials: LoginRequest) => Promise<string>;
}

/**
 * Reads a required environment variable or fails with an actionable message.
 *
 * @param name - The environment variable name.
 * @returns The variable's value.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/**
 * Extended Playwright `test` instance with every client fixture plus
 * `seedCredentials`, `authToken` and `loginAs`.
 *
 * Import this `test` (and `expect`) in every API spec file that needs auth.
 */
const test = base.extend<AuthFixtures>({
  seedCredentials: async ({}, use) => {
    // Never hardcode credentials — always read them from environment variables.
    await use({
      email: requiredEnv('API_USERNAME'),
      password: requiredEnv('API_PASSWORD'),
    });
  },

  loginAs: async ({ authClient }, use) => {
    await use(async (credentials: LoginRequest): Promise<string> => {
      const response = await authClient.login(credentials);

      // A clear error here is easier to debug than a cryptic 401 mid-test.
      expect(response.status(), `login failed for ${credentials.email}`).toBe(200);

      const body = (await response.json()) as LoginResponse;
      return body.access_token;
    });
  },

  authToken: async ({ loginAs, seedCredentials }, use) => {
    const token = await loginAs(seedCredentials);

    // Provide the token to the test. Everything after use() runs as teardown.
    await use(token);
  },
});

export { test, expect };
