/**
 * Shared types used by more than one GAD resource.
 *
 * SOLID: Single Responsibility Principle (SRP) — this file describes data
 *        shapes that are common across resources. It has no methods and no behavior.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */

/**
 * Identifier type used by GAD resources.
 *
 * The OpenAPI contract declares most `id` fields as `oneOf: [integer, string]`,
 * so every client accepts both.
 */
export type ResourceId = number | string;

/**
 * Error envelope returned by GAD on 401 / 404 / 409 / 422 responses
 * (`components.schemas.ErrorMessage` in the OpenAPI spec).
 *
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface ErrorMessage {
  error: {
    /** Human-readable error description, e.g. "Access token not provided!". */
    message: string;
    /** Optional extra context, e.g. the list of mandatory fields. */
    details?: unknown;
  };
}
