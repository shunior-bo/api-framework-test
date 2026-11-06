/**
 * Deterministic ordering helpers shared by every module of the tool.
 *
 * Every array the tool emits is sorted with these comparators, so the same
 * input always produces byte-identical output. Strings are compared by code
 * unit (`<`), never with `localeCompare`, which depends on the host locale.
 */

/** Fixed method order used for sorting operations and gaps. */
export const METHOD_ORDER: readonly string[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TRACE',
];

/** OpenAPI operation keys inside a path item, in lower case. */
export const HTTP_METHODS: readonly string[] = METHOD_ORDER.map((m) => m.toLowerCase());

/** Fixed parameter location order. */
export const PARAM_IN_ORDER: readonly string[] = ['path', 'query', 'header', 'cookie'];

/**
 * Locale-independent string comparison.
 *
 * @param a - First string.
 * @param b - Second string.
 */
export function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Compares HTTP methods by `METHOD_ORDER`; unknown methods sort last, alphabetically.
 *
 * @param a - Upper-case method.
 * @param b - Upper-case method.
 */
export function compareMethods(a: string, b: string): number {
  const ia = METHOD_ORDER.indexOf(a);
  const ib = METHOD_ORDER.indexOf(b);
  const ra = ia === -1 ? METHOD_ORDER.length : ia;
  const rb = ib === -1 ? METHOD_ORDER.length : ib;
  return ra !== rb ? ra - rb : compareStrings(a, b);
}

/**
 * Compares response codes: exact codes numerically, then ranges (`2XX`), then `default`.
 *
 * @param a - Response code key from the spec.
 * @param b - Response code key from the spec.
 */
export function compareStatusCodes(a: string, b: string): number {
  const rank = (code: string): number => {
    if (/^\d{3}$/.test(code)) return Number(code);
    if (/^[1-5]XX$/i.test(code)) return 1000 + Number(code[0]);
    return 2000;
  };
  const diff = rank(a) - rank(b);
  return diff !== 0 ? diff : compareStrings(a, b);
}

/**
 * Compares parameter locations by `PARAM_IN_ORDER`.
 *
 * @param a - Parameter `in` value.
 * @param b - Parameter `in` value.
 */
export function compareParamIn(a: string, b: string): number {
  const ia = PARAM_IN_ORDER.indexOf(a);
  const ib = PARAM_IN_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || compareStrings(a, b);
}

/**
 * Builds the stable operation key, e.g. "POST /articles".
 *
 * @param method - Upper-case method.
 * @param path - Template path relative to the server base path.
 */
export function operationKey(method: string, path: string): string {
  return `${method} ${path}`;
}

/**
 * Rounds a ratio to a percentage with 2 decimals; null when the total is 0.
 *
 * @param covered - Covered units.
 * @param total - Total units.
 */
export function percent(covered: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((covered / total) * 10000) / 100;
}
