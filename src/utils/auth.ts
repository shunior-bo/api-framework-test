/**
 * Authentication strategy utilities.
 *
 * Pattern: Strategy — the algorithm for adding auth headers is encapsulated
 *          behind the `AuthStrategy` interface. Callers never need to know
 *          which concrete strategy is in use.
 *
 * SOLID: Open/Closed Principle (OCP) — adding a new strategy (e.g., ApiKeyAuth)
 *        requires writing a new class, not modifying any existing code.
 *
 * Must NOT: make network calls, read environment variables, or perform assertions.
 */

/**
 * Defines the contract for all authentication strategies.
 *
 * SOLID: Interface Segregation Principle (ISP) — one method only (`apply`).
 *        No consumer is ever forced to implement or call anything extra.
 * SOLID: Open/Closed Principle (OCP) — closed for modification; add new
 *        strategies by creating new classes that implement this interface.
 * Pattern: Strategy — callers depend on this interface, not on concrete classes.
 */
export interface AuthStrategy {
  /**
   * Mutates the headers map to add the appropriate Authorization header.
   *
   * @param headers - A plain object of HTTP headers to modify in place.
   */
  apply(headers: Record<string, string>): void;
}

/**
 * Implements Bearer token (JWT) authentication — the scheme GAD uses
 * (`securitySchemes.bearerAuth` in the OpenAPI contract).
 *
 * SOLID: Liskov Substitution Principle (LSP) — fully substitutable for any
 *        `AuthStrategy`. Code that accepts `AuthStrategy` works identically
 *        when given a `TokenAuth` instance.
 *
 * Use this when the API expects: `Authorization: Bearer <token>`
 * Must NOT store more than the token string, and must NOT make network calls.
 */
export class TokenAuth implements AuthStrategy {
  /**
   * @param token - The `access_token` string obtained from POST /api/login.
   */
  constructor(private readonly token: string) {}

  /**
   * Sets the Authorization header to "Bearer <token>".
   *
   * @param headers - The headers map to modify. Modified in place.
   */
  apply(headers: Record<string, string>): void {
    headers['Authorization'] = `Bearer ${this.token}`;
  }
}

/**
 * Implements HTTP Basic authentication (RFC 7617).
 *
 * SOLID: Liskov Substitution Principle (LSP) — fully substitutable for any
 *        `AuthStrategy`. Code that accepts `AuthStrategy` works identically
 *        when given a `BasicAuth` instance.
 *
 * Use this when the API expects: `Authorization: Basic <base64(username:password)>`
 * Must NOT store more than the username and password, and must NOT make network calls.
 */
export class BasicAuth implements AuthStrategy {
  /**
   * @param username - The account username (typically an email address).
   * @param password - The account password.
   */
  constructor(
    private readonly username: string,
    private readonly password: string,
  ) {}

  /**
   * Sets the Authorization header to "Basic <base64(username:password)>".
   *
   * @param headers - The headers map to modify. Modified in place.
   */
  apply(headers: Record<string, string>): void {
    const encoded = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    headers['Authorization'] = `Basic ${encoded}`;
  }
}

/**
 * Builds a fresh headers object with the strategy applied.
 *
 * Used by every client in src/api/ so the Authorization header is produced in
 * exactly one way. An empty token still yields "Bearer " — rejecting it is the
 * server's job, which lets tests exercise the 401 path.
 *
 * @param strategy - Any `AuthStrategy` implementation.
 * @returns A new headers map containing the Authorization header.
 */
export function authHeaders(strategy: AuthStrategy): Record<string, string> {
  const headers: Record<string, string> = {};
  strategy.apply(headers);
  return headers;
}
