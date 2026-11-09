/**
 * Unit tests for .github/scripts/pr-guards.js (the human-review required check).
 *
 * Run with: npm run test:unit
 */
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

/** Shape of the CommonJS module under test. */
interface PrGuardsModule {
  humanReview: (input: { action: string; labels: string[] }) => {
    ok: boolean;
    removeLabel: boolean;
    message: string;
  };
  run: (input: { github: unknown; context: unknown; core: unknown }) => Promise<{ ok: boolean }>;
}

const mod = require(join(process.cwd(), '.github', 'scripts', 'pr-guards.js')) as PrGuardsModule;

test.describe('pr-guards: human-review', () => {
  test('passes on PRs that are not ai-generated', () => {
    expect(mod.humanReview({ action: 'opened', labels: ['documentation'] })).toMatchObject({
      ok: true,
      removeLabel: false,
    });
  });

  test('fails on an ai-generated PR until a human adds human-reviewed', () => {
    expect(mod.humanReview({ action: 'opened', labels: ['ai-generated', 'ai-feature'] }).ok).toBe(
      false,
    );
    expect(
      mod.humanReview({ action: 'labeled', labels: ['ai-generated', 'human-reviewed'] }),
    ).toMatchObject({ ok: true, removeLabel: false });
  });

  test('a push after the review removes the label and fails', () => {
    expect(
      mod.humanReview({ action: 'synchronize', labels: ['ai-generated', 'human-reviewed'] }),
    ).toMatchObject({ ok: false, removeLabel: true });
  });

  test('run(): removes the label through the API and marks the check failed', async () => {
    const removed: unknown[] = [];
    let failed = '';
    await mod.run({
      github: { rest: { issues: { removeLabel: async (p: unknown) => removed.push(p) } } },
      context: {
        repo: { owner: 'shunior-bo', repo: 'api-framework-test' },
        payload: {
          action: 'synchronize',
          pull_request: {
            number: 31,
            labels: [{ name: 'ai-generated' }, { name: 'human-reviewed' }],
          },
        },
      },
      core: {
        info: () => undefined,
        warning: () => undefined,
        setFailed: (m: string) => (failed = m),
      },
    });
    expect(removed).toEqual([
      { owner: 'shunior-bo', repo: 'api-framework-test', issue_number: 31, name: 'human-reviewed' },
    ]);
    expect(failed).toContain('New commits were pushed after the review');
  });
});
