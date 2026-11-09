import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { type CreateBookmarkRequest } from '@src/models/bookmark.model';
import { authHeaders, TokenAuth } from '@src/utils/auth';

/**
 * Handles all article-bookmark requests to /api/bookmarks/articles.
 *
 * SOLID: Single Responsibility Principle (SRP) — this class owns only bookmark
 *        endpoints. If the /api/bookmarks contract changes, this is the only
 *        class that changes.
 * SOLID: Dependency Inversion Principle (DIP) — `APIRequestContext` is injected
 *        by the caller (constructor injection). This class never creates its own
 *        HTTP client.
 *
 * Note: every /api/bookmarks request answers 404 unless the GAD feature flag
 *       `feature_user_bookmark_articles` is enabled. Both endpoints need a JWT
 *       Bearer token. There is no DELETE: POSTing a bookmarked article removes it.
 *
 * Must NOT: validate responses, read environment variables, perform assertions,
 *           or parse response bodies. Return the raw APIResponse and let the
 *           caller decide what to do with it.
 */
export class BookmarksClient {
  private readonly request: APIRequestContext;

  /**
   * @param request - The Playwright APIRequestContext injected by the caller.
   */
  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * Sends GET /api/bookmarks/articles — the token owner's bookmarked article ids (auth required).
   *
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse containing `{ article_ids }` (200) or an error (401).
   */
  async getAll(token: string): Promise<APIResponse> {
    return this.request.get('/api/bookmarks/articles', {
      headers: authHeaders(new TokenAuth(token)),
    });
  }

  /**
   * Sends POST /api/bookmarks/articles — adds the article to the token owner's
   * bookmarks, or removes it when it is already bookmarked (auth required).
   *
   * @param data - The `CreateBookmarkRequest` payload.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse — 201 for a user's first bookmark, 200 when added or removed.
   */
  async create(data: CreateBookmarkRequest, token: string): Promise<APIResponse> {
    return this.request.post('/api/bookmarks/articles', {
      data,
      headers: authHeaders(new TokenAuth(token)),
    });
  }
}
