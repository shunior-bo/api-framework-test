import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { type LoginRequest } from '@src/models/auth.model';

/**
 * Handles all authentication requests to /api/login.
 *
 * SOLID: Single Responsibility Principle (SRP) — this class owns only auth
 *        endpoints. If the /api/login contract changes, this is the only class
 *        that changes.
 * SOLID: Dependency Inversion Principle (DIP) — `APIRequestContext` is injected
 *        by the caller (constructor injection). This class never creates its own
 *        HTTP client.
 *
 * Note: only src/fixtures/auth.fixture.ts and tests/api/auth.spec.ts (which tests
 *       the login endpoint itself) may call `login`.
 *
 * Must NOT: validate responses, read environment variables, perform assertions,
 *           or parse response bodies. Return the raw APIResponse and let the
 *           caller decide what to do with it.
 */
export class AuthClient {
  private readonly request: APIRequestContext;

  /**
   * @param request - The Playwright APIRequestContext injected by the caller.
   */
  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * Sends POST /api/login with the provided credentials.
   *
   * @param credentials - The login payload containing `email` and `password`.
   * @returns The raw APIResponse — 200 with `{ access_token }` or 401.
   */
  async login(credentials: LoginRequest): Promise<APIResponse> {
    return this.request.post('/api/login', {
      data: credentials,
    });
  }
}
