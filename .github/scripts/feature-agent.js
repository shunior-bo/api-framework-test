// @ts-check
/**
 * Logic of .github/workflows/feature-agent.yml (used through actions/github-script):
 *
 *   evaluateTrigger  who may start the feature agent (labeler AND issue author must be trusted)
 *   buildIssueData   the issue as quoted, size-capped DATA for the agent (.agent-work/issue.json)
 *   outcome          what the workflow does after the agent: nothing, or comment + `ai-feature-blocked`
 *
 * CommonJS, no dependencies, pure functions plus thin github-script wrappers
 * (`github` is the Octokit instance that github-script injects; a stub in unit tests).
 */
'use strict';

/** Label that starts the feature agent. */
const TRIGGER_LABEL = 'feature-request';

/** Label added when the agent stops without delivering. */
const BLOCKED_LABEL = 'ai-feature-blocked';

/** Issue author associations allowed to request features. */
const TRUSTED_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/** Repository permissions (of the labeler) allowed to start the agent. */
const TRUSTED_PERMISSIONS = ['admin', 'maintain', 'write'];

/** Maximum characters of the issue body handed to the agent. */
const MAX_BODY = 20000;

/** Hidden marker of the workflow's own issue comment. */
const MARKER = '<!-- feature-agent-report -->';

/**
 * Decides whether a labeled issue may start the feature agent.
 *
 * @param {object} input
 * @param {any} input.payload - The `issues` event payload.
 * @param {string | null} input.senderPermission - Repository permission of the labeler
 *   (`admin` | `maintain` | `write` | `triage` | `read` | `none`), from the collaborators API.
 * @returns {{ allowed: boolean, reasons: string[] }}
 */
function evaluateTrigger({ payload, senderPermission }) {
  const reasons = [];
  const issue = payload && payload.issue;
  if (!payload || payload.action !== 'labeled') reasons.push('event is not issues.labeled');
  if (!payload || !payload.label || payload.label.name !== TRIGGER_LABEL) {
    reasons.push(`label is not "${TRIGGER_LABEL}"`);
  }
  if (!issue) {
    reasons.push('no issue in the payload');
  } else {
    if (issue.pull_request) reasons.push('the item is a pull request, not an issue');
    if (issue.state !== 'open') reasons.push('the issue is not open');
    if (!TRUSTED_ASSOCIATIONS.includes(issue.author_association)) {
      reasons.push(
        `issue author association "${issue.author_association}" is not one of ${TRUSTED_ASSOCIATIONS.join(', ')}`,
      );
    }
  }
  const sender = payload && payload.sender;
  if (!sender || sender.type !== 'User') {
    reasons.push('the label was not applied by a user account');
  }
  if (!senderPermission || !TRUSTED_PERMISSIONS.includes(senderPermission)) {
    reasons.push(
      `labeler permission "${senderPermission}" is not one of ${TRUSTED_PERMISSIONS.join(', ')}`,
    );
  }
  return { allowed: reasons.length === 0, reasons };
}

/**
 * Builds the agent's input file. The title and body stay verbatim (they are
 * DATA); only their size is capped and control characters are dropped.
 *
 * @param {any} issue - The issue from the event payload.
 * @returns {{ number: number, title: string, body: string, author: string, url: string, truncated: boolean }}
 */
function buildIssueData(issue) {
  const clean = (/** @type {unknown} */ s) =>
    String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  const body = clean(issue.body);
  return {
    number: issue.number,
    title: clean(issue.title).slice(0, 300),
    body: body.slice(0, MAX_BODY),
    author: issue.user ? String(issue.user.login) : 'unknown',
    url: String(issue.html_url ?? ''),
    truncated: body.length > MAX_BODY,
  };
}

/**
 * Decides the follow-up after the agent step.
 *
 * @param {object} input
 * @param {any} input.result - Parsed .agent-work/result.json, or null when missing/invalid.
 * @param {string} input.actionOutcome - Outcome of the claude-code-action step.
 * @param {string} input.runUrl - URL of the workflow run.
 * @param {string | null} [input.agentError] - Error reported by Claude Code (execution log), if any.
 * @returns {{ blocked: boolean, status: string, comment: string | null }}
 */
