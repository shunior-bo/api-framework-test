/**
 * Computes coverage in three dimensions — operations, documented statuses and
 * parameters — plus spec-drift extras. Pure function: no I/O, no clock, no env.
 *
 * Counted requests (coverage units):
 *   - phase !== "hook", unless `includeHooks`;
 *   - with `onlyPassed`, a non-hook request counts only when its test ended as
 *     expected (testStatus === expectedStatus). Hook requests are not filtered
 *     by `onlyPassed` (they have no test outcome).
 * Extras (unmatched, undocumented statuses) describe ALL recorded traffic,
 * regardless of the counting options, because they report spec drift.
 */
import type { CoverageConfig } from './config.ts';
import { globToRegExp } from './config.ts';
import { normalizePath, PathMatcher } from '../match/pathMatcher.ts';
import type { RequestRecord } from '../records/loadRecords.ts';
import {
  compareMethods,
  compareStatusCodes,
  compareStrings,
  operationKey,
  percent,
} from '../shared/order.ts';
import type { LoadedSpec, Operation } from '../spec/types.ts';
import type {
  DimensionTotals,
  ExcludedOperation,
  Extras,
  OperationCoverage,
  ParameterCoverage,
  Ratio,
  RequestCounts,
  StatusCoverage,
  UndocumentedStatus,
  UnmatchedRequest,
} from './types.ts';

/** Options that change which requests count. */
export interface AnalyzeOptions {
  includeHooks: boolean;
  onlyPassed: boolean;
}

/** Result of `analyzeCoverage` (everything except metadata). */
export interface CoverageAnalysis {
  requests: RequestCounts;
  totals: DimensionTotals;
  byTag: Record<string, DimensionTotals>;
  operations: OperationCoverage[];
  excluded: ExcludedOperation[];
  extras: Omit<Extras, 'invalidRecordLines'>;
  /** Spec operations that are in scope (not excluded), sorted. */
  inScope: Operation[];
}

/** Tag name used for operations without tags. */
export const UNTAGGED = '(untagged)';

/**
 * Decides whether a record counts toward coverage.
 *
 * @param record - A request record.
 * @param options - Counting options.
 */
export function isCounted(record: RequestRecord, options: AnalyzeOptions): boolean {
  if (record.phase === 'hook') return options.includeHooks;
  if (!options.onlyPassed) return true;
  return record.testStatus !== null && record.testStatus === record.expectedStatus;
}

/**
 * True when a documented response key covers a received status.
 *
 * @param documented - "200", "2XX" (ranges) — "default" is handled separately.
 * @param received - Received HTTP status.
 */
export function codeMatches(documented: string, received: number): boolean {
  if (/^\d{3}$/.test(documented)) return Number(documented) === received;
  if (/^[1-5]XX$/.test(documented)) return Math.floor(received / 100) === Number(documented[0]);
  return false;
}

/**
 * Builds a ratio.
 *
 * @param covered - Covered units.
 * @param total - Total units.
 */
function ratio(covered: number, total: number): Ratio {
  return { covered, total, pct: percent(covered, total) };
}

/**
 * Sums the three dimensions over a list of operation coverages.
 *
 * @param ops - Operation coverages.
 */
export function sumTotals(ops: readonly OperationCoverage[]): DimensionTotals {
  let opsCovered = 0;
  let stCovered = 0;
  let stTotal = 0;
  const params = { covered: 0, total: 0, reqCovered: 0, reqTotal: 0, optCovered: 0, optTotal: 0 };
  for (const op of ops) {
    if (op.covered) opsCovered += 1;
    for (const st of op.statuses) {
      if (!st.counted) continue;
      stTotal += 1;
      if (st.covered) stCovered += 1;
    }
    for (const p of op.parameters) {
      params.total += 1;
      if (p.covered) params.covered += 1;
      if (p.required) {
        params.reqTotal += 1;
        if (p.covered) params.reqCovered += 1;
      } else {
        params.optTotal += 1;
        if (p.covered) params.optCovered += 1;
      }
    }
  }
  return {
    operations: ratio(opsCovered, ops.length),
    statuses: ratio(stCovered, stTotal),
    parameters: {
      ...ratio(params.covered, params.total),
      required: ratio(params.reqCovered, params.reqTotal),
      optional: ratio(params.optCovered, params.optTotal),
    },
  };
}

