import { type ResourceId } from '@src/models/common.model';

/**
 * Article-bookmark record returned by POST /api/bookmarks/articles
 * (inline 200/201 response schema).
 *
 * GAD keeps one record per user and toggles article ids in `article_ids`.
 *
 * Note: every /api/bookmarks request answers 404 unless the GAD feature flag
 *       `feature_user_bookmark_articles` is enabled.
 *
 * SOLID: Single Responsibility Principle (SRP) — this interface describes the
 *        data shape only. It has no methods and no behavior.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface Bookmark {
  /** Unique identifier of the user's bookmark record. */
  id: ResourceId;
  /** Id of the user who owns the bookmarks. */
  user_id: ResourceId;
  /** Ids of the bookmarked articles. */
  article_ids: ResourceId[];
}

/**
 * Response body of GET /api/bookmarks/articles (inline response schema).
 *
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface BookmarkedArticles {
  /** Ids of the bookmarked articles (absent when the user has no bookmark record). */
  article_ids?: ResourceId[];
}

/**
 * Request body for POST /api/bookmarks/articles (`components.schemas.CreateBookmark`).
 *
 * GAD toggles: posting an article that is not bookmarked adds it, posting a
 * bookmarked one removes it.
 *
 * SOLID: Dependency Inversion Principle (DIP) — BookmarksClient depends on this
 *        interface instead of a raw JSON object.
 * Must NOT contain methods, validation logic, or Zod schemas.
 */
export interface CreateBookmarkRequest {
  /** Id of an existing article. The contract types it as a string. */
  article_id: string;
}
