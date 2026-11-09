/**
 * Response body from GET /api/about.
 *
 * The OpenAPI contract documents only the 200 status (no body schema), so this
 * interface reflects the observed GAD response.
 *
 * SOLID: Single Responsibility Principle (SRP) — this interface describes the
 *        data shape only. It has no methods and no behavior.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface AboutResponse {
  /** Application name ("GAD"). */
  name: string;
  /** Application version, e.g. "v2.9.1". */
  version: string;
  /** Short description of the application. */
  description: string;
  /** URL of the source repository. */
  repository: string;
  /** Keywords describing the application. */
  keywords: string[];
  /** Author of the application. */
  author: string;
}
