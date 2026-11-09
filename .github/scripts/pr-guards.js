// @ts-check
/**
 * Logic of the `human-review` job of .github/workflows/pr-guards.yml.
 *
 * Single-user reality: PRs opened with AGENT_PAT are authored by the repo owner,
 * who cannot approve their own PR, so a "required approving review" would block
 * every AI PR. Instead, a required check passes only when a human put the label
 * `human-reviewed` on an `ai-generated` PR, AFTER its last push: a new push
 * removes the label, so the review always covers the final diff.
 *
 * CommonJS, no dependencies.
 */
'use strict';

const AI_LABEL = 'ai-generated';
const REVIEWED_LABEL = 'human-reviewed';

/**
 * Decides the human-review check.
 *
 * @param {object} input
 * @param {string} input.action - pull_request event action (opened, synchronize, labeled, …).
 * @param {string[]} input.labels - Current PR label names.
 * @returns {{ ok: boolean, removeLabel: boolean, message: string }}
 */
function humanReview({ action, labels }) {
  const isAi = labels.includes(AI_LABEL);
  const reviewed = labels.includes(REVIEWED_LABEL);
  if (!isAi) {
    return {
      ok: true,
      removeLabel: false,
      message: `Not an ${AI_LABEL} PR: no human-review label needed.`,
    };
  }
  if (action === 'synchronize' && reviewed) {
    return {
      ok: false,
      removeLabel: true,
      message: `New commits were pushed after the review: label ${REVIEWED_LABEL} removed. Review the new diff and add it again.`,
    };
  }
  if (!reviewed) {
    return {
      ok: false,
      removeLabel: false,
      message: `${AI_LABEL} PR: a human must review it (tests, AI generation log, lane-check, coverage comment) and add the label ${REVIEWED_LABEL}.`,
    };
  }
  return {
    ok: true,
    removeLabel: false,
    message: `Reviewed by a human (label ${REVIEWED_LABEL}).`,
  };
}

/**
 * github-script wrapper.
 *
 * @param {{ github: any, context: any, core: any }} gh
 */
async function run({ github, context, core }) {
  const pr = context.payload.pull_request;
  const labels = (pr.labels || []).map((/** @type {any} */ l) => l.name);
  const decision = humanReview({ action: context.payload.action, labels });
  if (decision.removeLabel) {
    try {
      await github.rest.issues.removeLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pr.number,
        name: REVIEWED_LABEL,
      });
    } catch (error) {
      core.warning(`Could not remove ${REVIEWED_LABEL}: ${error}`);
    }
  }
  if (decision.ok) core.info(decision.message);
  else core.setFailed(decision.message);
  return decision;
}

module.exports = { AI_LABEL, REVIEWED_LABEL, humanReview, run };
