// @ts-check
/**
 * Logic of .github/workflows/test-agent.yml (used through actions/github-script):
 *
 *   decide        should the test agent run on this completed "API coverage" run?  run | skip | block
 *   summarizeRun  what the run achieved, measured with the coverage tool's output (not the agent's claim)
 *   buildReport   the sticky PR comment (marker <!-- test-agent-report -->) with a hidden state block
 *
 * Bounded loop: at most MAX_RUNS runs per PR, counted with the labels
 * ai-tests-run-1 / ai-tests-run-2 (added BEFORE the agent starts, so a crashed
 * run still counts). A run never starts after one that closed 0 gaps, and the
 * natural cut-off is the verdict: once it is no longer `regressed` (and no added
 * operation is uncovered) nothing runs, whoever pushed the last commit.
 *
 * CommonJS, no dependencies; pure functions plus thin github-script wrappers.
 */
'use strict';

const MAX_RUNS = 2;
const RUN_LABELS = ['ai-tests-run-1', 'ai-tests-run-2'];
const FEATURE_LABEL = 'ai-feature';
const BLOCKED_LABEL = 'ai-tests-blocked';
const BRANCH_PREFIX = 'feature/';
const MARKER = '<!-- test-agent-report -->';
const STATE_RE = /<!-- test-agent-state: (\{.*?\}) -->/s;

/**
 * @typedef {{ n: number, sha: string, targeted: string[], closed: string[], blocked: string[], conclusion: string, attempts: number | null, log: string | null }} RunRecord
 * @typedef {{ runs: RunRecord[] }} State
 * @typedef {{ action: 'run' | 'skip' | 'block', reason: string, runNumber: number | null, gapIds: string[], prNumber: number | null }} Decision
 */

/**
 * Reads the hidden state of a previous report comment.
 *
 * @param {string | null | undefined} body - Comment body.
 * @returns {State}
 */
function parseState(body) {
  const match = body ? STATE_RE.exec(body) : null;
  if (!match || !match[1]) return { runs: [] };
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed.runs) ? { runs: parsed.runs } : { runs: [] };
  } catch {
    return { runs: [] };
  }
}

/**
 * Ids of the gaps the PR opened (delta.gaps.opened), sorted and unique.
 *
 * @param {any} delta - delta.json.
 * @returns {string[]}
 */
function openedGapIds(delta) {
  const opened = delta && delta.gaps && Array.isArray(delta.gaps.opened) ? delta.gaps.opened : [];
  return [...new Set(opened.map((/** @type {any} */ g) => String(g.id)))].sort();
}

/**
 * Decides what to do with a completed "API coverage" workflow run.
 *
 * @param {object} input
 * @param {any} input.workflowRun - `github.event.workflow_run`.
 * @param {string} input.repository - `owner/name` of this repository.
 * @param {any} input.pr - The open PR for the run's head branch (null if none).
 * @param {any} input.delta - delta.json from the coverage-report-html artifact (null if missing).
 * @param {State} input.state - State from the previous report comment.
 * @returns {Decision}
 */
