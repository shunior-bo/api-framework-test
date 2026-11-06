/**
 * Entrypoint for the Day 2 experiment: compare AI coverage estimates with the tool.
 *
 *   node tools/coverage/src/compare-estimate.ts \
 *     [--estimates docs/day2-ai-estimates] \
 *     [--coverage docs/coverage/day1-baseline/coverage.json] \
 *     [--gaps docs/coverage/day1-baseline/gaps.json]
 *
 * Reads every run-*.md in --estimates (sorted), extracts the last ```json
 * block of each and prints a Markdown comparison to stdout.
 * Exit codes: 0 OK · 2 input error.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { compareEstimates, extractEstimate, renderComparison } from './estimate/compare.ts';
import type { ToolResult } from './estimate/compare.ts';
import { InputError } from './shared/errors.ts';
import { compareStrings } from './shared/order.ts';

/** Minimal shapes read from the tool output. */
interface CoverageJson {
  totals: Record<
    'operations' | 'statuses' | 'parameters',
    { covered: number; total: number; pct: number | null }
  >;
  operations: { key: string; covered: boolean }[];
}
interface GapsJson {
  gaps: { id: string }[];
}

/**
 * Reads a JSON file or throws an InputError.
 *
 * @param file - Path.
 */
function readJson<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    throw new InputError(`Cannot read JSON "${file}".`);
  }
}

try {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: {
      estimates: { type: 'string', default: 'docs/day2-ai-estimates' },
      coverage: { type: 'string', default: 'docs/coverage/day1-baseline/coverage.json' },
      gaps: { type: 'string', default: 'docs/coverage/day1-baseline/gaps.json' },
    },
  });
  const dir = values.estimates;
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => /^run-.*\.md$/.test(f))
      .sort(compareStrings);
  } catch {
    throw new InputError(`Estimates directory "${dir}" not found.`);
  }
  if (files.length === 0) {
    throw new InputError(
      `No run-*.md files in "${dir}". Follow docs/day2-ai-estimate-vs-tool.md first.`,
    );
  }
  const names = files.map((f) => f.replace(/\.md$/, ''));
  const estimates = files.map((f) => extractEstimate(readFileSync(join(dir, f), 'utf8'), f));

  const coverage = readJson<CoverageJson>(values.coverage);
  const gaps = readJson<GapsJson>(values.gaps);
  const ratio = (dim: 'operations' | 'statuses' | 'parameters') => ({
    covered: coverage.totals[dim].covered,
    total: coverage.totals[dim].total,
    pct: coverage.totals[dim].pct ?? 0,
  });
  const tool: ToolResult = {
    operations: ratio('operations'),
    statuses: ratio('statuses'),
    parameters: ratio('parameters'),
    coveredOperations: coverage.operations.filter((o) => o.covered).map((o) => o.key),
    topGaps: gaps.gaps.slice(0, 20).map((g) => g.id),
    allGapIds: gaps.gaps.map((g) => g.id),
  };
  process.stdout.write(renderComparison(compareEstimates(names, estimates, tool)));
} catch (error) {
  if (error instanceof InputError || (error instanceof TypeError && 'code' in error)) {
    process.stderr.write(`compare-estimate: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
