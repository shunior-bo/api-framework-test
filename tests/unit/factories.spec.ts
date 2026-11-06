/**
 * Unit tests for src/data/factories.ts
 *
 * WHY unit tests here?
 * Every API test builds its payloads through these factories. If a factory
 * produced an invalid or duplicated payload, API tests would fail with a
 * misleading 409 / 422. These tests prove the factories are valid, unique and
 * overridable — without any network.
 *
 * Run with: npm run test:unit
 */
import { test, expect } from '@playwright/test';
import {
  buildArticle,
  buildComment,
  buildUser,
  isoNow,
  MAX_TITLE_LENGTH,
  recentIsoDate,
  uniqueSuffix,
} from '@src/data/factories';
import { DateTimeSchema } from '@src/utils/schema';

test.describe('uniqueSuffix / isoNow', () => {
  test('uniqueSuffix returns a different value on each call', () => {
    const values = new Set(Array.from({ length: 50 }, () => uniqueSuffix()));

    expect(values.size).toBe(50);
  });

  test('isoNow returns an OpenAPI date-time string', () => {
    expect(DateTimeSchema.safeParse(isoNow()).success).toBe(true);
  });

  test('recentIsoDate returns a date-time about 24 hours in the past', () => {
    const date = recentIsoDate();
    const hoursAgo = (Date.now() - new Date(date).getTime()) / 3_600_000;

    expect(DateTimeSchema.safeParse(date).success).toBe(true);
    expect(hoursAgo).toBeGreaterThan(23);
    expect(hoursAgo).toBeLessThan(25);
  });
});

test.describe('buildArticle', () => {
  test('returns all mandatory ArticleCreate fields', () => {
    const article = buildArticle();

    expect(article.title.length).toBeGreaterThan(0);
    expect(article.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(article.body.length).toBeGreaterThan(0);
    expect(DateTimeSchema.safeParse(article.date).success).toBe(true);
  });

  test('generates unique titles', () => {
    expect(buildArticle().title).not.toBe(buildArticle().title);
  });

  test('applies overrides', () => {
    expect(buildArticle({ title: 'Fixed' }).title).toBe('Fixed');
  });
});

test.describe('buildComment', () => {
  test('links the comment to the given article', () => {
    const comment = buildComment(42);

    expect(comment.article_id).toBe(42);
    expect(comment.body.length).toBeGreaterThan(0);
  });
});

test.describe('buildUser', () => {
  test('returns all mandatory UserUpdate fields', () => {
    const user = buildUser();

    expect(user.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    expect(user.firstname.length).toBeGreaterThan(0);
    expect(user.lastname.length).toBeGreaterThan(0);
    expect(user.password.length).toBeGreaterThan(0);
    expect(user.avatar.length).toBeGreaterThan(0);
  });

  test('generates unique emails', () => {
    expect(buildUser().email).not.toBe(buildUser().email);
  });
});
