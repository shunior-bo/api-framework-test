/**
 * Label resource returned by GET /api/labels (`components.schemas.Label`).
 *
 * Note: GET /api/labels answers 404 unless the GAD feature flag
 *       `feature_labels` is enabled.
 *
 * SOLID: Single Responsibility Principle (SRP) — this interface describes the
 *        data shape only. It has no methods and no behavior.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface Label {
  /** Unique numeric identifier assigned by the API. */
  id: number;
  /** Label display name. */
  name: string;
  /** Id of the user who owns the label. */
  user_id: number;
}
