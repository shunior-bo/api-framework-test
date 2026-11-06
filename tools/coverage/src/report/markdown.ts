/**
 * Markdown summary (summary.md) — used for $GITHUB_STEP_SUMMARY today and
 * reused by the Day 3 PR comment.
 */
import type { CoverageReport, GapsReport, Ratio } from '../analyze/types.ts';
import { formatPct } from './console.ts';

/**
 * Escapes characters that break a Markdown table cell.
 *
 * @param text - Cell text.
 */
function md(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Renders one totals row.
 *
 * @param label - Row label.
 * @param r - Ratio.
 */
function row(label: string, r: Ratio): string {
  return `| ${label} | ${r.covered} | ${r.total} | ${formatPct(r.pct)} |`;
}

/**
 * Renders the Markdown summary.
 *
 * @param report - coverage.json document.
 * @param gaps - gaps.json document.
 * @param top - Number of gaps to list.
 * @returns Markdown text ending with a newline.
 */
export function renderMarkdown(report: CoverageReport, gaps: GapsReport, top: number): string {
  const t = report.totals;
  const s = gaps.summary;
  const lines = [
    '## API coverage',
    '',
    `Spec **${md(report.source.spec.title)} v${md(report.source.spec.version)}** · ${report.requests.counted} counted requests · ${report.excluded.length} excluded operations`,
    '',
    '| Dimension | Covered | Total | % |',
    '|---|---:|---:|---:|',
    row('Operations', t.operations),
    row('Statuses', t.statuses),
    row('Parameters', t.parameters),
    row('↳ required', t.parameters.required),
    row('↳ optional', t.parameters.optional),
    '',
    `### Top ${Math.min(top, gaps.gaps.length)} gaps (${s.total} total: ${s.high} high, ${s.medium} medium, ${s.low} low)`,
    '',
    '| Priority | Type | Gap | Hint |',
    '|---|---|---|---|',
    ...gaps.gaps
      .slice(0, top)
      .map(
        (g) =>
          `| ${g.priority} | ${g.type} | \`${md(g.id.slice(g.id.indexOf(':') + 1))}\` | ${md(g.hint)} |`,
      ),
    '',
  ];
  const warnings =
    report.extras.unmatched.length +
    report.extras.undocumentedStatuses.length +
    report.extras.specWarnings.length +
    report.extras.invalidRecordLines.length;
  if (warnings > 0) {
    lines.push(
      `> ⚠️ ${report.extras.unmatched.length} unmatched request groups · ${report.extras.undocumentedStatuses.length} undocumented statuses · ${report.extras.specWarnings.length} spec warnings · ${report.extras.invalidRecordLines.length} corrupt record lines (see coverage.json)`,
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}
