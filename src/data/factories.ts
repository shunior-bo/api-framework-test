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
 * Returns a short string that is unique per call within a test run.
 *
 * Combines the current timestamp with a random component, e.g. "m3x9k2-4821".
 */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${faker.string.numeric(4)}`;
}

/**
 * Returns the current date-time as an ISO 8601 string (OpenAPI `format: date-time`).
 */
export function isoNow(): string {
  return new Date().toISOString();
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
    date: isoNow(),
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
    date: isoNow(),
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
