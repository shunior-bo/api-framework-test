/**
 * Unit tests for .github/scripts/upsert-pr-comment.js (sticky PR comment).
 *
 * A stub replaces the Octokit client injected by actions/github-script, so no
 * network is involved.
 *
 * Run with: npm run test:unit
 */
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

/** Shape of the CommonJS module under test. */
interface CommentModule {
  MARKER: string;
  MAX_BODY: number;
  buildCommentBody: (input: {
    deltaMarkdown: string | null;
    headSummary: string | null;
    runUrl: string;
    headSha: string | null;
    baseSha: string | null;
    testsOutcome: string;
  }) => string;
  upsertPrComment: (input: {
    github: unknown;
    repo: { owner: string; repo: string };
    issueNumber: number;
    body: string;
  }) => Promise<{ action: 'created' | 'updated'; id: number }>;
}

const mod = require(
  join(process.cwd(), '.github', 'scripts', 'upsert-pr-comment.js'),
) as CommentModule;

/** A call recorded by the stub. */
interface Call {
  method: string;
  params: Record<string, unknown>;
}

/**
 * Builds a stub Octokit holding `existing` comments.
 *
 * @param existing - Comments already on the PR.
 * @param calls - Sink for observed calls.
 */
function stubGithub(existing: { id: number; body: string }[], calls: Call[]): unknown {
  const listComments = async (params: Record<string, unknown>) => {
    calls.push({ method: 'listComments', params });
    return { data: existing };
  };
  return {
    paginate: async (fn: typeof listComments, params: Record<string, unknown>) =>
      (await fn(params)).data,
    rest: {
      issues: {
        listComments,
        updateComment: async (params: Record<string, unknown>) => {
          calls.push({ method: 'updateComment', params });
          return { data: {} };
        },
        createComment: async (params: Record<string, unknown>) => {
          calls.push({ method: 'createComment', params });
          return { data: { id: 999 } };
        },
      },
    },
  };
}

const repo = { owner: 'shunior-bo', repo: 'api-framework-test' };

test.describe('Sticky PR comment', () => {
  test(
    'creates the comment when none carries the marker',
    { tag: ['@smoke', '@tc-coverage-52'] },
    async () => {
      // --- ARRANGE ---------------------------------------------------------
      const calls: Call[] = [];
      const github = stubGithub([{ id: 1, body: 'LGTM' }], calls);

      // --- ACT -------------------------------------------------------------
      const result = await mod.upsertPrComment({ github, repo, issueNumber: 7, body: 'hello' });

      // --- ASSERT ----------------------------------------------------------
      expect(result).toEqual({ action: 'created', id: 999 });
      expect(calls.map((c) => c.method)).toEqual(['listComments', 'createComment']);
      expect(calls[1]?.params).toMatchObject({ issue_number: 7, body: `${mod.MARKER}\nhello` });
    },
  );

  test(
    'updates the existing marked comment instead of adding a new one',
    { tag: ['@regression', '@tc-coverage-53'] },
    async () => {
      // --- ARRANGE ---------------------------------------------------------
      const calls: Call[] = [];
      const github = stubGithub(
        [
          { id: 1, body: 'LGTM' },
          { id: 42, body: `${mod.MARKER}\nold report` },
        ],
        calls,
      );

      // --- ACT -------------------------------------------------------------
      const result = await mod.upsertPrComment({
        github,
        repo,
        issueNumber: 7,
        body: `${mod.MARKER}\nnew`,
      });

      // --- ASSERT ----------------------------------------------------------
      expect(result).toEqual({ action: 'updated', id: 42 });
      expect(calls.map((c) => c.method)).toEqual(['listComments', 'updateComment']);
      expect(calls[1]?.params).toMatchObject({ comment_id: 42, body: `${mod.MARKER}\nnew` });
    },
  );

  test(
    'the body shows the delta, or a "base coverage unavailable" notice, with shas and run link',
    { tag: ['@regression', '@tc-coverage-54'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const withDelta = mod.buildCommentBody({
        deltaMarkdown: '## API coverage delta\n',
        headSummary: null,
        runUrl: 'https://github.com/o/r/actions/runs/1',
        headSha: 'abcdef1234',
        baseSha: '1234567890',
        testsOutcome: 'success',
      });
      const noBase = mod.buildCommentBody({
        deltaMarkdown: null,
        headSummary: '## API coverage\n',
        runUrl: 'https://github.com/o/r/actions/runs/1',
        headSha: 'abcdef1234',
        baseSha: null,
        testsOutcome: 'failure',
      });
      const huge = mod.buildCommentBody({
        deltaMarkdown: 'x'.repeat(70000),
        headSummary: null,
        runUrl: 'u',
        headSha: null,
        baseSha: null,
        testsOutcome: 'success',
      });

      // --- ASSERT ----------------------------------------------------------
      expect(withDelta.startsWith(mod.MARKER)).toBe(true);
      expect(withDelta).toContain('## API coverage delta');
      expect(withDelta).toContain('Head `abcdef1` · Base `1234567`');
      expect(withDelta).toContain(
        '[Workflow run and artifacts](https://github.com/o/r/actions/runs/1)',
      );
      expect(noBase).toContain('Base coverage unavailable');
      expect(noBase).toContain('❌ Head API tests: **failure**');
      expect(huge.length).toBeLessThanOrEqual(mod.MAX_BODY);
    },
  );
});
