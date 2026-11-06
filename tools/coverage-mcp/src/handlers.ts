/**
 * Handlers behind the api-coverage MCP tools.
 *
 * They REUSE the coverage tool's modules (tools/coverage/src) — no duplicated
 * logic and no parsing of console output. Each handler returns a plain JSON
 * value; server.ts wraps it as MCP tool content.
 *
 * Side effects:
 *   summary / listGaps / getOperation   read-only
 *   compare                              writes delta.json + delta.md under reports/
 *   runCoverage                          runs the API tests against the local GAD,
 *                                        then re-analyzes coverage (writes reports/)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CoverageReport, GapsReport } from '../../coverage/src/analyze/types.ts';
import { computeDelta } from '../../coverage/src/compare/delta.ts';
import { loadSnapshot } from '../../coverage/src/compare/loadSnapshot.ts';
import { selectBatch, type GapFilters } from '../../coverage/src/gaps/select.ts';
import { run as runCoverageCli } from '../../coverage/src/main.ts';
import { renderDeltaMarkdown } from '../../coverage/src/report/deltaMarkdown.ts';
import { toJson } from '../../coverage/src/report/build.ts';
import { InputError } from '../../coverage/src/shared/errors.ts';
import { loadSpecDocument, operationContext } from '../../coverage/src/spec/operationContext.ts';

/** Where the handlers read and write. */
export interface McpPaths {
  /** Repository root (cwd for test runs). */
  root: string;
  /** Directory holding coverage.json / gaps.json (default <root>/reports/coverage). */
  coverageDir: string;
  /** OpenAPI JSON (default <root>/spec/openapi.json). */
  spec: string;
  /** coverage.config.json (default <root>/tools/coverage/coverage.config.json). */
  config: string;
}

/** Hard ceiling for coverage_run. */
export const MAX_RUN_SECONDS = 1800;

/** Characters of stderr/stdout returned by coverage_run. */
const TAIL_CHARS = 4000;

/**
 * Builds default paths from a repository root.
 *
 * @param root - Repository root.
 * @param overrides - Optional overrides.
 */
export function defaultPaths(root: string, overrides: Partial<McpPaths> = {}): McpPaths {
  const r = resolve(root);
  return {
    root: r,
    coverageDir: resolve(r, overrides.coverageDir ?? 'reports/coverage'),
    spec: resolve(r, overrides.spec ?? 'spec/openapi.json'),
    config: resolve(r, overrides.config ?? 'tools/coverage/coverage.config.json'),
  };
}

/**
 * Reads a JSON report from the coverage directory.
 *
 * @param paths - Paths.
 * @param name - File name.
 */
function readReport<T>(paths: McpPaths, name: string): T {
  const file = join(paths.coverageDir, name);
  if (!existsSync(file)) {
    throw new InputError(
      `${file} not found. Run the coverage_run tool (or \`npm run test:api:coverage\`) first.`,
    );
  }
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/**
 * coverage_summary: totals, per-tag coverage and gap counts of the latest run.
 *
 * @param paths - Paths.
 */
export function summary(paths: McpPaths): unknown {
  const coverage = readReport<CoverageReport>(paths, 'coverage.json');
  const gaps = readReport<GapsReport>(paths, 'gaps.json');
  return {
    generatedAt: coverage.generatedAt,
    spec: coverage.source.spec,
    git: coverage.source.git,
    requests: coverage.requests,
    totals: coverage.totals,
    byTag: coverage.byTag,
    gaps: gaps.summary,
    excluded: coverage.excluded.length,
  };
}

/**
 * coverage_list_gaps: deterministic batch with resolved spec context.
 *
 * @param paths - Paths.
 * @param filters - Same filters as the `gaps` CLI subcommand.
 */
export function listGaps(paths: McpPaths, filters: Partial<GapFilters>): unknown {
  const report = readReport<GapsReport>(paths, 'gaps.json');
  return selectBatch(
    report,
    join(paths.coverageDir, 'gaps.json'),
    loadSpecDocument(paths.spec),
    filters,
  );
}

/**
 * coverage_get_operation: coverage detail + resolved spec of one operation.
 *
 * @param paths - Paths.
 * @param key - Operation key, e.g. "POST /likes" (template path without /api).
 */
export function getOperation(paths: McpPaths, key: string): unknown {
  const match = /^([A-Za-z]+)\s+(\/\S*)$/.exec(key.trim());
  if (!match) throw new InputError(`Operation key must look like "POST /likes", got "${key}".`);
  const method = (match[1] ?? '').toUpperCase();
  const path = match[2] ?? '';
  const normalizedKey = `${method} ${path}`;
  const coverage = readReport<CoverageReport>(paths, 'coverage.json');
  const gaps = readReport<GapsReport>(paths, 'gaps.json');
  const spec = operationContext(loadSpecDocument(paths.spec), method, path);
  if (!spec) throw new InputError(`Operation "${normalizedKey}" is not in ${paths.spec}.`);
  const excluded = coverage.excluded.find((e) => e.key === normalizedKey) ?? null;
  return {
    key: normalizedKey,
    excluded,
    coverage: coverage.operations.find((o) => o.key === normalizedKey) ?? null,
    gaps: gaps.gaps.filter((g) => g.method === method && g.path === path),
    spec,
  };
}

/**
 * coverage_compare: delta between two snapshot directories.
 *
 * @param paths - Paths.
 * @param base - Base directory (coverage.json + gaps.json).
 * @param head - Head directory (default: the coverage directory).
 * @param outDir - Where delta.json / delta.md are written.
 * @param now - Clock.
 */
export function compare(
  paths: McpPaths,
  base: string,
  head: string | undefined,
  outDir: string | undefined,
  now: () => Date = () => new Date(),
): unknown {
  const baseDir = resolve(paths.root, base);
  const headDir = head ? resolve(paths.root, head) : paths.coverageDir;
  const out = resolve(paths.root, outDir ?? join(paths.coverageDir, 'delta'));
  const headSnap = loadSnapshot(headDir, 'head');
  const delta = computeDelta(loadSnapshot(baseDir, 'base'), headSnap, now().toISOString());
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'delta.json'), toJson(delta), 'utf8');
  writeFileSync(
    join(out, 'delta.md'),
    renderDeltaMarkdown(delta, headSnap.gaps, { top: 10 }),
    'utf8',
  );
  return {
    written: [join(out, 'delta.json'), join(out, 'delta.md')],
    verdict: delta.verdict,
    verdictReasons: delta.verdictReasons,
    specChanged: delta.specChanged,
    totals: delta.totals,
    operations: delta.operations,
    gaps: {
      summary: delta.gaps.summary,
      closed: delta.gaps.closed,
      opened: delta.gaps.opened.map((g) => g.id),
    },
  };
}

