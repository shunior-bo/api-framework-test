import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { type CreateCommentRequest } from '@src/models/comment.model';
import { type ResourceId } from '@src/models/common.model';
import { authHeaders, TokenAuth } from '@src/utils/auth';

/**
 * Handles all comment resource requests to /api/comments.
 *
 * SOLID: Single Responsibility Principle (SRP) — this class owns only comment
 *        endpoints. If the /api/comments contract changes, this is the only class
 *        that changes.
 * SOLID: Dependency Inversion Principle (DIP) — `APIRequestContext` is injected
 *        by the caller (constructor injection). This class never creates its own
 *        HTTP client.
 *
 * Note: GET endpoints are public. Write endpoints require a JWT Bearer token,
 *       passed as a parameter — this class never reads environment variables.
 *       Only the comment author may modify or delete it.
 *
 * Must NOT: validate responses, read environment variables, perform assertions,
 *           or parse response bodies. Return the raw APIResponse and let the
 *           caller decide what to do with it.
 */
export class CommentsClient {
  private readonly request: APIRequestContext;

  /**
   * @param request - The Playwright APIRequestContext injected by the caller.
   */
  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * Sends GET /api/comments — retrieves all comments (no auth required).
   *
   * @returns The raw APIResponse containing the array of comments.
   */
  async getAll(): Promise<APIResponse> {
    return this.request.get('/api/comments');
  }

  /**
   * Sends GET /api/comments/{id} — retrieves a single comment by ID (no auth required).
   *
   * @param id - The ID of the comment to retrieve.
   * @returns The raw APIResponse containing the comment object (200) or `{}` (404).
   */
  async getById(id: ResourceId): Promise<APIResponse> {
    return this.request.get(`/api/comments/${id}`);
  }

  /**
   * Sends POST /api/comments — creates a new comment (auth required).
   *
   * @param data - The `CreateCommentRequest` payload.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse containing the created comment (HTTP 201).
   */
  async create(data: CreateCommentRequest, token: string): Promise<APIResponse> {
    return this.request.post('/api/comments', {
      data,
      headers: authHeaders(new TokenAuth(token)),
    });
  }

  /**
   * Sends PUT /api/comments/{id} — replaces an existing comment (auth required).
   *
   * Note: GAD answers 201 and creates the comment when the ID does not exist (upsert).
   *
   * @param id - The ID of the comment to replace.
   * @param data - The full `CreateCommentRequest` payload.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse containing the replaced comment object.
   */
  async update(id: ResourceId, data: CreateCommentRequest, token: string): Promise<APIResponse> {
    return this.request.put(`/api/comments/${id}`, {
      data,
      headers: authHeaders(new TokenAuth(token)),
    });
  }

  /**
   * Sends PATCH /api/comments/{id} — partially updates an existing comment (auth required).
   *
   * @param id - The ID of the comment to update.
   * @param data - Partial `CreateCommentRequest` containing only the fields to change.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse containing the updated comment object.
   */
  async patch(
    id: ResourceId,
    data: Partial<CreateCommentRequest>,
    token: string,
  ): Promise<APIResponse> {
    return this.request.patch(`/api/comments/${id}`, {
      data,
      headers: authHeaders(new TokenAuth(token)),
    });
  }

  /**
   * Sends DELETE /api/comments/{id} — removes a comment (auth required).
   *
   * @param id - The ID of the comment to delete.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse — 200 with `{}` on success.
   */
  async delete(id: ResourceId, token: string): Promise<APIResponse> {
    return this.request.delete(`/api/comments/${id}`, {
      headers: authHeaders(new TokenAuth(token)),
    });
  }
}