function decide({ workflowRun, repository, pr, delta, state }) {
  /** @type {(action: Decision['action'], reason: string, extra?: Partial<Decision>) => Decision} */
  const out = (action, reason, extra = {}) => ({
    action,
    reason,
    runNumber: null,
    gapIds: [],
    prNumber: pr ? pr.number : null,
    ...extra,
  });
  if (!workflowRun || workflowRun.event !== 'pull_request') {
    return out('skip', 'the coverage run was not triggered by a pull_request');
  }
  if (!workflowRun.head_repository || workflowRun.head_repository.full_name !== repository) {
    return out('skip', 'the pull request comes from a fork');
  }
  if (!String(workflowRun.head_branch || '').startsWith(BRANCH_PREFIX)) {
    return out('skip', `the head branch is not ${BRANCH_PREFIX}*`);
  }
  if (workflowRun.conclusion === 'cancelled' || workflowRun.conclusion === 'skipped') {
    return out('skip', `the coverage run was ${workflowRun.conclusion}`);
  }
  if (!pr || pr.state !== 'open') return out('skip', 'no open pull request for the head branch');
  const labels = (pr.labels || []).map((/** @type {any} */ l) =>
    typeof l === 'string' ? l : l.name,
  );
  if (!labels.includes(FEATURE_LABEL)) return out('skip', `the PR has no ${FEATURE_LABEL} label`);
  if (pr.head && pr.head.sha !== workflowRun.head_sha) {
    return out('skip', 'stale run: the PR head moved on; a newer coverage run will decide');
  }
  if (labels.includes(BLOCKED_LABEL)) {
    return out('skip', `the PR is already labeled ${BLOCKED_LABEL}; waiting for a human`);
  }
  if (!delta) return out('skip', 'no delta.json (base coverage unavailable): nothing to target');

  const uncoveredAdded = ((delta.operations && delta.operations.added) || []).filter(
    (/** @type {any} */ op) => !op.covered,
  );
  if (delta.verdict !== 'regressed' && uncoveredAdded.length === 0) {
    return out(
      'skip',
      `verdict "${delta.verdict}" with every added operation covered: nothing to do`,
    );
  }
  const gapIds = openedGapIds(delta);
  if (gapIds.length === 0) {
    return out(
      'block',
      `verdict "${delta.verdict}" but the PR opened no gaps: the regression is not something new tests can close`,
    );
  }
  // Runs are counted with labels only, so a human can grant another run by
  // removing one ai-tests-run-N label (documented in the blocked comment).
  const runsDone = RUN_LABELS.filter((l) => labels.includes(l)).length;
  if (runsDone >= MAX_RUNS) {
    return out(
      'block',
      `run limit reached (${runsDone}/${MAX_RUNS}) and ${gapIds.length} opened gap(s) remain`,
      { gapIds },
    );
  }
  const last = state.runs[state.runs.length - 1];
  // Ignored when a human removed run labels after that run (explicit override).
  if (last && last.closed.length === 0 && runsDone >= state.runs.length) {
    return out('block', `the previous run (#${last.n}) closed 0 gaps; not retrying`, { gapIds });
  }
  return out('run', `verdict "${delta.verdict}": ${gapIds.length} opened gap(s) to target`, {
    runNumber: RUN_LABELS.findIndex((l) => !labels.includes(l)) + 1,
    gapIds,
  });
}

/**
 * Measures a finished run with the coverage tool's final gaps.json.
 *
 * @param {object} input
 * @param {string[]} input.targetIds - Gap ids handed to the agent.
 * @param {any} input.finalGaps - reports/coverage/gaps.json after the run (null if missing).
 * @param {any} input.agentResult - .agent-work/test-agent-result.json (null if missing).
 * @returns {{ closed: string[], open: string[], blocked: string[], measured: boolean, attempts: number | null, log: string | null }}
 */
function summarizeRun({ targetIds, finalGaps, agentResult }) {
  const measured = Boolean(finalGaps && Array.isArray(finalGaps.gaps));
  const remaining = new Set(
    measured ? finalGaps.gaps.map((/** @type {any} */ g) => g.id) : targetIds,
  );
  const closed = targetIds.filter((id) => !remaining.has(id));
  const open = targetIds.filter((id) => remaining.has(id));
  const claimedBlocked =
    agentResult && Array.isArray(agentResult.blocked)
      ? agentResult.blocked.map((/** @type {any} */ b) => String(typeof b === 'string' ? b : b.id))
      : [];
  return {
    closed,
    open,
    blocked: open.filter((id) => claimedBlocked.includes(id)),
    measured,
    attempts: agentResult && Number.isInteger(agentResult.attempts) ? agentResult.attempts : null,
    log: agentResult && typeof agentResult.log === 'string' ? agentResult.log : null,
  };
}

/**
 * Builds the sticky report comment.
 *
 * @param {object} input
 * @param {State} input.state - All runs so far (including the one just finished).
 * @param {string | null} input.blockedReason - Set when the loop stopped and a human is needed.
 * @param {string} input.runUrl - URL of the latest workflow run.
 * @returns {string}
 */
