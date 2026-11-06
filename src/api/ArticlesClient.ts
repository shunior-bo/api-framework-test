import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { type CreateArticleRequest } from '@src/models/article.model';
import { type ResourceId } from '@src/models/common.model';
import { authHeaders, TokenAuth } from '@src/utils/auth';

/**
 * Handles all article resource requests to /api/articles.
 *
 * SOLID: Single Responsibility Principle (SRP) — this class owns only article
 *        endpoints. If the /api/articles contract changes, this is the only class
 *        that changes.
 * SOLID: Dependency Inversion Principle (DIP) — `APIRequestContext` is injected
 *        by the caller (constructor injection). This class never creates its own
 *        HTTP client.
 *
 * Note: GET endpoints are public. Write endpoints require a JWT Bearer token,
 *       passed as a parameter — this class never reads environment variables.
 *       Only the article author may modify or delete it.
 *
 * Must NOT: validate responses, read environment variables, perform assertions,
 *           or parse response bodies. Return the raw APIResponse and let the
 *           caller decide what to do with it.
 */
export class ArticlesClient {
  private readonly request: APIRequestContext;

  /**
   * @param request - The Playwright APIRequestContext injected by the caller.
   */
  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * Sends GET /api/articles — retrieves all articles (no auth required).
   *
   * @returns The raw APIResponse containing the array of articles.
   */
  async getAll(): Promise<APIResponse> {
    return this.request.get('/api/articles');
  }

  /**
   * Sends GET /api/articles/{id} — retrieves a single article by ID (no auth required).
   *
   * @param id - The ID of the article to retrieve.
   * @returns The raw APIResponse containing the article object (200) or `{}` (404).
   */
  async getById(id: ResourceId): Promise<APIResponse> {
    return this.request.get(`/api/articles/${id}`);
  }

  /**
   * Sends POST /api/articles — creates a new article (auth required).
   *
   * @param data - The `CreateArticleRequest` payload.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse containing the created article (HTTP 201).
   */
  async create(data: CreateArticleRequest, token: string): Promise<APIResponse> {
    return this.request.post('/api/articles', {
      data,
      headers: authHeaders(new TokenAuth(token)),
    });
  }

  /**
   * Sends PUT /api/articles/{id} — replaces an existing article (auth required).
   *
   * Note: GAD answers 201 and creates the article when the ID does not exist (upsert).
   *
   * @param id - The ID of the article to replace.
   * @param data - The full `CreateArticleRequest` payload.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse containing the replaced article object.
   */
  async update(id: ResourceId, data: CreateArticleRequest, token: string): Promise<APIResponse> {
    return this.request.put(`/api/articles/${id}`, {
      data,
      headers: authHeaders(new TokenAuth(token)),
    });
  }

  /**
   * Sends PATCH /api/articles/{id} — partially updates an existing article (auth required).
   *
   * @param id - The ID of the article to update.
   * @param data - Partial `CreateArticleRequest` containing only the fields to change.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse containing the updated article object.
   */
  async patch(
    id: ResourceId,
    data: Partial<CreateArticleRequest>,
    token: string,
  ): Promise<APIResponse> {
    return this.request.patch(`/api/articles/${id}`, {
      data,
      headers: authHeaders(new TokenAuth(token)),
    });
  }

  /**
   * Sends DELETE /api/articles/{id} — removes a article (auth required).
   *
   * @param id - The ID of the article to delete.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse — 200 with `{}` on success.
   */
  async delete(id: ResourceId, token: string): Promise<APIResponse> {
    return this.request.delete(`/api/articles/${id}`, {
      headers: authHeaders(new TokenAuth(token)),
    });
  }
}
