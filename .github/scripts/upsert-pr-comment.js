// @ts-check
/**
 * Sticky PR comment for the API coverage report.
 *
 * Used by .github/workflows/api-coverage.yml through actions/github-script:
 *   const { buildCommentBody, upsertPrComment } = require('./.github/scripts/upsert-pr-comment.js');
 *
 * - Finds the comment that contains MARKER and updates it; creates one only if
 *   none exists, so every push to the PR refreshes a single comment.
 * - CommonJS, no dependencies: `github` is the Octokit instance that
 *   github-script injects (a stub in unit tests).
 */
'use strict';

/** Hidden marker that identifies the coverage comment. */
const MARKER = '<!-- api-coverage-report -->';

/** GitHub rejects comment bodies above 65,536 characters. */
const MAX_BODY = 65000;

/**
 * Builds the comment body.
 *
 * @param {object} input
 * @param {string | null} input.deltaMarkdown - delta.md, or null when base coverage is unavailable.
 * @param {string | null} input.headSummary - head summary.md (used when there is no delta).
 * @param {string} input.runUrl - URL of the workflow run (artifacts are listed there).
 * @param {string | null} input.headSha - PR head commit.
 * @param {string | null} input.baseSha - PR base commit.
 * @param {string} input.testsOutcome - Outcome of the head API tests (success | failure | …).
 * @param {string | null} [input.policyNote] - Negative-delta policy note (feature PR warning or non-feature failure).
 * @returns {string}
 */
function buildCommentBody({
  deltaMarkdown,
  headSummary,
  runUrl,
  headSha,
  baseSha,
  testsOutcome,
  policyNote = null,
}) {
  const short = (/** @type {string | null} */ sha) =>
    sha ? `\`${sha.slice(0, 7)}\`` : '`unknown`';
  const testsLine =
    testsOutcome === 'success'
      ? '✅ Head API tests passed.'
      : `❌ Head API tests: **${testsOutcome}** — see the \`playwright-report-head\` artifact.`;
  const parts = [MARKER, testsLine, ''];
  if (policyNote && policyNote.trim()) parts.push(policyNote.trim(), '');
  if (deltaMarkdown) {
    parts.push(deltaMarkdown.trim());
  } else {
    parts.push(
      '> ℹ️ **Base coverage unavailable** — showing head coverage only (the base branch could not produce `coverage.json`).',
      '',
      (headSummary ?? '_Head coverage unavailable._').trim(),
    );
  }
  parts.push(
    '',
    '---',
    `Head ${short(headSha)} · Base ${short(baseSha)} · [Workflow run and artifacts](${runUrl}) (\`coverage-report-html\` has the full HTML report).`,
  );
  let body = parts.join('\n');
  if (body.length > MAX_BODY) {
    body = `${body.slice(0, MAX_BODY - 200)}\n\n> ⚠️ Comment truncated. See the \`coverage-report-html\` artifact.`;
  }
  return body;
}

/**
 * Creates or updates the sticky comment on a pull request.
 *
 * @param {object} input
 * @param {any} input.github - Octokit (github-script) or a stub with the same shape.
 * @param {{ owner: string, repo: string }} input.repo - Repository coordinates.
 * @param {number} input.issueNumber - Pull request number.
 * @param {string} input.body - Comment body (MARKER is prepended if missing).
 * @returns {Promise<{ action: 'created' | 'updated', id: number }>}
 */
async function upsertPrComment({ github, repo, issueNumber, body }) {
  const fullBody = body.includes(MARKER) ? body : `${MARKER}\n${body}`;
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner: repo.owner,
    repo: repo.repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  const existing = comments.find(
    (/** @type {{ body?: string }} */ c) => typeof c.body === 'string' && c.body.includes(MARKER),
  );
  if (existing) {
    await github.rest.issues.updateComment({
      owner: repo.owner,
      repo: repo.repo,
      comment_id: existing.id,
      body: fullBody,
    });
    return { action: 'updated', id: existing.id };
  }
  const { data } = await github.rest.issues.createComment({
    owner: repo.owner,
    repo: repo.repo,
    issue_number: issueNumber,
    body: fullBody,
  });
  return { action: 'created', id: data.id };
}

module.exports = { MARKER, MAX_BODY, buildCommentBody, upsertPrComment };
