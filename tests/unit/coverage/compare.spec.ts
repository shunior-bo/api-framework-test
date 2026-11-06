/**
 * Unit tests for the coverage `compare` subcommand (base vs head delta).
 *
 * Fixtures in fixtures/compare/ were produced by the real analyze command from
 * variants of the mini OpenAPI + records (fixed clock and git):
 *   base               mini spec, mini records
 *   head-improved      + GET /never 200 and POST /items 422 → more coverage
 *   head-spec-added    spec adds GET /extra, nobody tests it
 *   head-spec-removed  spec drops DELETE /items/{id}
 *   head-regressed     POST /items is no longer called
 *   head-schema-v2     base with schemaVersion 2 (incompatible)
 *
 * Run with: npm run test:unit
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { computeDelta, negativeFailures, ratioDelta } from '@coverage/compare/delta';
import { loadSnapshot } from '@coverage/compare/loadSnapshot';
import { renderDeltaMarkdown, truncateMarkdown } from '@coverage/report/deltaMarkdown';
import { type CliIo, run } from '@coverage/main';

const DIR = join(__dirname, 'fixtures', 'compare');
const T0 = '2026-01-01T00:00:00.000Z';

/**
 * Loads a fixture snapshot.
 *
 * @param name - Fixture directory name.
 */
function snap(name: string): ReturnType<typeof loadSnapshot> {
  return loadSnapshot(join(DIR, name), name);
}

/**
 * Runs `cli.ts compare` in-process.
 *
 * @param args - Arguments after "compare".
 * @param now - Clock value.
 */
function compareCli(args: string[], now = T0): { code: number; stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    env: {},
    now: () => new Date(now),
    isTTY: false,
  };
  return { code: run(['compare', ...args], io), stdout, stderr };
}

/**
 * Reads a JSON file without its generatedAt field.
 *
 * @param file - JSON file.
 */
function withoutTimestamp(file: string): string {
  const doc = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  delete doc.generatedAt;
  return JSON.stringify(doc);
}

