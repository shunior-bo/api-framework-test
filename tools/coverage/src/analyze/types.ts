/**
 * Shapes of the coverage report (coverage.json) and the gap list (gaps.json).
 *
 * These are public contracts consumed by CI (Day 3) and agents (Day 3/4).
 * Bump `schemaVersion` on any breaking change.
 */
import type { ParameterLocation, SpecWarning } from '../spec/types.ts';

/** covered / total / pct (pct is null when total is 0). */
export interface Ratio {
  covered: number;
  total: number;
  pct: number | null;
}

/** Parameter totals with the required/optional split. */
export interface ParameterRatio extends Ratio {
  required: Ratio;
  optional: Ratio;
}

/** Totals of the three dimensions. */
export interface DimensionTotals {
  operations: Ratio;
  statuses: Ratio;
  parameters: ParameterRatio;
}

/** Coverage of one documented status code. */
export interface StatusCoverage {
  /** "200", "2XX" or "default". */
  code: string;
  /** For "default": true when a code not documented explicitly was received. */
  covered: boolean;
  /** False only for "default", which is reported but not counted in totals. */
  counted: boolean;
}

/** Coverage of one parameter. */
export interface ParameterCoverage {
  name: string;
  in: ParameterLocation;
  required: boolean;
  declared: boolean;
  covered: boolean;
}

/** Per-operation coverage detail. */
export interface OperationCoverage {
  key: string;
  method: string;
  path: string;
  operationId: string | null;
  tags: string[];
  covered: boolean;
  requestCount: number;
  statuses: StatusCoverage[];
  parameters: ParameterCoverage[];
  /** Received status → count ("error" for calls that threw). Keys sorted. */
  observedStatuses: Record<string, number>;
  /** "file > title" of tests that exercised the operation (sorted, unique). */
  tests: string[];
}

/** An operation removed from the denominators by configuration. */
export interface ExcludedOperation {
  key: string;
  reason: string;
  /** Counted requests that hit it anyway. */
  requestCount: number;
}

/** Aggregated request that did not match a documented operation. */
export interface UnmatchedRequest {
  method: string;
  /** Full request path (with base path), decoded, no trailing slash. */
  path: string;
  reason: 'path-not-documented' | 'method-not-documented';
  /** Matched template for "method-not-documented". */
  template: string | null;
  count: number;
  /** Phases seen ("hook", "test", …), sorted. */
  phases: string[];
}

/** A received status that the operation does not document (spec drift). */
export interface UndocumentedStatus {
  key: string;
  status: string;
  count: number;
}

/** Anything worth reporting that is not a coverage unit. */
export interface Extras {
  unmatched: UnmatchedRequest[];
  ignoredUnmatched: UnmatchedRequest[];
  undocumentedStatuses: UndocumentedStatus[];
  specWarnings: SpecWarning[];
  configWarnings: string[];
  invalidRecordLines: { file: string; line: number; reason: string }[];
}

/** Request counts shown in the report header. */
export interface RequestCounts {
  /** All valid records. */
  recorded: number;
  /** Records that count toward coverage with the current options. */
  counted: number;
  /** Records made in beforeAll/afterAll. */
  hooks: number;
  /** Records excluded by --only-passed. */
  filteredByOutcome: number;
  /** Records (any phase) that matched no documented operation and are not ignored. */
  unmatched: number;
}

/** The full coverage.json document. */
export interface CoverageReport {
  schemaVersion: 1;
  generatedAt: string;
  tool: { name: string; version: string };
  source: {
    spec: { path: string; title: string; version: string; sha256: string };
    records: { dir: string; files: number; lines: number; invalidLines: number };
    git: { sha: string | null; branch: string | null };
  };
  options: { includeHooks: boolean; onlyPassed: boolean; configPath: string };
  requests: RequestCounts;
  totals: DimensionTotals;
  byTag: Record<string, DimensionTotals>;
  operations: OperationCoverage[];
  excluded: ExcludedOperation[];
  extras: Extras;
}

/** Gap priority. */
export type GapPriority = 'high' | 'medium' | 'low';

/** One gap in gaps.json. */
export interface Gap {
  /** Stable unique id, e.g. "status:POST /articles:422". */
  id: string;
  type: 'operation' | 'status' | 'parameter';
  priority: GapPriority;
  method: string;
  path: string;
  operationId: string | null;
  tags: string[];
  status?: string;
  parameter?: { name: string; in: ParameterLocation; required: boolean };
  pending?: {
    statuses: string[];
    parameters: { name: string; in: ParameterLocation; required: boolean }[];
  };
  hint: string;
}

/** The full gaps.json document. */
export interface GapsReport {
  schemaVersion: 1;
  generatedAt: string;
  spec: { path: string; sha256: string };
  summary: { total: number; high: number; medium: number; low: number };
  gaps: Gap[];
}
