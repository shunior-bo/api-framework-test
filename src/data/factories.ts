/**
 * Test-data factories for GAD request payloads.
 *
 * Pattern: Factory / Builder — each `buildXxx()` returns a valid, unique request
 *          payload. Tests override only the fields they care about:
 *          `buildArticle({ title: 'Specific title' })`.
 *
 * SOLID: Single Responsibility Principle (SRP) — this file owns test-data
 *        generation only. It never sends requests or performs assertions.
 * SOLID: Open/Closed Principle (OCP) — add a new `buildXxx()` for a new
 *        resource; existing builders never change.
 *
 * Uniqueness: every builder mixes faker data with `uniqueSuffix()` so tests can
 * run in parallel and repeatedly without colliding (e.g. the 409 duplicate-email
 * rule on POST /api/users).
 *
 * Must NOT: make network calls, perform assertions, or read environment variables.
 */
import { faker } from '@faker-js/faker';
import { type CreateArticleRequest } from '@src/models/article.model';
import { type CreateBookmarkRequest } from '@src/models/bookmark.model';
import { type CreateCommentRequest } from '@src/models/comment.model';
import { type ResourceId } from '@src/models/common.model';
import { type CreateLikeRequest } from '@src/models/like.model';
import { type CreateUserRequest } from '@src/models/user.model';

/** GAD rejects article titles longer than this with 422. */
export const MAX_TITLE_LENGTH = 128;

/** Avatar path that exists in the GAD seed data. */
const DEFAULT_AVATAR = '.\\data\\users\\face_1591133479.7144732.jpg';

/**
 * Article image path that exists in the GAD seed data.
 *
 * `image` is optional in the contract, but GAD's DB sanity check (reported by
 * GET /api/health as `dbProblems`) flags every article without it and turns the
 * health status to "Degraded" — even after the article is deleted. Always send it.
 */
const DEFAULT_ARTICLE_IMAGE = '.\\data\\images\\256\\chuttersnap-9cCeS9Sg6nU-unsplash.jpg';

/** Per-process call counter: guarantees uniqueness within one worker. */
let suffixCounter = 0;

/**
 * Returns a short string that is unique per call within a test run.
 *
 * Combines the timestamp, the worker process id and a per-process counter,
 * e.g. "m3x9k2-1a2b-7". The counter makes calls within the same millisecond
 * unique (a random component alone collided ~12% of the time for 50 calls),
 * and the pid separates parallel workers.
 */
export function uniqueSuffix(): string {
  suffixCounter += 1;
  return `${Date.now().toString(36)}-${process.pid.toString(36)}-${suffixCounter.toString(36)}`;
}

/**
 * Returns the current date-time as an ISO 8601 string (OpenAPI `format: date-time`).
 *
 * Do NOT use it as payload data for GAD: see `recentIsoDate()`.
 */
export function isoNow(): string {
  return new Date().toISOString();
}

/**
 * Returns an ISO 8601 date-time 24 hours in the past.
 *
 * Why not "now": GAD compares the payload `date` (a UTC instant) against the
 * server's LOCAL wall-clock time, so on a host west of UTC the current instant
 * is rejected with 422 "date in future" (see tc-articles-12). A date one day in
 * the past is valid in every timezone.
 */
export function recentIsoDate(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Builds a valid POST/PUT /api/articles payload.
 *
 * @param overrides - Fields to replace in the generated payload.
 * @returns A `CreateArticleRequest` with a unique title.
 */
export function buildArticle(overrides: Partial<CreateArticleRequest> = {}): CreateArticleRequest {
  const title = `[api-test] ${faker.lorem.words(4)} ${uniqueSuffix()}`;
  return {
    title: title.slice(0, MAX_TITLE_LENGTH),
    body: faker.lorem.paragraph(),
    date: recentIsoDate(),
    image: DEFAULT_ARTICLE_IMAGE,
    ...overrides,
  };
}

/**
 * Builds a malformed JSON request body: a valid article payload with its closing
 * brace cut off. Use it for the documented 400 "Bad request - malformed JSON".
 *
 * @returns A string that is not parseable as JSON.
 */
export function buildMalformedArticleJson(): string {
  return JSON.stringify(buildArticle()).slice(0, -1);
}

/**
 * Builds a valid POST /api/comments payload.
 *
 * @param articleId - ID of an existing article the comment belongs to.
 * @param overrides - Fields to replace in the generated payload.
 * @returns A `CreateCommentRequest` with a unique body.
 */
export function buildComment(
  articleId: ResourceId,
  overrides: Partial<CreateCommentRequest> = {},
): CreateCommentRequest {
  return {
    article_id: articleId,
    body: `[api-test] ${faker.lorem.sentence()} ${uniqueSuffix()}`,
    date: recentIsoDate(),
    ...overrides,
  };
}

/**
 * Builds a valid POST /api/users payload with a unique email address.
 *
 * @param overrides - Fields to replace in the generated payload.
 * @returns A `CreateUserRequest` whose email will not collide with other tests.
 */
export function buildUser(overrides: Partial<CreateUserRequest> = {}): CreateUserRequest {
  const firstname = faker.person.firstName();
  const lastname = faker.person.lastName();
  return {
    email: `api-test.${uniqueSuffix()}@example.test`,
    firstname,
    lastname,
    password: faker.internet.password({ length: 12 }),
    avatar: DEFAULT_AVATAR,
    ...overrides,
  };
}

/**
 * Builds a valid POST /api/likes payload for an article.
 *
 * GAD toggles likes: posting the same payload twice removes the like again.
 *
 * @param userId - ID of the token owner who gives the like.
 * @param articleId - ID of an existing article to like.
 * @param overrides - Fields to replace in the generated payload (e.g. `{ comment_id }`).
 * @returns A `CreateLikeRequest` for the article.
 */
export function buildLike(
  userId: ResourceId,
  articleId: ResourceId,
  overrides: Partial<CreateLikeRequest> = {},
): CreateLikeRequest {
  return {
    user_id: userId,
    article_id: articleId,
    date: recentIsoDate(),
    ...overrides,
  };
}

/**
 * Builds a malformed JSON POST /api/likes body: a valid like payload with its
 * closing brace cut off. Use it for the documented 400 "Bad request - malformed JSON".
 *
 * @param userId - ID of the token owner.
 * @param articleId - ID of an article.
 * @returns A string that is not parseable as JSON.
 */
export function buildMalformedLikeJson(userId: ResourceId, articleId: ResourceId): string {
  return JSON.stringify(buildLike(userId, articleId)).slice(0, -1);
}

/**
 * Builds a valid POST /api/bookmarks/articles payload.
 *
 * The contract types `article_id` as a string, so the ID is stringified.
 *
 * @param articleId - ID of an existing article to bookmark.
 * @returns A `CreateBookmarkRequest` for the article.
 */
export function buildBookmark(articleId: ResourceId): CreateBookmarkRequest {
  return { article_id: String(articleId) };
}

/**
 * An ID that no GAD resource uses. Use it for 404 scenarios on GET.
 *
 * Do NOT use it for PUT: GAD upserts and would create a resource with this ID.
 */
export const NON_EXISTENT_ID = 999999999;
