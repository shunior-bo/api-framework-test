/**
 * Request body for POST /api/config/features — a map of GAD feature-flag
 * names to their desired state, e.g. `{ feature_labels: true }`.
 *
 * Note: this runtime-config endpoint is NOT documented in spec/openapi.json.
 *       It is test infrastructure used only to enable features that are off
 *       by default (see ConfigClient).
 *
 * SOLID: Single Responsibility Principle (SRP) — data shape only.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export type FeatureFlags = Record<string, boolean>;
