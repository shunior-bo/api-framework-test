/**
 * Reads the raw JSONL request records written by the framework's recorder.
 *
 * Every `*.jsonl` file in the directory is read in file-name order. Each
 * non-empty line must be a JSON object of record format v1; anything else is
 * reported in `invalid` (file, line number, reason) and ignored — one corrupt
 * line never aborts the analysis.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { InputError } from '../shared/errors.ts';
import { compareStrings } from '../shared/order.ts';

/** When the request was made (see src/coverage/types.ts in the framework). */
export type RecordPhase = 'test' | 'hook' | 'unknown';

/** One validated request record. Mirrors the framework's RecordedRequest v1. */
export interface RequestRecord {
  v: 1;
  file: string;
  title: string;
  testId: string;
  phase: RecordPhase;
  method: string;
  path: string;
  query: string[];
  headers: string[];
  status: number | null;
  testStatus: string | null;
  expectedStatus: string | null;
}

/** A line that could not be used. */
export interface InvalidLine {
  /** File name (relative to the records directory). */
  file: string;
  /** 1-based line number. */
  line: number;
  /** Why the line was rejected. */
  reason: string;
}

/** Result of loading a records directory. */
export interface LoadedRecords {
  /** Directory as given. */
  dir: string;
  /** Number of JSONL files read. */
  files: number;
  /** Number of non-empty lines read. */
  lines: number;
  /** Valid records, in file then line order. */
  records: RequestRecord[];
  /** Rejected lines. */
  invalid: InvalidLine[];
}

const PHASES: ReadonlySet<string> = new Set(['test', 'hook', 'unknown']);

/**
 * @param value - Any value.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * @param value - Any value.
 */
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/**
 * Validates one parsed line.
 *
 * @param value - Parsed JSON value.
 * @returns The record, or a string describing the first problem found.
 */
export function validateRecord(value: unknown): RequestRecord | string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'not an object';
  const r = value as Record<string, unknown>;
  if (r.v !== 1) return `unsupported record version ${JSON.stringify(r.v)}`;
  if (typeof r.method !== 'string' || r.method === '') return 'missing "method"';
  if (typeof r.path !== 'string' || !r.path.startsWith('/')) return 'missing or relative "path"';
  if (!(r.status === null || (typeof r.status === 'number' && Number.isInteger(r.status)))) {
    return 'invalid "status"';
  }
  if (typeof r.phase !== 'string' || !PHASES.has(r.phase)) return 'invalid "phase"';
  if (!isStringArray(r.query)) return 'invalid "query"';
  if (!isStringArray(r.headers)) return 'invalid "headers"';
  if (typeof r.file !== 'string' || typeof r.title !== 'string') return 'missing "file"/"title"';
  if (!isNullableString(r.testStatus) || !isNullableString(r.expectedStatus)) {
    return 'invalid "testStatus"/"expectedStatus"';
  }
  return {
    v: 1,
    file: r.file,
    title: r.title,
    testId: typeof r.testId === 'string' ? r.testId : '',
    phase: r.phase as RecordPhase,
    method: r.method.toUpperCase(),
    path: r.path,
    query: r.query,
    headers: r.headers.map((h) => h.toLowerCase()),
    status: r.status as number | null,
    testStatus: r.testStatus,
    expectedStatus: r.expectedStatus,
  };
}

/**
 * Parses JSONL text.
 *
 * @param text - File content.
 * @param fileName - Name used in invalid-line reports.
 */
export function parseRecords(
  text: string,
  fileName: string,
): { records: RequestRecord[]; invalid: InvalidLine[]; lines: number } {
  const records: RequestRecord[] = [];
  const invalid: InvalidLine[] = [];
  let lines = 0;
  text.split(/\r?\n/).forEach((raw, index) => {
    if (raw.trim() === '') return;
    lines += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      invalid.push({ file: fileName, line: index + 1, reason: 'invalid JSON' });
      return;
    }
    const result = validateRecord(parsed);
    if (typeof result === 'string') {
      invalid.push({ file: fileName, line: index + 1, reason: result });
    } else {
      records.push(result);
    }
  });
  return { records, invalid, lines };
}

/**
 * Loads every `*.jsonl` file of a directory.
 *
 * @param dir - Records directory.
 * @throws InputError when the directory is missing or holds no valid record.
 */
export function loadRecords(dir: string): LoadedRecords {
  const hint = 'Run `npm run test:api` first (with GAD running) to record requests.';
  let names: string[];
  try {
    if (!statSync(dir).isDirectory()) throw new Error('not a directory');
    names = readdirSync(dir)
      .filter((name) => name.endsWith('.jsonl'))
      .sort(compareStrings);
  } catch {
    throw new InputError(`Records directory "${dir}" does not exist. ${hint}`);
  }
  if (names.length === 0) throw new InputError(`No *.jsonl records in "${dir}". ${hint}`);

  const result: LoadedRecords = { dir, files: names.length, lines: 0, records: [], invalid: [] };
  for (const name of names) {
    const parsed = parseRecords(readFileSync(join(dir, name), 'utf8'), name);
    result.lines += parsed.lines;
    result.records.push(...parsed.records);
    result.invalid.push(...parsed.invalid);
  }
  if (result.records.length === 0) {
    throw new InputError(
      `No valid records in "${dir}" (${result.invalid.length} invalid lines). ${hint}`,
    );
  }
  return result;
}
