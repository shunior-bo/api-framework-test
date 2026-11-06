/**
 * Loads and validates coverage.config.json.
 *
 * {
 *   "excludeOperations": [{ "method": "GET", "path": "/debug/exit", "reason": "…" }],
 *   "ignoreUnmatched":   ["/api/config/**"]
 * }
 *
 * - `excludeOperations[].path` is a template path relative to the base path.
 *   A non-empty `reason` is mandatory.
 * - `ignoreUnmatched` globs are matched against the FULL request path (with the
 *   base path). `*` matches within one segment, `**` matches across segments.
 */
import { readFileSync } from 'node:fs';
import { InputError } from '../shared/errors.ts';

/** One excluded operation. */
export interface Exclusion {
  method: string;
  path: string;
  reason: string;
}

/** Validated configuration. */
export interface CoverageConfig {
  /** Config path as given ("(none)" when defaults are used). */
  path: string;
  excludeOperations: Exclusion[];
  ignoreUnmatched: string[];
}

/** Configuration used when no file is given. */
export const EMPTY_CONFIG: CoverageConfig = {
  path: '(none)',
  excludeOperations: [],
  ignoreUnmatched: [],
};

/**
 * Validates a parsed config object.
 *
 * @param value - Parsed JSON.
 * @param configPath - Path used in messages.
 */
export function parseConfig(value: unknown, configPath: string): CoverageConfig {
  const fail = (what: string): never => {
    throw new InputError(`Invalid coverage config "${configPath}": ${what}.`);
  };
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('expected an object');
  const obj = value as Record<string, unknown>;
  const allowed = new Set(['$comment', 'excludeOperations', 'ignoreUnmatched']);
  for (const key of Object.keys(obj)) if (!allowed.has(key)) fail(`unknown key "${key}"`);

  const rawExclusions = obj.excludeOperations ?? [];
  if (!Array.isArray(rawExclusions)) fail('"excludeOperations" must be an array');
  const excludeOperations = (rawExclusions as unknown[]).map((item, i) => {
    const e = (item ?? {}) as Record<string, unknown>;
    if (typeof e.method !== 'string' || typeof e.path !== 'string') {
      fail(`excludeOperations[${i}] needs "method" and "path"`);
    }
    if (typeof e.reason !== 'string' || e.reason.trim() === '') {
      fail(
        `excludeOperations[${i}] (${String(e.method)} ${String(e.path)}) needs a non-empty "reason"`,
      );
    }
    return {
      method: String(e.method).toUpperCase(),
      path: String(e.path),
      reason: String(e.reason).trim(),
    };
  });

  const rawIgnore = obj.ignoreUnmatched ?? [];
  if (!Array.isArray(rawIgnore) || !rawIgnore.every((g) => typeof g === 'string')) {
    fail('"ignoreUnmatched" must be an array of strings');
  }
  return { path: configPath, excludeOperations, ignoreUnmatched: rawIgnore as string[] };
}

/**
 * Reads a config file.
 *
 * @param configPath - Path to coverage.config.json.
 */
export function loadConfig(configPath: string): CoverageConfig {
  let text: string;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch {
    throw new InputError(`Cannot read coverage config "${configPath}". Pass --config <file>.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InputError(`Coverage config "${configPath}" is not valid JSON.`);
  }
  return parseConfig(parsed, configPath);
}

/**
 * Compiles a path glob into a RegExp (`**` = any characters, `*` = within a segment).
 *
 * @param glob - Glob such as "/api/config/**".
 */
export function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i] ?? '';
    if (ch === '*' && glob[i + 1] === '*') {
      pattern += '.*';
      i += 1;
    } else if (ch === '*') {
      pattern += '[^/]*';
    } else {
      pattern += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${pattern}$`);
}
