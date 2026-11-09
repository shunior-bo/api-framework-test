/**
 * Unit tests for src/utils/schema.ts (Zod schema registry)
 *
 * WHY unit tests here?
 * Zod schemas are pure data-shape contracts. safeParse() is deterministic and
 * needs no network. Testing them proves that:
 *   1. Each schema accepts the shape GAD documents in spec/openapi.json
 *   2. Each schema rejects the shapes it must reject (so API tests can fail)
 *   3. Future schema changes break loudly here, not silently mid-suite
 *
 * Rule enforced by these tests:
 *   Import `z` and all schemas from @src/utils/schema — never from zod directly.
 *
 * Run with: npm run test:unit
 */
import { test, expect } from '@playwright/test';
import {
  z,
  ArticleSchema,
  ArticlesSchema,
  CommentSchema,
  ErrorMessageSchema,
  HealthSchema,
  IdSchema,
  LabelSchema,
  LoginResponseSchema,
  MalformedJsonErrorSchema,
  UserSchema,
} from '@src/utils/schema';

const validArticle = {
  id: 1,
  user_id: 1,
  title: 'How to write effective test cases',
  body: 'Test cases are the backbone of any testing process.',
  date: '2021-07-13T16:35:00Z',
  image: '.\\data\\images\\256\\image.jpg',
};

// ---------------------------------------------------------------------------
// z re-export — the single import-point rule
// ---------------------------------------------------------------------------
test.describe('z re-export', () => {
  test('z is exported and can build an inline schema', () => {
    const schema = z.object({ name: z.string() });

    expect(schema.safeParse({ name: 'test' }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// IdSchema — OpenAPI oneOf [integer, string]
// ---------------------------------------------------------------------------
test.describe('IdSchema', () => {
  test('accepts an integer and a string', () => {
    expect(IdSchema.safeParse(42).success).toBe(true);
    expect(IdSchema.safeParse('42').success).toBe(true);
  });

  test('rejects a decimal number and null', () => {
    expect(IdSchema.safeParse(1.5).success).toBe(false);
    expect(IdSchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LoginResponseSchema
// ---------------------------------------------------------------------------
test.describe('LoginResponseSchema', () => {
  test('accepts a valid login response', () => {
    const result = LoginResponseSchema.safeParse({ access_token: 'eyJhbGciOiJIUzI1NiJ9' });

    expect(result.success).toBe(true);
  });

  test('rejects the reference-project shape { token }', () => {
    const result = LoginResponseSchema.safeParse({ token: 'eyJhbGciOiJIUzI1NiJ9' });

    expect(result.success).toBe(false);
  });

  test('rejects an empty access_token', () => {
    expect(LoginResponseSchema.safeParse({ access_token: '' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HealthSchema
// ---------------------------------------------------------------------------
test.describe('HealthSchema', () => {
  test('accepts the GAD health report shape', () => {
    const result = HealthSchema.safeParse({
      status: 'OK',
      health: { uptime: 1 },
      dbProblems: [],
      configProblems: [],
      backendProblems: [],
    });

    expect(result.success).toBe(true);
  });

  test('rejects when the problem lists are missing', () => {
    expect(HealthSchema.safeParse({ status: 'OK', health: {} }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ArticleSchema / ArticlesSchema
// ---------------------------------------------------------------------------
test.describe('ArticleSchema', () => {
  test('accepts a valid article', () => {
    expect(ArticleSchema.safeParse(validArticle).success).toBe(true);
  });

  test('accepts an article without the optional image', () => {
    const { image: _image, ...withoutImage } = validArticle;

    expect(ArticleSchema.safeParse(withoutImage).success).toBe(true);
  });

  test('rejects when title is missing', () => {
    const { title: _title, ...withoutTitle } = validArticle;

    expect(ArticleSchema.safeParse(withoutTitle).success).toBe(false);
  });

  test('rejects a date that is not ISO 8601 date-time', () => {
    expect(ArticleSchema.safeParse({ ...validArticle, date: '13/07/2021' }).success).toBe(false);
  });

  test('ArticlesSchema accepts an array and rejects an object', () => {
    expect(ArticlesSchema.safeParse([validArticle]).success).toBe(true);
    expect(ArticlesSchema.safeParse(validArticle).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CommentSchema
// ---------------------------------------------------------------------------
test.describe('CommentSchema', () => {
  test('accepts a valid comment', () => {
    const result = CommentSchema.safeParse({
      id: 1,
      article_id: 1,
      user_id: 3,
      body: 'Great article',
      date: '2021-11-30T14:44:22Z',
    });

    expect(result.success).toBe(true);
  });

  test('rejects when article_id is missing', () => {
    const result = CommentSchema.safeParse({
      id: 1,
      user_id: 3,
      body: 'Great article',
      date: '2021-11-30T14:44:22Z',
    });

    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UserSchema
// ---------------------------------------------------------------------------
test.describe('UserSchema', () => {
  test('accepts a masked user as returned by GET /api/users', () => {
    const result = UserSchema.safeParse({
      id: 1,
      email: '****',
      firstname: 'Moses',
      lastname: '****',
      password: '****',
      avatar: '.\\data\\users\\face.jpg',
      birthDate: '1990-01-01',
    });

    expect(result.success).toBe(true);
  });

  test('rejects when avatar is missing', () => {
    const result = UserSchema.safeParse({ id: 1, email: 'a@b.c', firstname: 'A', lastname: 'B' });

    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LabelSchema
// ---------------------------------------------------------------------------
test.describe('LabelSchema', () => {
  test('accepts a valid label', () => {
    expect(LabelSchema.safeParse({ id: 1, name: 'Testing', user_id: 1 }).success).toBe(true);
  });

  test('rejects when id is a string (contract says number)', () => {
    expect(LabelSchema.safeParse({ id: '1', name: 'Testing', user_id: 1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ErrorMessageSchema
// ---------------------------------------------------------------------------
test.describe('ErrorMessageSchema', () => {
  test('accepts a GAD error envelope', () => {
    const result = ErrorMessageSchema.safeParse({
      error: { message: 'One of mandatory field is missing', details: ['title'] },
    });

    expect(result.success).toBe(true);
  });

  test('error object is populated on failure (safeParse usage demo)', () => {
    const result = ErrorMessageSchema.safeParse({ message: 'flat' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// MalformedJsonErrorSchema
// ---------------------------------------------------------------------------
test.describe('MalformedJsonErrorSchema', () => {
  test('accepts the flat body-parser error GAD returns for malformed JSON', () => {
    const result = MalformedJsonErrorSchema.safeParse({
      error: 'SyntaxError: Unexpected data in JSON. Please check Your JSON.',
      details: '{"title": "x",',
    });

    expect(result.success).toBe(true);
  });

  test('rejects the nested ErrorMessage envelope', () => {
    const result = MalformedJsonErrorSchema.safeParse({
      error: { message: 'Access token not provided!' },
    });

    expect(result.success).toBe(false);
  });
});
