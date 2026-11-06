/**
 * Unit tests for src/coverage/RequestRecorder.ts
 *
 * WHY unit tests here?
 * The recorder sits between every API test and GAD. It must (1) never change
 * what the test sees, and (2) never leak secrets into reports/coverage/raw.
 * A typed stub replaces APIRequestContext, so no network is involved.
 *
 * Run with: npm run test:unit
 */
import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { RequestRecorder } from '@src/coverage/RequestRecorder';
import { type RecordContext } from '@src/coverage/types';

/** Values that must never appear in a record. */
const SECRET_TOKEN = 'eyJ.secret.token';
const SECRET_PASSWORD = 'pa55-w0rd!';
const SECRET_QUERY_VALUE = 'top-secret-query';

/** A call observed by the stub. */
interface StubCall {
  method: string;
  url: string;
  options: unknown;
  thisArg: unknown;
}

/**
 * Builds a fake APIResponse.
 *
 * @param url - Final URL.
 * @param status - HTTP status.
 */
function fakeResponse(url: string, status: number): APIResponse {
  return { url: () => url, status: () => status } as unknown as APIResponse;
}

/**
 * Builds a stub APIRequestContext that records how it was called.
 *
 * @param calls - Sink for observed calls.
 * @param failWith - When set, every HTTP method rejects with this error.
 */
function stubContext(calls: StubCall[], failWith?: Error): APIRequestContext {
  const http = (method: string) =>
    async function (this: unknown, url: string, options?: unknown): Promise<APIResponse> {
      calls.push({ method, url, options, thisArg: this });
      if (failWith) throw failWith;
      return fakeResponse(`http://localhost:3000${url}`, method === 'post' ? 201 : 200);
    };
  const stub = {
    get: http('get'),
    post: http('post'),
    put: http('put'),
    patch: http('patch'),
    delete: http('delete'),
    head: http('head'),
    fetch: http('fetch'),
    dispose: async function (this: unknown): Promise<void> {
      calls.push({ method: 'dispose', url: '', options: undefined, thisArg: this });
    },
  };
  return stub as unknown as APIRequestContext;
}

const context: RecordContext = {
  project: 'api',
  file: 'tests/api/articles.spec.ts',
  testId: 'id-1',
  title: 'Articles API > POST /api/articles returns 201',
  phase: 'test',
  baseURL: 'http://localhost:3000',
};

const fixedClock = { now: () => 1000, isoNow: () => '2026-01-01T00:00:00.000Z' };

test.describe('RequestRecorder', () => {
  test(
    'records names only and never header, query or body values',
    { tag: ['@smoke', '@tc-coverage-29'] },
    async () => {
      // --- ARRANGE ---------------------------------------------------------
      const calls: StubCall[] = [];
      const recorder = new RequestRecorder(context, fixedClock);
      const request = recorder.wrap(stubContext(calls));

      // --- ACT -------------------------------------------------------------
      await request.post(`/api/articles?token=${SECRET_TOKEN}`, {
        data: { title: 't', password: SECRET_PASSWORD },
        headers: { Authorization: `Bearer ${SECRET_TOKEN}`, 'X-Trace': 'abc' },
        params: { _limit: 5, secret: SECRET_QUERY_VALUE },
      });
      const records = recorder.drain('passed', 'passed');
      const serialized = JSON.stringify(records);

      // --- ASSERT ----------------------------------------------------------
      expect(records).toEqual([
        {
          v: 1,
          ts: '2026-01-01T00:00:00.000Z',
          project: 'api',
          file: 'tests/api/articles.spec.ts',
          testId: 'id-1',
          title: 'Articles API > POST /api/articles returns 201',
          phase: 'test',
          method: 'POST',
          url: '/api/articles',
          path: '/api/articles',
          query: ['_limit', 'secret', 'token'],
          headers: ['authorization', 'x-trace'],
          bodyKeys: ['password', 'title'],
          status: 201,
          durationMs: 0,
          testStatus: 'passed',
          expectedStatus: 'passed',
        },
      ]);
      for (const secret of [SECRET_TOKEN, SECRET_PASSWORD, SECRET_QUERY_VALUE, 'Bearer', 'abc']) {
        expect(serialized).not.toContain(secret);
      }
    },
  );

  test(
    'returns the original APIResponse and forwards the original arguments',
    { tag: ['@regression', '@tc-coverage-30'] },
    async () => {
      // --- ARRANGE ---------------------------------------------------------
      const calls: StubCall[] = [];
      const stub = stubContext(calls);
      const request = new RequestRecorder(context, fixedClock).wrap(stub);
      const options = { headers: { Authorization: 'Bearer x' } };

      // --- ACT -------------------------------------------------------------
      const response = await request.get('/api/articles/1', options);
      const direct = await stub.get('/api/articles/1');

      // --- ASSERT ----------------------------------------------------------
      expect(response.status()).toBe(direct.status());
      expect(response.url()).toBe('http://localhost:3000/api/articles/1');
      expect(calls[0]).toMatchObject({ method: 'get', url: '/api/articles/1' });
      expect(calls[0]?.options).toBe(options);
      expect(calls[0]?.thisArg).toBe(stub);
    },
  );

  test(
    'fetch takes its method from options and other methods pass through untouched',
    { tag: ['@regression', '@tc-coverage-31'] },
    async () => {
      // --- ARRANGE ---------------------------------------------------------
      const calls: StubCall[] = [];
      const stub = stubContext(calls);
      const recorder = new RequestRecorder(context, fixedClock);
      const request = recorder.wrap(stub);

      // --- ACT -------------------------------------------------------------
      await request.fetch('/api/likes', { method: 'post', data: [1, 2] });
      await request.fetch('/api/likes/1');
      await request.dispose();
      const records = recorder.drain('passed', 'passed');

      // --- ASSERT ----------------------------------------------------------
      expect(records.map((r) => r.method)).toEqual(['POST', 'GET']);
      expect(records[0]?.bodyKeys).toEqual([]); // arrays are not plain objects
      expect(calls.at(-1)).toMatchObject({ method: 'dispose', thisArg: stub });
      expect(records).toHaveLength(2);
    },
  );

  test(
    'a call that throws is recorded with status null and the error is re-thrown',
    { tag: ['@negative', '@tc-coverage-32'] },
    async () => {
      // --- ARRANGE ---------------------------------------------------------
      const failure = new Error('connect ECONNREFUSED');
      failure.name = 'ConnectionError';
      const recorder = new RequestRecorder({ ...context, phase: 'hook' }, fixedClock);
      const request = recorder.wrap(stubContext([], failure));

      // --- ACT -------------------------------------------------------------
      const outcome = request.delete('/api/articles/9?x=1').catch((error: unknown) => error);
      const thrown = await outcome;
      const records = recorder.drain(null, null);

      // --- ASSERT ----------------------------------------------------------
      expect(thrown).toBe(failure);
      expect(records).toEqual([
        expect.objectContaining({
          method: 'DELETE',
          path: '/api/articles/9',
          query: ['x'],
          status: null,
          error: 'ConnectionError',
          phase: 'hook',
          testStatus: null,
        }),
      ]);
    },
  );
});
