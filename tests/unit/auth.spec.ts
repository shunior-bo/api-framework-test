/**
 * Unit tests for src/utils/auth.ts
 *
 * WHY unit tests here?
 * TokenAuth, BasicAuth and authHeaders are pure utilities — they take inputs and
 * deterministically produce an Authorization header. There is no network, no
 * server, no fixtures needed. Every client in src/api/ builds its auth header
 * through `authHeaders(new TokenAuth(token))`, so a bug here would make EVERY
 * authenticated API test fail for the wrong reason.
 *
 * What we are NOT testing here:
 * - Whether GAD accepts the token (that's an integration test in tests/api/)
 *
 * Run with: npm run test:unit
 */
import { test, expect } from '@playwright/test';
import { type AuthStrategy, authHeaders, BasicAuth, TokenAuth } from '@src/utils/auth';

// ---------------------------------------------------------------------------
// TokenAuth
// ---------------------------------------------------------------------------
test.describe('TokenAuth', () => {
  test('sets Authorization header to "Bearer <token>"', () => {
    const headers: Record<string, string> = {};
    new TokenAuth('my-jwt-token').apply(headers);

    expect(headers['Authorization']).toBe('Bearer my-jwt-token');
  });

  test('overwrites an existing Authorization header', () => {
    const headers: Record<string, string> = { Authorization: 'Bearer old-token' };
    new TokenAuth('new-token').apply(headers);

    expect(headers['Authorization']).toBe('Bearer new-token');
  });

  test('does not mutate other headers', () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    new TokenAuth('abc123').apply(headers);

    expect(headers['Content-Type']).toBe('application/json');
  });

  test('works with an empty string token (edge case)', () => {
    const headers: Record<string, string> = {};
    new TokenAuth('').apply(headers);

    // Still sets the header — rejecting the token is the server's job
    expect(headers['Authorization']).toBe('Bearer ');
  });
});

// ---------------------------------------------------------------------------
// BasicAuth
// ---------------------------------------------------------------------------
test.describe('BasicAuth', () => {
  test('sets Authorization header to "Basic <base64(username:password)>"', () => {
    const headers: Record<string, string> = {};
    new BasicAuth('user', 'pass').apply(headers);

    // "user:pass" in base64 is "dXNlcjpwYXNz"
    expect(headers['Authorization']).toBe('Basic dXNlcjpwYXNz');
  });

  test('handles special characters in password', () => {
    const headers: Record<string, string> = {};
    new BasicAuth('user@example.com', 'p@$$w0rd!').apply(headers);

    const expected = `Basic ${Buffer.from('user@example.com:p@$$w0rd!').toString('base64')}`;
    expect(headers['Authorization']).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// authHeaders — the helper every client uses
// ---------------------------------------------------------------------------
test.describe('authHeaders', () => {
  test('returns a new object containing only the Authorization header', () => {
    const headers = authHeaders(new TokenAuth('tok'));

    expect(headers).toEqual({ Authorization: 'Bearer tok' });
  });

  test('accepts any AuthStrategy implementation (Strategy pattern / LSP)', () => {
    const strategies: AuthStrategy[] = [new TokenAuth('tok'), new BasicAuth('u', 'p')];

    const values = strategies.map((strategy) => authHeaders(strategy)['Authorization']);

    expect(values[0]).toMatch(/^Bearer /);
    expect(values[1]).toMatch(/^Basic /);
  });
});
