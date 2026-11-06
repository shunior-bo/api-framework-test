/**
 * Assembles coverage.json and gaps.json documents from an analysis.
 *
 * Pure: the only non-deterministic input is `generatedAt`, passed by the caller.
 */
import type { CoverageAnalysis, AnalyzeOptions } from '../analyze/coverage.ts';
import { buildGaps, summarizeGaps } from '../analyze/gaps.ts';
import type { CoverageReport, GapsReport } from '../analyze/types.ts';
import type { LoadedRecords } from '../records/loadRecords.ts';
import type { LoadedSpec } from '../spec/types.ts';

/** Tool identity written into every report. */
export const TOOL = { name: 'api-coverage', version: '1.0.0' } as const;

/** Metadata needed to build the documents. */
export interface ReportMeta {
  generatedAt: string;
  spec: LoadedSpec;
  records: LoadedRecords;
  options: AnalyzeOptions;
  configPath: string;
  git: { sha: string | null; branch: string | null };
}

/**
 * Builds coverage.json.
 *
 * @param analysis - Output of analyzeCoverage.
 * @param meta - Report metadata.
 */
export function buildCoverageReport(analysis: CoverageAnalysis, meta: ReportMeta): CoverageReport {
  return {
    schemaVersion: 1,
    generatedAt: meta.generatedAt,
    tool: { name: TOOL.name, version: TOOL.version },
    source: {
      spec: {
        path: meta.spec.path,
        title: meta.spec.title,
        version: meta.spec.version,
        sha256: meta.spec.sha256,
      },
      records: {
        dir: meta.records.dir,
        files: meta.records.files,
        lines: meta.records.lines,
        invalidLines: meta.records.invalid.length,
      },
      git: meta.git,
    },
    options: {
      includeHooks: meta.options.includeHooks,
      onlyPassed: meta.options.onlyPassed,
      configPath: meta.configPath,
    },
    requests: analysis.requests,
    totals: analysis.totals,
    byTag: analysis.byTag,
    operations: analysis.operations,
    excluded: analysis.excluded,
    extras: { ...analysis.extras, invalidRecordLines: meta.records.invalid },
  };
}

/**
 * Builds gaps.json.
 *
 * @param analysis - Output of analyzeCoverage.
 * @param meta - Report metadata.
 */
export function buildGapsReport(analysis: CoverageAnalysis, meta: ReportMeta): GapsReport {
  const gaps = buildGaps(analysis.operations, analysis.inScope);
  return {
    schemaVersion: 1,
    generatedAt: meta.generatedAt,
    spec: { path: meta.spec.path, sha256: meta.spec.sha256 },
    summary: summarizeGaps(gaps),
    gaps,
  };
}

/**
 * Serializes a document the same way every time (2-space JSON + trailing newline).
 *
 * @param document - Any JSON-serializable document.
 */
export function toJson(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
