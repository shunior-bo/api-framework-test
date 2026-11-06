import { type APIRequestContext, type APIResponse } from '@playwright/test';

/**
 * Handles all label resource requests to /api/labels.
 *
 * SOLID: Single Responsibility Principle (SRP) — this class owns only label
 *        endpoints. If the /api/labels contract changes, this is the only class
 *        that changes.
 * SOLID: Dependency Inversion Principle (DIP) — `APIRequestContext` is injected
 *        by the caller (constructor injection). This class never creates its own
 *        HTTP client.
 *
 * Note: GAD answers 404 on every /api/labels request unless the
 *       `feature_labels` flag is enabled (see ConfigClient).
 *
 * Must NOT: validate responses, read environment variables, perform assertions,
 *           or parse response bodies. Return the raw APIResponse and let the
 *           caller decide what to do with it.
 */
export class LabelsClient {
  private readonly request: APIRequestContext;

  /**
   * @param request - The Playwright APIRequestContext injected by the caller.
   */
  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * Sends GET /api/labels — retrieves all labels (no auth required).
   *
   * @returns The raw APIResponse containing the array of labels (200) or `{}` (404).
   */
  async getAll(): Promise<APIResponse> {
    return this.request.get('/api/labels');
  }
}