test.describe('Coverage compare (delta)', () => {
  test(
    'identical inputs give a zero delta and an "unchanged" verdict',
    { tag: ['@smoke', '@tc-coverage-35'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const delta = computeDelta(snap('base'), snap('base'), T0);

      // --- ASSERT ----------------------------------------------------------
      expect(delta.verdict).toBe('unchanged');
      expect(delta.verdictReasons).toEqual([]);
      expect(delta.specChanged).toBe(false);
      for (const dim of [delta.totals.operations, delta.totals.statuses, delta.totals.parameters]) {
        expect(dim.delta).toEqual({ covered: 0, total: 0, pct: 0 });
      }
      expect(delta.operations).toEqual({
        added: [],
        removed: [],
        newlyCovered: [],
        noLongerCovered: [],
      });
      expect(delta.gaps.summary).toEqual({ opened: 0, closed: 0, headTotal: 5, baseTotal: 5 });
    },
  );

  test(
    'more tests → "improved" with newly covered operations and closed gaps',
    { tag: ['@regression', '@tc-coverage-36'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const delta = computeDelta(snap('base'), snap('head-improved'), T0);

      // --- ASSERT ----------------------------------------------------------
      expect(delta.verdict).toBe('improved');
      expect(delta.operations.newlyCovered).toEqual(['GET /never']);
      expect(delta.totals.operations.delta).toEqual({ covered: 1, total: 0, pct: 14.29 });
      expect(delta.totals.statuses.delta).toEqual({ covered: 2, total: 0, pct: 16.67 });
      expect(delta.gaps.closed).toEqual(['operation:GET /never', 'status:POST /items:422']);
      // GET /never is covered now, but its 404 and ?page are still pending.
      expect(delta.gaps.opened.map((g) => g.id)).toEqual([
        'status:GET /never:404',
        'parameter:GET /never:query:page',
      ]);
    },
  );

  test(
    'spec adds an uncovered operation → pct drops, covered unchanged, "regressed"',
    { tag: ['@regression', '@tc-coverage-37'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const delta = computeDelta(snap('base'), snap('head-spec-added'), T0);

      // --- ASSERT ----------------------------------------------------------
      expect(delta.specChanged).toBe(true);
      expect(delta.operations.added).toEqual([{ key: 'GET /extra', covered: false }]);
      expect(delta.totals.operations.delta).toEqual({ covered: 0, total: 1, pct: -10.71 });
      expect(delta.verdict).toBe('regressed');
      expect(delta.verdictReasons).toContain('regression: uncovered operations added to the spec');
      expect(delta.gaps.opened.map((g) => g.id)).toEqual(['operation:GET /extra']);
    },
  );

  test(
    'spec removes an operation → listed in "removed" and its gaps close',
    { tag: ['@regression', '@tc-coverage-38'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const delta = computeDelta(snap('base'), snap('head-spec-removed'), T0);

      // --- ASSERT ----------------------------------------------------------
      expect(delta.operations.removed).toEqual(['DELETE /items/{id}']);
      expect(delta.gaps.closed).toEqual(['status:DELETE /items/{id}:404']);
      expect(delta.totals.operations.delta.total).toBe(-1);
    },
  );

  test(
    'an operation that is no longer called is a regression',
    { tag: ['@negative', '@tc-coverage-39'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const delta = computeDelta(snap('base'), snap('head-regressed'), T0);

      // --- ASSERT ----------------------------------------------------------
      expect(delta.operations.noLongerCovered).toEqual(['POST /items']);
      expect(delta.verdict).toBe('regressed');
      expect(delta.gaps.opened.map((g) => g.id)).toEqual(['operation:POST /items']);
    },
  );

  test('mixed signals give a "mixed" verdict', { tag: ['@regression', '@tc-coverage-40'] }, () => {
    // --- ARRANGE ---------------------------------------------------------
    const head = snap('head-improved');
    head.coverage.operations = head.coverage.operations.map((o) =>
      o.key === 'GET /items/search' ? { ...o, covered: false } : o,
    );

    // --- ACT -------------------------------------------------------------
    const delta = computeDelta(snap('base'), head, T0);

    // --- ASSERT ----------------------------------------------------------
    expect(delta.operations.noLongerCovered).toEqual(['GET /items/search']);
    expect(delta.verdict).toBe('mixed');
  });

  test(
    'the pct delta is null when either side has pct null',
    { tag: ['@negative', '@tc-coverage-41'] },
    () => {
      // --- ACT / ASSERT ----------------------------------------------------
      expect(
        ratioDelta({ covered: 0, total: 0, pct: null }, { covered: 1, total: 2, pct: 50 }),
      ).toEqual({
        covered: 1,
        total: 2,
        pct: null,
      });
      expect(
        ratioDelta({ covered: 1, total: 2, pct: 50 }, { covered: 0, total: 0, pct: null }).pct,
      ).toBeNull();
    },
  );

  test(
    '--fail-on-negative fails only for the chosen dimension (off by default)',
    { tag: ['@regression', '@tc-coverage-42'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const base = join(DIR, 'base');
      const added = join(DIR, 'head-spec-added');
      const out = test.info().outputPath('fail-on');
      const exit = (head: string, extra: string[]) =>
        compareCli(['--base', base, '--head', head, '--out', out, ...extra]).code;

      // --- ACT / ASSERT ----------------------------------------------------
      expect(exit(added, [])).toBe(0);
      expect(exit(added, ['--fail-on-negative', 'operations'])).toBe(1);
      expect(exit(added, ['--fail-on-negative', 'statuses'])).toBe(1);
      expect(exit(added, ['--fail-on-negative', 'parameters'])).toBe(0);
      expect(exit(added, ['--fail-on-negative', 'any'])).toBe(1);
      expect(exit(join(DIR, 'head-improved'), ['--fail-on-negative', 'any'])).toBe(0);
      expect(exit(added, ['--fail-on-negative', 'bogus'])).toBe(2);
      expect(
        negativeFailures(computeDelta(snap('base'), snap('head-regressed'), T0), 'any'),
      ).toContain('1 operation(s) no longer covered');
    },
  );

  test(
    'incompatible schemaVersion or missing input exits 2 with a clear message',
    { tag: ['@negative', '@tc-coverage-43'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const v2 = compareCli(['--base', join(DIR, 'base'), '--head', join(DIR, 'head-schema-v2')]);
      const missingDir = compareCli(['--base', join(DIR, 'base'), '--head', join(DIR, 'nope')]);
      const missingFlag = compareCli(['--base', join(DIR, 'base')]);

      // --- ASSERT ----------------------------------------------------------
      expect(v2.code).toBe(2);
      expect(v2.stderr).toContain('schemaVersion 2');
      expect(missingDir.code).toBe(2);
      expect(missingDir.stderr).toContain('head: cannot read');
      expect(missingFlag.code).toBe(2);
      expect(missingFlag.stderr).toContain('needs both --base and --head');
    },
  );

  test(
    'markdown has the headline table and is truncated deterministically under the limit',
    { tag: ['@regression', '@tc-coverage-44'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const head = snap('head-improved');
      const delta = computeDelta(snap('base'), head, T0);
      const big = `${'<details><summary>x</summary>\n'}${'- line\n'.repeat(5000)}</details>\n`;

      // --- ACT -------------------------------------------------------------
      const markdown = renderDeltaMarkdown(delta, head.gaps, { top: 1 });
      const truncated = truncateMarkdown(big, 2000);

      // --- ASSERT ----------------------------------------------------------
      expect(markdown).toContain('| Operations | 6/7 (85.71%) | 7/7 (100.00%) | ▲ +1 | ▲ +14.29 |');
      expect(markdown).toContain('**Verdict: improved**');
      expect(markdown).toContain('<details><summary>1 more new gaps</summary>');
      expect(truncated.length).toBeLessThanOrEqual(2000);
      expect(truncated).toContain('Truncated: showing');
      expect(truncated.match(/<details>/g)?.length).toBe(truncated.match(/<\/details>/g)?.length);
      expect(truncateMarkdown(big, 2000)).toBe(truncated);
    },
  );

  test(
    'compare is deterministic apart from generatedAt',
    { tag: ['@smoke', '@tc-coverage-45'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const out1 = test.info().outputPath('d1');
      const out2 = test.info().outputPath('d2');
      const args = [
        '--base',
        join(DIR, 'base'),
        '--head',
        join(DIR, 'head-spec-added'),
        '--format',
        'json,markdown,html',
      ];

      // --- ACT -------------------------------------------------------------
      compareCli([...args, '--out', out1], T0);
      compareCli([...args, '--out', out2], '2030-12-31T23:59:59.000Z');

      // --- ASSERT ----------------------------------------------------------
      expect(withoutTimestamp(join(out1, 'delta.json'))).toBe(
        withoutTimestamp(join(out2, 'delta.json')),
      );
      expect(readFileSync(join(out1, 'delta.md'), 'utf8')).toBe(
        readFileSync(join(out2, 'delta.md'), 'utf8'),
      );
      expect(readFileSync(join(out1, 'index.html'), 'utf8')).toBe(
        readFileSync(join(out2, 'index.html'), 'utf8'),
      );
    },
  );
});
