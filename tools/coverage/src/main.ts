/**
 * Coverage CLI logic: argument parsing, orchestration and exit codes.
 *
 * Kept free of `import.meta` and `process` globals so it can be unit-tested
 * in-process (Playwright transpiles tests to CommonJS). cli.ts is the thin
 * entrypoint that wires real I/O.
 *
 * Exit codes: 0 OK · 1 a --min-* threshold not met · 2 input/usage error.
 * Gaps never cause a non-zero exit.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './analyze/config.ts';
import { analyzeCoverage } from './analyze/coverage.ts';
import { loadRecords } from './records/loadRecords.ts';
import { buildCoverageReport, buildGapsReport, toJson, TOOL } from './report/build.ts';
import { renderConsole } from './report/console.ts';
import { renderMarkdown } from './report/markdown.ts';
import { InputError } from './shared/errors.ts';
import { loadSpec } from './spec/loadSpec.ts';

/** Side effects injected by the caller. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  /** Clock for `generatedAt`. */
  now: () => Date;
  /** Whether stdout is a TTY (enables colors unless NO_COLOR is set). */
  isTTY: boolean;
  /** Git lookup; return nulls when unavailable. Defaults to the `git` binary. */
  git?: () => { sha: string | null; branch: string | null };
}

/** Output formats. */
const FORMATS = ['console', 'json', 'gaps', 'markdown'] as const;
type Format = (typeof FORMATS)[number];

export const USAGE = `Usage: node tools/coverage/src/cli.ts [options]

  --spec <file>           OpenAPI JSON (default: $OPENAPI_PATH or spec/openapi.json)
  --records <dir>         Raw JSONL records (default: reports/coverage/raw)
  --config <file>         Exclusions config (default: tools/coverage/coverage.config.json)
  --out <dir>             Output directory (default: reports/coverage)
  --format <list>         console,json,gaps,markdown (default: console)
  --top <n>               Gaps to list in console/markdown (default: 15)
  --include-hooks         Count requests made in beforeAll/afterAll
  --only-passed           Count only tests whose outcome matched the expectation
  --min-operations <pct>  Exit 1 if operation coverage is below <pct>
  --min-statuses <pct>    Exit 1 if status coverage is below <pct>
  --min-parameters <pct>  Exit 1 if parameter coverage is below <pct>
  -h, --help              Show this help

Exit codes: 0 OK · 1 threshold not met · 2 input/usage error. Gaps alone never fail.
`;

/**
 * Reads git metadata from CI variables, then from the git binary.
 *
 * @param env - Environment variables.
 */
function defaultGit(env: Record<string, string | undefined>): {
  sha: string | null;
  branch: string | null;
} {
  const run = (args: string[]): string | null => {
    try {
      return (
        execFileSync('git', args, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || null
      );
    } catch {
      return null;
    }
  };
  const sha = env.GITHUB_SHA || run(['rev-parse', 'HEAD']);
  const branch =
    env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || run(['rev-parse', '--abbrev-ref', 'HEAD']);
  return { sha: sha ?? null, branch: branch ?? null };
}

/**
 * Parses a percentage flag.
 *
 * @param flag - Flag name for messages.
 * @param value - Raw value.
 */
function parsePct(flag: string, value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new InputError(`--${flag} expects a number between 0 and 100, got "${value}".`);
  }
  return n;
}

/**
 * Runs the CLI.
 *
 * @param argv - Arguments without "node" and the script path.
 * @param io - Injected side effects.
 * @returns The process exit code.
 */
export function run(argv: string[], io: CliIo): number {
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args: argv,
        strict: true,
        allowPositionals: false,
        options: {
          spec: { type: 'string' },
          records: { type: 'string' },
          config: { type: 'string' },
          out: { type: 'string' },
          format: { type: 'string' },
          top: { type: 'string' },
          'include-hooks': { type: 'boolean' },
          'only-passed': { type: 'boolean' },
          'min-operations': { type: 'string' },
          'min-statuses': { type: 'string' },
          'min-parameters': { type: 'string' },
          help: { type: 'boolean', short: 'h' },
        },
      });
    } catch (error) {
      throw new InputError(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    }
    const v = parsed.values;
    if (v.help) {
      io.stdout(USAGE);
      return 0;
    }

    const formats = (v.format ?? 'console')
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
    for (const f of formats) {
      if (!(FORMATS as readonly string[]).includes(f)) {
        throw new InputError(`Unknown format "${f}". Use any of: ${FORMATS.join(', ')}.`);
      }
    }
    const top = v.top === undefined ? 15 : Number(v.top);
    if (!Number.isInteger(top) || top < 0)
      throw new InputError(`--top expects a non-negative integer, got "${v.top}".`);
    const thresholds = {
      operations: parsePct('min-operations', v['min-operations']),
      statuses: parsePct('min-statuses', v['min-statuses']),
      parameters: parsePct('min-parameters', v['min-parameters']),
    };

    const specPath = v.spec ?? (io.env.OPENAPI_PATH || 'spec/openapi.json');
    const recordsDir = v.records ?? 'reports/coverage/raw';
    const configPath = v.config ?? 'tools/coverage/coverage.config.json';
    const outDir = v.out ?? 'reports/coverage';
    const options = {
      includeHooks: v['include-hooks'] === true,
      onlyPassed: v['only-passed'] === true,
    };

    const spec = loadSpec(specPath);
    const config = loadConfig(configPath);
    const records = loadRecords(recordsDir);
    const analysis = analyzeCoverage(spec, records.records, config, options);
    const meta = {
      generatedAt: io.now().toISOString(),
      spec,
      records,
      options,
      configPath,
      git: (io.git ?? (() => defaultGit(io.env)))(),
    };
    const report = buildCoverageReport(analysis, meta);
    const gaps = buildGapsReport(analysis, meta);

    const selected = new Set<Format>(formats as Format[]);
    if (selected.has('console')) {
      io.stdout(renderConsole(report, gaps, { top, color: io.isTTY && !io.env.NO_COLOR }));
    }
    const files: [Format, string, string][] = [
      ['json', 'coverage.json', toJson(report)],
      ['gaps', 'gaps.json', toJson(gaps)],
      ['markdown', 'summary.md', renderMarkdown(report, gaps, top)],
    ];
    for (const [format, name, content] of files) {
      if (!selected.has(format)) continue;
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, name), content, 'utf8');
      io.stderr(`${TOOL.name}: wrote ${join(outDir, name)}\n`);
    }

    const failures: string[] = [];
    for (const [dim, min] of Object.entries(thresholds)) {
      if (min === null) continue;
      const pct = report.totals[dim as keyof typeof thresholds].pct;
      // A dimension with no units (pct null) has nothing to cover and passes.
      if (pct !== null && pct < min) failures.push(`${dim} ${pct.toFixed(2)}% < ${min}%`);
    }
    if (failures.length > 0) {
      io.stderr(`${TOOL.name}: coverage threshold not met: ${failures.join('; ')}\n`);
      return 1;
    }
    return 0;
  } catch (error) {
    if (error instanceof InputError) {
      io.stderr(`${TOOL.name}: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}
