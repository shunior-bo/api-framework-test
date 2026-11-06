/**
 * Shape of delta.json — the base-vs-head comparison of two coverage runs.
 *
 * Public contract consumed by CI (PR comment, job summary) and the Day 4
 * agents. Bump `schemaVersion` on any breaking change.
 */
import type { DimensionTotals, Gap, Ratio } from '../analyze/types.ts';

/** covered / total / pct change between base and head (pct null if either side is null). */
export interface RatioDelta {
  covered: number;
  total: number;
  pct: number | null;
}

/** One dimension compared. */
export interface DimensionDelta {
  base: Ratio;
  head: Ratio;
  delta: RatioDelta;
}

/** Parameters compared, with the required/optional split. */
export interface ParameterDimensionDelta extends DimensionDelta {
  required: DimensionDelta;
  optional: DimensionDelta;
}

/** Identity of one side of the comparison. */
export interface DeltaSide {
  git: { sha: string | null; branch: string | null };
  spec: { sha256: string; version: string };
  totals: DimensionTotals;
}

/** Verdict of the comparison (rules in compare/delta.ts). */
export type Verdict = 'improved' | 'regressed' | 'unchanged' | 'mixed';

/** The full delta.json document. */
export interface DeltaReport {
  schemaVersion: 1;
  generatedAt: string;
  base: DeltaSide;
  head: DeltaSide;
  specChanged: boolean;
  totals: {
    operations: DimensionDelta;
    statuses: DimensionDelta;
    parameters: ParameterDimensionDelta;
  };
  operations: {
    /** In-scope in head, absent from base (e.g. a new endpoint in the spec). */
    added: { key: string; covered: boolean }[];
    /** In-scope in base, absent from head. */
    removed: string[];
    /** Uncovered in base, covered in head. */
    newlyCovered: string[];
    /** Covered in base, uncovered in head (regression). */
    noLongerCovered: string[];
  };
  gaps: {
    /** Full head gaps whose id does not exist in base. */
    opened: Gap[];
    /** Ids present in base and missing in head. */
    closed: string[];
    summary: { opened: number; closed: number; headTotal: number; baseTotal: number };
  };
  verdict: Verdict;
  /** The signals that produced the verdict, sorted (explains it to humans). */
  verdictReasons: string[];
}
