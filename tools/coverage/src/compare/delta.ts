/**
 * Computes the delta between two coverage runs (base → head). Pure: no I/O.
 *
 * Each side must have been analyzed with ITS OWN spec and config, so a PR that
 * changes the spec (Day 4) is reflected: new operations show up in `added`,
 * removed ones in `removed`, and totals move accordingly.
 *
 * Verdict rules (deterministic):
 *   regression signals
 *     - a dimension's `covered` decreased
 *     - a dimension's `pct` decreased (e.g. the spec grew and nobody tested it)
 *     - `noLongerCovered` is not empty
 *     - an operation was `added` to the spec and is not covered
 *   improvement signals
 *     - a dimension's `covered` increased
 *     - a dimension's `pct` increased
 *     - `newlyCovered` is not empty
 *   verdict = both → "mixed" · only regression → "regressed"
 *           · only improvement → "improved" · none → "unchanged"
 * Gap ids opened/closed are reported but are not signals by themselves: they
 * also move when the spec changes, which the rules above already capture.
 */
import type { CoverageReport, Gap, GapsReport, Ratio } from '../analyze/types.ts';
import { compareStrings } from '../shared/order.ts';
import type { DeltaReport, DimensionDelta, RatioDelta, Verdict } from './types.ts';

/** One side of the comparison: its coverage.json and gaps.json. */
export interface CoverageSnapshot {
  coverage: CoverageReport;
  gaps: GapsReport;
}

/**
 * Rounds to 2 decimals (avoids -0).
 *
 * @param n - Number.
 */
function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
}

/**
 * Compares two ratios.
 *
 * @param base - Base ratio.
 * @param head - Head ratio.
 */
export function ratioDelta(base: Ratio, head: Ratio): RatioDelta {
  return {
    covered: head.covered - base.covered,
    total: head.total - base.total,
    pct: base.pct === null || head.pct === null ? null : round2(head.pct - base.pct),
  };
}

/**
 * Builds one dimension delta.
 *
 * @param base - Base ratio.
 * @param head - Head ratio.
 */
function dimension(base: Ratio, head: Ratio): DimensionDelta {
  const pick = (r: Ratio): Ratio => ({ covered: r.covered, total: r.total, pct: r.pct });
  return { base: pick(base), head: pick(head), delta: ratioDelta(base, head) };
}

/**
 * Computes the delta.
 *
 * @param base - Base snapshot.
 * @param head - Head snapshot.
 * @param generatedAt - ISO timestamp (the only non-deterministic field).
 */
export function computeDelta(
  base: CoverageSnapshot,
  head: CoverageSnapshot,
  generatedAt: string,
): DeltaReport {
  const bt = base.coverage.totals;
  const ht = head.coverage.totals;
  const totals = {
    operations: dimension(bt.operations, ht.operations),
    statuses: dimension(bt.statuses, ht.statuses),
    parameters: {
      ...dimension(bt.parameters, ht.parameters),
      required: dimension(bt.parameters.required, ht.parameters.required),
      optional: dimension(bt.parameters.optional, ht.parameters.optional),
    },
  };

  const baseOps = new Map(base.coverage.operations.map((o) => [o.key, o.covered]));
  const headOps = new Map(head.coverage.operations.map((o) => [o.key, o.covered]));
  const sorted = (keys: Iterable<string>): string[] => [...keys].sort(compareStrings);

  const added = sorted([...headOps.keys()].filter((k) => !baseOps.has(k))).map((key) => ({
    key,
    covered: headOps.get(key) === true,
  }));
  const removed = sorted([...baseOps.keys()].filter((k) => !headOps.has(k)));
  const newlyCovered = sorted(
    [...headOps.entries()]
      .filter(([k, covered]) => covered && baseOps.get(k) === false)
      .map(([k]) => k),
  );
  const noLongerCovered = sorted(
    [...baseOps.entries()]
      .filter(([k, covered]) => covered && headOps.get(k) === false)
      .map(([k]) => k),
  );

  const baseGapIds = new Set(base.gaps.gaps.map((g) => g.id));
  const headGapIds = new Set(head.gaps.gaps.map((g) => g.id));
  // head.gaps.gaps is already in the tool's deterministic gap order.
  const opened: Gap[] = head.gaps.gaps.filter((g) => !baseGapIds.has(g.id));
  const closed = sorted([...baseGapIds].filter((id) => !headGapIds.has(id)));

  const regressions: string[] = [];
  const improvements: string[] = [];
  for (const [name, d] of [
    ['operations', totals.operations],
    ['statuses', totals.statuses],
    ['parameters', totals.parameters],
  ] as const) {
    if (d.delta.covered < 0) regressions.push(`${name}.covered decreased`);
    if (d.delta.covered > 0) improvements.push(`${name}.covered increased`);
    if (d.delta.pct !== null && d.delta.pct < 0) regressions.push(`${name}.pct decreased`);
    if (d.delta.pct !== null && d.delta.pct > 0) improvements.push(`${name}.pct increased`);
  }
  if (noLongerCovered.length > 0) regressions.push('operations no longer covered');
  if (added.some((a) => !a.covered)) regressions.push('uncovered operations added to the spec');
  if (newlyCovered.length > 0) improvements.push('operations newly covered');

  let verdict: Verdict = 'unchanged';
  if (regressions.length > 0 && improvements.length > 0) verdict = 'mixed';
  else if (regressions.length > 0) verdict = 'regressed';
  else if (improvements.length > 0) verdict = 'improved';

  return {
    schemaVersion: 1,
    generatedAt,
    base: {
      git: base.coverage.source.git,
      spec: {
        sha256: base.coverage.source.spec.sha256,
        version: base.coverage.source.spec.version,
      },
      totals: bt,
    },
    head: {
      git: head.coverage.source.git,
      spec: {
        sha256: head.coverage.source.spec.sha256,
        version: head.coverage.source.spec.version,
      },
      totals: ht,
    },
    specChanged: base.coverage.source.spec.sha256 !== head.coverage.source.spec.sha256,
    totals,
    operations: { added, removed, newlyCovered, noLongerCovered },
    gaps: {
      opened,
      closed,
      summary: {
        opened: opened.length,
        closed: closed.length,
        headTotal: head.gaps.gaps.length,
        baseTotal: base.gaps.gaps.length,
      },
    },
    verdict,
    verdictReasons: [
      ...regressions.map((r) => `regression: ${r}`),
      ...improvements.map((i) => `improvement: ${i}`),
    ].sort(compareStrings),
  };
}

/** Dimensions accepted by --fail-on-negative. */
export const FAIL_ON_NEGATIVE = ['operations', 'statuses', 'parameters', 'any'] as const;
export type FailOnNegative = (typeof FAIL_ON_NEGATIVE)[number];

/**
 * Evaluates --fail-on-negative.
 *
 * @param delta - Delta report.
 * @param mode - Dimension to check, or "any".
 * @returns Human-readable failures; empty when the check passes.
 */
export function negativeFailures(delta: DeltaReport, mode: FailOnNegative): string[] {
  const dims = mode === 'any' ? (['operations', 'statuses', 'parameters'] as const) : [mode];
  const failures: string[] = [];
  for (const dim of dims) {
    const pct = delta.totals[dim].delta.pct;
    if (pct !== null && pct < 0) failures.push(`${dim} pct ${pct.toFixed(2)}`);
  }
  if (mode === 'any' && delta.operations.noLongerCovered.length > 0) {
    failures.push(`${delta.operations.noLongerCovered.length} operation(s) no longer covered`);
  }
  return failures;
}
