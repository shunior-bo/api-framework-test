/**
 * `compare` subcommand: base vs head coverage delta.
 *
 *   node tools/coverage/src/cli.ts compare --base <dir> --head <dir>
 *        [--out reports/coverage/delta] [--format console,json,markdown,html]
 *        [--top 10] [--fail-on-negative operations|statuses|parameters|any]
 *
 * Each <dir> must hold coverage.json + gaps.json produced by the analyze command.
 * Exit codes: 0 OK · 1 --fail-on-negative triggered · 2 input/usage error.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { renderDeltaConsole, renderDeltaMarkdown } from '../report/deltaMarkdown.ts';
import { renderHtml } from '../report/html.ts';
import { toJson, TOOL } from '../report/build.ts';
import { InputError } from '../shared/errors.ts';
import { csv, type CliIo } from '../shared/io.ts';
import { computeDelta, FAIL_ON_NEGATIVE, negativeFailures, type FailOnNegative } from './delta.ts';
import { loadSnapshot } from './loadSnapshot.ts';

const FORMATS = ['console', 'json', 'markdown', 'html'] as const;

export const COMPARE_USAGE = `Usage: node tools/coverage/src/cli.ts compare --base <dir> --head <dir> [options]

  --base <dir>               Directory with the base coverage.json + gaps.json
  --head <dir>               Directory with the head coverage.json + gaps.json
  --out <dir>                Output directory (default: reports/coverage/delta)
  --format <list>            console,json,markdown,html (default: console)
                             json → delta.json · markdown → delta.md · html → index.html (head report + delta)
  --top <n>                  Items per list before collapsing (default: 10)
  --fail-on-negative <dim>   Exit 1 if the pct delta of <dim> is negative:
                             operations | statuses | parameters | any (any also fails on no-longer-covered operations)
  -h, --help                 Show this help

Exit codes: 0 OK · 1 --fail-on-negative triggered · 2 input/usage error.
`;

/**
 * Runs the compare subcommand.
 *
 * @param argv - Arguments after "compare".
 * @param io - Injected side effects.
 * @returns Exit code (InputError is thrown and mapped to 2 by the caller).
 */
export function runCompare(argv: string[], io: CliIo): number {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        base: { type: 'string' },
        head: { type: 'string' },
        out: { type: 'string' },
        format: { type: 'string' },
        top: { type: 'string' },
        'fail-on-negative': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (error) {
    throw new InputError(
      `${error instanceof Error ? error.message : String(error)}\n\n${COMPARE_USAGE}`,
    );
  }
  if (values.help) {
    io.stdout(COMPARE_USAGE);
    return 0;
  }
  if (!values.base || !values.head) {
    throw new InputError(`compare needs both --base and --head.\n\n${COMPARE_USAGE}`);
  }
  const formats = csv(values.format ?? 'console');
  for (const f of formats) {
    if (!(FORMATS as readonly string[]).includes(f)) {
      throw new InputError(`Unknown compare format "${f}". Use any of: ${FORMATS.join(', ')}.`);
    }
  }
  const top = values.top === undefined ? 10 : Number(values.top);
  if (!Number.isInteger(top) || top < 0) {
    throw new InputError(`--top expects a non-negative integer, got "${values.top}".`);
  }
  const failOn = values['fail-on-negative'];
  if (failOn !== undefined && !(FAIL_ON_NEGATIVE as readonly string[]).includes(failOn)) {
    throw new InputError(
      `--fail-on-negative expects one of ${FAIL_ON_NEGATIVE.join(', ')}, got "${failOn}".`,
    );
  }
  const outDir = values.out ?? 'reports/coverage/delta';

  const base = loadSnapshot(values.base, 'base');
  const head = loadSnapshot(values.head, 'head');
  const delta = computeDelta(base, head, io.now().toISOString());

  if (formats.includes('console')) io.stdout(renderDeltaConsole(delta));
  const files: [string, string, () => string][] = [
    ['json', 'delta.json', () => toJson(delta)],
    ['markdown', 'delta.md', () => renderDeltaMarkdown(delta, head.gaps, { top })],
    ['html', 'index.html', () => renderHtml(head.coverage, head.gaps, delta)],
  ];
  for (const [format, name, render] of files) {
    if (!formats.includes(format)) continue;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, name), render(), 'utf8');
    io.stderr(`${TOOL.name}: wrote ${join(outDir, name)}\n`);
  }

  if (failOn !== undefined) {
    const failures = negativeFailures(delta, failOn as FailOnNegative);
    if (failures.length > 0) {
      io.stderr(`${TOOL.name}: negative coverage delta (${failOn}): ${failures.join('; ')}\n`);
      return 1;
    }
  }
  return 0;
}
