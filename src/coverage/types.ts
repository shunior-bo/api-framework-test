/**
 * Shapes shared by the request recorder and the raw-record writer.
 *
 * SOLID: Single Responsibility Principle (SRP) — data shapes only. These types
 *        are the contract of one JSONL line in reports/coverage/raw/; the
 *        coverage CLI (tools/coverage) validates the same shape on its side.
 *
 * Privacy rule: a record holds NAMES only (query names, header names, top-level
 * body keys). It never holds header values, query values, or body values.
 *
 * Must NOT contain behavior, Playwright imports, or Zod schemas.
 */

/**
 * When the request was made:
 * - `test`: inside a test body, `beforeEach` or `afterEach`.
 * - `hook`: inside `beforeAll` / `afterAll` (detected because auto fixtures are
 *   not instantiated for those hooks — see coverage.fixture.ts).
 * - `unknown`: reserved for callers that cannot tell.
 */
export type RequestPhase = 'test' | 'hook' | 'unknown';

/** Test identity attached to every record produced by one recorder. */
export interface RecordContext {
  /** Playwright project name, e.g. "api". */
  project: string;
  /** Spec file relative to the repo root, using forward slashes. */
  file: string;
  /** Playwright test id. For hooks, the id of the adjacent test. */
  testId: string;
  /** Title path joined with " > " (without the file name). */
  title: string;
  /** See `RequestPhase`. */
  phase: RequestPhase;
  /** Base URL used to resolve relative URLs when a call throws before responding. */
  baseURL?: string;
}

/** One recorded HTTP request — exactly one JSONL line. */
export interface RecordedRequest {
  /** Record format version. */
  v: 1;
  /** ISO-8601 time when the request started. */
  ts: string;
  project: string;
  file: string;
  testId: string;
  title: string;
  phase: RequestPhase;
  /** Upper-case HTTP method. */
  method: string;
  /** URL as passed by the client, without its query string. */
  url: string;
  /** Decoded path of the final URL (no origin, no query), e.g. "/api/articles/1". */
  path: string;
  /** Sorted, unique query parameter NAMES (from the URL and `options.params`). */
  query: string[];
  /** Sorted, unique, lower-cased NAMES of headers passed explicitly in options. */
  headers: string[];
  /** Sorted top-level keys of `options.data` when it is a plain object. */
  bodyKeys: string[];
  /** HTTP status, or null when the call threw (timeout, connection refused…). */
  status: number | null;
  /** Error name when the call threw, e.g. "Error" or "TimeoutError". */
  error?: string;
  /** Wall-clock duration of the call in whole milliseconds. */
  durationMs: number;
  /** `testInfo.status` at fixture teardown; null for hooks. */
  testStatus: string | null;
  /** `testInfo.expectedStatus` at fixture teardown; null for hooks. */
  expectedStatus: string | null;
}

/** A record before the test outcome is known (buffered by the recorder). */
export type PendingRecord = Omit<RecordedRequest, 'testStatus' | 'expectedStatus'>;