/** Mutable per-operation accumulator. */
interface Accumulator {
  requestCount: number;
  observed: Map<string, number>;
  queryNames: Set<string>;
  headerNames: Set<string>;
  tests: Set<string>;
}

/** Mutable aggregate for unmatched requests. */
interface UnmatchedAccumulator {
  method: string;
  path: string;
  reason: UnmatchedRequest['reason'];
  template: string | null;
  count: number;
  phases: Set<string>;
}

/**
 * Sorts and freezes unmatched aggregates.
 *
 * @param map - Aggregates keyed by method+path+reason.
 */
function finishUnmatched(map: Map<string, UnmatchedAccumulator>): UnmatchedRequest[] {
  return [...map.values()]
    .map((u) => ({
      method: u.method,
      path: u.path,
      reason: u.reason,
      template: u.template,
      count: u.count,
      phases: [...u.phases].sort(compareStrings),
    }))
    .sort(
      (a, b) =>
        compareStrings(a.path, b.path) ||
        compareMethods(a.method, b.method) ||
        compareStrings(a.reason, b.reason),
    );
}

/**
 * Computes coverage.
 *
 * @param spec - Loaded spec.
 * @param records - Valid request records.
 * @param config - Exclusions and ignore globs.
 * @param options - Counting options.
 */
