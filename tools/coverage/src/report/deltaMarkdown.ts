/**
 * Markdown rendering of delta.json (delta.md) — reused by the job summary and
 * the sticky PR comment. Deterministic for a given delta + head gaps.
 *
 * Lists longer than `top` are collapsed with <details>. The result never
 * exceeds `limit` characters (GitHub comments allow 65,536): truncation keeps
 * whole lines, closes any open <details>, and points to the artifact.
 */
import type { Gap, GapsReport, Ratio } from '../analyze/types.ts';
import type { DeltaReport, DimensionDelta, RatioDelta } from '../compare/types.ts';
import { formatPct } from './console.ts';

/** Default character limit for delta.md. */
export const MARKDOWN_LIMIT = 60000;

/** Options for renderDeltaMarkdown. */
export interface DeltaMarkdownOptions {
  /** Items shown before collapsing a list, and gaps per table. */
  top: number;
  /** Hard character limit (default MARKDOWN_LIMIT). */
  limit?: number;
}

/**
 * Escapes characters that break Markdown table cells or inline code.
 *
 * @param text - Raw text.
 */
function md(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').replace(/</g, '&lt;');
}

/**
 * Arrow for a signed number (null/0 → ＝).
 *
 * @param n - Delta.
 */
function arrow(n: number | null): string {
  if (n === null || n === 0) return '＝';
  return n > 0 ? '▲' : '▼';
}

/**
 * Formats a signed number ("+3", "-1.25", "0", "n/a").
 *
 * @param n - Delta.
 */