function buildReport({ state, blockedReason, runUrl }) {
  const list = (/** @type {string[]} */ ids) =>
    ids.length ? ids.map((id) => `\`${id}\``).join(', ') : '—';
  const lines = [MARKER, '### 🤖 Test agent', ''];
  if (state.runs.length) {
    lines.push(
      `| Run | Commit | Targeted | Closed | Still open | Blocked (agent) | Attempts | Outcome | Log |`,
      '|---|---|---:|---:|---:|---:|---:|---|---|',
    );
    for (const r of state.runs) {
      const open = r.targeted.filter((id) => !r.closed.includes(id));
      lines.push(
        `| ${r.n}/${MAX_RUNS} | \`${r.sha.slice(0, 7)}\` | ${r.targeted.length} | ${r.closed.length} | ${open.length} | ${r.blocked.length} | ${r.attempts ?? '?'} | ${r.conclusion} | ${r.log ? `\`${r.log}\`` : '—'} |`,
      );
    }
    const last = state.runs[state.runs.length - 1];
    if (last) {
      lines.push(
        '',
        `**Last run** — targeted: ${list(last.targeted)}`,
        '',
        `closed: ${list(last.closed)}`,
        '',
        `blocked by the agent: ${list(last.blocked)}`,
      );
    }
  } else {
    lines.push('_No test-agent run yet._');
  }
  lines.push('');
  if (blockedReason) {
    lines.push(
      `> ⛔ **Human needed** (label \`${BLOCKED_LABEL}\`): ${blockedReason}. Write the missing tests or decide the gaps by hand; remove \`${BLOCKED_LABEL}\` and one \`ai-tests-run-N\` label to allow another agent run.`,
    );
  } else {
    lines.push(
      '> "Closed" is measured with the coverage tool on the agent runner. The next **API coverage** comment on this PR is the independent verdict.',
    );
  }
  lines.push('', `[Latest test-agent run and artifacts](${runUrl}) (artifact \`test-agent-log\`).`);
  lines.push(`<!-- test-agent-state: ${JSON.stringify({ runs: state.runs })} -->`);
  return lines.join('\n');
}

/**
 * Finds the open PR of a workflow run.
 *
 * @param {any} github - Octokit.
 * @param {{ owner: string, repo: string }} repo - Coordinates.
 * @param {any} workflowRun - The workflow_run payload.
 */
async function findPr(github, repo, workflowRun) {
  const listed = (workflowRun.pull_requests || [])[0];
  if (listed) {
    const { data } = await github.rest.pulls.get({ ...repo, pull_number: listed.number });
    return data;
  }
  const { data } = await github.rest.pulls.list({
    ...repo,
    state: 'open',
    head: `${repo.owner}:${workflowRun.head_branch}`,
  });
  return data[0] || null;
}

/**
 * Finds the sticky report comment.
 *
 * @param {any} github - Octokit.
 * @param {{ owner: string, repo: string }} repo - Coordinates.
 * @param {number} issueNumber - PR number.
 */
async function findReport(github, repo, issueNumber) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  return (
    comments.find(
      (/** @type {any} */ c) => typeof c.body === 'string' && c.body.includes(MARKER),
    ) || null
  );
}

/**
 * Creates or updates the sticky report comment.
 *
 * @param {any} github - Octokit.
 * @param {{ owner: string, repo: string }} repo - Coordinates.
 * @param {number} issueNumber - PR number.
 * @param {string} body - Comment body.
 */
async function upsertReport(github, repo, issueNumber, body) {
  const existing = await findReport(github, repo, issueNumber);
  if (existing) {
    await github.rest.issues.updateComment({ ...repo, comment_id: existing.id, body });
    return 'updated';
  }
  await github.rest.issues.createComment({ ...repo, issue_number: issueNumber, body });
  return 'created';
}

/**
 * github-script wrapper: decides, writes gap-ids.txt, labels the run or blocks.
 *
 * @param {{ github: any, context: any, core: any, deltaPath: string, gapIdsPath: string }} input
 * @returns {Promise<Decision>}
 */
