/**
 * Records every HTTP call made through a Playwright `APIRequestContext`.
 *
 * Pattern: Proxy — `wrap()` returns a transparent proxy of the context. The
 *          HTTP methods (`get`, `post`, `put`, `patch`, `delete`, `head`,
 *          `fetch`) are intercepted; everything else (`dispose`,
 *          `storageState`, …) passes through untouched.
 *
 * SOLID: Single Responsibility Principle (SRP) — this class only observes
 *        calls and buffers records. Writing them to disk is recordWriter.ts.
 * SOLID: Open/Closed Principle (OCP) — clients and specs are unaware of it:
 *        the coverage fixture swaps the `request` fixture for the proxy.
 *
 * Guarantees:
 *   - The original `APIResponse` is returned unchanged.
 *   - A call that throws is recorded with `status: null` + `error`, then re-thrown.
 *   - Only NAMES are recorded (query names, header names, top-level body keys).
 *     Header values, query values and bodies are never read into a record.
 *
 * Must NOT: perform assertions, read environment variables, write files, or
 *           alter requests/responses.
 */
import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { type PendingRecord, type RecordContext, type RecordedRequest } from '@src/coverage/types';

/** HTTP methods of APIRequestContext that are recorded. */
const RECORDED_METHODS: ReadonlySet<string> = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'fetch',
]);

/** Subset of Playwright request options the recorder inspects (names only). */
interface InspectedOptions {
  method?: string;
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean> | URLSearchParams | string;
  data?: unknown;
}

/** Signature shared by every recorded APIRequestContext method. */
type HttpMethod = (urlOrRequest: unknown, options?: InspectedOptions) => Promise<APIResponse>;

/** Clock functions, injectable for deterministic unit tests. */
export interface RecorderClock {
  /** Monotonic milliseconds, used for durations. */
  now: () => number;
  /** Current time as ISO-8601, used for `ts`. */
  isoNow: () => string;
}

const systemClock: RecorderClock = {
  now: () => performance.now(),
  isoNow: () => new Date().toISOString(),
};

/**
 * Returns true for `{ … }` objects (not arrays, buffers, strings or class instances).
 *
 * @param value - Any value.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Sorts and de-duplicates a list of names.
 *
 * @param names - Names in any order.
 */
function sortedUnique(names: Iterable<string>): string[] {
  return [...new Set(names)].sort();
}

/**
 * Decodes each path segment; keeps the raw segment if it is malformed.
 *
 * @param pathname - URL pathname, e.g. "/api/users/a%20b".
 */
function decodePath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

/**
 * Extracts the URL string from `fetch(urlOrRequest)`, which also accepts a Request.
 *
 * @param urlOrRequest - A URL string or a Playwright `Request`.
 */
function toUrlString(urlOrRequest: unknown): string {
  if (typeof urlOrRequest === 'string') return urlOrRequest;
  if (
    urlOrRequest !== null &&
    typeof urlOrRequest === 'object' &&
    'url' in urlOrRequest &&
    typeof urlOrRequest.url === 'function'
  ) {
    return String(urlOrRequest.url());
  }
  return String(urlOrRequest);
}

/**
 * Resolves the HTTP method for a recorded call.
 *
 * @param methodName - The APIRequestContext method that was called.
 * @param urlOrRequest - First argument (a Request carries its own method for `fetch`).
 * @param options - Request options (`fetch` reads `options.method`).
 */
function resolveMethod(
  methodName: string,
  urlOrRequest: unknown,
  options: InspectedOptions | undefined,
): string {
  if (methodName !== 'fetch') return methodName.toUpperCase();
  if (options?.method) return options.method.toUpperCase();
  if (
    urlOrRequest !== null &&
    typeof urlOrRequest === 'object' &&
    'method' in urlOrRequest &&
    typeof urlOrRequest.method === 'function'
  ) {
    return String(urlOrRequest.method()).toUpperCase();
  }
  return 'GET';
}

/**
 * Collects query parameter names from a parsed URL and from `options.params`.
 *
 * @param url - The parsed request URL (may be null if unparsable).
 * @param params - `options.params` in any of its accepted forms.
 */
