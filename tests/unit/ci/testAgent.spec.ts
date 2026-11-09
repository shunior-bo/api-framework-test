/**
 * Unit tests for .github/scripts/test-agent.js: the gate of test-agent.yml
 * (conditions + bounded loop), the run summary measured from gaps.json, and the
 * sticky report with its hidden state. Payloads mirror real `workflow_run`
 * events of "API coverage"; delta.json fixtures were produced by
 * `cli.ts compare` on the coverage compare fixtures. No network.
 *
 * Run with: npm run test:unit
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

/** One recorded run in the report state. */
interface RunRecord {
  n: number;
  sha: string;
  targeted: string[];
  closed: string[];
  blocked: string[];
  conclusion: string;
  attempts: number | null;
  log: string | null;
}

/** Decision of the gate. */
interface Decision {
  action: 'run' | 'skip' | 'block';
  reason: string;
  runNumber: number | null;
  gapIds: string[];
  prNumber: number | null;
}

/** Shape of the CommonJS module under test. */
interface TestAgentModule {
  MARKER: string;
  parseState: (body: string | null) => { runs: RunRecord[] };
  decide: (input: {
    workflowRun: unknown;
    repository: string;
    pr: unknown;
    delta: unknown;
    state: { runs: RunRecord[] };
  }) => Decision;
  summarizeRun: (input: { targetIds: string[]; finalGaps: unknown; agentResult: unknown }) => {
    closed: string[];
    open: string[];
    blocked: string[];
    measured: boolean;
    attempts: number | null;
  };
  buildReport: (input: {
    state: { runs: RunRecord[] };
    blockedReason: string | null;
    runUrl: string;
  }) => string;
  gate: (input: {
    github: unknown;
    context: unknown;
    core: unknown;
    deltaPath: string;
    gapIdsPath: string;
  }) => Promise<Decision>;
  report: (input: Record<string, unknown>) => Promise<{ closed: string[] }>;
}

const mod = require(join(process.cwd(), '.github', 'scripts', 'test-agent.js')) as TestAgentModule;

const FIXTURES = join(__dirname, 'fixtures');
const REGRESSED = JSON.parse(
  readFileSync(join(FIXTURES, 'delta-feature-regressed.json'), 'utf8'),
) as Record<string, unknown>;
const IMPROVED = JSON.parse(readFileSync(join(FIXTURES, 'delta-improved.json'), 'utf8')) as Record<
  string,
  unknown
>;
const REPO = 'shunior-bo/api-framework-test';
const SHA = '1f0e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c';

/**
 * A `workflow_run` (completed) payload of "API coverage".
 *
 * @param overrides - Changed fields.
 */
function workflowRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 19283746,
    name: 'API coverage',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'feature/12-article-reading-stats',
    head_sha: SHA,
    head_repository: { full_name: REPO },
    repository: { full_name: REPO },
    pull_requests: [{ number: 31, head: { ref: 'feature/12-article-reading-stats', sha: SHA } }],
    ...overrides,
  };
}

/**
 * An open feature PR.
 *
 * @param labels - Label names.
 * @param overrides - Changed fields.
 */
function pr(
  labels: string[] = ['ai-generated', 'ai-feature'],
  overrides = {},
): Record<string, unknown> {
  return {
    number: 31,
    state: 'open',
    head: { ref: 'feature/12-article-reading-stats', sha: SHA },
    labels: labels.map((name) => ({ name })),
    ...overrides,
  };
}

/**
 * A recorded run.
 *
 * @param n - Run number.
 * @param closed - Closed ids.
 */
function run(n: number, closed: string[]): RunRecord {
  return {
    n,
    sha: SHA,
    targeted: ['operation:GET /extra'],
    closed,
    blocked: [],
    conclusion: 'success',
    attempts: 1,
    log: null,
  };
}

const decide = (overrides: Partial<Parameters<TestAgentModule['decide']>[0]> = {}): Decision =>
  mod.decide({
    workflowRun: workflowRun(),
    repository: REPO,
    pr: pr(),
    delta: REGRESSED,
    state: { runs: [] },
    ...overrides,
  });