async function gate({ github, context, core, deltaPath, gapIdsPath }) {
  const fs = require('fs');
  const repo = context.repo;
  const workflowRun = context.payload.workflow_run;
  let delta = null;
  try {
    delta = JSON.parse(fs.readFileSync(deltaPath, 'utf8'));
  } catch {
    delta = null;
  }
  const pr =
    workflowRun && workflowRun.event === 'pull_request'
      ? await findPr(github, repo, workflowRun)
      : null;
  const previous = pr ? await findReport(github, repo, pr.number) : null;
  const state = parseState(previous && previous.body);
  const decision = decide({
    workflowRun,
    repository: `${repo.owner}/${repo.repo}`,
    pr,
    delta,
    state,
  });

  core.setOutput('action', decision.action);
  core.setOutput('pr_number', decision.prNumber ? String(decision.prNumber) : '');
  core.setOutput('run_number', decision.runNumber ? String(decision.runNumber) : '');
  core.setOutput('head_branch', workflowRun ? workflowRun.head_branch : '');
  core.setOutput('head_sha', workflowRun ? workflowRun.head_sha : '');
  core.info(`Test agent: ${decision.action} — ${decision.reason}`);

  if (decision.action === 'run' && decision.runNumber) {
    fs.writeFileSync(gapIdsPath, `${decision.gapIds.join('\n')}\n`);
    // Count the run before the agent starts, so a crashed run still counts.
    await github.rest.issues.addLabels({
      ...repo,
      issue_number: decision.prNumber,
      labels: [RUN_LABELS[decision.runNumber - 1]],
    });
  }
  if (decision.action === 'block' && decision.prNumber) {
    await github.rest.issues.addLabels({
      ...repo,
      issue_number: decision.prNumber,
      labels: [BLOCKED_LABEL],
    });
    const runUrl = `${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`;
    await upsertReport(
      github,
      repo,
      decision.prNumber,
      buildReport({ state, blockedReason: decision.reason, runUrl }),
    );
    core.warning(`Test agent blocked on PR #${decision.prNumber}: ${decision.reason}`);
  }
  return decision;
}

/**
 * github-script wrapper: records the finished run in the sticky comment.
 *
 * @param {{ github: any, context: any, core: any, prNumber: number, runNumber: number, headSha: string, gapIdsPath: string, gapsPath: string, resultPath: string, actionOutcome: string }} input
 */
async function report({
  github,
  context,
  core,
  prNumber,
  runNumber,
  headSha,
  gapIdsPath,
  gapsPath,
  resultPath,
  actionOutcome,
}) {
  const fs = require('fs');
  const readJson = (/** @type {string} */ p) => {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  };
  const repo = context.repo;
  const targetIds = fs
    .readFileSync(gapIdsPath, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const summary = summarizeRun({
    targetIds,
    finalGaps: readJson(gapsPath),
    agentResult: readJson(resultPath),
  });
  const previous = await findReport(github, repo, prNumber);
  const state = parseState(previous && previous.body);
  state.runs = state.runs.filter((r) => r.n !== runNumber);
  state.runs.push({
    n: runNumber,
    sha: headSha,
    targeted: targetIds,
    closed: summary.closed,
    blocked: summary.blocked,
    conclusion: summary.measured ? actionOutcome : `${actionOutcome} (not measured: no gaps.json)`,
    attempts: summary.attempts,
    log: summary.log,
  });
  state.runs.sort((a, b) => a.n - b.n);
  const runUrl = `${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`;
  const action = await upsertReport(
    github,
    repo,
    prNumber,
    buildReport({ state, blockedReason: null, runUrl }),
  );
  core.info(`Test agent report ${action}: closed ${summary.closed.length}/${targetIds.length}.`);
  return summary;
}

module.exports = {
  MAX_RUNS,
  RUN_LABELS,
  FEATURE_LABEL,
  BLOCKED_LABEL,
  MARKER,
  parseState,
  openedGapIds,
  decide,
  summarizeRun,
  buildReport,
  gate,
  report,
};
