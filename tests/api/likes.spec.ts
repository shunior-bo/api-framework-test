/**
 * Tests for /api/likes and its GET /api/likes/* read endpoints.
 *
 * GAD ships with the `feature_likes` flag OFF, and then every /api/likes request
 * answers 404 (documented in the contract as "Not found"). The other cases need
 * the flag ON, which is set through ConfigClient (POST /api/config/features, NOT
 * in spec/openapi.json — test infrastructure only). The flag is global server
 * state, so this file runs serially and always restores the flag to its
 * default (OFF) in afterAll.
 *
 * GAD toggles likes: the first POST for an element creates the like (201), the
 * next identical POST removes it (200). Cleanup therefore POSTs the like again.
 * POST also needs a `userid` header equal to the token owner's id; LikesClient
 * sends it from the payload's `user_id`. The seed user's id is read from an
 * article it creates (`article.user_id`).
 */
import {
  buildArticle,
  buildComment,
  buildCommentLike,
  buildLike,
  buildMalformedLikeJson,
} from '@src/data/factories';
import { test, expect } from '@src/fixtures/auth.fixture';
import {
  ArticleSchema,
  CommentSchema,
  ErrorMessageSchema,
  LikeSchema,
  LikesCountSchema,
  MalformedJsonErrorSchema,
} from '@src/utils/schema';

test.describe.configure({ mode: 'serial' });

