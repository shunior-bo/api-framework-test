/**
 * Central schema registry for the GAD API test framework.
 *
 * SOLID: Single Responsibility Principle (SRP) — this is the ONLY file in the
 *        entire framework that imports from `zod` directly. Every other file
 *        that needs `z` or a schema imports from here instead.
 * SOLID: Open/Closed Principle (OCP) — add new schemas by exporting new
 *        constants below. No existing schema definition ever needs to change.
 *
 * Rule: Never import `z` from `zod` directly in test files.
 *       Always import from `@src/utils/schema` (enforced by ESLint).
 *
 * Source of truth: `components.schemas` in spec/openapi.json. Each schema below
 * names the OpenAPI component it mirrors. Objects are non-strict on purpose:
 * GAD may return extra fields (e.g. users carry `birthDate`), and the contract
 * does not forbid them.
 *
 * Must NOT: make network calls, perform assertions, or read environment variables.
 */
import { z } from 'zod';

// Re-export `z` so consumers can call z.object(), z.string(), etc.
// without importing from zod directly.
export { z };

/**
 * Identifier used by GAD resources.
 *
 * Mirrors the OpenAPI `oneOf: [{ type: integer }, { type: string }]` pattern.
 */
export const IdSchema = z.union([z.number().int(), z.string()]);

/**
 * ISO 8601 date-time string (OpenAPI `format: date-time`).
 *
 * Accepts `Z` and numeric offsets, e.g. "2021-07-13T16:35:00Z".
 */
export const DateTimeSchema = z.string().datetime({ offset: true });

/**
 * Validates GAD error envelopes (`components.schemas.ErrorMessage`).
 *
 * Expected shape: { error: { message: string, details?: unknown } }
 */
export const ErrorMessageSchema = z.object({
  error: z.object({
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

/**
 * Validates the response body of GET /api/health.
 *
 * The contract has no body schema for this endpoint; this mirrors the observed
 * response. Expected shape: { status, health, dbProblems, configProblems, backendProblems }
 */
export const HealthSchema = z.object({
  status: z.string(),
  health: z.record(z.unknown()),
  dbProblems: z.array(z.unknown()),
  configProblems: z.array(z.unknown()),
  backendProblems: z.array(z.unknown()),
});

/**
 * Validates the response body of POST /api/login with HTTP 200
 * (`components.schemas.UserLoginToken`).
 *
 * Expected shape: { access_token: string }
 */
export const LoginResponseSchema = z.object({
  access_token: z.string().min(1),
});

/**
 * Validates a single article (`components.schemas.Article`).
 *
 * Expected shape: { id, user_id, title, body, date, image? }
 */
export const ArticleSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  title: z.string(),
  body: z.string(),
  date: DateTimeSchema,
  image: z.string().optional(),
});

/**
 * Validates the response body of GET /api/articles (`components.schemas.Articles`).
 */
export const ArticlesSchema = z.array(ArticleSchema);

/**
 * Validates a single comment (`components.schemas.Comment`).
 *
 * Expected shape: { id, article_id, user_id, body, date }
 */
export const CommentSchema = z.object({
  id: IdSchema,
  article_id: IdSchema,
  user_id: IdSchema,
  body: z.string(),
  date: DateTimeSchema,
});

/**
 * Validates the response body of GET /api/comments (`components.schemas.Comments`).
 */
export const CommentsSchema = z.array(CommentSchema);

/**
 * Validates a single user (`components.schemas.User`).
 *
 * Expected shape: { id, email, firstname, lastname, password?, avatar }
 * Note: `email` is a plain string, not `z.string().email()`, because public GET
 *       endpoints mask it as "****".
 */
export const UserSchema = z.object({
  id: IdSchema,
  email: z.string(),
  firstname: z.string(),
  lastname: z.string(),
  password: z.string().optional(),
  avatar: z.string(),
});

/**
 * Validates the response body of GET /api/users (`components.schemas.Users`).
 */
export const UsersSchema = z.array(UserSchema);

/**
 * Validates a single label (`components.schemas.Label`).
 *
 * Expected shape: { id: number, name: string, user_id: number }
 */
export const LabelSchema = z.object({
  id: z.number(),
  name: z.string(),
  user_id: z.number(),
});

/**
 * Validates the response body of GET /api/labels (`components.schemas.Labels`).
 */
export const LabelsSchema = z.array(LabelSchema);

/**
 * Validates GAD's body-parser error for a malformed JSON request body (HTTP 400).
 *
 * The contract documents 400 "Bad request - malformed JSON" with no body schema.
 * GAD answers with a flat envelope (unlike `ErrorMessageSchema`), e.g.
 * `{ error: "SyntaxError: Unexpected data in JSON. Please check Your JSON.", details: "<raw body>" }`.
 * Expected shape: { error: string, details?: unknown }
 */
export const MalformedJsonErrorSchema = z.object({
  error: z.string(),
  details: z.unknown().optional(),
});

/**
 * Validates the like returned by POST /api/likes with HTTP 201
 * (`components.schemas.Like`, required: `user_id`, `date`).
 *
 * Expected shape: { id?, user_id, article_id?, comment_id?, date }
 */
export const LikeSchema = z.object({
  id: IdSchema.optional(),
  user_id: IdSchema,
  article_id: IdSchema.optional(),
  comment_id: IdSchema.optional(),
  date: DateTimeSchema,
});

/**
 * Validates the like-count bodies of GET /api/likes/article, /api/likes/article/{id},
 * /api/likes/comment/{id} and /api/likes/article/mylikes (inline schema,
 * required: `likes`).
 *
 * Expected shape: { likes: number }
 */
export const LikesCountSchema = z.object({
  likes: z.number(),
});

/**
 * Article id inside a bookmark list. The contract declares
 * `oneOf: [{ type: number }, { type: string }]`.
 */
const BookmarkArticleIdSchema = z.union([z.number(), z.string()]);

/**
 * Validates the bookmark record returned by POST /api/bookmarks/articles with
 * HTTP 200 or 201 (inline response schema).
 *
 * Expected shape: { id, user_id, article_ids: (number | string)[] }
 */
export const BookmarkSchema = z.object({
  id: BookmarkArticleIdSchema,
  user_id: BookmarkArticleIdSchema,
  article_ids: z.array(BookmarkArticleIdSchema),
});

/**
 * Validates the response body of GET /api/bookmarks/articles (inline response schema).
 *
 * Expected shape: { article_ids?: (number | string)[] }
 */
export const BookmarkedArticlesSchema = z.object({
  article_ids: z.array(BookmarkArticleIdSchema).optional(),
});
