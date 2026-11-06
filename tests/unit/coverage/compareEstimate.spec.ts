/**
 * Unit tests for tools/coverage/src/estimate/compare.ts (Day 2 experiment helper).
 *
 * Run with: npm run test:unit
 */
import { test, expect } from '@playwright/test';
import { compareEstimates, extractEstimate, type ToolResult } from '@coverage/estimate/compare';

const tool: ToolResult = {
  operations: { covered: 2, total: 10, pct: 20 },
  statuses: { covered: 3, total: 30, pct: 10 },
  parameters: { covered: 1, total: 4, pct: 25 },
  coveredOperations: ['GET /a', 'POST /a'],
  topGaps: ['operation:GET /b'],
  allGapIds: ['operation:GET /b', 'status:POST /a:422'],
};

test.describe('compare-estimate', () => {
  test(
    'extracts the last json block of an AI answer',
    { tag: ['@regression', '@tc-coverage-33'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const answer = [
        'Draft:',
        '```json',
        '{ "draft": true }',
        '```',
        'Final:',
        '```json',
        '{"operations":{"covered":3,"total":10},"statuses":{"covered":3,"total":30,"pct":10},',
        '"parameters":{"covered":1,"total":4,"pct":25},"coveredOperations":["GET /a"],"topGaps":[]}',
        '```',
      ].join('\n');

      // --- ACT -------------------------------------------------------------
      const estimate = extractEstimate(answer, 'run-1.md');

      // --- ASSERT ----------------------------------------------------------
      expect(estimate.operations).toEqual({ covered: 3, total: 10, pct: 30 });
      expect(estimate.coveredOperations).toEqual(['GET /a']);
      expect(() => extractEstimate('no json here', 'run-2.md')).toThrow('no ```json block');
    },
  );

  test(
    'reports errors, spread, false positives and false negatives per run',
    { tag: ['@regression', '@tc-coverage-34'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const base = { statuses: tool.statuses, parameters: tool.parameters, topGaps: [] };
      const run1 = {
        ...base,
        operations: { covered: 3, total: 10, pct: 30 },
        coveredOperations: ['GET /a', 'GET /x'],
      };
      const run2 = {
        ...base,
        operations: { covered: 1, total: 10, pct: 10 },
        coveredOperations: ['GET /a'],
      };

      // --- ACT -------------------------------------------------------------
      const comparison = compareEstimates(['run-1', 'run-2'], [run1, run2], tool);
      const covered = comparison.rows.find((r) => r.metric === 'operations.covered');

      // --- ASSERT ----------------------------------------------------------
      expect(covered).toEqual({
        metric: 'operations.covered',
        runs: [3, 1],
        tool: 2,
        errors: [1, -1],
        spread: 2,
      });
      expect(comparison.falsePositives).toEqual([['GET /x'], []]);
      expect(comparison.falseNegatives).toEqual([['POST /a'], ['POST /a']]);
    },
  );
});
