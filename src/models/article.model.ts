import { type ResourceId } from '@src/models/common.model';

/**
 * Article resource returned by GET /api/articles or GET /api/articles/{id}
 * (`components.schemas.Article`).
 *
 * SOLID: Single Responsibility Principle (SRP) — this interface describes the
 *        data shape only. It has no methods and no behavior.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface Article {
  /** Unique identifier assigned by the API. */
  id: ResourceId;
  /** Id of the user who authored the article (taken from the access token on create). */
  user_id: ResourceId;
  /** Article title. */
  title: string;
  /** Article body text. */
  body: string;
  /** Publication date as an ISO 8601 date-time string. */
  date: string;
  /** Optional relative image path. */
  image?: string;
}

/**
 * Request body for POST /api/articles and PUT /api/articles/{id}
 * (`components.schemas.ArticleCreate` / `ArticleUpdatePut`).
 *
 * SOLID: Dependency Inversion Principle (DIP) — ArticlesClient depends on this
 *        interface instead of a raw JSON object.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface CreateArticleRequest {
  /** Article title. */
  title: string;
  /** Article body text. */
  body: string;
  /** Publication date as an ISO 8601 date-time string. */
  date: string;
  /** Optional relative image path. */
  image?: string;
}
