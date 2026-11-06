import { type ResourceId } from '@src/models/common.model';

/**
 * Comment resource returned by GET /api/comments or GET /api/comments/{id}
 * (`components.schemas.Comment`).
 *
 * SOLID: Single Responsibility Principle (SRP) — this interface describes the
 *        data shape only. It has no methods and no behavior.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface Comment {
  /** Unique identifier assigned by the API. */
  id: ResourceId;
  /** Id of the article the comment belongs to. */
  article_id: ResourceId;
  /** Id of the user who wrote the comment (taken from the access token on create). */
  user_id: ResourceId;
  /** Comment text. */
  body: string;
  /** Creation date as an ISO 8601 date-time string. */
  date: string;
}

/**
 * Request body for POST /api/comments (`components.schemas.CommentCreate`).
 *
 * SOLID: Dependency Inversion Principle (DIP) — CommentsClient depends on this
 *        interface instead of a raw JSON object.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface CreateCommentRequest {
  /** Id of an existing article. */
  article_id: ResourceId;
  /** Comment text. */
  body: string;
  /** Creation date as an ISO 8601 date-time string. */
  date: string;
}