/** A failed test parsed from the JUnit report. */
export interface FailedTest {
  name: string;
  message: string;
}

/**
 * Extracts counts and failures from Playwright's JUnit XML (reports/results.xml).
 *
 * @param xml - JUnit XML text.
 */
export function parseJunit(xml: string): {
  tests: number;
  failures: number;
  skipped: number;
  failed: FailedTest[];
} {
  const attr = (tag: string, name: string): number => {
    const m = new RegExp(`${name}="(\\d+)"`).exec(tag);
    return m ? Number(m[1]) : 0;
  };
  const root = /<testsuites[^>]*>/.exec(xml)?.[0] ?? '';
  const unescape = (s: string): string =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  const failed: FailedTest[] = [];
  for (const m of xml.matchAll(/<testcase\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/testcase>/g)) {
    const body = m[2] ?? '';
    const failure = /<failure[^>]*message="([^"]*)"/.exec(body);
    if (failure) {
      failed.push({
        name: unescape(m[1] ?? ''),
        message: unescape(failure[1] ?? '').slice(0, 500),
      });
    }
  }
  return {
    tests: attr(root, 'tests'),
    failures: attr(root, 'failures') + attr(root, 'errors'),
    skipped: attr(root, 'skipped'),
    failed,
  };
}

/** Options of coverage_run. */
export interface RunOptions {
  /** Playwright --grep pattern. */
  grep?: string;
  /** Spec files under tests/api/ to run (default: the whole api project). */
  files?: string[];
  /** Timeout in seconds (default 600, max MAX_RUN_SECONDS). */
  timeoutSec?: number;
}

/**
 * coverage_run: runs the API tests, then re-analyzes coverage.
 *
 * A filtered run (grep/files) REPLACES the recorded data, so the coverage then
 * reflects only that subset; run without filters to measure the full suite.
 *
 * @param paths - Paths.
 * @param options - Run options.
 */
export async function runCoverage(paths: McpPaths, options: RunOptions): Promise<unknown> {
  const files = options.files ?? [];
  for (const f of files) {
    if (!/^tests\/api\/[\w./-]+\.spec\.ts$/.test(f) || f.includes('..')) {
      throw new InputError(`files must be spec paths under tests/api/, got "${f}".`);
    }
  }
  const timeoutSec = Math.min(options.timeoutSec ?? 600, MAX_RUN_SECONDS);
  const args = ['playwright', 'test', '--project=api', ...files];
  if (options.grep) args.push('--grep', options.grep);

  const started = Date.now();
  const result = await new Promise<{
    code: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
  }>((done) => {
    const child = spawn('npx', args, {
      cwd: paths.root,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d: Buffer) => {
      stdout = (stdout + d.toString()).slice(-TAIL_CHARS * 4);
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-TAIL_CHARS * 4);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutSec * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, timedOut, stdout, stderr });
    });
  });

  let analyzeErr = '';
  const analyzeCode = runCoverageCli(
    [
      '--spec',
      paths.spec,
      '--config',
      paths.config,
      '--records',
      join(paths.root, 'reports/coverage/raw'),
      '--out',
      paths.coverageDir,
      '--format',
      'json,gaps,markdown,html',
    ],
    {
      stdout: () => undefined,
      stderr: (t) => {
        analyzeErr += t;
      },
      env: process.env,
      now: () => new Date(),
      isTTY: false,
    },
  );

  const junitFile = join(paths.root, 'reports/results.xml');
  const junit = existsSync(junitFile) ? parseJunit(readFileSync(junitFile, 'utf8')) : null;
  let totals: unknown = null;
  let gapsSummary: unknown = null;
  if (analyzeCode === 0) {
    totals = readReport<CoverageReport>(paths, 'coverage.json').totals;
    gapsSummary = readReport<GapsReport>(paths, 'gaps.json').summary;
  }
  return {
    testsExitCode: result.code,
    timedOut: result.timedOut,
    durationSec: Math.round((Date.now() - started) / 1000),
    command: `npx ${args.join(' ')}`,
    partialRun: files.length > 0 || Boolean(options.grep),
    tests: junit,
    coverage: {
      exitCode: analyzeCode,
      totals,
      gaps: gapsSummary,
      error: analyzeErr.slice(-TAIL_CHARS) || null,
    },
    stdoutTail: result.stdout.slice(-TAIL_CHARS),
    stderrTail: result.stderr.slice(-TAIL_CHARS),
  };
}
