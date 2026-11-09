/**
 * Tests for /api/about (public, tag `healthcheck`).
 */
import { test, expect } from '@src/fixtures/api.fixture';
import { AboutSchema } from '@src/utils/schema';

test.describe('About API', () => {
  test(
    'GET /api/about returns 200 and information about the application',
    { tag: ['@smoke', '@tc-about-01', '@ai-generated'] },
    async ({ aboutClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      // Nothing to set up for a public information endpoint.

      // --- ACT -------------------------------------------------------------
      const response = await aboutClient.get();
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(200);

      const parsed = AboutSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      expect(parsed.data?.name).toBe('GAD');
      expect(parsed.data?.version).toMatch(/^v\d+\.\d+\.\d+/);
    },
  );
});
