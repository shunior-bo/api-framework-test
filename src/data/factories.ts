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
import { type CreateCommentRequest } from '@src/models/comment.model';
import { type ResourceId } from '@src/models/common.model';
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
 * An ID that no GAD resource uses. Use it for 404 scenarios on GET.
 *
 * Do NOT use it for PUT: GAD upserts and would create a resource with this ID.
 */
export const NON_EXISTENT_ID = 999999999;
