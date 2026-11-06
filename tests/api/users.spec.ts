/**
 * Tests for /api/users and /api/users/{id}.
 *
 * Cleanup note: GAD only lets a user delete THEIR OWN account, so cleanup logs
 * in as the created user with the `loginAs` fixture and deletes with that token.
 */
import { buildUser } from '@src/data/factories';
import { type UsersClient } from '@src/api/UsersClient';
import { type AuthFixtures, test, expect } from '@src/fixtures/auth.fixture';
import { type ResourceId } from '@src/models/common.model';
import { type CreateUserRequest } from '@src/models/user.model';
import { ErrorMessageSchema, UserSchema, UsersSchema } from '@src/utils/schema';

/** Placeholder GAD returns instead of private fields on public GET endpoints. */
const MASK = '****';

/**
 * Deletes a user created by a test, authenticating as that user.
 *
 * @param usersClient - The users client fixture.
 * @param loginAs - The `loginAs` fixture.
 * @param user - The payload the user was created with (email + password).
 * @param id - The ID GAD assigned to the user.
 */
async function deleteCreatedUser(
  usersClient: UsersClient,
  loginAs: AuthFixtures['loginAs'],
  user: CreateUserRequest,
  id: ResourceId,
): Promise<void> {
  const ownToken = await loginAs({ email: user.email, password: user.password });
  await usersClient.delete(id, ownToken);
}

test.describe('Users API', () => {
  test(
    'GET /api/users returns 200 and a list of users with private fields masked',
    { tag: ['@smoke', '@tc-users-01'] },
    async ({ usersClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      // Seed data contains users; nothing to create.

      // --- ACT -------------------------------------------------------------
      const response = await usersClient.getAll();
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(200);

      const parsed = UsersSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      expect(parsed.data?.length).toBeGreaterThan(0);
      for (const user of parsed.data ?? []) {
        expect(user.email).toBe(MASK);
        expect(user.lastname).toBe(MASK);
      }
    },
  );

  test(
    'POST /api/users returns 201 and the created user',
    { tag: ['@smoke', '@tc-users-02'] },
    async ({ usersClient, loginAs }) => {
      // --- ARRANGE ---------------------------------------------------------
      const payload = buildUser();

      // --- ACT -------------------------------------------------------------
      const response = await usersClient.create(payload);
      const body: unknown = await response.json();
      const parsed = UserSchema.safeParse(body);

      try {
        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(201);

        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data).toMatchObject({
          email: payload.email,
          firstname: payload.firstname,
          lastname: payload.lastname,
          avatar: payload.avatar,
        });
      } finally {
        // --- CLEANUP -------------------------------------------------------
        if (parsed.success) {
          await deleteCreatedUser(usersClient, loginAs, payload, parsed.data.id);
        }
      }
    },
  );

  test(
    'POST /api/users returns 409 for a duplicate email',
    { tag: ['@negative', '@tc-users-03'] },
    async ({ usersClient, loginAs }) => {
      // --- ARRANGE ---------------------------------------------------------
      const existing = buildUser();
      const createResponse = await usersClient.create(existing);
      expect(createResponse.status()).toBe(201);
      const created = UserSchema.parse(await createResponse.json());
      const duplicate = buildUser({ email: existing.email });

      try {
        // --- ACT -----------------------------------------------------------
        const response = await usersClient.create(duplicate);
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(409);

        const parsed = ErrorMessageSchema.safeParse(body);
        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data?.error.message).toBe('Email not unique');
      } finally {
        // --- CLEANUP -------------------------------------------------------
        await deleteCreatedUser(usersClient, loginAs, existing, created.id);
      }
    },
  );

  test(
    'POST /api/users returns 422 for an invalid email',
    { tag: ['@negative', '@tc-users-04'] },
    async ({ usersClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      const payload = buildUser({ email: 'not-an-email' });

      // --- ACT -------------------------------------------------------------
      const response = await usersClient.create(payload);
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(422);

      const parsed = ErrorMessageSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      expect(parsed.data?.error.message).toBe('Invalid email');
    },
  );

  test(
    'POST /api/users returns 422 when a mandatory field is empty',
    { tag: ['@negative', '@tc-users-05'] },
    async ({ usersClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      const payload = buildUser({ firstname: '' });

      // --- ACT -------------------------------------------------------------
      const response = await usersClient.create(payload);
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(422);

      const parsed = ErrorMessageSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      expect(parsed.data?.error.message).toBe('One of mandatory field is missing');
    },
  );
});