function signed(n: number | null): string {
  if (n === null) return 'n/a';
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * "covered/total (pct)".
 *
 * @param r - Ratio.
 */
function cell(r: Ratio): string {
  return `${r.covered}/${r.total} (${formatPct(r.pct)})`;
}

/**
 * One headline table row.
 *
 * @param label - Row label.
 * @param d - Dimension delta.
 */
function row(label: string, d: DimensionDelta): string {
  const delta: RatioDelta = d.delta;
  return `| ${label} | ${cell(d.base)} | ${cell(d.head)} | ${arrow(delta.covered)} ${signed(delta.covered)} | ${arrow(delta.pct)} ${signed(delta.pct)} |`;
}

/**
 * Renders a bullet list, collapsing items beyond `top`.
 *
 * @param items - Already formatted items.
 * @param top - Visible items.
 */
function list(items: string[], top: number): string[] {
  if (items.length === 0) return ['_none_'];
  const visible = items.slice(0, top).map((i) => `- ${i}`);
  if (items.length <= top) return visible;
  return [
    ...visible,
    '',
    `<details><summary>${items.length - top} more</summary>`,
    '',
    ...items.slice(top).map((i) => `- ${i}`),
    '',
    '</details>',
  ];
}

/**
 * Renders a gap table.
 *
 * @param gaps - Gaps to show.
 */
function gapTable(gaps: readonly Gap[]): string[] {
  if (gaps.length === 0) return ['_none_'];
  return [
    '| Priority | Type | Gap | Hint |',
    '|---|---|---|---|',
    ...gaps.map(
      (g) =>
        `| ${g.priority} | ${g.type} | \`${md(g.id.slice(g.id.indexOf(':') + 1))}\` | ${md(g.hint)} |`,
    ),
  ];
}

/**
 * Short git label, e.g. "`abc1234` (main)".
 *
 * @param git - Git metadata.
 */
function gitLabel(git: { sha: string | null; branch: string | null }): string {
  const sha = git.sha ? `\`${git.sha.slice(0, 7)}\`` : '`unknown`';
  return git.branch ? `${sha} (${md(git.branch)})` : sha;
}

/**
 * Truncates Markdown deterministically at a line boundary.
 *
 * @param text - Full Markdown.
 * @param limit - Maximum length.
 */
export function truncateMarkdown(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const notice = (shown: number): string =>
    `\n> ⚠️ Truncated: showing ${shown} of ${text.length} characters. The full report is \`delta.md\` in the \`coverage-report-html\` artifact.\n`;
  const reserve = notice(limit).length + 64; // room for the notice and closing tags
  const kept: string[] = [];
  let length = 0;
  for (const line of text.split('\n')) {
    if (length + line.length + 1 > limit - reserve) break;
    kept.push(line);
    length += line.length + 1;
  }
  const body = kept.join('\n');
  const open = (body.match(/<details>/g) ?? []).length - (body.match(/<\/details>/g) ?? []).length;
  const closing = open > 0 ? `\n${'\n</details>'.repeat(open)}` : '';
  return `${body}${closing}\n${notice(body.length)}`;
}

/**
 * Renders delta.md.
 *
 * @param delta - Delta report.
 * @param headGaps - Head gaps.json (for the "top gaps in head" table).
 * @param options - Rendering options.
 */
export function renderDeltaMarkdown(
  delta: DeltaReport,
  headGaps: GapsReport,
  options: DeltaMarkdownOptions,
): string {
  const { top } = options;
  const t = delta.totals;
  const g = delta.gaps.summary;
  const ops = delta.operations;
  const lines: string[] = [
    '## API coverage delta',
    '',
    `**Verdict: ${delta.verdict}**${delta.verdictReasons.length ? ` — ${delta.verdictReasons.join('; ')}` : ''}`,
    '',
    `Base ${gitLabel(delta.base.git)} → Head ${gitLabel(delta.head.git)} · spec ${delta.specChanged ? `**changed** (v${md(delta.base.spec.version)} → v${md(delta.head.spec.version)})` : 'unchanged'}`,
    '',
    '| Dimension | Base | Head | Δ covered | Δ % |',
    '|---|---:|---:|---:|---:|',
    row('Operations', t.operations),
    row('Statuses', t.statuses),
    row('Parameters', t.parameters),
    row('↳ required', t.parameters.required),
    row('↳ optional', t.parameters.optional),
    '',
    `Gaps: **${g.opened} opened** · **${g.closed} closed** · ${g.headTotal} in head (base ${g.baseTotal})`,
    '',
  ];
  if (ops.added.length > 0 || ops.removed.length > 0) {
    lines.push(
      `### Operations added to the spec (${ops.added.length})`,
      '',
      ...list(
        ops.added.map((a) => `\`${md(a.key)}\` ${a.covered ? '✅ covered' : '❌ not covered'}`),
        top,
      ),
      '',
      `### Operations removed from the spec (${ops.removed.length})`,
      '',
      ...list(
        ops.removed.map((k) => `\`${md(k)}\``),
        top,
      ),
      '',
    );
  }
  lines.push(
    `### Newly covered (${ops.newlyCovered.length})`,
    '',
    ...list(
      ops.newlyCovered.map((k) => `\`${md(k)}\``),
      top,
    ),
    '',
    `### Regressions — no longer covered (${ops.noLongerCovered.length})`,
    '',
    ...list(
      ops.noLongerCovered.map((k) => `\`${md(k)}\``),
      top,
    ),
    '',
    `### New gaps (${Math.min(top, delta.gaps.opened.length)} of ${delta.gaps.opened.length})`,
    '',
    ...gapTable(delta.gaps.opened.slice(0, top)),
  );
  if (delta.gaps.opened.length > top) {
    lines.push(
      '',
      `<details><summary>${delta.gaps.opened.length - top} more new gaps</summary>`,
      '',
      ...delta.gaps.opened.slice(top).map((gap) => `- \`${md(gap.id)}\``),
      '',
      '</details>',
    );
  }
  lines.push(
    '',
    `### Top ${Math.min(top, headGaps.gaps.length)} gaps in head (of ${headGaps.gaps.length})`,
    '',
    ...gapTable(headGaps.gaps.slice(0, top)),
    '',
  );
  return truncateMarkdown(`${lines.join('\n')}\n`, options.limit ?? MARKDOWN_LIMIT);
}

/**
 * Short plain-text rendering for the console.
 *
 * @param delta - Delta report.
 */
export function renderDeltaConsole(delta: DeltaReport): string {
  const t = delta.totals;
  const line = (label: string, d: DimensionDelta): string =>
    `${label.padEnd(12)} ${cell(d.base).padStart(22)} → ${cell(d.head).padStart(22)}   Δ covered ${signed(d.delta.covered).padStart(4)}   Δ% ${signed(d.delta.pct)}`;
  const o = delta.operations;
  return [
    `API coverage delta — verdict: ${delta.verdict.toUpperCase()}`,
    ...delta.verdictReasons.map((r) => `  · ${r}`),
    `spec ${delta.specChanged ? 'CHANGED' : 'unchanged'} · gaps opened ${delta.gaps.summary.opened} · closed ${delta.gaps.summary.closed}`,
    line('Operations', t.operations),
    line('Statuses', t.statuses),
    line('Parameters', t.parameters),
    `added ${o.added.length} · removed ${o.removed.length} · newly covered ${o.newlyCovered.length} · no longer covered ${o.noLongerCovered.length}`,
    '',
  ].join('\n');
}
