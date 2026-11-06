/**
 * Compares AI coverage estimates (Markdown answers ending in a JSON block)
 * with the tool's coverage.json / gaps.json. Pure functions; no I/O.
 */
import { InputError } from '../shared/errors.ts';
import { compareStrings } from '../shared/order.ts';

/** covered/total/pct triple as answered by the AI. */
export interface EstimateRatio {
  covered: number;
  total: number;
  pct: number;
}

/** The fixed JSON shape requested by docs/day2-ai-estimate-prompt.md. */
export interface Estimate {
  operations: EstimateRatio;
  statuses: EstimateRatio;
  parameters: EstimateRatio;
  coveredOperations: string[];
  topGaps: string[];
}

/** The subset of the tool output needed for the comparison. */
export interface ToolResult {
  operations: EstimateRatio;
  statuses: EstimateRatio;
  parameters: EstimateRatio;
  coveredOperations: string[];
  topGaps: string[];
  allGapIds: string[];
}

/**
 * Extracts and validates the LAST ```json fenced block of an answer.
 *
 * @param markdown - The AI answer.
 * @param name - Run name for error messages.
 */
export function extractEstimate(markdown: string, name: string): Estimate {
  const blocks = [...markdown.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  const last = blocks.at(-1)?.[1];
  if (last === undefined) throw new InputError(`${name}: no \`\`\`json block found.`);
  let value: unknown;
  try {
    value = JSON.parse(last);
  } catch {
    throw new InputError(`${name}: the last \`\`\`json block is not valid JSON.`);
  }
  const v = value as Record<string, unknown>;
  const ratio = (key: string): EstimateRatio => {
    const r = v[key] as Record<string, unknown> | undefined;
    if (!r || typeof r.covered !== 'number' || typeof r.total !== 'number') {
      throw new InputError(`${name}: "${key}" must be { covered, total, pct }.`);
    }
    const pct = typeof r.pct === 'number' ? r.pct : r.total === 0 ? 0 : (r.covered / r.total) * 100;
    return { covered: r.covered, total: r.total, pct };
  };
  const list = (key: string): string[] =>
    Array.isArray(v[key])
      ? (v[key] as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
  return {
    operations: ratio('operations'),
    statuses: ratio('statuses'),
    parameters: ratio('parameters'),
    coveredOperations: list('coveredOperations'),
    topGaps: list('topGaps'),
  };
}

/** One row of the comparison table. */
export interface MetricRow {
  metric: string;
  runs: number[];
  tool: number;
  errors: number[];
  /** max(runs) - min(runs): spread between AI runs. */
  spread: number;
}

/** Full comparison result. */
export interface Comparison {
  runNames: string[];
  rows: MetricRow[];
  /** Per run: operations the AI marked covered that are not (false positives). */
  falsePositives: string[][];
  /** Per run: covered operations the AI missed (false negatives). */
  falseNegatives: string[][];
  /** Per run: how many of the AI topGaps are real gaps / in the tool's top 20. */
  gapOverlap: { realGaps: number; inToolTop: number; listed: number }[];
}

/**
 * Rounds to 2 decimals.
 *
 * @param n - Number.
 */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compares estimates with the tool result.
 *
 * @param runNames - Run names, same order as `estimates`.
 * @param estimates - Parsed estimates.
 * @param tool - Tool result.
 */
export function compareEstimates(
  runNames: string[],
  estimates: Estimate[],
  tool: ToolResult,
): Comparison {
  const rows: MetricRow[] = [];
  for (const dim of ['operations', 'statuses', 'parameters'] as const) {
    for (const field of ['covered', 'total', 'pct'] as const) {
      const runs = estimates.map((e) => r2(e[dim][field]));
      const toolValue = r2(tool[dim][field]);
      rows.push({
        metric: `${dim}.${field}`,
        runs,
        tool: toolValue,
        errors: runs.map((x) => r2(x - toolValue)),
        spread: runs.length ? r2(Math.max(...runs) - Math.min(...runs)) : 0,
      });
    }
  }
  const toolCovered = new Set(tool.coveredOperations);
  const allGaps = new Set(tool.allGapIds);
  const toolTop = new Set(tool.topGaps);
  return {
    runNames,
    rows,
    falsePositives: estimates.map((e) =>
      [...new Set(e.coveredOperations)].filter((k) => !toolCovered.has(k)).sort(compareStrings),
    ),
    falseNegatives: estimates.map((e) => {
      const ai = new Set(e.coveredOperations);
      return [...toolCovered].filter((k) => !ai.has(k)).sort(compareStrings);
    }),
    gapOverlap: estimates.map((e) => ({
      listed: e.topGaps.length,
      realGaps: e.topGaps.filter((g) => allGaps.has(g)).length,
      inToolTop: e.topGaps.filter((g) => toolTop.has(g)).length,
    })),
  };
}

/**
 * Renders the comparison as Markdown.
 *
 * @param c - Comparison.
 */
export function renderComparison(c: Comparison): string {
  const head = [
    'Metric',
    ...c.runNames,
    'Tool',
    ...c.runNames.map((n) => `Error ${n}`),
    'Spread (max−min)',
  ];
  const lines = [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...c.rows.map(
      (r) =>
        `| ${r.metric} | ${r.runs.join(' | ')} | ${r.tool} | ${r.errors.map((e) => (e > 0 ? `+${e}` : `${e}`)).join(' | ')} | ${r.spread} |`,
    ),
    '',
  ];
  c.runNames.forEach((name, i) => {
    const fp = c.falsePositives[i] ?? [];
    const fn = c.falseNegatives[i] ?? [];
    const g = c.gapOverlap[i];
    lines.push(`### ${name}`);
    lines.push(
      `- False positives (AI says covered, tool says not): ${fp.length ? fp.map((k) => `\`${k}\``).join(', ') : 'none'}`,
    );
    lines.push(
      `- False negatives (covered, AI missed): ${fn.length ? fn.map((k) => `\`${k}\``).join(', ') : 'none'}`,
    );
    if (g)
      lines.push(
        `- topGaps: ${g.listed} listed · ${g.realGaps} are real gaps · ${g.inToolTop} in the tool's top ${20}`,
      );
    lines.push('');
  });
  return `${lines.join('\n')}\n`;
}
