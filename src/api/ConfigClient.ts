import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { type FeatureFlags } from '@src/models/config.model';

/**
 * Handles GAD runtime-configuration requests to /api/config.
 *
 * SOLID: Single Responsibility Principle (SRP) — this class owns only the
 *        runtime-config endpoints. If the /api/config contract changes, this is
 *        the only class that changes.
 * SOLID: Dependency Inversion Principle (DIP) — `APIRequestContext` is injected
 *        by the caller (constructor injection). This class never creates its own
 *        HTTP client.
 *
 * Note: /api/config/* is NOT part of spec/openapi.json. It is test
 *       infrastructure, used only in beforeAll/afterAll hooks to switch on
 *       features that GAD ships disabled (e.g. `feature_labels`). Never assert
 *       on it as if it were a feature under test.
 *
 * Must NOT: validate responses, read environment variables, perform assertions,
 *           or parse response bodies. Return the raw APIResponse and let the
 *           caller decide what to do with it.
 */
export class ConfigClient {
  private readonly request: APIRequestContext;

  /**
   * @param request - The Playwright APIRequestContext injected by the caller.
   */
  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * Sends POST /api/config/features — sets one or more feature flags at runtime.
   *
   * @param flags - Map of feature-flag names to their desired state.
   * @returns The raw APIResponse — 200 on success, 422 when a flag name is unknown.
   */
  async setFeatures(flags: FeatureFlags): Promise<APIResponse> {
    return this.request.post('/api/config/features', {
      data: flags,
    });
  }
}
