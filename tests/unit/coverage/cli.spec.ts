/**
 * Unit tests for the coverage CLI (tools/coverage/src/main.ts): exit codes,
 * output files and determinism. The CLI runs in-process through `run()` with
 * injected I/O, so no child process and no network are needed.
 *
 * Run with: npm run test:unit
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { type CliIo, run } from '@coverage/main';

const FIXTURES = join(__dirname, 'fixtures');

/** Captured output of one CLI run. */
interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the CLI against the mini fixtures.
 *
 * @param args - Extra CLI arguments.
 * @param now - Clock value for generatedAt.
 */
function runCli(args: string[], now = '2026-01-01T00:00:00.000Z'): Captured {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    env: {},
    now: () => new Date(now),
    isTTY: false,
    git: () => ({ sha: 'abc123', branch: 'test-branch' }),
  };
  const code = run(
    [
      '--spec',
      join(FIXTURES, 'mini-openapi.json'),
      '--config',
      join(FIXTURES, 'coverage.config.json'),
      ...args,
    ],
    io,
  );
  return { code, stdout, stderr };
}

/**
 * Reads a JSON file and removes its generatedAt field.
 *
 * @param file - JSON file path.
 */
function withoutTimestamp(file: string): string {
  const document = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  delete document.generatedAt;
  return JSON.stringify(document);
}

test.describe('Coverage CLI', () => {
  test(
    'produces identical JSON for identical input, whatever the record order (determinism)',
    { tag: ['@smoke', '@tc-coverage-25'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const shuffledDir = test.info().outputPath('shuffled-records');
      mkdirSync(shuffledDir, { recursive: true });
      const lines = readFileSync(join(FIXTURES, 'requests.jsonl'), 'utf8').trim().split('\n');
      writeFileSync(join(shuffledDir, 'b.jsonl'), `${lines.slice(0, 8).reverse().join('\n')}\n`);
      writeFileSync(join(shuffledDir, 'a.jsonl'), `${lines.slice(8).reverse().join('\n')}\n`);
      const out1 = test.info().outputPath('run1');
      const out2 = test.info().outputPath('run2');
      const out3 = test.info().outputPath('run3');

      // --- ACT -------------------------------------------------------------
      runCli(['--records', FIXTURES, '--out', out1, '--format', 'json,gaps,markdown']);
      runCli(
        ['--records', FIXTURES, '--out', out2, '--format', 'json,gaps,markdown'],
        '2027-05-05T05:05:05.000Z',
      );
      runCli(['--records', shuffledDir, '--out', out3, '--format', 'gaps']);

      // --- ASSERT ----------------------------------------------------------
      expect(withoutTimestamp(join(out1, 'coverage.json'))).toBe(
        withoutTimestamp(join(out2, 'coverage.json')),
      );
      expect(withoutTimestamp(join(out1, 'gaps.json'))).toBe(
        withoutTimestamp(join(out2, 'gaps.json')),
      );
      expect(readFileSync(join(out1, 'summary.md'), 'utf8')).toBe(
        readFileSync(join(out2, 'summary.md'), 'utf8'),
      );
      // Same records in a different order/file split → identical gap list.
      const gaps1 = JSON.parse(readFileSync(join(out1, 'gaps.json'), 'utf8')) as {
        gaps: unknown[];
      };
      const gaps3 = JSON.parse(readFileSync(join(out3, 'gaps.json'), 'utf8')) as {
        gaps: unknown[];
      };
      expect(gaps3.gaps).toEqual(gaps1.gaps);
    },
  );

  test(
    'exits 0 and writes coverage.json, gaps.json and summary.md',
    { tag: ['@smoke', '@tc-coverage-26'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const out = test.info().outputPath('out');

      // --- ACT -------------------------------------------------------------
      const result = runCli([
        '--records',
        FIXTURES,
        '--out',
        out,
        '--format',
        'console,json,gaps,markdown',
      ]);
      const coverage = JSON.parse(readFileSync(join(out, 'coverage.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      const gaps = JSON.parse(readFileSync(join(out, 'gaps.json'), 'utf8')) as Record<
        string,
        unknown
      >;

      // --- ASSERT ----------------------------------------------------------
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('API coverage — Mini API v0.0.1');
      expect(result.stdout).not.toContain('\u001b['); // no colors when not a TTY
      expect(coverage).toMatchObject({
        schemaVersion: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        source: { git: { sha: 'abc123', branch: 'test-branch' } },
      });
      expect(gaps).toMatchObject({
        schemaVersion: 1,
        summary: { total: 5, high: 1, medium: 4, low: 0 },
      });
      expect(readFileSync(join(out, 'summary.md'), 'utf8')).toContain(
        '| Operations | 6 | 7 | 85.71% |',
      );
    },
  );

  test(
    'exits 1 and names the dimension when a --min-* threshold is not met',
    { tag: ['@negative', '@tc-coverage-27'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const failing = runCli([
        '--records',
        FIXTURES,
        '--format',
        'json',
        '--out',
        test.info().outputPath('o1'),
        '--min-statuses',
        '90',
      ]);
      const passing = runCli([
        '--records',
        FIXTURES,
        '--format',
        'json',
        '--out',
        test.info().outputPath('o2'),
        '--min-operations',
        '80',
      ]);

      // --- ASSERT ----------------------------------------------------------
      expect(failing.code).toBe(1);
      expect(failing.stderr).toContain('statuses 58.33% < 90%');
      expect(passing.code).toBe(0);
    },
  );

  test(
    'exits 2 with an actionable message on usage and input errors',
    { tag: ['@negative', '@tc-coverage-28'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const emptyDir = test.info().outputPath('empty');
      mkdirSync(emptyDir, { recursive: true });
      const badSpec = test.info().outputPath('bad-spec.json');
      writeFileSync(badSpec, '{ not json');
      const badConfigDir = test.info().outputPath('cfg');
      mkdirSync(badConfigDir, { recursive: true });
      copyFileSync(join(FIXTURES, 'coverage.config.json'), join(badConfigDir, 'ok.json'));
      writeFileSync(
        join(badConfigDir, 'no-reason.json'),
        JSON.stringify({ excludeOperations: [{ method: 'GET', path: '/never' }] }),
      );

      // --- ACT -------------------------------------------------------------
      const unknownFlag = runCli(['--bogus']);
      const noRecords = runCli(['--records', emptyDir]);
      const invalidSpec = runCli(['--records', FIXTURES, '--spec', badSpec]);
      const noReason = runCli([
        '--records',
        FIXTURES,
        '--config',
        join(badConfigDir, 'no-reason.json'),
      ]);
      const badFormat = runCli(['--records', FIXTURES, '--format', 'xml']);

      // --- ASSERT ----------------------------------------------------------
      expect(unknownFlag.code).toBe(2);
      expect(unknownFlag.stderr).toContain("Unknown option '--bogus'");
      expect(noRecords.code).toBe(2);
      expect(noRecords.stderr).toContain('npm run test:api');
      expect(invalidSpec.code).toBe(2);
      expect(invalidSpec.stderr).toContain('is not valid JSON');
      expect(noReason.code).toBe(2);
      expect(noReason.stderr).toContain('needs a non-empty "reason"');
      expect(badFormat.code).toBe(2);
    },
  );
});
