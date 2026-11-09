import { type ResourceId } from '@src/models/common.model';

/**
 * Like resource returned by POST /api/likes with HTTP 201 (`components.schemas.Like`).
 *
 * A like targets exactly one element: an article (`article_id`) or a comment
 * (`comment_id`), never both.
 *
 * Note: every /api/likes request answers 404 unless the GAD feature flag
 *       `feature_likes` is enabled.
 *
 * SOLID: Single Responsibility Principle (SRP) — this interface describes the
 *        data shape only. It has no methods and no behavior.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface Like {
  /** Unique identifier assigned by the API. */
  id: ResourceId;
  /** Id of the user who gave the like. */
  user_id: ResourceId;
  /** Id of the liked article (absent when a comment is liked). */
  article_id?: ResourceId;
  /** Id of the liked comment (absent when an article is liked). */
  comment_id?: ResourceId;
  /** Creation date as an ISO 8601 date-time string (set by GAD). */
  date: string;
}

/**
 * Request body for POST /api/likes (`components.schemas.Like`, required: `user_id`, `date`).
 *
 * GAD toggles: the first POST for an element creates the like (201), the next
 * one removes it (200). Set exactly one of `article_id` / `comment_id`.
 *
 * SOLID: Dependency Inversion Principle (DIP) — LikesClient depends on this
 *        interface instead of a raw JSON object.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface CreateLikeRequest {
  /** Id of the user who likes; must be the owner of the access token. */
  user_id: ResourceId;
  /** Id of the article to like. */
  article_id?: ResourceId;
  /** Id of the comment to like. */
  comment_id?: ResourceId;
  /** ISO 8601 date-time string. Required by the contract; GAD overwrites it. */
  date: string;
}

/**
 * Like count returned by GET /api/likes/article/{id} and GET /api/likes/comment/{id}
 * (inline response schema: `{ likes: number }`).
 *
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface LikesCount {
  /** Number of likes of the element. */
  likes: number;
}
