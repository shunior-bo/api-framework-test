/**
 * Human-readable console report. Colors only when enabled by the caller
 * (stdout is a TTY and NO_COLOR is not set).
 */
import type { CoverageReport, GapsReport, Ratio } from '../analyze/types.ts';

/** Rendering options. */
export interface ConsoleOptions {
  /** Number of gaps to list. */
  top: number;
  /** Emit ANSI colors. */
  color: boolean;
}

/**
 * Wraps text in an ANSI color when enabled.
 *
 * @param on - Whether colors are enabled.
 * @param code - ANSI SGR code.
 * @param text - Text to wrap.
 */
function paint(on: boolean, code: string, text: string): string {
  return on ? `\u001b[${code}m${text}\u001b[0m` : text;
}

/**
 * Formats a percentage ("n/a" when null).
 *
 * @param pct - Percentage or null.
 */
export function formatPct(pct: number | null): string {
  return pct === null ? 'n/a' : `${pct.toFixed(2)}%`;
}

/**
 * Colors a percentage: green ≥ 80, yellow ≥ 50, red otherwise.
 *
 * @param on - Colors enabled.
 * @param pct - Percentage.
 */
function pctColored(on: boolean, pct: number | null): string {
  const text = formatPct(pct);
  if (pct === null) return paint(on, '2', text);
  return paint(on, pct >= 80 ? '32' : pct >= 50 ? '33' : '31', text);
}

/**
 * Right-pads (or left-pads when `right` is true) a cell.
 *
 * @param text - Cell text (without color codes).
 * @param width - Column width.
 * @param right - Right-align.
 */
function cell(text: string, width: number, right = false): string {
  return right ? text.padStart(width) : text.padEnd(width);
}

/**
 * Formats "covered/total pct" for the tag table.
 *
 * @param r - Ratio.
 */
function compact(r: Ratio): string {
  return `${r.covered}/${r.total} ${formatPct(r.pct)}`;
}

/**
 * Renders the console report.
 *
 * @param report - coverage.json document.
 * @param gaps - gaps.json document.
 * @param options - Rendering options.
 * @returns The full text, ending with a newline.
 */
export function renderConsole(
  report: CoverageReport,
  gaps: GapsReport,
  options: ConsoleOptions,
): string {
  const c = options.color;
  const out: string[] = [];
  const { spec } = report.source;
  const req = report.requests;
  const ignored = report.extras.ignoredUnmatched.reduce((n, u) => n + u.count, 0);

  out.push(
    paint(c, '1', `API coverage — ${spec.title} v${spec.version}`) +
      paint(c, '2', `  (${spec.path}, sha256 ${spec.sha256.slice(0, 12)})`),
  );
  out.push(
    `Requests: ${req.recorded} recorded · ${req.counted} counted · ${req.hooks} in hooks${
      report.options.includeHooks ? ' (included)' : ' (not counted)'
    } · ${req.unmatched} unmatched · ${ignored} ignored` +
      (report.options.onlyPassed ? ` · ${req.filteredByOutcome} filtered (--only-passed)` : '') +
      (req.errored > 0 ? ` · ${req.errored} errored (no response, not counted)` : ''),
  );
  out.push(
    `Scope: ${report.totals.operations.total} operations · ${report.excluded.length} excluded by ${report.options.configPath}`,
  );
  out.push('');

  out.push(
    paint(
      c,
      '1',
      `${cell('Dimension', 14)}${cell('Covered', 9, true)}${cell('Total', 8, true)}${cell('%', 10, true)}`,
    ),
  );
  const rows: [string, Ratio][] = [
    ['Operations', report.totals.operations],
    ['Statuses', report.totals.statuses],
    ['Parameters', report.totals.parameters],
    ['  required', report.totals.parameters.required],
    ['  optional', report.totals.parameters.optional],
  ];
  for (const [label, r] of rows) {
    const pct = formatPct(r.pct);
    out.push(
      `${cell(label, 14)}${cell(String(r.covered), 9, true)}${cell(String(r.total), 8, true)}${' '.repeat(Math.max(0, 10 - pct.length))}${pctColored(c, r.pct)}`,
    );
  }
  out.push('');

  const tags = Object.keys(report.byTag);
  const tagWidth = Math.max(8, ...tags.map((t) => t.length)) + 2;
  out.push(
    paint(
      c,
      '1',
      `${cell('By tag', tagWidth)}${cell('Operations', 20)}${cell('Statuses', 20)}Parameters`,
    ),
  );
  for (const tag of tags) {
    const t = report.byTag[tag];
    if (!t) continue;
    out.push(
      `${cell(tag, tagWidth)}${cell(compact(t.operations), 20)}${cell(compact(t.statuses), 20)}${compact(t.parameters)}`,
    );
  }
  out.push('');

  const s = gaps.summary;
  out.push(
    paint(c, '1', `Top ${Math.min(options.top, gaps.gaps.length)} gaps`) +
      ` (${s.total} total: ${s.high} high, ${s.medium} medium, ${s.low} low)`,
  );
  const prioColor: Record<string, string> = { high: '31', medium: '33', low: '36' };
  for (const gap of gaps.gaps.slice(0, options.top)) {
    out.push(
      `  ${paint(c, prioColor[gap.priority] ?? '0', cell(gap.priority.toUpperCase(), 7))}${cell(gap.type, 10)}${gap.id.slice(gap.id.indexOf(':') + 1)}`,
    );
    out.push(paint(c, '2', `         ${gap.hint}`));
  }
  out.push('');

  const warnings: string[] = [];
  for (const u of report.extras.unmatched) {
    warnings.push(
      `unmatched: ${u.method} ${u.path} ×${u.count} (${u.reason}${u.template ? `, template ${u.template}` : ''}; phases: ${u.phases.join(',')})`,
    );
  }
  for (const u of report.extras.undocumentedStatuses) {
    warnings.push(`undocumented status: ${u.key} returned ${u.status} ×${u.count}`);
  }
  for (const w of report.extras.specWarnings) warnings.push(`spec: ${w.message}`);
  for (const w of report.extras.configWarnings) warnings.push(`config: ${w}`);
  for (const l of report.extras.invalidRecordLines) {
    warnings.push(`corrupt record: ${l.file}:${l.line} (${l.reason})`);
  }
  for (const u of report.extras.ignoredUnmatched) {
    warnings.push(
      `ignored (config): ${u.method} ${u.path} ×${u.count} (phases: ${u.phases.join(',')})`,
    );
  }
  out.push(paint(c, '1', `Warnings (${warnings.length})`));
  for (const w of warnings) out.push(`  ${paint(c, '33', '!')} ${w}`);
  if (warnings.length === 0) out.push('  none');

  return `${out.join('\n')}\n`;
}
