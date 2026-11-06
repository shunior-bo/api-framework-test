/**
 * Request body for POST /api/login (`components.schemas.UserLoginData`).
 *
 * SOLID: Dependency Inversion Principle (DIP) — clients and fixtures depend on
 *        this interface, not on raw JSON objects.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface LoginRequest {
  /** The user's email address. */
  email: string;
  /** The user's password. */
  password: string;
}

/**
 * Response body from POST /api/login with HTTP 200 (`components.schemas.UserLoginToken`).
 *
 * Use LoginResponseSchema (src/utils/schema.ts) to validate the shape at runtime.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface LoginResponse {
  /** The JWT to send as `Authorization: Bearer <access_token>` in subsequent requests. */
  access_token: string;
}