test.describe('Likes API', () => {
  test.describe('with feature_likes enabled', () => {
    test.beforeAll(async ({ configClient }) => {
      const response = await configClient.setFeatures({ feature_likes: true });
      expect(response.status(), 'could not enable feature_likes').toBe(200);
    });

    test.afterAll(async ({ configClient }) => {
      await configClient.setFeatures({ feature_likes: false });
    });

    test(
      'POST /api/likes returns 201 and the created like',
      { tag: ['@smoke', '@tc-likes-01', '@ai-generated'] },
      async ({ articlesClient, likesClient, authToken }) => {
        // --- ARRANGE -------------------------------------------------------
        const articleResponse = await articlesClient.create(buildArticle(), authToken);
        expect(articleResponse.status()).toBe(201);
        const article = ArticleSchema.parse(await articleResponse.json());
        const payload = buildLike(article.user_id, article.id);

        // --- ACT -----------------------------------------------------------
        const response = await likesClient.create(payload, authToken);
        const body: unknown = await response.json();
        const parsed = LikeSchema.safeParse(body);

        try {
          // --- ASSERT ------------------------------------------------------
          expect(response.status()).toBe(201);

          expect(parsed.success, parsed.error?.message).toBe(true);

          expect(parsed.data).toMatchObject({ user_id: article.user_id, article_id: article.id });
        } finally {
          // --- CLEANUP -----------------------------------------------------
          if (response.status() === 201) {
            await likesClient.create(payload, authToken);
          }
          await articlesClient.delete(article.id, authToken);
        }
      },
    );

    test(
      'POST /api/likes returns 200 and removes the like when the article is already liked',
      { tag: ['@regression', '@tc-likes-02', '@ai-generated'] },
      async ({ articlesClient, likesClient, authToken }) => {
        // --- ARRANGE -------------------------------------------------------
        const articleResponse = await articlesClient.create(buildArticle(), authToken);
        expect(articleResponse.status()).toBe(201);
        const article = ArticleSchema.parse(await articleResponse.json());
        const payload = buildLike(article.user_id, article.id);
        const likeResponse = await likesClient.create(payload, authToken);
        expect(likeResponse.status()).toBe(201);

        // --- ACT -----------------------------------------------------------
        const response = await likesClient.create(payload, authToken);
        const body: unknown = await response.json();

        try {
          // --- ASSERT ------------------------------------------------------
          // The contract documents 200 "Like deleted" without a body schema.
          expect(response.status()).toBe(200);
          expect(body).toEqual({});
        } finally {
          // --- CLEANUP -----------------------------------------------------
          if (response.status() !== 200) {
            await likesClient.create(payload, authToken);
          }
          await articlesClient.delete(article.id, authToken);
        }
      },
    );

    test(
      'POST /api/likes returns 400 for a malformed JSON body',
      { tag: ['@negative', '@tc-likes-03', '@ai-generated'] },
      async ({ likesClient, authToken }) => {
        // --- ARRANGE -------------------------------------------------------
        // The body is rejected by the JSON parser before any user or article
        // lookup, so any IDs work.
        const rawBody = buildMalformedLikeJson(1, 1);

        // --- ACT -----------------------------------------------------------
        const response = await likesClient.createWithRawBody(rawBody, 1, authToken);
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(400);

        const parsed = MalformedJsonErrorSchema.safeParse(body);
        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data?.error).toContain('SyntaxError');
      },
    );

    test(
      'POST /api/likes returns 422 when both article_id and comment_id are set',
      { tag: ['@negative', '@tc-likes-04', '@ai-generated'] },
      async ({ articlesClient, likesClient, authToken }) => {
        // --- ARRANGE -------------------------------------------------------
        // The article provides the seed user's id, which must match the token.
        const articleResponse = await articlesClient.create(buildArticle(), authToken);
        expect(articleResponse.status()).toBe(201);
        const article = ArticleSchema.parse(await articleResponse.json());
        const payload = buildLike(article.user_id, article.id, { comment_id: 1 });

        try {
          // --- ACT ---------------------------------------------------------
          const response = await likesClient.create(payload, authToken);
          const body: unknown = await response.json();

          // --- ASSERT ------------------------------------------------------
          expect(response.status()).toBe(422);

          const parsed = ErrorMessageSchema.safeParse(body);
          expect(parsed.success, parsed.error?.message).toBe(true);

          expect(parsed.data?.error.message).toBe('Only one field must not be empty!');
        } finally {
          // --- CLEANUP -----------------------------------------------------
          await articlesClient.delete(article.id, authToken);
        }
      },
    );

    test(
      'GET /api/likes/article returns 200 and the like count',
      { tag: ['@smoke', '@tc-likes-05', '@ai-generated'] },
      async ({ articlesClient, likesClient, authToken }) => {
        test.fail(
          true,
          'GAD bug: spec says 200 { likes: number } with no parameters, GAD needs ?id= (405 without it) and returns { likes: { "<id>": number } } — evidence in docs/ai-generation/20261109-0959-likes-bookmarks.md',
        );

        // --- ARRANGE -------------------------------------------------------
        const articleResponse = await articlesClient.create(buildArticle(), authToken);
        expect(articleResponse.status()).toBe(201);
        const article = ArticleSchema.parse(await articleResponse.json());

        try {
          // --- ACT ---------------------------------------------------------
          const response = await likesClient.getByArticleQuery(article.id);
          const body: unknown = await response.json();

          // --- ASSERT ------------------------------------------------------
          expect(response.status()).toBe(200);

          const parsed = LikesCountSchema.safeParse(body);
          expect(parsed.success, parsed.error?.message).toBe(true);

          expect(parsed.data?.likes).toBe(0);
        } finally {
          // --- CLEANUP -----------------------------------------------------
          await articlesClient.delete(article.id, authToken);
        }
      },
    );

    test(
      'GET /api/likes/article/{id} returns 200 and the like count of the article',
      { tag: ['@smoke', '@tc-likes-08', '@ai-generated'] },
      async ({ articlesClient, likesClient, authToken }) => {
        // --- ARRANGE -------------------------------------------------------
        const articleResponse = await articlesClient.create(buildArticle(), authToken);
        expect(articleResponse.status()).toBe(201);
        const article = ArticleSchema.parse(await articleResponse.json());
        const like = buildLike(article.user_id, article.id);
        const likeResponse = await likesClient.create(like, authToken);
        expect(likeResponse.status()).toBe(201);

        try {
          // --- ACT ---------------------------------------------------------
          const response = await likesClient.getByArticleId(article.id);
          const body: unknown = await response.json();

          // --- ASSERT ------------------------------------------------------
          expect(response.status()).toBe(200);

          const parsed = LikesCountSchema.safeParse(body);
          expect(parsed.success, parsed.error?.message).toBe(true);

          expect(parsed.data?.likes).toBe(1);
        } finally {
          // --- CLEANUP -----------------------------------------------------
          await likesClient.create(like, authToken);
          await articlesClient.delete(article.id, authToken);
        }
      },
    );

    test(
      'GET /api/likes/comment/{id} returns 200 and the like count of the comment',
      { tag: ['@smoke', '@tc-likes-09', '@ai-generated'] },
      async ({ articlesClient, commentsClient, likesClient, authToken }) => {
        // --- ARRANGE -------------------------------------------------------
        const articleResponse = await articlesClient.create(buildArticle(), authToken);
        expect(articleResponse.status()).toBe(201);
        const article = ArticleSchema.parse(await articleResponse.json());
        const commentResponse = await commentsClient.create(buildComment(article.id), authToken);
        expect(commentResponse.status()).toBe(201);
        const comment = CommentSchema.parse(await commentResponse.json());
        const like = buildCommentLike(comment.user_id, comment.id);
        const likeResponse = await likesClient.create(like, authToken);
        expect(likeResponse.status()).toBe(201);

        try {
          // --- ACT ---------------------------------------------------------
          const response = await likesClient.getByCommentId(comment.id);
          const body: unknown = await response.json();

          // --- ASSERT ------------------------------------------------------
          expect(response.status()).toBe(200);

          const parsed = LikesCountSchema.safeParse(body);
          expect(parsed.success, parsed.error?.message).toBe(true);

          expect(parsed.data?.likes).toBe(1);
        } finally {
          // --- CLEANUP -----------------------------------------------------
          await likesClient.create(like, authToken);
          await commentsClient.delete(comment.id, authToken);
          await articlesClient.delete(article.id, authToken);
        }
      },
    );

    test(
      'GET /api/likes/article/mylikes returns 200 and the like count of the user',
      { tag: ['@regression', '@tc-likes-10', '@ai-generated'] },
      async ({ articlesClient, likesClient, authToken }) => {
        test.fail(
          true,
          'GAD bug: spec says 200 { likes: number }, GAD returns { likes: { "<id>": boolean } } — evidence in docs/ai-generation/20261109-0959-likes-bookmarks.md',
        );

        // --- ARRANGE -------------------------------------------------------
        const articleResponse = await articlesClient.create(buildArticle(), authToken);
        expect(articleResponse.status()).toBe(201);
        const article = ArticleSchema.parse(await articleResponse.json());
        const like = buildLike(article.user_id, article.id);
        const likeResponse = await likesClient.create(like, authToken);
        expect(likeResponse.status()).toBe(201);

        try {
          // --- ACT ---------------------------------------------------------
          const response = await likesClient.getMyLikes(article.id, article.user_id);
          const body: unknown = await response.json();

          // --- ASSERT ------------------------------------------------------
          expect(response.status()).toBe(200);

          const parsed = LikesCountSchema.safeParse(body);
          expect(parsed.success, parsed.error?.message).toBe(true);

          expect(parsed.data?.likes).toBe(1);
        } finally {
          // --- CLEANUP -----------------------------------------------------
          await likesClient.create(like, authToken);
          await articlesClient.delete(article.id, authToken);
        }
      },
    );
  });

  test.describe('with feature_likes disabled (GAD default)', () => {
    test.beforeAll(async ({ configClient }) => {
      const response = await configClient.setFeatures({ feature_likes: false });
      expect(response.status(), 'could not disable feature_likes').toBe(200);
    });

    test(
      'POST /api/likes returns 404 when the likes feature is disabled',
      { tag: ['@negative', '@tc-likes-06', '@ai-generated'] },
      async ({ likesClient, authToken }) => {
        // --- ARRANGE -------------------------------------------------------
        // The feature check runs before any user or article lookup, so any IDs work.
        const payload = buildLike(1, 1);

        // --- ACT -----------------------------------------------------------
        const response = await likesClient.create(payload, authToken);
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(404);
        expect(body).toEqual({});
      },
    );

    test(
      'GET /api/likes/article returns 404 when the likes feature is disabled',
      { tag: ['@negative', '@tc-likes-07', '@ai-generated'] },
      async ({ likesClient }) => {
        // --- ARRANGE -------------------------------------------------------
        const articleId = 1;

        // --- ACT -----------------------------------------------------------
        const response = await likesClient.getByArticleQuery(articleId);
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(404);
        expect(body).toEqual({});
      },
    );

    test(
      'GET /api/likes/article/{id} returns 404 when the likes feature is disabled',
      { tag: ['@negative', '@tc-likes-11', '@ai-generated'] },
      async ({ likesClient }) => {
        // --- ARRANGE -------------------------------------------------------
        const articleId = 1;

        // --- ACT -----------------------------------------------------------
        const response = await likesClient.getByArticleId(articleId);
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(404);
        expect(body).toEqual({});
      },
    );

    test(
      'GET /api/likes/comment/{id} returns 404 when the likes feature is disabled',
      { tag: ['@negative', '@tc-likes-12', '@ai-generated'] },
      async ({ likesClient }) => {
        // --- ARRANGE -------------------------------------------------------
        const commentId = 1;

        // --- ACT -----------------------------------------------------------
        const response = await likesClient.getByCommentId(commentId);
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(404);
        expect(body).toEqual({});
      },
    );

    test(
      'GET /api/likes/article/mylikes returns 404 when the likes feature is disabled',
      { tag: ['@negative', '@tc-likes-13', '@ai-generated'] },
      async ({ likesClient }) => {
        // --- ARRANGE -------------------------------------------------------
        const articleId = 1;
        const userId = 1;

        // --- ACT -----------------------------------------------------------
        const response = await likesClient.getMyLikes(articleId, userId);
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(404);
        expect(body).toEqual({});
      },
    );
  });
});
