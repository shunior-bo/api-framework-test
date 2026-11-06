/**
 * Tests for POST /api/login.
 *
 * This is the ONLY spec allowed to call `authClient.login` directly, because
 * the login endpoint itself is the feature under test. Every other spec gets
 * its token from the `authToken` / `loginAs` fixtures.
 */
import { test, expect } from '@src/fixtures/auth.fixture';
import { LoginResponseSchema } from '@src/utils/schema';

test.describe('Auth API', () => {
  test(
    'POST /api/login returns 200 and an access_token for valid credentials',
    { tag: ['@smoke', '@tc-auth-01'] },
    async ({ authClient, seedCredentials }) => {
      // --- ARRANGE ---------------------------------------------------------
      // Seed-user credentials come from .env through the seedCredentials fixture.

      // --- ACT -------------------------------------------------------------
      const response = await authClient.login(seedCredentials);
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(200);

      const parsed = LoginResponseSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      // A JWT has three base64url segments separated by dots.
      expect(parsed.data?.access_token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    },
  );

  test(
    'POST /api/login returns 401 for a wrong password',
    { tag: ['@negative', '@tc-auth-02'] },
    async ({ authClient, seedCredentials }) => {
      // --- ARRANGE ---------------------------------------------------------
      const wrongPassword = { ...seedCredentials, password: `${seedCredentials.password}-wrong` };

      // --- ACT -------------------------------------------------------------
      const response = await authClient.login(wrongPassword);
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(401);
      expect(body).not.toHaveProperty('access_token');
    },
  );

  test(
    'POST /api/login returns 401 for an unknown email',
    { tag: ['@negative', '@tc-auth-03'] },
    async ({ authClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      const unknownUser = { email: 'nobody.registered@example.test', password: 'irrelevant' };

      // --- ACT -------------------------------------------------------------
      const response = await authClient.login(unknownUser);
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(401);
      expect(body).not.toHaveProperty('access_token');
    },
  );
});
