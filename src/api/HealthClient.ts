import { type APIRequestContext, type APIResponse } from '@playwright/test';

/**
 * Handles the health-check request to /api/health.
 *
 * SOLID: Single Responsibility Principle (SRP) — this class owns only the
 *        health endpoint. If the /api/health contract changes, this is the only
 *        class that changes.
 * SOLID: Dependency Inversion Principle (DIP) — `APIRequestContext` is injected
 *        by the caller (constructor injection). This class never creates its own
 *        HTTP client.
 *
 * Must NOT: validate responses, read environment variables, perform assertions,
 *           or parse response bodies. Return the raw APIResponse and let the
 *           caller decide what to do with it.
 */
export class HealthClient {
  private readonly request: APIRequestContext;

  /**
   * @param request - The Playwright APIRequestContext injected by the caller.
   */
  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * Sends GET /api/health — retrieves the service health status (no auth required).
   *
   * @returns The raw APIResponse containing the health report.
   */
  async get(): Promise<APIResponse> {
    return this.request.get('/api/health');
  }
}
