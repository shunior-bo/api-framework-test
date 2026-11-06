/**
 * Maps a concrete request (method + URL path) to a spec operation.
 *
 * Rules:
 *  1. Strip the base path (servers[0].url, e.g. "/api"). A path outside the base
 *     path is unmatched ("path-not-documented").
 *  2. Collapse a trailing slash and URL-decode each segment.
 *  3. A template matches when it has the same number of segments, every literal
 *     segment is equal, and every `{var}` segment is non-empty.
 *  4. Specificity: most literal segments wins; ties are broken left to right
 *     (a literal beats a variable at the first differing position); a final
 *     tie falls back to plain string order of the templates. Deterministic.
 *  5. Matching is path-first, as in OpenAPI: the most specific path is chosen,
 *     then the method is looked up. If that path does not document the method,
 *     the request is unmatched ("method-not-documented").
 */
import { compareStrings } from '../shared/order.ts';
import type { Operation } from '../spec/types.ts';

/** One segment of a compiled template. */
interface Segment {
  /** Literal text, or null for a `{var}` segment. */
  literal: string | null;
}

/** A template path compiled for matching. */
export interface CompiledTemplate {
  /** Template path, e.g. "/articles/{id}". */
  path: string;
  /** Compiled segments. */
  segments: Segment[];
  /** Number of literal segments. */
  literalCount: number;
  /** Operations of this path, keyed by upper-case method. */
  operations: Map<string, Operation>;
}

/** Result of matching one request. */
export type MatchResult =
  | { kind: 'matched'; operation: Operation; relativePath: string }
  | {
      kind: 'unmatched';
      reason: 'path-not-documented' | 'method-not-documented';
      relativePath: string;
      template: string | null;
    };

/**
 * Splits a path into decoded segments after normalizing the trailing slash.
 *
 * @param path - A path such as "/articles/1/".
 */
export function splitPath(path: string): string[] {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return trimmed
    .split('/')
    .slice(1)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

/**
 * Removes the base path prefix.
 *
 * @param path - Request path, e.g. "/api/articles/1".
 * @param basePath - Base path without trailing slash, e.g. "/api" ("" for none).
 * @returns The relative path ("/articles/1"), or null when outside the base path.
 */
export function stripBasePath(path: string, basePath: string): string | null {
  const clean = path.split('?')[0] ?? path;
  if (!basePath) return clean || '/';
  if (clean === basePath || clean === `${basePath}/`) return '/';
  if (clean.startsWith(`${basePath}/`)) return clean.slice(basePath.length);
  return null;
}

/**
 * Normalizes a relative path for reporting: decoded segments, no trailing slash.
 *
 * @param path - Relative path.
 */
export function normalizePath(path: string): string {
  return `/${splitPath(path).join('/')}`;
}

/**
 * Compares two templates by specificity (most specific first).
 *
 * @param a - Compiled template.
 * @param b - Compiled template.
 */
export function compareSpecificity(a: CompiledTemplate, b: CompiledTemplate): number {
  if (a.literalCount !== b.literalCount) return b.literalCount - a.literalCount;
  for (let i = 0; i < Math.min(a.segments.length, b.segments.length); i += 1) {
    const aLiteral = a.segments[i]?.literal !== null;
    const bLiteral = b.segments[i]?.literal !== null;
    if (aLiteral !== bLiteral) return aLiteral ? -1 : 1;
  }
  return compareStrings(a.path, b.path);
}

/**
 * Indexes the spec operations for fast, deterministic matching.
 */
export class PathMatcher {
  private readonly basePath: string;
  private readonly byLength = new Map<number, CompiledTemplate[]>();

  /**
   * @param operations - All spec operations.
   * @param basePath - Server base path without trailing slash.
   */
  constructor(operations: readonly Operation[], basePath: string) {
    this.basePath = basePath;
    const templates = new Map<string, CompiledTemplate>();
    for (const op of operations) {
      let template = templates.get(op.path);
      if (!template) {
        const segments = splitPath(op.path).map((s) => ({
          literal: /^\{[^}]+\}$/.test(s) ? null : s,
        }));
        template = {
          path: op.path,
          segments,
          literalCount: segments.filter((s) => s.literal !== null).length,
          operations: new Map(),
        };
        templates.set(op.path, template);
      }
      template.operations.set(op.method, op);
    }
    for (const template of templates.values()) {
      const list = this.byLength.get(template.segments.length) ?? [];
      list.push(template);
      this.byLength.set(template.segments.length, list);
    }
    for (const list of this.byLength.values()) list.sort(compareSpecificity);
  }

  /**
   * Finds the most specific template matching a relative path.
   *
   * @param relativePath - Path without the base path.
   */
  matchTemplate(relativePath: string): CompiledTemplate | null {
    const segments = splitPath(relativePath);
    const candidates = this.byLength.get(segments.length) ?? [];
    for (const template of candidates) {
      const ok = template.segments.every((seg, i) => {
        const actual = segments[i] ?? '';
        return seg.literal === null ? actual.length > 0 : seg.literal === actual;
      });
      if (ok) return template;
    }
    return null;
  }

  /**
   * Matches a recorded request.
   *
   * @param method - HTTP method (any case).
   * @param requestPath - Full request path including the base path, e.g. "/api/articles/1".
   */
  match(method: string, requestPath: string): MatchResult {
    const relative = stripBasePath(requestPath, this.basePath);
    if (relative === null) {
      return {
        kind: 'unmatched',
        reason: 'path-not-documented',
        relativePath: normalizePath(requestPath),
        template: null,
      };
    }
    const relativePath = normalizePath(relative);
    const template = this.matchTemplate(relativePath);
    if (!template) {
      return { kind: 'unmatched', reason: 'path-not-documented', relativePath, template: null };
    }
    const operation = template.operations.get(method.toUpperCase());
    if (!operation) {
      return {
        kind: 'unmatched',
        reason: 'method-not-documented',
        relativePath,
        template: template.path,
      };
    }
    return { kind: 'matched', operation, relativePath };
  }
}
