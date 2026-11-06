/**
 * Canonical example test — read this before writing your own.
 *
 * This file shows the minimal pattern for a Playwright API test in this framework:
 *   - `test` / `expect` come from a fixture file, never from `@playwright/test`
 *     (public endpoint → `@src/fixtures/api.fixture`; auth needed → `@src/fixtures/auth.fixture`).
 *   - The HTTP call goes through a client fixture (`healthClient`), never `request.get(...)`.
 *   - Title format: '<METHOD> /api/<path> <expected behavior>'.
 *   - Tags: one of @smoke / @negative / @regression plus a unique @tc-<resource>-NN id.
 *   - Arrange / Act / Assert sections, asserting status → schema → field values.
 */
import { test, expect } from '@src/fixtures/api.fixture';
import { HealthSchema } from '@src/utils/schema';

test.describe('Health API', () => {
  test(
    'GET /api/health returns 200 and a healthy status report',
    { tag: ['@smoke', '@tc-health-01'] },
    async ({ healthClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      // Nothing to set up for a public health check endpoint.

      // --- ACT -------------------------------------------------------------
      // The base URL comes from playwright.config.ts (process.env.BASE_URL).
      const response = await healthClient.get();
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      // 1. Status code
      expect(response.status()).toBe(200);

      // 2. Schema
      const parsed = HealthSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      // 3. Field values
      expect(parsed.data?.status).toBe('OK');
      expect(parsed.data?.dbProblems).toEqual([]);
      expect(parsed.data?.configProblems).toEqual([]);
      expect(parsed.data?.backendProblems).toEqual([]);
    },
  );
});