function outcome({ result, actionOutcome, runUrl, agentError = null }) {
  const status = result && typeof result.status === 'string' ? result.status : 'missing';
  if (status === 'delivered' && result.frameworkPr && result.gadPr) {
    return { blocked: false, status, comment: null };
  }
  const lines = [MARKER, '### 🤖 Feature agent stopped without delivering', ''];
  if (status === 'clarification') {
    lines.push('The agent needs clarification before it can implement this request.');
    const questions = Array.isArray(result.questions) ? result.questions : [];
    for (const q of questions) lines.push(`- ${String(q).replace(/\r?\n/g, ' ')}`);
  } else if (status === 'failed') {
    lines.push('The agent could not converge within its attempt limit (3) and opened no PRs.');
  } else if (status === 'delivered') {
    lines.push('The agent reported `delivered` but did not return both PR links.');
  } else {
    lines.push(
      `The agent produced no result (step outcome: \`${actionOutcome}\`). It probably hit the turn or time limit, or failed before finishing.`,
    );
  }
  if (agentError) {
    lines.push(
      '',
      `Claude Code reported: \`${agentError.replace(/[`\r\n]+/g, ' ').slice(0, 300)}\``,
    );
  }
  if (result && typeof result.message === 'string' && result.message.trim()) {
    lines.push('', '> ' + result.message.trim().replace(/\r?\n/g, '\n> '));
  }
  lines.push(
    '',
    `Label \`${BLOCKED_LABEL}\` added. Edit the issue if needed, remove \`${BLOCKED_LABEL}\`, then remove and re-add \`${TRIGGER_LABEL}\` to retry.`,
    '',
    `[Workflow run and agent log](${runUrl}) (artifact \`feature-agent-log\`).`,
  );
  return { blocked: true, status, comment: lines.join('\n') };
}

/**
 * Reads the error of a failed Claude Code run from the action's execution log
 * (a JSON array of SDK messages; the last `result` message carries `is_error`).
 *
 * @param {string | null | undefined} text - Execution file contents.
 * @returns {string | null}
 */
function agentErrorFrom(text) {
  if (!text) return null;
  try {
    const messages = JSON.parse(text);
    const results = Array.isArray(messages) ? messages.filter((m) => m && m.type === 'result') : [];
    const last = results[results.length - 1];
    if (!last || !last.is_error) return null;
    return String(last.result || last.subtype || 'unknown error');
  } catch {
    return null;
  }
}

/**
 * github-script wrapper: evaluates the trigger and sets the `allowed` output.
 *
 * @param {{ github: any, context: any, core: any }} gh
 */
async function gate({ github, context, core }) {
  let senderPermission = null;
  try {
    const { data } = await github.rest.repos.getCollaboratorPermissionLevel({
      owner: context.repo.owner,
      repo: context.repo.repo,
      username: context.payload.sender.login,
    });
    senderPermission = data.permission;
  } catch (error) {
    core.warning(`Could not read the labeler's permission: ${error}`);
  }
  const decision = evaluateTrigger({ payload: context.payload, senderPermission });
  core.setOutput('allowed', String(decision.allowed));
  if (decision.allowed) {
    core.info(`Feature agent allowed for issue #${context.payload.issue.number}.`);
  } else {
    core.notice(`Feature agent not started: ${decision.reasons.join('; ')}`);
  }
  return decision;
}

/**
 * github-script wrapper: comments and labels the issue when the agent did not deliver.
 *
 * @param {{ github: any, context: any, core: any, resultPath: string, actionOutcome: string, executionFile?: string }} input
 */
async function report({ github, context, core, resultPath, actionOutcome, executionFile }) {
  const fs = require('fs');
  let result = null;
  try {
    result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch {
    result = null;
  }
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
  let agentError = null;
  try {
    agentError = executionFile ? agentErrorFrom(fs.readFileSync(executionFile, 'utf8')) : null;
  } catch {
    agentError = null;
  }
  const decision = outcome({ result, actionOutcome, runUrl, agentError });
  core.setOutput('status', decision.status);
  if (!decision.blocked) {
    core.info(`Delivered: ${result.frameworkPr} and ${result.gadPr}`);
    return decision;
  }
  const issue_number = context.payload.issue.number;
  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number,
    body: decision.comment,
  });
  await github.rest.issues.addLabels({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number,
    labels: [BLOCKED_LABEL],
  });
  core.warning(
    `Feature agent did not deliver (status: ${decision.status}); issue labeled ${BLOCKED_LABEL}.`,
  );
  return decision;
}

module.exports = {
  TRIGGER_LABEL,
  BLOCKED_LABEL,
  TRUSTED_ASSOCIATIONS,
  TRUSTED_PERMISSIONS,
  MAX_BODY,
  MARKER,
  evaluateTrigger,
  buildIssueData,
  outcome,
  agentErrorFrom,
  gate,
  report,
};
