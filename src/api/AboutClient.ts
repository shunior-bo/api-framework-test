import { type APIRequestContext, type APIResponse } from '@playwright/test';

/**
 * Handles the application information request to /api/about.
 *
 * SOLID: Single Responsibility Principle (SRP) — this class owns only the
 *        about endpoint. If the /api/about contract changes, this is the only
 *        class that changes.
 * SOLID: Dependency Inversion Principle (DIP) — `APIRequestContext` is injected
 *        by the caller (constructor injection). This class never creates its own
 *        HTTP client.
 *
 * Must NOT: validate responses, read environment variables, perform assertions,
 *           or parse response bodies. Return the raw APIResponse and let the
 *           caller decide what to do with it.
 */
export class AboutClient {
  private readonly request: APIRequestContext;

  /**
   * @param request - The Playwright APIRequestContext injected by the caller.
   */
  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * Sends GET /api/about — retrieves information about the application (no auth required).
   *
   * @returns The raw APIResponse containing the application information (200).
   */
  async get(): Promise<APIResponse> {
    return this.request.get('/api/about');
  }
}