test.describe('test-agent: decide (conditions)', () => {
  test('runs on a regressed feature PR and targets exactly delta.gaps.opened', () => {
    expect(decide()).toEqual({
      action: 'run',
      reason: 'verdict "regressed": 1 opened gap(s) to target',
      runNumber: 1,
      gapIds: ['operation:GET /extra'],
      prNumber: 31,
    });
  });

  test('skips non-PR events, forks, non-feature branches and cancelled runs', () => {
    expect(decide({ workflowRun: workflowRun({ event: 'push' }) }).action).toBe('skip');
    expect(
      decide({ workflowRun: workflowRun({ head_repository: { full_name: 'someone/fork' } }) })
        .action,
    ).toBe('skip');
    expect(decide({ workflowRun: workflowRun({ head_branch: 'session/04-x' }) }).action).toBe(
      'skip',
    );
    expect(decide({ workflowRun: workflowRun({ conclusion: 'cancelled' }) }).action).toBe('skip');
  });

  test('skips without an open ai-feature PR, on a stale head, or when already blocked', () => {
    expect(decide({ pr: null }).action).toBe('skip');
    expect(decide({ pr: pr(['ai-generated']) }).reason).toContain('no ai-feature label');
    expect(decide({ pr: pr(undefined, { head: { sha: 'f'.repeat(40) } }) }).reason).toContain(
      'stale',
    );
    expect(decide({ pr: pr(['ai-feature', 'ai-tests-blocked']) }).action).toBe('skip');
    expect(decide({ delta: null }).reason).toContain('no delta.json');
  });

  test('natural cut-off: no run once the verdict is not regressed and added ops are covered', () => {
    // e.g. the coverage run triggered by the test agent's own push
    const decision = decide({
      delta: IMPROVED,
      pr: pr(['ai-feature', 'ai-tests-run-1']),
      state: { runs: [run(1, ['operation:GET /extra'])] },
    });
    expect(decision).toMatchObject({ action: 'skip', runNumber: null });
    expect(decision.reason).toContain('verdict "improved"');
  });

  test('runs when an added operation is uncovered even if the verdict is not regressed', () => {
    const mixed = { ...REGRESSED, verdict: 'mixed' };
    expect(decide({ delta: mixed }).action).toBe('run');
  });

  test('blocks a regression that opened no gaps (new tests cannot fix it)', () => {
    const noGaps = { ...REGRESSED, gaps: { opened: [], closed: [], summary: {} } };
    expect(decide({ delta: noGaps }).action).toBe('block');
  });
});

test.describe('test-agent: decide (bounded loop)', () => {
  test('second run after a first run that closed gaps', () => {
    const decision = decide({
      pr: pr(['ai-feature', 'ai-tests-run-1']),
      state: { runs: [run(1, ['operation:GET /extra'])] },
    });
    expect(decision).toMatchObject({ action: 'run', runNumber: 2 });
  });

  test('blocks at the limit of 2 runs', () => {
    const decision = decide({
      pr: pr(['ai-feature', 'ai-tests-run-1', 'ai-tests-run-2']),
      state: { runs: [run(1, ['a']), run(2, ['b'])] },
    });
    expect(decision.action).toBe('block');
    expect(decision.reason).toContain('run limit reached (2/2)');
  });

  test('blocks after a run that closed 0 gaps', () => {
    const decision = decide({
      pr: pr(['ai-feature', 'ai-tests-run-1']),
      state: { runs: [run(1, [])] },
    });
    expect(decision.action).toBe('block');
    expect(decision.reason).toContain('closed 0 gaps');
  });

  test('a human can grant one more run by removing a run label', () => {
    const decision = decide({
      pr: pr(['ai-feature', 'ai-tests-run-1']),
      state: { runs: [run(1, ['a']), run(2, [])] },
    });
    expect(decision).toMatchObject({ action: 'run', runNumber: 2 });
  });
});

test.describe('test-agent: summary and report', () => {
  test('measures closed gaps from the final gaps.json, not from the agent claim', () => {
    const summary = mod.summarizeRun({
      targetIds: ['operation:GET /extra', 'status:GET /extra:404'],
      finalGaps: { gaps: [{ id: 'status:GET /extra:404' }, { id: 'operation:GET /other' }] },
      agentResult: {
        closed: ['operation:GET /extra', 'status:GET /extra:404'],
        blocked: [{ id: 'status:GET /extra:404', reason: 'unreachable' }],
        attempts: 2,
      },
    });
    expect(summary).toEqual({
      closed: ['operation:GET /extra'],
      open: ['status:GET /extra:404'],
      blocked: ['status:GET /extra:404'],
      measured: true,
      attempts: 2,
      log: null,
    });
  });

  test('without gaps.json nothing counts as closed', () => {
    const summary = mod.summarizeRun({ targetIds: ['a'], finalGaps: null, agentResult: null });
    expect(summary).toMatchObject({ closed: [], open: ['a'], measured: false });
  });

  test('the report round-trips its hidden state and asks for a human when blocked', () => {
    const state = { runs: [run(1, ['operation:GET /extra'])] };
    const body = mod.buildReport({ state, blockedReason: 'run limit reached', runUrl: 'u' });
    expect(body.startsWith(mod.MARKER)).toBe(true);
    expect(body).toContain('| 1/2 |');
    expect(body).toContain('Human needed');
    expect(mod.parseState(body)).toEqual(state);
    expect(mod.parseState('no state here')).toEqual({ runs: [] });
  });
});

