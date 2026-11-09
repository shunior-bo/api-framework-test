/**
 * Tests for /api/bookmarks/articles.
 *
 * GAD ships with the `feature_user_bookmark_articles` flag OFF, and then every
 * /api/bookmarks request answers 404. The flag is switched on through
 * ConfigClient (POST /api/config/features, NOT in spec/openapi.json — test
 * infrastructure only) in beforeAll and restored to its default (OFF) in
 * afterAll. The flag is global server state, so this file runs serially.
 *
 * GAD keeps one bookmark record per user and toggles: POSTing an article that
 * is not bookmarked adds it, POSTing it again removes it. There is no DELETE,
 * so cleanup POSTs the article again.
 *
 * Not covered: 201 "First bookmark created". It needs a user without a bookmark
 * record, but the record it creates cannot be deleted through the API and GAD
 * reuses a deleted user's id, so such a test passes once and then gets 200.
 */
import { buildArticle, buildBookmark } from '@src/data/factories';
import { test, expect } from '@src/fixtures/auth.fixture';
import {
  ArticleSchema,
  BookmarkedArticlesSchema,
  BookmarkSchema,
  ErrorMessageSchema,
} from '@src/utils/schema';

test.describe.configure({ mode: 'serial' });

test.describe('Bookmarks API', () => {
  test.beforeAll(async ({ configClient }) => {
    const response = await configClient.setFeatures({ feature_user_bookmark_articles: true });
    expect(response.status(), 'could not enable feature_user_bookmark_articles').toBe(200);
  });

  test.afterAll(async ({ configClient }) => {
    await configClient.setFeatures({ feature_user_bookmark_articles: false });
  });

  test(
    'GET /api/bookmarks/articles returns 200 and the bookmarked article ids',
    { tag: ['@smoke', '@tc-bookmarks-01', '@ai-generated'] },
    async ({ articlesClient, bookmarksClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const articleResponse = await articlesClient.create(buildArticle(), authToken);
      expect(articleResponse.status()).toBe(201);
      const article = ArticleSchema.parse(await articleResponse.json());
      const bookmark = buildBookmark(article.id);
      const addResponse = await bookmarksClient.create(bookmark, authToken);
      expect(addResponse.ok()).toBe(true);

      try {
        // --- ACT -----------------------------------------------------------
        const response = await bookmarksClient.getAll(authToken);
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(200);

        const parsed = BookmarkedArticlesSchema.safeParse(body);
        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data?.article_ids).toContain(bookmark.article_id);
      } finally {
        // --- CLEANUP -------------------------------------------------------
        await bookmarksClient.create(bookmark, authToken);
        await articlesClient.delete(article.id, authToken);
      }
    },
  );

  test(
    'GET /api/bookmarks/articles returns 401 without an access token',
    { tag: ['@negative', '@tc-bookmarks-02', '@ai-generated'] },
    async ({ bookmarksClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      const token = '';

      // --- ACT -------------------------------------------------------------
      const response = await bookmarksClient.getAll(token);
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(401);

      const parsed = ErrorMessageSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      expect(parsed.data?.error.message).toBe('Access token for given user is invalid!');
    },
  );

  test(
    'POST /api/bookmarks/articles returns 200 and adds the article to existing bookmarks',
    { tag: ['@regression', '@tc-bookmarks-03', '@ai-generated'] },
    async ({ articlesClient, bookmarksClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      // The seed user already owns a bookmark record, so a new article is added to it.
      const articleResponse = await articlesClient.create(buildArticle(), authToken);
      expect(articleResponse.status()).toBe(201);
      const article = ArticleSchema.parse(await articleResponse.json());
      const bookmark = buildBookmark(article.id);

      // --- ACT -------------------------------------------------------------
      const response = await bookmarksClient.create(bookmark, authToken);
      const body: unknown = await response.json();
      const parsed = BookmarkSchema.safeParse(body);

      try {
        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(200);

        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data?.user_id).toBe(article.user_id);
        expect(parsed.data?.article_ids).toContain(bookmark.article_id);
      } finally {
        // --- CLEANUP -------------------------------------------------------
        if (parsed.success && parsed.data.article_ids.includes(bookmark.article_id)) {
          await bookmarksClient.create(bookmark, authToken);
        }
        await articlesClient.delete(article.id, authToken);
      }
    },
  );

  test(
    'POST /api/bookmarks/articles returns 200 and removes an already bookmarked article',
    { tag: ['@regression', '@tc-bookmarks-04', '@ai-generated'] },
    async ({ articlesClient, bookmarksClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const articleResponse = await articlesClient.create(buildArticle(), authToken);
      expect(articleResponse.status()).toBe(201);
      const article = ArticleSchema.parse(await articleResponse.json());
      const bookmark = buildBookmark(article.id);
      const addResponse = await bookmarksClient.create(bookmark, authToken);
      expect(addResponse.ok()).toBe(true);

      // --- ACT -------------------------------------------------------------
      const response = await bookmarksClient.create(bookmark, authToken);
      const body: unknown = await response.json();
      const parsed = BookmarkSchema.safeParse(body);

      try {
        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(200);

        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data?.article_ids).not.toContain(bookmark.article_id);
      } finally {
        // --- CLEANUP -------------------------------------------------------
        if (parsed.success && parsed.data.article_ids.includes(bookmark.article_id)) {
          await bookmarksClient.create(bookmark, authToken);
        }
        await articlesClient.delete(article.id, authToken);
      }
    },
  );

  test(
    'POST /api/bookmarks/articles returns 401 without an access token',
    { tag: ['@negative', '@tc-bookmarks-05', '@ai-generated'] },
    async ({ bookmarksClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      // The request is rejected before the article is looked up, so any ID works.
      const bookmark = buildBookmark(1);

      // --- ACT -------------------------------------------------------------
      const response = await bookmarksClient.create(bookmark, '');
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(401);

      const parsed = ErrorMessageSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      expect(parsed.data?.error.message).toBe('Access token for given user is invalid!');
    },
  );
});
