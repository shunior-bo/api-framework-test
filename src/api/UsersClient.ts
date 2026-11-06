import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { type CreateUserRequest } from '@src/models/user.model';
import { type ResourceId } from '@src/models/common.model';
import { authHeaders, TokenAuth } from '@src/utils/auth';

/**
 * Handles all user resource requests to /api/users.
 *
 * SOLID: Single Responsibility Principle (SRP) — this class owns only user
 *        endpoints. If the /api/users contract changes, this is the only class
 *        that changes.
 * SOLID: Dependency Inversion Principle (DIP) — `APIRequestContext` is injected
 *        by the caller (constructor injection). This class never creates its own
 *        HTTP client.
 *
 * Note: GET endpoints and POST (sign-up) are public. PUT, PATCH and DELETE
 *       require the Bearer token of the SAME user being modified — a token of a
 *       different user is rejected with 401.
 *
 * Must NOT: validate responses, read environment variables, perform assertions,
 *           or parse response bodies. Return the raw APIResponse and let the
 *           caller decide what to do with it.
 */
export class UsersClient {
  private readonly request: APIRequestContext;

  /**
   * @param request - The Playwright APIRequestContext injected by the caller.
   */
  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * Sends GET /api/users — retrieves all users (no auth required).
   *
   * @returns The raw APIResponse containing the array of users.
   */
  async getAll(): Promise<APIResponse> {
    return this.request.get('/api/users');
  }

  /**
   * Sends GET /api/users/{id} — retrieves a single user by ID (no auth required).
   *
   * @param id - The ID of the user to retrieve.
   * @returns The raw APIResponse containing the user object (200) or `{}` (404).
   */
  async getById(id: ResourceId): Promise<APIResponse> {
    return this.request.get(`/api/users/${id}`);
  }

  /**
   * Sends POST /api/users — registers a new user (no auth required).
   *
   * @param data - The `CreateUserRequest` payload. `email` must be unique.
   * @returns The raw APIResponse containing the created user (201), or 409 / 422.
   */
  async create(data: CreateUserRequest): Promise<APIResponse> {
    return this.request.post('/api/users', {
      data,
    });
  }

  /**
   * Sends PUT /api/users/{id} — replaces an existing user (auth required).
   *
   * Note: GAD answers 201 and creates the user when the ID does not exist (upsert).
   *
   * @param id - The ID of the user to replace.
   * @param data - The full `CreateUserRequest` payload.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse containing the replaced user object.
   */
  async update(id: ResourceId, data: CreateUserRequest, token: string): Promise<APIResponse> {
    return this.request.put(`/api/users/${id}`, {
      data,
      headers: authHeaders(new TokenAuth(token)),
    });
  }

  /**
   * Sends PATCH /api/users/{id} — partially updates an existing user (auth required).
   *
   * @param id - The ID of the user to update.
   * @param data - Partial `CreateUserRequest` containing only the fields to change.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse containing the updated user object.
   */
  async patch(
    id: ResourceId,
    data: Partial<CreateUserRequest>,
    token: string,
  ): Promise<APIResponse> {
    return this.request.patch(`/api/users/${id}`, {
      data,
      headers: authHeaders(new TokenAuth(token)),
    });
  }

  /**
   * Sends DELETE /api/users/{id} — removes a user (auth required).
   *
   * @param id - The ID of the user to delete.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse — 200 with `{}` on success.
   */
  async delete(id: ResourceId, token: string): Promise<APIResponse> {
    return this.request.delete(`/api/users/${id}`, {
      headers: authHeaders(new TokenAuth(token)),
    });
  }
}