test.describe('test-agent: gate and report (github-script wrappers)', () => {
  /** Calls recorded by the Octokit stub. */
  interface Call {
    method: string;
    params: Record<string, unknown>;
  }

  /**
   * Octokit stub with one PR and the given comments.
   *
   * @param calls - Recorded calls.
   * @param labels - PR labels.
   * @param comments - Existing PR comments.
   */
  function stub(calls: Call[], labels: string[], comments: { id: number; body: string }[] = []) {
    const record =
      (method: string, data: unknown = {}) =>
      async (params: Record<string, unknown>) => {
        calls.push({ method, params });
        return { data };
      };
    return {
      paginate: async () => comments,
      rest: {
        pulls: { get: record('pulls.get', pr(labels)), list: record('pulls.list', []) },
        issues: {
          listComments: record('listComments'),
          addLabels: record('addLabels'),
          createComment: record('createComment', { id: 5 }),
          updateComment: record('updateComment'),
        },
      },
    };
  }

  const core = { setOutput: () => undefined, info: () => undefined, warning: () => undefined };

  /**
   * github-script context for a workflow_run event.
   *
   * @param wr - The workflow_run payload.
   */
  const context = (wr: Record<string, unknown>) => ({
    serverUrl: 'https://github.com',
    runId: 99,
    repo: { owner: 'shunior-bo', repo: 'api-framework-test' },
    payload: { workflow_run: wr },
  });

  test('run: writes gap-ids.txt and labels the PR before the agent starts', async () => {
    const dir = test.info().outputPath();
    mkdirSync(dir, { recursive: true });
    const deltaPath = join(dir, 'delta.json');
    const gapIdsPath = join(dir, 'gap-ids.txt');
    writeFileSync(deltaPath, JSON.stringify(REGRESSED));
    const calls: Call[] = [];

    const decision = await mod.gate({
      github: stub(calls, ['ai-generated', 'ai-feature']),
      context: context(workflowRun()),
      core,
      deltaPath,
      gapIdsPath,
    });

    expect(decision.action).toBe('run');
    expect(readFileSync(gapIdsPath, 'utf8')).toBe('operation:GET /extra\n');
    expect(calls.find((c) => c.method === 'addLabels')?.params).toMatchObject({
      issue_number: 31,
      labels: ['ai-tests-run-1'],
    });
  });

  test('block: labels ai-tests-blocked and updates the sticky comment, nothing else', async () => {
    const dir = test.info().outputPath();
    mkdirSync(dir, { recursive: true });
    const deltaPath = join(dir, 'delta.json');
    writeFileSync(deltaPath, JSON.stringify(REGRESSED));
    const calls: Call[] = [];
    const previous = mod.buildReport({
      state: { runs: [run(1, ['x']), run(2, ['y'])] },
      blockedReason: null,
      runUrl: 'u',
    });

    const decision = await mod.gate({
      github: stub(
        calls,
        ['ai-feature', 'ai-tests-run-1', 'ai-tests-run-2'],
        [{ id: 8, body: previous }],
      ),
      context: context(workflowRun()),
      core,
      deltaPath,
      gapIdsPath: join(dir, 'gap-ids.txt'),
    });

    expect(decision.action).toBe('block');
    expect(calls.map((c) => c.method)).toEqual(['pulls.get', 'addLabels', 'updateComment']);
    expect(calls[1]?.params).toMatchObject({ labels: ['ai-tests-blocked'] });
  });

  test('report: records the run measured from gaps.json in the sticky comment', async () => {
    const dir = test.info().outputPath();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'gap-ids.txt'), 'operation:GET /extra\nstatus:GET /extra:404\n');
    writeFileSync(
      join(dir, 'gaps.json'),
      JSON.stringify({ gaps: [{ id: 'status:GET /extra:404' }] }),
    );
    writeFileSync(
      join(dir, 'result.json'),
      JSON.stringify({ attempts: 1, log: 'docs/ai-generation/r.md' }),
    );
    const calls: Call[] = [];

    const summary = await mod.report({
      github: stub(calls, ['ai-feature', 'ai-tests-run-1']),
      context: context(workflowRun()),
      core,
      prNumber: 31,
      runNumber: 1,
      headSha: SHA,
      gapIdsPath: join(dir, 'gap-ids.txt'),
      gapsPath: join(dir, 'gaps.json'),
      resultPath: join(dir, 'result.json'),
      actionOutcome: 'success',
    });

    expect(summary.closed).toEqual(['operation:GET /extra']);
    const created = calls.find((c) => c.method === 'createComment');
    expect(String(created?.params.body)).toContain(mod.MARKER);
    expect(mod.parseState(String(created?.params.body)).runs[0]).toMatchObject({
      n: 1,
      closed: ['operation:GET /extra'],
      log: 'docs/ai-generation/r.md',
    });
  });
});
