/**
 * Unit tests for tools/coverage analysis (3 dimensions, options, exclusions)
 * and gap prioritization.
 *
 * Fixtures: fixtures/mini-openapi.json (8 operations), fixtures/requests.jsonl
 * (hand-written records, incl. hooks, failures, unmatched and corrupt lines)
 * and fixtures/coverage.config.json (1 exclusion + 1 ignore glob).
 *
 * Run with: npm run test:unit
 */
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { loadConfig } from '@coverage/analyze/config';
import { analyzeCoverage, sumTotals } from '@coverage/analyze/coverage';
import { buildGaps } from '@coverage/analyze/gaps';
import { loadRecords } from '@coverage/records/loadRecords';
import { loadSpec } from '@coverage/spec/loadSpec';

const FIXTURES = join(__dirname, 'fixtures');
const spec = loadSpec(join(FIXTURES, 'mini-openapi.json'));
const config = loadConfig(join(FIXTURES, 'coverage.config.json'));
const { records, invalid } = loadRecords(FIXTURES);
const DEFAULTS = { includeHooks: false, onlyPassed: false };

test.describe('Coverage analysis', () => {
  test(
    'computes the three dimensions with default options',
    { tag: ['@smoke', '@tc-coverage-11'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const analysis = analyzeCoverage(spec, records, config, DEFAULTS);

      // --- ASSERT ----------------------------------------------------------
      expect(analysis.totals.operations).toEqual({ covered: 6, total: 7, pct: 85.71 });
      expect(analysis.totals.statuses).toEqual({ covered: 7, total: 12, pct: 58.33 });
      expect(analysis.totals.parameters).toEqual({
        covered: 6,
        total: 8,
        pct: 75,
        required: { covered: 4, total: 5, pct: 80 },
        optional: { covered: 2, total: 3, pct: 66.67 },
      });
    },
  );

  test(
    'query and header parameters are covered by name, headers case-insensitively',
    { tag: ['@regression', '@tc-coverage-12'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const analysis = analyzeCoverage(spec, records, config, DEFAULTS);
      const listItems = analysis.operations.find((o) => o.key === 'GET /items');

      // --- ASSERT ----------------------------------------------------------
      expect(listItems?.parameters).toEqual([
        { name: '_limit', in: 'query', required: false, declared: true, covered: true },
        { name: 'q', in: 'query', required: true, declared: true, covered: false },
        { name: 'X-Trace', in: 'header', required: false, declared: true, covered: true },
      ]);
    },
  );

  test(
    'implicit path parameters are covered when the operation is exercised',
    { tag: ['@regression', '@tc-coverage-13'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const analysis = analyzeCoverage(spec, records, config, DEFAULTS);
      const deleteItem = analysis.operations.find((o) => o.key === 'DELETE /items/{id}');

      // --- ASSERT ----------------------------------------------------------
      expect(deleteItem?.parameters).toEqual([
        { name: 'id', in: 'path', required: true, declared: false, covered: true },
      ]);
      // 204 covers the documented 2XX range.
      expect(deleteItem?.statuses).toContainEqual({ code: '2XX', covered: true, counted: true });
    },
  );

  test(
    '"default" responses are reported but not counted, and undocumented statuses are extras',
    { tag: ['@regression', '@tc-coverage-14'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const analysis = analyzeCoverage(spec, records, config, DEFAULTS);
      const createItem = analysis.operations.find((o) => o.key === 'POST /items');

      // --- ASSERT ----------------------------------------------------------
      expect(createItem?.statuses).toContainEqual({
        code: 'default',
        covered: true,
        counted: false,
      });
      // 418 on GET /items is drift; 500 on POST /items is covered by "default".
      expect(analysis.extras.undocumentedStatuses).toEqual([
        { key: 'GET /items', status: '418', count: 1 },
      ]);
    },
  );

  test(
    'unmatched requests are reported and ignoreUnmatched globs move them aside',
    { tag: ['@regression', '@tc-coverage-15'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const analysis = analyzeCoverage(spec, records, config, DEFAULTS);

      // --- ASSERT ----------------------------------------------------------
      expect(analysis.extras.unmatched).toEqual([
        {
          method: 'PUT',
          path: '/api/items/7',
          reason: 'method-not-documented',
          template: '/items/{id}',
          count: 1,
          phases: ['test'],
        },
        {
          method: 'GET',
          path: '/api/unknown',
          reason: 'path-not-documented',
          template: null,
          count: 1,
          phases: ['test'],
        },
      ]);
      expect(analysis.extras.ignoredUnmatched).toEqual([
        expect.objectContaining({ method: 'POST', path: '/api/config/features', phases: ['hook'] }),
      ]);
    },
  );

  test(
    'excluded operations leave the denominators and are listed with their reason',
    { tag: ['@regression', '@tc-coverage-16'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const analysis = analyzeCoverage(spec, records, config, DEFAULTS);

      // --- ASSERT ----------------------------------------------------------
      expect(analysis.excluded).toEqual([
        { key: 'POST /admin/reset', reason: 'Destructive: wipes all data.', requestCount: 1 },
      ]);
      expect(analysis.operations.map((o) => o.key)).not.toContain('POST /admin/reset');
      expect(Object.keys(analysis.byTag)).toEqual(['(untagged)', 'items', 'parts']);
    },
  );

  test(
    '--include-hooks counts requests made in beforeAll/afterAll',
    { tag: ['@regression', '@tc-coverage-17'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const without = analyzeCoverage(spec, records, config, DEFAULTS);
      const withHooks = analyzeCoverage(spec, records, config, { ...DEFAULTS, includeHooks: true });
      const status401 = (a: typeof without) =>
        a.operations.find((o) => o.key === 'GET /items')?.statuses.find((s) => s.code === '401');

      // --- ASSERT ----------------------------------------------------------
      expect(status401(without)?.covered).toBe(false);
      expect(status401(withHooks)?.covered).toBe(true);
      expect(withHooks.totals.statuses.covered).toBe(without.totals.statuses.covered + 1);
    },
  );

  test(
    '--only-passed ignores requests of tests that did not end as expected',
    { tag: ['@regression', '@tc-coverage-18'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const analysis = analyzeCoverage(spec, records, config, { ...DEFAULTS, onlyPassed: true });
      const getItem = analysis.operations.find((o) => o.key === 'GET /items/{id}');

      // --- ASSERT ----------------------------------------------------------
      expect(analysis.requests.filteredByOutcome).toBe(1);
      expect(getItem?.statuses.find((s) => s.code === '200')?.covered).toBe(false);
    },
  );

  test(
    'requests that threw (status null) never count as coverage',
    { tag: ['@negative', '@tc-coverage-19'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const analysis = analyzeCoverage(spec, records, config, DEFAULTS);

      // --- ASSERT ----------------------------------------------------------
      expect(analysis.requests.errored).toBe(1);
      expect(analysis.operations.find((o) => o.key === 'GET /never')?.covered).toBe(false);
    },
  );

  test(
    'pct is null (not NaN) when a dimension has no units',
    { tag: ['@negative', '@tc-coverage-20'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const totals = sumTotals([]);

      // --- ASSERT ----------------------------------------------------------
      expect(totals.operations).toEqual({ covered: 0, total: 0, pct: null });
      expect(totals.parameters.required.pct).toBeNull();
    },
  );

  test(
    'corrupt JSONL lines are reported and skipped',
    { tag: ['@negative', '@tc-coverage-21'] },
    () => {
      // --- ASSERT ----------------------------------------------------------
      expect(records).toHaveLength(15);
      expect(invalid).toEqual([
        { file: 'requests.jsonl', line: 15, reason: 'invalid JSON' },
        { file: 'requests.jsonl', line: 16, reason: 'unsupported record version 2' },
      ]);
    },
  );
});

test.describe('Coverage gaps', () => {
  test(
    'gaps are prioritized, ordered and uncovered operations are collapsed into one gap',
    { tag: ['@smoke', '@tc-coverage-22'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const analysis = analyzeCoverage(spec, records, config, DEFAULTS);

      // --- ACT -------------------------------------------------------------
      const gaps = buildGaps(analysis.operations, analysis.inScope);

      // --- ASSERT ----------------------------------------------------------
      expect(gaps.map((g) => `${g.priority} ${g.id}`)).toEqual([
        'high operation:GET /never',
        'medium status:GET /items:401',
        'medium parameter:GET /items:query:q',
        'medium status:POST /items:422',
        'medium status:DELETE /items/{id}:404',
      ]);
      expect(gaps[0]?.pending).toEqual({
        statuses: ['200', '404'],
        parameters: [{ name: 'page', in: 'query', required: false }],
      });
      expect(gaps.some((g) => g.id.startsWith('status:GET /never'))).toBe(false);
    },
  );

  test(
    'an uncovered 2xx status in a covered operation is high priority',
    { tag: ['@regression', '@tc-coverage-23'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const analysis = analyzeCoverage(spec, records, config, { ...DEFAULTS, onlyPassed: true });

      // --- ACT -------------------------------------------------------------
      const gaps = buildGaps(analysis.operations, analysis.inScope);
      const gap = gaps.find((g) => g.id === 'status:GET /items/{id}:200');

      // --- ASSERT ----------------------------------------------------------
      expect(gap?.priority).toBe('high');
      expect(gaps.indexOf(gap ?? gaps[0]!)).toBeLessThan(
        gaps.findIndex((g) => g.priority === 'medium'),
      );
    },
  );

  test(
    'hints are generated from spec data only',
    { tag: ['@regression', '@tc-coverage-24'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const analysis = analyzeCoverage(spec, records, config, DEFAULTS);

      // --- ACT -------------------------------------------------------------
      const gaps = buildGaps(analysis.operations, analysis.inScope);

      // --- ASSERT ----------------------------------------------------------
      expect(gaps.find((g) => g.id === 'status:POST /items:422')?.hint).toBe(
        'Documented 422 ("Invalid item") for POST /items is never exercised. Send an invalid payload (see components.schemas.ItemCreate).',
      );
      expect(gaps.find((g) => g.id === 'operation:GET /never')?.hint).toBe(
        'GET /never (Never called) is never called. Documented responses: 200, 404.',
      );
    },
  );
});
