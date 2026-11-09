/**
 * Unit tests for .github/scripts/lane-check.js: lanes per `Agent:` trailer,
 * coverage-config exclusions, the "only imports may change in existing specs"
 * heuristic, and git collection on a temporary repository. No network.
 *
 * Run with: npm run test:unit
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

/** A file change. */
interface FileChange {
  status: string;
  path: string;
  oldPath?: string;
}

/** Commit input of evaluate(). */
interface CommitInfo {
  sha: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  agent: string | null;
  files: FileChange[];
  tests: { path: string; existedAtBase: boolean; removed: string[]; added: string[] }[];
  configBefore?: string | null;
  configAfter?: string | null;
}

/** A finding. */
interface Finding {
  sha: string;
  agent: string | null;
  file: string | null;
  reason: string;
}

/** Shape of the CommonJS module under test. */
interface LaneCheckModule {
  inLane: (agent: string, path: string) => boolean;
  addedExclusions: (before: string | null, after: string | null) => string[];
  evaluate: (commits: CommitInfo[]) => {
    ok: boolean;
    violations: Finding[];
    warnings: Finding[];
    human: { sha: string }[];
    agents: Record<string, number>;
  };
  renderMarkdown: (result: ReturnType<LaneCheckModule['evaluate']>, total: number) => string;
  collect: (input: { base: string; head: string; git: (args: string[]) => string }) => CommitInfo[];
}

const mod = require(join(process.cwd(), '.github', 'scripts', 'lane-check.js')) as LaneCheckModule;

/**
 * Builds a commit.
 *
 * @param agent - Agent trailer value (null = human).
 * @param paths - Modified paths.
 * @param extra - Other fields.
 */
function commit(
  agent: string | null,
  paths: string[],
  extra: Partial<CommitInfo> = {},
): CommitInfo {
  return {
    sha: `${(agent ?? 'human').padEnd(7, '0').slice(0, 7)}${'0'.repeat(33)}`,
    subject: 'subject',
    authorName: agent ? 'claude[bot]' : 'Junior Rodriguez',
    authorEmail: agent ? '41898282+claude[bot]@users.noreply.github.com' : 'junior@example.com',
    agent,
    files: paths.map((path) => ({ status: 'M', path })),
    tests: [],
    ...extra,
  };
}

const CONFIG = JSON.stringify({
  excludeOperations: [{ method: 'GET', path: '/debug/exit', reason: 'Kills GAD.' }],
  ignoreUnmatched: ['/api/config/**'],
});

test.describe('lane-check: lanes', () => {
  test('feature-developer may touch only spec/openapi.json and gad.ref.json', () => {
    expect(mod.inLane('feature-developer', 'spec/openapi.json')).toBe(true);
    expect(mod.inLane('feature-developer', 'gad.ref.json')).toBe(true);
    expect(mod.inLane('feature-developer', 'tests/api/articles.spec.ts')).toBe(false);
  });

  test('test-generator globs: ** crosses folders, exact files stay exact', () => {
    expect(mod.inLane('test-generator', 'tests/api/stats.spec.ts')).toBe(true);
    expect(mod.inLane('test-generator', 'src/api/sub/StatsClient.ts')).toBe(true);
    expect(mod.inLane('test-generator', 'docs/ai-generation/20261110-x.md')).toBe(true);
    expect(mod.inLane('test-generator', 'tests/unit/schema.spec.ts')).toBe(true);
    expect(mod.inLane('test-generator', 'tests/unit/factories.spec.ts')).toBe(false);
    expect(mod.inLane('test-generator', 'src/utils/auth.ts')).toBe(false);
    expect(mod.inLane('test-generator', 'src/fixtures/auth.fixture.ts')).toBe(false);
  });

  test('a PR of a feature commit + test-agent commits + a human commit passes', () => {
    const result = mod.evaluate([
      commit('feature-developer', ['spec/openapi.json', 'gad.ref.json']),
      commit('test-generator', ['src/api/StatsClient.ts', 'tests/api/stats.spec.ts']),
      commit(null, ['README.md']),
    ]);
    expect(result.ok).toBe(true);
    expect(result.agents).toEqual({ 'feature-developer': 1, 'test-generator': 1 });
    expect(result.human).toHaveLength(1);
  });

  test('flags files outside the lane, the contract and unknown agents', () => {
    const result = mod.evaluate([
      commit('feature-developer', ['spec/openapi.json', '.github/workflows/api-coverage.yml']),
      commit('test-generator', ['spec/openapi.json', 'tools/coverage/src/main.ts']),
      commit('mystery-agent', ['README.md']),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => `${v.agent}|${v.file}|${v.reason}`)).toEqual([
      'feature-developer|.github/workflows/api-coverage.yml|outside the feature-developer lane',
      'test-generator|spec/openapi.json|test-generator modified the contract (spec/openapi.json)',
      'test-generator|tools/coverage/src/main.ts|outside the test-generator lane',
      'mystery-agent|null|unknown agent "mystery-agent"',
    ]);
  });

  test('a rename is checked on both paths', () => {
    const renamed = commit('test-generator', []);
    renamed.files = [{ status: 'R', oldPath: 'src/utils/auth.ts', path: 'src/api/auth.ts' }];
    expect(mod.evaluate([renamed]).violations.map((v) => v.file)).toEqual(['src/utils/auth.ts']);
  });

  test('a bot commit without an Agent trailer is a violation, not a human commit', () => {
    const bot = commit(null, ['tests/api/x.spec.ts'], {
      authorName: 'claude[bot]',
      authorEmail: '41898282+claude[bot]@users.noreply.github.com',
    });
    const result = mod.evaluate([bot]);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.reason).toContain('has no "Agent:" trailer');
  });
});

