import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { type ResourceId } from '@src/models/common.model';
import { type CreateLikeRequest } from '@src/models/like.model';
import { authHeaders, TokenAuth } from '@src/utils/auth';

/**
 * Handles all like resource requests to /api/likes.
 *
 * SOLID: Single Responsibility Principle (SRP) — this class owns only like
 *        endpoints. If the /api/likes contract changes, this is the only class
 *        that changes.
 * SOLID: Dependency Inversion Principle (DIP) — `APIRequestContext` is injected
 *        by the caller (constructor injection). This class never creates its own
 *        HTTP client.
 *
 * Note: every /api/likes request answers 404 unless the GAD feature flag
 *       `feature_likes` is enabled. GET endpoints are public. POST needs a JWT
 *       Bearer token AND a `userid` header equal to the token owner's id (GAD
 *       answers 401 without it; the header is not in the contract), so `create`
 *       sends `userid` from the payload's `user_id`.
 *
 * Must NOT: validate responses, read environment variables, perform assertions,
 *           or parse response bodies. Return the raw APIResponse and let the
 *           caller decide what to do with it.
 */
export class LikesClient {
  private readonly request: APIRequestContext;

  /**
   * @param request - The Playwright APIRequestContext injected by the caller.
   */
  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * Sends POST /api/likes — likes an article or comment, or removes the like when
   * the user already liked it (auth required).
   *
   * @param data - The `CreateLikeRequest` payload; `user_id` is also sent as the `userid` header.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse — 201 with the like when created, 200 with `{}` when removed.
   */
  async create(data: CreateLikeRequest, token: string): Promise<APIResponse> {
    return this.request.post('/api/likes', {
      data,
      headers: { ...authHeaders(new TokenAuth(token)), userid: String(data.user_id) },
    });
  }

  /**
   * Sends POST /api/likes with a raw, unserialized JSON body (auth required).
   *
   * Exists for the documented 400 "Bad request - malformed JSON": the typed
   * `create` always serializes valid JSON.
   *
   * @param rawBody - The exact request body text, sent as `application/json`.
   * @param userId - Id of the token owner, sent as the `userid` header.
   * @param token - The JWT Bearer token for authorization.
   * @returns The raw APIResponse — 400 when `rawBody` is not valid JSON.
   */
  async createWithRawBody(
    rawBody: string,
    userId: ResourceId,
    token: string,
  ): Promise<APIResponse> {
    return this.request.post('/api/likes', {
      data: rawBody,
      headers: {
        ...authHeaders(new TokenAuth(token)),
        'Content-Type': 'application/json',
        userid: String(userId),
      },
    });
  }

  /**
   * Sends GET /api/likes/article?id={articleId} — like counts for one or more
   * articles (no auth required).
   *
   * Note: the contract declares no parameters for this operation, but GAD
   *       answers 405 unless the `id` query parameter is present.
   *
   * @param articleId - The ID of the article whose likes are counted.
   * @returns The raw APIResponse containing the like counts.
   */
  async getByArticleQuery(articleId: ResourceId): Promise<APIResponse> {
    return this.request.get('/api/likes/article', { params: { id: articleId } });
  }

  /**
   * Sends GET /api/likes/article/{id} — like count of one article (no auth required).
   *
   * @param articleId - The ID of the article whose likes are counted.
   * @returns The raw APIResponse containing `{ likes }`.
   */
  async getByArticleId(articleId: ResourceId): Promise<APIResponse> {
    return this.request.get(`/api/likes/article/${articleId}`);
  }

  /**
   * Sends GET /api/likes/comment/{id} — like count of one comment (no auth required).
   *
   * @param commentId - The ID of the comment whose likes are counted.
   * @returns The raw APIResponse containing `{ likes }`.
   */
  async getByCommentId(commentId: ResourceId): Promise<APIResponse> {
    return this.request.get(`/api/likes/comment/${commentId}`);
  }

  /**
   * Sends GET /api/likes/article/mylikes?id={articleId} with the `userid` header —
   * whether the user liked the article (no auth required).
   *
   * @param articleId - The ID of the article (`id` query parameter).
   * @param userId - The ID of the user (`userid` header).
   * @returns The raw APIResponse containing the user's likes.
   */
  async getMyLikes(articleId: ResourceId, userId: ResourceId): Promise<APIResponse> {
    return this.request.get('/api/likes/article/mylikes', {
      params: { id: articleId },
      headers: { userid: String(userId) },
    });
  }
}
