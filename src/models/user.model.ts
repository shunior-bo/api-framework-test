import { type ResourceId } from '@src/models/common.model';

/**
 * User resource returned by GET /api/users or GET /api/users/{id}
 * (`components.schemas.User`).
 *
 * Note: on public GET endpoints GAD masks `email`, `lastname` and `password`
 *       with the literal string "****".
 *
 * SOLID: Single Responsibility Principle (SRP) — this interface describes the
 *        data shape only. It has no methods and no behavior.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface User {
  /** Unique identifier assigned by the API. */
  id: ResourceId;
  /** Email address (used as the login username). Masked as "****" on GET. */
  email: string;
  /** First name. */
  firstname: string;
  /** Last name. Masked as "****" on GET. */
  lastname: string;
  /** Password. Masked as "****" on GET; returned in clear text on POST. */
  password?: string;
  /** Relative avatar image path. */
  avatar: string;
}

/**
 * Request body for POST /api/users (`components.schemas.UserUpdate`).
 *
 * SOLID: Dependency Inversion Principle (DIP) — UsersClient depends on this
 *        interface instead of a raw JSON object.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface CreateUserRequest {
  /** Email address — must be unique, otherwise the API answers 409. */
  email: string;
  /** First name. */
  firstname: string;
  /** Last name. */
  lastname: string;
  /** Plain-text password used later for POST /api/login. */
  password: string;
  /** Relative avatar image path. */
  avatar: string;
}
