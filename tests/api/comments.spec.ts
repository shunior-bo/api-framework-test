/**
 * Tests for /api/comments and /api/comments/{id}.
 *
 * A comment needs an article, so tests that create comments also create a
 * parent article. Cleanup deletes the comment first, then the article.
 */
import { buildArticle, buildComment, NON_EXISTENT_ID } from '@src/data/factories';
import { test, expect } from '@src/fixtures/auth.fixture';
import {
  ArticleSchema,
  CommentSchema,
  CommentsSchema,
  ErrorMessageSchema,
} from '@src/utils/schema';

test.describe('Comments API', () => {
  test(
    'GET /api/comments returns 200 and a list of comments',
    { tag: ['@smoke', '@tc-comments-01'] },
    async ({ commentsClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      // Seed data contains comments; nothing to create.

      // --- ACT -------------------------------------------------------------
      const response = await commentsClient.getAll();
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(200);

      const parsed = CommentsSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      expect(parsed.data?.length).toBeGreaterThan(0);
    },
  );

  test(
    'POST /api/comments returns 201 and the created comment',
    { tag: ['@smoke', '@tc-comments-02'] },
    async ({ articlesClient, commentsClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const articleResponse = await articlesClient.create(buildArticle(), authToken);
      expect(articleResponse.status()).toBe(201);
      const article = ArticleSchema.parse(await articleResponse.json());
      const payload = buildComment(article.id);

      // --- ACT -------------------------------------------------------------
      const response = await commentsClient.create(payload, authToken);
      const body: unknown = await response.json();
      const parsed = CommentSchema.safeParse(body);

      try {
        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(201);

        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data).toMatchObject({ ...payload });
        expect(parsed.data?.user_id).toBe(article.user_id);
      } finally {
        // --- CLEANUP -------------------------------------------------------
        if (parsed.success) {
          await commentsClient.delete(parsed.data.id, authToken);
        }
        await articlesClient.delete(article.id, authToken);
      }
    },
  );

  test(
    'POST /api/comments returns 401 without an access token',
    { tag: ['@negative', '@tc-comments-03'] },
    async ({ commentsClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      // The request is rejected before the article is looked up, so any ID works.
      const payload = buildComment(1);

      // --- ACT -------------------------------------------------------------
      const response = await commentsClient.create(payload, '');
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(401);

      const parsed = ErrorMessageSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      expect(parsed.data?.error.message).toBe('Access token not provided!');
    },
  );

  test(
    'POST /api/comments returns 422 when a mandatory field is empty',
    { tag: ['@negative', '@tc-comments-04'] },
    async ({ commentsClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const payload = buildComment(1, { body: '' });

      // --- ACT -------------------------------------------------------------
      const response = await commentsClient.create(payload, authToken);
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(422);

      const parsed = ErrorMessageSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      // GAD reports an empty comment body with its field-validation message.
      expect(parsed.data?.error.message).toContain('"body" is empty');
    },
  );

  test(
    'GET /api/comments/{id} returns 200 and the requested comment',
    { tag: ['@regression', '@tc-comments-05'] },
    async ({ articlesClient, commentsClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const articleResponse = await articlesClient.create(buildArticle(), authToken);
      expect(articleResponse.status()).toBe(201);
      const article = ArticleSchema.parse(await articleResponse.json());
      const commentResponse = await commentsClient.create(buildComment(article.id), authToken);
      expect(commentResponse.status()).toBe(201);
      const comment = CommentSchema.parse(await commentResponse.json());

      try {
        // --- ACT -----------------------------------------------------------
        const response = await commentsClient.getById(comment.id);
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(200);

        const parsed = CommentSchema.safeParse(body);
        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data).toEqual(comment);
      } finally {
        // --- CLEANUP -------------------------------------------------------
        await commentsClient.delete(comment.id, authToken);
        await articlesClient.delete(article.id, authToken);
      }
    },
  );

  test(
    'GET /api/comments/{id} returns 404 for a non-existent comment',
    { tag: ['@negative', '@tc-comments-06'] },
    async ({ commentsClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      const missingId = NON_EXISTENT_ID;

      // --- ACT -------------------------------------------------------------
      const response = await commentsClient.getById(missingId);
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(404);
      expect(body).toEqual({});
    },
  );
});
