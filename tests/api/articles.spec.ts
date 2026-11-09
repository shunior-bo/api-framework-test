/**
 * Tests for /api/articles and /api/articles/{id}.
 *
 * Every test that creates an article deletes it in a `finally` block, so the
 * suite leaves GAD's data as it found it and tests stay independent.
 */
import {
  buildArticle,
  buildMalformedArticleJson,
  isoNow,
  NON_EXISTENT_ID,
} from '@src/data/factories';
import { test, expect } from '@src/fixtures/auth.fixture';
import {
  ArticleSchema,
  ArticlesSchema,
  ErrorMessageSchema,
  MalformedJsonErrorSchema,
} from '@src/utils/schema';

test.describe('Articles API', () => {
  test(
    'GET /api/articles returns 200 and a list of articles',
    { tag: ['@smoke', '@tc-articles-01'] },
    async ({ articlesClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      // Seed data contains articles; nothing to create.

      // --- ACT -------------------------------------------------------------
      const response = await articlesClient.getAll();
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(200);

      const parsed = ArticlesSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      expect(parsed.data?.length).toBeGreaterThan(0);
    },
  );

  test(
    'GET /api/articles/{id} returns 200 and the requested article',
    { tag: ['@smoke', '@tc-articles-02'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const payload = buildArticle();
      const createResponse = await articlesClient.create(payload, authToken);
      expect(createResponse.status()).toBe(201);
      const created = ArticleSchema.parse(await createResponse.json());

      try {
        // --- ACT -----------------------------------------------------------
        const response = await articlesClient.getById(created.id);
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(200);

        const parsed = ArticleSchema.safeParse(body);
        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data).toEqual(created);
      } finally {
        // --- CLEANUP -------------------------------------------------------
        await articlesClient.delete(created.id, authToken);
      }
    },
  );

  test(
    'GET /api/articles/{id} returns 404 for a non-existent article',
    { tag: ['@negative', '@tc-articles-03'] },
    async ({ articlesClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      const missingId = NON_EXISTENT_ID;

      // --- ACT -------------------------------------------------------------
      const response = await articlesClient.getById(missingId);
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(404);
      expect(body).toEqual({});
    },
  );

  test(
    'POST /api/articles returns 201 and the created article',
    { tag: ['@smoke', '@tc-articles-04'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const payload = buildArticle();

      // --- ACT -------------------------------------------------------------
      const response = await articlesClient.create(payload, authToken);
      const body: unknown = await response.json();
      const parsed = ArticleSchema.safeParse(body);

      try {
        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(201);

        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data).toMatchObject({ ...payload });
        expect(parsed.data?.user_id).toBeDefined();
      } finally {
        // --- CLEANUP -------------------------------------------------------
        if (parsed.success) {
          await articlesClient.delete(parsed.data.id, authToken);
        }
      }
    },
  );

  test(
    'POST /api/articles returns 401 without an access token',
    { tag: ['@negative', '@tc-articles-05'] },
    async ({ articlesClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      const payload = buildArticle();
      const noToken = '';

      // --- ACT -------------------------------------------------------------
      const response = await articlesClient.create(payload, noToken);
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(401);

      const parsed = ErrorMessageSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      expect(parsed.data?.error.message).toBe('Access token not provided!');
    },
  );

  test(
    'POST /api/articles returns 401 with an invalid access token',
    { tag: ['@negative', '@tc-articles-06'] },
    async ({ articlesClient }) => {
      // --- ARRANGE ---------------------------------------------------------
      const payload = buildArticle();

      // --- ACT -------------------------------------------------------------
      const response = await articlesClient.create(payload, 'invalid-token');
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(401);

      const parsed = ErrorMessageSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);
    },
  );

  test(
    'POST /api/articles returns 422 when a mandatory field is empty',
    { tag: ['@negative', '@tc-articles-07'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const payload = buildArticle({ title: '' });

      // --- ACT -------------------------------------------------------------
      const response = await articlesClient.create(payload, authToken);
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(422);

      const parsed = ErrorMessageSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      expect(parsed.data?.error.message).toBe('One of mandatory field is missing');
    },
  );

  test(
    'PUT /api/articles/{id} returns 200 and the replaced article',
    { tag: ['@smoke', '@tc-articles-08'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const createResponse = await articlesClient.create(buildArticle(), authToken);
      expect(createResponse.status()).toBe(201);
      const created = ArticleSchema.parse(await createResponse.json());
      const replacement = buildArticle();

      try {
        // --- ACT -----------------------------------------------------------
        const response = await articlesClient.update(created.id, replacement, authToken);
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(200);

        const parsed = ArticleSchema.safeParse(body);
        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data).toMatchObject({ ...replacement, id: created.id });
      } finally {
        // --- CLEANUP -------------------------------------------------------
        await articlesClient.delete(created.id, authToken);
      }
    },
  );

  test(
    'PATCH /api/articles/{id} returns 200 and updates only the given fields',
    { tag: ['@smoke', '@tc-articles-09'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const original = buildArticle();
      const createResponse = await articlesClient.create(original, authToken);
      expect(createResponse.status()).toBe(201);
      const created = ArticleSchema.parse(await createResponse.json());
      const newTitle = buildArticle().title;

      try {
        // --- ACT -----------------------------------------------------------
        const response = await articlesClient.patch(created.id, { title: newTitle }, authToken);
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(200);

        const parsed = ArticleSchema.safeParse(body);
        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data?.title).toBe(newTitle);
        expect(parsed.data?.body).toBe(original.body);
      } finally {
        // --- CLEANUP -------------------------------------------------------
        await articlesClient.delete(created.id, authToken);
      }
    },
  );

  test(
    'DELETE /api/articles/{id} returns 200 and the article is no longer retrievable',
    { tag: ['@smoke', '@tc-articles-10'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const createResponse = await articlesClient.create(buildArticle(), authToken);
      expect(createResponse.status()).toBe(201);
      const created = ArticleSchema.parse(await createResponse.json());

      // --- ACT -------------------------------------------------------------
      const response = await articlesClient.delete(created.id, authToken);

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(200);

      const followUp = await articlesClient.getById(created.id);
      expect(followUp.status()).toBe(404);
    },
  );

  test(
    'DELETE /api/articles/{id} returns 401 without an access token',
    { tag: ['@negative', '@tc-articles-11'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const createResponse = await articlesClient.create(buildArticle(), authToken);
      expect(createResponse.status()).toBe(201);
      const created = ArticleSchema.parse(await createResponse.json());

      try {
        // --- ACT -----------------------------------------------------------
        const response = await articlesClient.delete(created.id, '');

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(401);

        const stillThere = await articlesClient.getById(created.id);
        expect(stillThere.status()).toBe(200);
      } finally {
        // --- CLEANUP -------------------------------------------------------
        await articlesClient.delete(created.id, authToken);
      }
    },
  );

  test(
    'POST /api/articles returns 201 when the date is the current date-time',
    { tag: ['@regression', '@tc-articles-12'] },
    async ({ articlesClient, authToken }) => {
      // KNOWN GAD BUG — expected to fail on hosts west of UTC until fixed in GAD.
      // Spec: `date` is `format: date-time`; the current instant is a valid value.
      // Actual: 422 "date has date in future!" — GAD compares the UTC payload date
      // against the server's LOCAL wall-clock time, so any host west of UTC
      // (e.g. UTC-04:00) rejects "now". Not controlled by config/config-bugs.js.
      // On UTC (CI) or east-of-UTC hosts the bug does not show and this is a normal
      // regression test. Assumes GAD and the tests share the host timezone, which
      // holds locally and in CI (the workflow pins TZ=UTC).
      const hostIsWestOfUtc = new Date().getTimezoneOffset() > 0;
      test.fail(
        hostIsWestOfUtc,
        'GAD rejects the current UTC date-time as "in future" on hosts west of UTC (timezone bug)',
      );

      // --- ARRANGE ---------------------------------------------------------
      const payload = buildArticle({ date: isoNow() });

      // --- ACT -------------------------------------------------------------
      const response = await articlesClient.create(payload, authToken);
      const body: unknown = await response.json();
      const parsed = ArticleSchema.safeParse(body);

      try {
        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(201);

        expect(parsed.success, parsed.error?.message).toBe(true);
      } finally {
        // --- CLEANUP -------------------------------------------------------
        if (parsed.success) {
          await articlesClient.delete(parsed.data.id, authToken);
        }
      }
    },
  );

  test(
    'PUT /api/articles/{id} returns 201 and creates the article when the id does not exist',
    { tag: ['@regression', '@tc-articles-13', '@ai-generated'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      // An id above every existing article id, so the PUT takes the documented
      // "Article created" (201) branch. Not NON_EXISTENT_ID: that constant is
      // reserved for GET 404s (CONVENTIONS §6).
      const listResponse = await articlesClient.getAll();
      expect(listResponse.status()).toBe(200);
      const existing = ArticlesSchema.parse(await listResponse.json());
      const unusedId = Math.max(0, ...existing.map((article) => Number(article.id))) + 1000;
      const payload = buildArticle();

      // --- ACT -------------------------------------------------------------
      const response = await articlesClient.update(unusedId, payload, authToken);
      const body: unknown = await response.json();
      const parsed = ArticleSchema.safeParse(body);

      try {
        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(201);

        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data).toMatchObject({ ...payload });
      } finally {
        // --- CLEANUP -------------------------------------------------------
        if (parsed.success) {
          await articlesClient.delete(parsed.data.id, authToken);
        }
      }
    },
  );

  test(
    'PUT /api/articles/{id} returns 401 without an access token',
    { tag: ['@negative', '@tc-articles-14', '@ai-generated'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const original = buildArticle();
      const createResponse = await articlesClient.create(original, authToken);
      expect(createResponse.status()).toBe(201);
      const created = ArticleSchema.parse(await createResponse.json());

      try {
        // --- ACT -----------------------------------------------------------
        const response = await articlesClient.update(created.id, buildArticle(), '');
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(401);

        const parsed = ErrorMessageSchema.safeParse(body);
        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data?.error.message).toBe('Access token not provided!');

        const unchanged = ArticleSchema.parse(
          await (await articlesClient.getById(created.id)).json(),
        );
        expect(unchanged.title).toBe(original.title);
      } finally {
        // --- CLEANUP -------------------------------------------------------
        await articlesClient.delete(created.id, authToken);
      }
    },
  );

  test(
    'POST /api/articles returns 400 for a malformed JSON body',
    { tag: ['@negative', '@tc-articles-15', '@ai-generated'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const malformedBody = buildMalformedArticleJson();

      // --- ACT -------------------------------------------------------------
      const response = await articlesClient.createWithRawBody(malformedBody, authToken);
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(400);

      const parsed = MalformedJsonErrorSchema.safeParse(body);
      expect(parsed.success, parsed.error?.message).toBe(true);

      expect(parsed.data?.error).toContain('JSON');
    },
  );

  test(
    'PUT /api/articles/{id} returns 400 for a malformed JSON body',
    { tag: ['@negative', '@tc-articles-16', '@ai-generated'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const original = buildArticle();
      const createResponse = await articlesClient.create(original, authToken);
      expect(createResponse.status()).toBe(201);
      const created = ArticleSchema.parse(await createResponse.json());
      const malformedBody = buildMalformedArticleJson();

      try {
        // --- ACT -----------------------------------------------------------
        const response = await articlesClient.updateWithRawBody(
          created.id,
          malformedBody,
          authToken,
        );
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(400);

        const parsed = MalformedJsonErrorSchema.safeParse(body);
        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data?.error).toContain('JSON');
      } finally {
        // --- CLEANUP -------------------------------------------------------
        await articlesClient.delete(created.id, authToken);
      }
    },
  );

  test(
    'PUT /api/articles/{id} returns 422 when a mandatory field is empty',
    { tag: ['@negative', '@tc-articles-17', '@ai-generated'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const original = buildArticle();
      const createResponse = await articlesClient.create(original, authToken);
      expect(createResponse.status()).toBe(201);
      const created = ArticleSchema.parse(await createResponse.json());
      const invalidReplacement = buildArticle({ title: '' });

      try {
        // --- ACT -----------------------------------------------------------
        const response = await articlesClient.update(created.id, invalidReplacement, authToken);
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(422);

        const parsed = ErrorMessageSchema.safeParse(body);
        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data?.error.message).toBe('One of mandatory field is missing');
      } finally {
        // --- CLEANUP -------------------------------------------------------
        await articlesClient.delete(created.id, authToken);
      }
    },
  );

  test(
    'PATCH /api/articles/{id} returns 400 for a malformed JSON body',
    { tag: ['@negative', '@tc-articles-18', '@ai-generated'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const createResponse = await articlesClient.create(buildArticle(), authToken);
      expect(createResponse.status()).toBe(201);
      const created = ArticleSchema.parse(await createResponse.json());
      const malformedBody = buildMalformedArticleJson();

      try {
        // --- ACT -----------------------------------------------------------
        const response = await articlesClient.patchWithRawBody(
          created.id,
          malformedBody,
          authToken,
        );
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(400);

        const parsed = MalformedJsonErrorSchema.safeParse(body);
        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data?.error).toContain('JSON');
      } finally {
        // --- CLEANUP -------------------------------------------------------
        await articlesClient.delete(created.id, authToken);
      }
    },
  );

  test(
    'PATCH /api/articles/{id} returns 401 without an access token',
    { tag: ['@negative', '@tc-articles-19', '@ai-generated'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const original = buildArticle();
      const createResponse = await articlesClient.create(original, authToken);
      expect(createResponse.status()).toBe(201);
      const created = ArticleSchema.parse(await createResponse.json());
      const newTitle = buildArticle().title;

      try {
        // --- ACT -----------------------------------------------------------
        const response = await articlesClient.patch(created.id, { title: newTitle }, '');
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(401);

        const parsed = ErrorMessageSchema.safeParse(body);
        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data?.error.message).toBe('Access token not provided!');

        const unchanged = ArticleSchema.parse(
          await (await articlesClient.getById(created.id)).json(),
        );
        expect(unchanged.title).toBe(original.title);
      } finally {
        // --- CLEANUP -------------------------------------------------------
        await articlesClient.delete(created.id, authToken);
      }
    },
  );

  test(
    'PATCH /api/articles/{id} returns 404 for a non-existent article',
    { tag: ['@negative', '@tc-articles-20', '@ai-generated'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      // PATCH does not upsert (unlike PUT), so NON_EXISTENT_ID is safe here.
      const missingId = NON_EXISTENT_ID;
      const newTitle = buildArticle().title;

      // --- ACT -------------------------------------------------------------
      const response = await articlesClient.patch(missingId, { title: newTitle }, authToken);
      const body: unknown = await response.json();

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(404);
      expect(body).toEqual({});

      const stillMissing = await articlesClient.getById(missingId);
      expect(stillMissing.status()).toBe(404);
    },
  );

  test(
    'PATCH /api/articles/{id} returns 422 when a field is empty',
    { tag: ['@negative', '@tc-articles-21', '@ai-generated'] },
    async ({ articlesClient, authToken }) => {
      // --- ARRANGE ---------------------------------------------------------
      const original = buildArticle();
      const createResponse = await articlesClient.create(original, authToken);
      expect(createResponse.status()).toBe(201);
      const created = ArticleSchema.parse(await createResponse.json());

      try {
        // --- ACT -----------------------------------------------------------
        const response = await articlesClient.patch(created.id, { title: '' }, authToken);
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(422);

        const parsed = ErrorMessageSchema.safeParse(body);
        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data?.error.message).toContain('"title" is empty');

        const unchanged = ArticleSchema.parse(
          await (await articlesClient.getById(created.id)).json(),
        );
        expect(unchanged.title).toBe(original.title);
      } finally {
        // --- CLEANUP -------------------------------------------------------
        await articlesClient.delete(created.id, authToken);
      }
    },
  );
});