export function analyzeCoverage(
  spec: LoadedSpec,
  records: readonly RequestRecord[],
  config: CoverageConfig,
  options: AnalyzeOptions,
): CoverageAnalysis {
  const matcher = new PathMatcher(spec.operations, spec.basePath);
  const ignoreGlobs = config.ignoreUnmatched.map(globToRegExp);
  const opsByKey = new Map(spec.operations.map((op) => [op.key, op]));

  const exclusionReasons = new Map<string, string>();
  const configWarnings: string[] = [];
  for (const ex of config.excludeOperations) {
    const key = operationKey(ex.method, ex.path);
    if (!opsByKey.has(key)) {
      configWarnings.push(`Exclusion "${key}" matches no operation in the spec.`);
      continue;
    }
    exclusionReasons.set(key, ex.reason);
  }

  const acc = new Map<string, Accumulator>();
  for (const op of spec.operations) {
    acc.set(op.key, {
      requestCount: 0,
      observed: new Map(),
      queryNames: new Set(),
      headerNames: new Set(),
      tests: new Set(),
    });
  }

  const unmatched = new Map<string, UnmatchedAccumulator>();
  const ignored = new Map<string, UnmatchedAccumulator>();
  const undocumented = new Map<string, UndocumentedStatus>();
  const counts: RequestCounts = {
    recorded: records.length,
    counted: 0,
    hooks: 0,
    filteredByOutcome: 0,
    unmatched: 0,
  };

  for (const record of records) {
    if (record.phase === 'hook') counts.hooks += 1;
    const counted = isCounted(record, options);
    if (counted) counts.counted += 1;
    else if (record.phase !== 'hook') counts.filteredByOutcome += 1;

    const result = matcher.match(record.method, record.path);
    if (result.kind === 'unmatched') {
      // Reported (and glob-matched) as the full, normalized request path.
      const reportedPath = normalizePath(record.path);
      const isIgnored = ignoreGlobs.some((re) => re.test(reportedPath));
      const target = isIgnored ? ignored : unmatched;
      const id = `${record.method} ${reportedPath} ${result.reason}`;
      const entry = target.get(id) ?? {
        method: record.method,
        path: reportedPath,
        reason: result.reason,
        template: result.template,
        count: 0,
        phases: new Set<string>(),
      };
      entry.count += 1;
      entry.phases.add(record.phase);
      target.set(id, entry);
      if (!isIgnored) counts.unmatched += 1;
      continue;
    }

    const op = result.operation;
    // Spec drift: a received status the operation does not document (all traffic).
    if (record.status !== null) {
      const documented = op.responses.some(
        (r) => r.code === 'default' || codeMatches(r.code, record.status as number),
      );
      if (!documented) {
        const id = `${op.key}|${record.status}`;
        const entry = undocumented.get(id) ?? {
          key: op.key,
          status: String(record.status),
          count: 0,
        };
        entry.count += 1;
        undocumented.set(id, entry);
      }
    }

    if (!counted) continue;
    const a = acc.get(op.key);
    if (!a) continue;
    a.requestCount += 1;
    const statusKey = record.status === null ? 'error' : String(record.status);
    a.observed.set(statusKey, (a.observed.get(statusKey) ?? 0) + 1);
    for (const q of record.query) a.queryNames.add(q);
    for (const h of record.headers) a.headerNames.add(h.toLowerCase());
    a.tests.add(`${record.file} > ${record.title}`);
  }

  const operations: OperationCoverage[] = [];
  const excluded: ExcludedOperation[] = [];
  const inScope: Operation[] = [];

  for (const op of spec.operations) {
    const a = acc.get(op.key);
    if (!a) continue;
    const reason = exclusionReasons.get(op.key);
    if (reason !== undefined) {
      excluded.push({ key: op.key, reason, requestCount: a.requestCount });
      continue;
    }
    inScope.push(op);

    const received = [...a.observed.keys()].filter((k) => k !== 'error').map(Number);
    const statuses: StatusCoverage[] = op.responses.map((r) => {
      if (r.code === 'default') {
        const explicit = op.responses.filter((x) => x.code !== 'default');
        const covered = received.some((code) => !explicit.some((x) => codeMatches(x.code, code)));
        return { code: r.code, covered, counted: false };
      }
      return {
        code: r.code,
        covered: received.some((code) => codeMatches(r.code, code)),
        counted: true,
      };
    });

    const exercised = a.requestCount > 0;
    const parameters: ParameterCoverage[] = op.parameters.map((p) => {
      let covered = false;
      if (p.in === 'path') covered = exercised;
      else if (p.in === 'query') covered = a.queryNames.has(p.name);
      else if (p.in === 'header') covered = a.headerNames.has(p.name.toLowerCase());
      return { name: p.name, in: p.in, required: p.required, declared: p.declared, covered };
    });

    const observedStatuses: Record<string, number> = {};
    for (const key of [...a.observed.keys()].sort(compareStatusCodes)) {
      observedStatuses[key] = a.observed.get(key) ?? 0;
    }

    operations.push({
      key: op.key,
      method: op.method,
      path: op.path,
      operationId: op.operationId,
      tags: op.tags,
      covered: exercised,
      requestCount: a.requestCount,
      statuses,
      parameters,
      observedStatuses,
      tests: [...a.tests].sort(compareStrings),
    });
  }

  const tagNames = new Set<string>();
  for (const op of operations) {
    if (op.tags.length === 0) tagNames.add(UNTAGGED);
    for (const tag of op.tags) tagNames.add(tag);
  }
  const byTag: Record<string, DimensionTotals> = {};
  for (const tag of [...tagNames].sort(compareStrings)) {
    byTag[tag] = sumTotals(
      operations.filter((op) => (tag === UNTAGGED ? op.tags.length === 0 : op.tags.includes(tag))),
    );
  }

  return {
    requests: counts,
    totals: sumTotals(operations),
    byTag,
    operations,
    excluded: excluded.sort((a, b) => compareStrings(a.key, b.key)),
    extras: {
      unmatched: finishUnmatched(unmatched),
      ignoredUnmatched: finishUnmatched(ignored),
      undocumentedStatuses: [...undocumented.values()].sort(
        (a, b) => compareStrings(a.key, b.key) || compareStatusCodes(a.status, b.status),
      ),
      specWarnings: spec.warnings,
      configWarnings: configWarnings.sort(compareStrings),
    },
    inScope,
  };
}
