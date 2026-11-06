/**
 * Deterministic batch selection over gaps.json, with spec context per gap.
 * Shared by the `gaps` CLI subcommand and the MCP server.
 *
 * Same gaps.json + spec + filters → same batch, always: gaps are re-sorted
 * with the canonical comparator (`compareGaps`) before filtering and limiting.
 */
import { compareGaps } from '../analyze/gaps.ts';
import type { Gap, GapsReport } from '../analyze/types.ts';
import { compareStrings } from '../shared/order.ts';
import {
  operationContext,
  type OperationContext,
  type SpecDocument,
} from '../spec/operationContext.ts';

/** Batch filters. Empty lists mean "no filter". */
export interface GapFilters {
  priority: string[];
  type: string[];
  /** A gap matches when it has ANY of these tags. */
  tag: string[];
  /** Segment-aware prefix: "/likes" matches "/likes" and "/likes/…", not "/likesX". */
  pathPrefix: string | null;
  /** Gap ids to skip (e.g. ones the agent already flagged as blocked). */
  excludeIds: string[];
  /** Maximum gaps returned (null = all). */
  limit: number | null;
}

/** One selected gap with its spec context. */
export interface BatchItem {
  gap: Gap;
  /** Null only if the operation vanished from the spec (spec/gaps mismatch). */
  operation: OperationContext | null;
}

/** The selected batch. */
export interface GapBatch {
  schemaVersion: 1;
  source: {
    gaps: string;
    spec: { path: string; sha256: string };
    /** spec sha256 recorded in gaps.json; differs if the spec changed since. */
    gapsSpecSha256: string;
    specMatches: boolean;
  };
  filters: GapFilters;
  /** Gaps matching the filters before `limit`. */
  totalMatching: number;
  returned: number;
  batch: BatchItem[];
}

/** Default batch size. */
export const DEFAULT_LIMIT = 5;

/**
 * Normalizes filters so the echo in the output is canonical.
 *
 * @param filters - Raw filters.
 */
export function normalizeFilters(filters: Partial<GapFilters>): GapFilters {
  const list = (values: string[] | undefined): string[] =>
    [...new Set(values ?? [])].sort(compareStrings);
  const prefix = filters.pathPrefix?.trim();
  return {
    priority: list(filters.priority),
    type: list(filters.type),
    tag: list(filters.tag),
    pathPrefix: prefix ? prefix.replace(/\/+$/, '') || '/' : null,
    excludeIds: list(filters.excludeIds),
    limit: filters.limit === undefined ? DEFAULT_LIMIT : filters.limit,
  };
}

/**
 * Tests the segment-aware path prefix.
 *
 * @param path - Gap template path.
 * @param prefix - Normalized prefix.
 */
function matchesPrefix(path: string, prefix: string): boolean {
  if (prefix === '/') return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Filters gaps (canonical order, no limit).
 *
 * @param gaps - All gaps.
 * @param filters - Normalized filters.
 */
export function filterGaps(gaps: readonly Gap[], filters: GapFilters): Gap[] {
  const exclude = new Set(filters.excludeIds);
  return [...gaps]
    .sort(compareGaps)
    .filter(
      (g) =>
        !exclude.has(g.id) &&
        (filters.priority.length === 0 || filters.priority.includes(g.priority)) &&
        (filters.type.length === 0 || filters.type.includes(g.type)) &&
        (filters.tag.length === 0 || g.tags.some((t) => filters.tag.includes(t))) &&
        (filters.pathPrefix === null || matchesPrefix(g.path, filters.pathPrefix)),
    );
}

/**
 * Selects a batch of gaps with spec context.
 *
 * @param report - gaps.json document.
 * @param gapsPath - Path of gaps.json (echoed in the output).
 * @param spec - Spec document.
 * @param rawFilters - Filters.
 */
export function selectBatch(
  report: GapsReport,
  gapsPath: string,
  spec: SpecDocument,
  rawFilters: Partial<GapFilters>,
): GapBatch {
  const filters = normalizeFilters(rawFilters);
  const matching = filterGaps(report.gaps, filters);
  const selected = filters.limit === null ? matching : matching.slice(0, filters.limit);
  return {
    schemaVersion: 1,
    source: {
      gaps: gapsPath,
      spec: { path: spec.path, sha256: spec.sha256 },
      gapsSpecSha256: report.spec.sha256,
      specMatches: report.spec.sha256 === spec.sha256,
    },
    filters,
    totalMatching: matching.length,
    returned: selected.length,
    batch: selected.map((gap) => ({
      gap,
      operation: operationContext(spec, gap.method, gap.path),
    })),
  };
}

/**
 * Renders a batch as Markdown (one section per gap, context as JSON).
 *
 * @param batch - Selected batch.
 */
export function renderBatchMarkdown(batch: GapBatch): string {
  const lines = [
    `# Gap batch: ${batch.returned} of ${batch.totalMatching} matching gaps`,
    '',
    `Filters: \`${JSON.stringify(batch.filters)}\``,
    batch.source.specMatches
      ? ''
      : '\n> ⚠️ The spec changed since gaps.json was produced: re-run the coverage before trusting this batch.\n',
  ];
  for (const { gap, operation } of batch.batch) {
    lines.push(
      `## \`${gap.id}\` (${gap.priority} ${gap.type})`,
      '',
      gap.hint,
      '',
      '```json',
      JSON.stringify(operation, null, 2),
      '```',
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}