function queryNames(url: URL | null, params: InspectedOptions['params']): string[] {
  const names: string[] = url ? [...url.searchParams.keys()] : [];
  if (typeof params === 'string') {
    names.push(...new URLSearchParams(params).keys());
  } else if (params instanceof URLSearchParams) {
    names.push(...params.keys());
  } else if (params) {
    names.push(...Object.keys(params));
  }
  return sortedUnique(names);
}

/**
 * Buffers one record per HTTP call made through the wrapped context.
 */
export class RequestRecorder {
  private readonly context: RecordContext;
  private readonly clock: RecorderClock;
  private readonly pending: PendingRecord[] = [];

  /**
   * @param context - Test identity attached to every record.
   * @param clock - Time source; defaults to the system clock.
   */
  constructor(context: RecordContext, clock: RecorderClock = systemClock) {
    this.context = context;
    this.clock = clock;
  }

  /**
   * Returns a proxy of `request` that records every HTTP call.
   *
   * @param request - The real Playwright APIRequestContext.
   * @returns A drop-in replacement for `request`.
   */
  wrap(request: APIRequestContext): APIRequestContext {
    return new Proxy(request, {
      get: (target, prop) => {
        const value: unknown = Reflect.get(target, prop, target);
        if (typeof value !== 'function') return value;
        const bound = (value as (...args: unknown[]) => unknown).bind(target);
        if (typeof prop === 'string' && RECORDED_METHODS.has(prop)) {
          return (urlOrRequest: unknown, options?: InspectedOptions) =>
            this.record(prop, bound as HttpMethod, urlOrRequest, options);
        }
        return bound;
      },
    });
  }

  /**
   * Returns the buffered records, stamped with the test outcome, and clears the buffer.
   *
   * @param testStatus - `testInfo.status` (null for hooks).
   * @param expectedStatus - `testInfo.expectedStatus` (null for hooks).
   */
  drain(testStatus: string | null, expectedStatus: string | null): RecordedRequest[] {
    const records = this.pending.map((record) => ({ ...record, testStatus, expectedStatus }));
    this.pending.length = 0;
    return records;
  }

  /**
   * Performs the real call and buffers a record of it.
   *
   * @param methodName - Intercepted method name.
   * @param call - The real, bound method.
   * @param urlOrRequest - First argument passed by the client.
   * @param options - Second argument passed by the client.
   */
  private async record(
    methodName: string,
    call: HttpMethod,
    urlOrRequest: unknown,
    options: InspectedOptions | undefined,
  ): Promise<APIResponse> {
    const ts = this.clock.isoNow();
    const started = this.clock.now();
    const rawUrl = toUrlString(urlOrRequest);
    const base: Omit<PendingRecord, 'path' | 'query' | 'status' | 'durationMs'> = {
      v: 1,
      ts,
      project: this.context.project,
      file: this.context.file,
      testId: this.context.testId,
      title: this.context.title,
      phase: this.context.phase,
      method: resolveMethod(methodName, urlOrRequest, options),
      url: rawUrl.split('?')[0] ?? rawUrl,
      headers: sortedUnique(Object.keys(options?.headers ?? {}).map((h) => h.toLowerCase())),
      bodyKeys: isPlainObject(options?.data) ? Object.keys(options.data).sort() : [],
    };

    try {
      const response = await call(urlOrRequest, options);
      const finalUrl = this.parseUrl(response.url());
      this.pending.push({
        ...base,
        path: finalUrl ? decodePath(finalUrl.pathname) : base.url,
        query: queryNames(finalUrl ?? this.parseUrl(rawUrl), options?.params),
        status: response.status(),
        durationMs: Math.round(this.clock.now() - started),
      });
      return response;
    } catch (error) {
      const requestedUrl = this.parseUrl(rawUrl);
      this.pending.push({
        ...base,
        path: requestedUrl ? decodePath(requestedUrl.pathname) : base.url,
        query: queryNames(requestedUrl, options?.params),
        status: null,
        error: error instanceof Error ? error.name : 'UnknownError',
        durationMs: Math.round(this.clock.now() - started),
      });
      throw error;
    }
  }

  /**
   * Parses a possibly relative URL against the context's base URL.
   *
   * @param url - Absolute or relative URL.
   * @returns The parsed URL, or null when it cannot be parsed.
   */
  private parseUrl(url: string): URL | null {
    try {
      return new URL(url, this.context.baseURL ?? 'http://localhost');
    } catch {
      return null;
    }
  }
}