test.describe('lane-check: exclusions and existing assertions', () => {
  test('detects exclusions or ignore globs added to coverage.config.json', () => {
    const after = JSON.stringify({
      excludeOperations: [
        { method: 'GET', path: '/debug/exit', reason: 'Kills GAD.' },
        { method: 'GET', path: '/articles/{id}/stats', reason: 'hide the gap' },
      ],
      ignoreUnmatched: ['/api/config/**', '/api/articles/**'],
    });
    expect(mod.addedExclusions(CONFIG, after)).toEqual([
      'excludeOperations: GET /articles/{id}/stats',
      'ignoreUnmatched: /api/articles/**',
    ]);
    expect(mod.addedExclusions(CONFIG, CONFIG)).toEqual([]);
    const result = mod.evaluate([
      commit('test-generator', ['tools/coverage/coverage.config.json'], {
        configBefore: CONFIG,
        configAfter: after,
      }),
    ]);
    expect(result.violations.map((v) => v.reason)).toContain(
      'added excludeOperations: GET /articles/{id}/stats',
    );
  });

  test('in existing specs only import lines may be removed (Day 3 heuristic)', () => {
    const importsOnly = commit('test-generator', ['tests/api/articles.spec.ts'], {
      tests: [
        {
          path: 'tests/api/articles.spec.ts',
          existedAtBase: true,
          removed: [
            "import { buildArticle, NON_EXISTENT_ID } from '@src/data/factories';",
            '  ArticleSchema,',
            "} from '@src/utils/schema';",
            '});',
          ],
          added: ["import { buildArticle, buildMalformedArticleJson } from '@src/data/factories';"],
        },
      ],
    });
    const changedAssertion = commit('test-generator', ['tests/api/articles.spec.ts'], {
      tests: [
        {
          path: 'tests/api/articles.spec.ts',
          existedAtBase: true,
          removed: ['      expect(response.status()).toBe(201);'],
          added: ['      expect([200, 201]).toContain(response.status());'],
        },
      ],
    });
    expect(mod.evaluate([importsOnly]).ok).toBe(true);
    const result = mod.evaluate([changedAssertion]);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.reason).toContain('expect(response.status()).toBe(201);');
  });

  test('files created in the PR may be edited freely; skips are forbidden; test.fail warns', () => {
    const result = mod.evaluate([
      commit('test-generator', ['tests/api/stats.spec.ts'], {
        tests: [
          {
            path: 'tests/api/stats.spec.ts',
            existedAtBase: false,
            removed: ['    expect(x).toBe(1);'],
            added: ["    test.fail(true, 'GAD bug: …');", "  test.skip('later', () => {});"],
          },
        ],
      }),
    ]);
    expect(result.violations.map((v) => v.reason)).toEqual([
      "added `test.skip('later', () => {});`",
    ]);
    expect(result.warnings[0]?.reason).toContain('test.fail');
  });

  test('the Markdown summary lists violations, warnings and human commits', () => {
    const result = mod.evaluate([
      commit('test-generator', ['src/utils/auth.ts']),
      commit(null, ['README.md']),
    ]);
    const md = mod.renderMarkdown(result, 2);
    expect(md).toContain('❌ 1 violation(s)');
    expect(md).toContain('`src/utils/auth.ts`');
    expect(md).toContain('Human commits');
  });
});

test.describe('lane-check: collect (real git, temporary repository)', () => {
  test('reads trailers, name-status and the removed lines of existing specs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lane-check-'));
    const git = (args: string[]): string =>
      execFileSync('git', ['-C', dir, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Junior Rodriguez',
          GIT_AUTHOR_EMAIL: 'junior@example.com',
          GIT_COMMITTER_NAME: 'Junior Rodriguez',
          GIT_COMMITTER_EMAIL: 'junior@example.com',
        },
      });
    git(['init', '-q', '-b', 'main']);
    mkdirSync(join(dir, 'tests', 'api'), { recursive: true });
    mkdirSync(join(dir, 'spec'));
    writeFileSync(join(dir, 'spec', 'openapi.json'), '{}\n');
    writeFileSync(
      join(dir, 'tests', 'api', 'articles.spec.ts'),
      "import { a } from '@src/x';\ntest('t', () => {\n  expect(1).toBe(1);\n});\n",
    );
    git(['add', '.']);
    git(['commit', '-q', '-m', 'base']);
    const base = git(['rev-parse', 'HEAD']).trim();

    writeFileSync(join(dir, 'spec', 'openapi.json'), '{"paths":{}}\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'chore: sync spec', '-m', 'Agent: feature-developer']);
    writeFileSync(
      join(dir, 'tests', 'api', 'articles.spec.ts'),
      "import { a, b } from '@src/x';\ntest('t', () => {\n  expect(2).toBe(2);\n});\n",
    );
    git(['add', '.']);
    git(['commit', '-q', '-m', 'test: more', '-m', 'Agent: test-generator']);
    const head = git(['rev-parse', 'HEAD']).trim();

    const commits = mod.collect({ base, head, git });
    expect(commits.map((c) => c.agent)).toEqual(['feature-developer', 'test-generator']);
    expect(commits[0]?.files).toEqual([{ status: 'M', path: 'spec/openapi.json' }]);
    expect(commits[1]?.tests[0]).toMatchObject({
      path: 'tests/api/articles.spec.ts',
      existedAtBase: true,
      removed: ["import { a } from '@src/x';", '  expect(1).toBe(1);'],
    });
    const result = mod.evaluate(commits);
    expect(result.violations.map((v) => v.reason)).toEqual([
      'changed an existing line (only imports may change): `expect(1).toBe(1);`',
    ]);
  });
});
