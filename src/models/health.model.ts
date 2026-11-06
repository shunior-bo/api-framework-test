/**
 * Response body from GET /api/health.
 *
 * The OpenAPI contract documents only the 200 status (no body schema), so this
 * interface reflects the observed GAD response.
 *
 * SOLID: Single Responsibility Principle (SRP) — this interface describes the
 *        data shape only. It has no methods and no behavior.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface HealthResponse {
  /** Overall status. "OK" when the service is healthy. */
  status: string;
  /** Process diagnostics (uptime, memory usage, timestamps). */
  health: Record<string, unknown>;
  /** Problems detected in the database. Empty when healthy. */
  dbProblems: unknown[];
  /** Problems detected in the configuration. Empty when healthy. */
  configProblems: unknown[];
  /** Problems detected in the backend. Empty when healthy. */
  backendProblems: unknown[];
}
