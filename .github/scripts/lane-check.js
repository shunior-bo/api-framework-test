#!/usr/bin/env node
// @ts-check
/**
 * Lane check: independent verification that each agent commit of a PR stayed
 * inside its lane. Run by the `lane-check` job of .github/workflows/pr-guards.yml
 * on PRs labeled `ai-generated`:
 *
 *   node .github/scripts/lane-check.js --base <sha> --head <sha> [--repo <dir>] [--summary <file>] [--json <file>]
 *
 * For every non-merge commit in base..head it reads the `Agent:` trailer:
 *
 *   feature-developer / repin-gad   spec/openapi.json, gad.ref.json
 *   test-generator                  src/api/**, src/models/**, src/utils/schema.ts, src/data/**,
 *                                   src/fixtures/api.fixture.ts, tests/api/**,
 *                                   tests/unit/schema.spec.ts, docs/ai-generation/**
 *   (no trailer)                    human: allowed, listed in the summary; but a commit authored
 *                                   by a bot identity without a trailer is a violation
 *
 * Extra checks on agent commits:
 *   - test-generator must not touch spec/openapi.json (called out explicitly);
 *   - no exclusion / ignoreUnmatched entry may be added to tools/coverage/coverage.config.json;
 *   - in test files that existed at the PR base, only import lines may be removed or changed
 *     (Day 3 heuristic: a changed assertion always removes a line);
 *   - no `.only(`, `test.skip(` or `test.fixme(` may be added to any test file;
 *     an added `test.fail(` is listed as a warning for the reviewer.
 *
 * Limits (documented in docs/day4-multi-agent-pipeline.md): the trailer is
 * self-declared; additions inside an existing test are not detected; it reads
 * diffs, not semantics.
 *
 * CommonJS, no dependencies. Exit codes: 0 OK · 1 violations · 2 usage/git error.
 */
'use strict';

const { execFileSync } = require('child_process');

/** @type {Record<string, string[]>} */
const LANES = {
  'feature-developer': ['spec/openapi.json', 'gad.ref.json'],
  'repin-gad': ['spec/openapi.json', 'gad.ref.json'],
  'test-generator': [
    'src/api/**',
    'src/models/**',
    'src/utils/schema.ts',
    'src/data/**',
    'src/fixtures/api.fixture.ts',
    'tests/api/**',
    'tests/unit/schema.spec.ts',
    'docs/ai-generation/**',
  ],
};

const COVERAGE_CONFIG = 'tools/coverage/coverage.config.json';
const SPEC = 'spec/openapi.json';

/** Bot identities: their commits must carry an Agent trailer. */
const BOT_EMAIL_RE = /\[bot\]@users\.noreply\.github\.com$/i;

/**
 * Removed lines allowed in an existing test file: imports and their pieces,
 * blank lines and closing punctuation.
 */
const ALLOWED_REMOVED_RE = [
  /^\s*$/,
  /^\s*import\b/,
  /^\s*\}\s*from\s+['"][^'"]+['"];?\s*$/,
  /^\s*(type\s+)?[A-Za-z_$][\w$]*(\s+as\s+[A-Za-z_$][\w$]*)?,?\s*$/,
  /^\s*[)}\]]+[;,)]*\s*$/,
];

/** Added lines that are never allowed in test files. */
const FORBIDDEN_ADDED_RE = [/\.only\(/, /\btest\.skip\(/, /\btest\.fixme\(/];

/**
 * Converts a lane glob (`**` = any depth, `*` = one segment) to a RegExp.
 *
 * @param {string} glob - Glob.
 */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += 1;
    } else if (c === '*') {
      re += '[^/]*';
    } else {
      re += /[.+?^${}()|[\]\\]/.test(String(c)) ? `\\${c}` : c;
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * True when `path` is inside the lane of `agent`.
 *
 * @param {string} agent - Agent name.
 * @param {string} path - Repository-relative path.
 */
function inLane(agent, path) {
  const lane = LANES[agent];
  return Boolean(lane && lane.some((glob) => globToRegExp(glob).test(path)));
}

/**
 * Entries added to the coverage config (exclusions or ignore globs).
 *
 * @param {string | null} before - Config text before the commit (null if absent).
 * @param {string | null} after - Config text after the commit (null if deleted).
 * @returns {string[]}
 */
function addedExclusions(before, after) {
  /** @param {string | null} text */
  const entries = (text) => {
    if (!text) return new Set();
    let cfg;
    try {
      cfg = JSON.parse(text);
    } catch {
      return new Set(['<unparseable config>']);
    }
    const ex = Array.isArray(cfg.excludeOperations) ? cfg.excludeOperations : [];
    const ig = Array.isArray(cfg.ignoreUnmatched) ? cfg.ignoreUnmatched : [];
    return new Set([
      ...ex.map((/** @type {any} */ e) => `excludeOperations: ${e.method} ${e.path}`),
      ...ig.map((/** @type {any} */ g) => `ignoreUnmatched: ${g}`),
    ]);
  };
  const b = entries(before);
  return [...entries(after)].filter((e) => !b.has(e)).sort();
}

/**
 * @typedef {{ status: string, path: string, oldPath?: string }} FileChange
 * @typedef {{ path: string, existedAtBase: boolean, removed: string[], added: string[] }} TestHunks
 * @typedef {{ sha: string, subject: string, authorName: string, authorEmail: string, agent: string | null,
 *   files: FileChange[], tests: TestHunks[], configBefore?: string | null, configAfter?: string | null }} CommitInfo
 * @typedef {{ sha: string, agent: string | null, file: string | null, reason: string }} Finding
 */

/**
 * Evaluates the commits of a PR.
 *
 * @param {CommitInfo[]} commits - Non-merge commits, oldest first.
 * @returns {{ ok: boolean, violations: Finding[], warnings: Finding[], human: { sha: string, subject: string, author: string, files: string[] }[], agents: Record<string, number> }}
 */
function evaluate(commits) {
  /** @type {Finding[]} */
  const violations = [];
  /** @type {Finding[]} */
  const warnings = [];
  const human = [];
  /** @type {Record<string, number>} */
  const agents = {};
  for (const c of commits) {
    const paths = c.files.flatMap((f) => (f.oldPath ? [f.oldPath, f.path] : [f.path]));
    if (!c.agent) {
      if (BOT_EMAIL_RE.test(c.authorEmail)) {
        violations.push({
          sha: c.sha,
          agent: null,
          file: null,
          reason: `commit by bot identity ${c.authorName} <${c.authorEmail}> has no "Agent:" trailer`,
        });
      } else {
        human.push({ sha: c.sha, subject: c.subject, author: c.authorName, files: paths });
      }
      if (paths.includes(COVERAGE_CONFIG)) {
        for (const e of addedExclusions(c.configBefore ?? null, c.configAfter ?? null)) {
          warnings.push({
            sha: c.sha,
            agent: null,
            file: COVERAGE_CONFIG,
            reason: `human commit added ${e}`,
          });
        }
      }
      continue;
    }
    agents[c.agent] = (agents[c.agent] || 0) + 1;
    if (!LANES[c.agent]) {
      violations.push({
        sha: c.sha,
        agent: c.agent,
        file: null,
        reason: `unknown agent "${c.agent}"`,
      });
      continue;
    }
    for (const p of paths) {
      if (inLane(c.agent, p)) continue;
      const reason =
        c.agent === 'test-generator' && p === SPEC
          ? 'test-generator modified the contract (spec/openapi.json)'
          : `outside the ${c.agent} lane`;
      violations.push({ sha: c.sha, agent: c.agent, file: p, reason });
    }
    if (paths.includes(COVERAGE_CONFIG)) {
      for (const e of addedExclusions(c.configBefore ?? null, c.configAfter ?? null)) {
        violations.push({
          sha: c.sha,
          agent: c.agent,
          file: COVERAGE_CONFIG,
          reason: `added ${e}`,
        });
      }
    }
    for (const t of c.tests) {
      if (t.existedAtBase) {
        const changed = t.removed.filter((line) => !ALLOWED_REMOVED_RE.some((re) => re.test(line)));
        for (const line of changed) {
          violations.push({
            sha: c.sha,
            agent: c.agent,
            file: t.path,
            reason: `changed an existing line (only imports may change): \`${line.trim().slice(0, 120)}\``,
          });
        }
      }
      for (const line of t.added) {
        if (FORBIDDEN_ADDED_RE.some((re) => re.test(line))) {
          violations.push({
            sha: c.sha,
            agent: c.agent,
            file: t.path,
            reason: `added \`${line.trim().slice(0, 120)}\``,
          });
        } else if (/\btest\.fail\(/.test(line)) {
          warnings.push({
            sha: c.sha,
            agent: c.agent,
            file: t.path,
            reason: 'added test.fail(…): check the curl evidence in the AI generation log',
          });
        }
      }
    }
  }
  return { ok: violations.length === 0, violations, warnings, human, agents };
}

/**
 * Renders the result as Markdown (job summary).
 *
 * @param {ReturnType<typeof evaluate>} result - Result.
 * @param {number} total - Commits checked.
 */
function renderMarkdown(result, total) {
  const short = (/** @type {string} */ sha) => `\`${sha.slice(0, 7)}\``;
  const lines = [
    `## Lane check: ${result.ok ? '✅ OK' : `❌ ${result.violations.length} violation(s)`}`,
    '',
  ];
  const agentList = Object.entries(result.agents)
    .map(([a, n]) => `${a} × ${n}`)
    .join(', ');
  lines.push(
    `Commits checked: ${total} · agent commits: ${agentList || 'none'} · human commits: ${result.human.length}`,
    '',
  );
  if (result.violations.length) {
    lines.push('| Commit | Agent | File | Violation |', '|---|---|---|---|');
    for (const v of result.violations) {
      lines.push(
        `| ${short(v.sha)} | ${v.agent ?? '—'} | ${v.file ? `\`${v.file}\`` : '—'} | ${v.reason.replace(/\|/g, '\\|')} |`,
      );
    }
    lines.push('');
  }
  if (result.warnings.length) {
    lines.push('**Warnings (not failing):**', '');
    for (const w of result.warnings)
      lines.push(`- ${short(w.sha)} ${w.file ? `\`${w.file}\`` : ''}: ${w.reason}`);
    lines.push('');
  }
  if (result.human.length) {
    lines.push('**Human commits (no `Agent:` trailer; allowed):**', '');
    for (const h of result.human)
      lines.push(`- ${short(h.sha)} ${h.subject} — ${h.author} (${h.files.length} file(s))`);
    lines.push('');
  }
  lines.push(
    '_Lanes: feature-developer/repin-gad → `spec/openapi.json`, `gad.ref.json`; test-generator → `src/api`, `src/models`, `src/utils/schema.ts`, `src/data`, `src/fixtures/api.fixture.ts`, `tests/api`, `tests/unit/schema.spec.ts`, `docs/ai-generation`._',
  );
  return `${lines.join('\n')}\n`;
}

/**
 * Parses `git diff-tree --name-status -M` output.
 *
 * @param {string} text - Output.
 * @returns {FileChange[]}
 */
function parseNameStatus(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status = '', a = '', b] = line.split('\t');
      return status.startsWith('R') || status.startsWith('C')
        ? { status: status[0] ?? 'R', path: b ?? a, oldPath: a }
        : { status, path: a };
    });
}

/**
 * Splits a `--unified=0` patch into removed and added lines.
 *
 * @param {string} patch - Patch text.
 */
function parsePatch(patch) {
  const removed = [];
  const added = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    if (line.startsWith('-')) removed.push(line.slice(1));
    else if (line.startsWith('+')) added.push(line.slice(1));
  }
  return { removed, added };
}

/**
 * Collects the commits of base..head with git.
 *
 * @param {{ base: string, head: string, git: (args: string[]) => string }} input
 * @returns {CommitInfo[]}
 */
function collect({ base, head, git }) {
  const shas = git(['rev-list', '--no-merges', '--reverse', `${base}..${head}`])
    .split('\n')
    .filter(Boolean);
  const testsAtBase = new Set(
    git(['ls-tree', '-r', '--name-only', base, '--', 'tests']).split('\n').filter(Boolean),
  );
  const show = (/** @type {string} */ rev) => {
    try {
      return git(['show', rev]);
    } catch {
      return null;
    }
  };
  return shas.map((sha) => {
    const [authorName = '', authorEmail = '', subject = '', trailer = ''] = git([
      'show',
      '-s',
      '--format=%an%x00%ae%x00%s%x00%(trailers:key=Agent,valueonly,separator=%x2C)',
      sha,
    ])
      .replace(/\n+$/, '')
      .split('\0');
    const agent =
      trailer
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)[0] ?? null;
    const files = parseNameStatus(
      git(['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', sha]),
    );
    const tests = files
      .filter((f) => f.path.startsWith('tests/') && f.status !== 'A')
      .map((f) => {
        const original = f.oldPath ?? f.path;
        const { removed, added } = parsePatch(
          git(['show', '--format=', '--unified=0', '-M', sha, '--', original, f.path]),
        );
        return { path: f.path, existedAtBase: testsAtBase.has(original), removed, added };
      })
      .concat(
        files
          .filter((f) => f.path.startsWith('tests/') && f.status === 'A')
          .map((f) => ({
            path: f.path,
            existedAtBase: false,
            removed: [],
            added: parsePatch(git(['show', '--format=', '--unified=0', sha, '--', f.path])).added,
          })),
      );
    const touchesConfig = files.some(
      (f) => f.path === COVERAGE_CONFIG || f.oldPath === COVERAGE_CONFIG,
    );
    return {
      sha,
      subject,
      authorName,
      authorEmail,
      agent,
      files,
      tests,
      configBefore: touchesConfig ? show(`${sha}^:${COVERAGE_CONFIG}`) : null,
      configAfter: touchesConfig ? show(`${sha}:${COVERAGE_CONFIG}`) : null,
    };
  });
}

/**
 * CLI entrypoint.
 *
 * @param {string[]} argv - Arguments.
 * @returns {number} Exit code.
 */
function main(argv) {
  const fs = require('fs');
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key || !key.startsWith('--') || value === undefined) {
      process.stderr.write(
        'usage: lane-check.js --base <sha> --head <sha> [--repo <dir>] [--summary <file>] [--json <file>]\n',
      );
      return 2;
    }
    opts[key.slice(2)] = value;
  }
  if (!opts.base || !opts.head) {
    process.stderr.write('lane-check: --base and --head are required\n');
    return 2;
  }
  const repo = opts.repo || '.';
  const git = (/** @type {string[]} */ args) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let commits;
  try {
    commits = collect({ base: opts.base, head: opts.head, git });
  } catch (error) {
    process.stderr.write(
      `lane-check: git failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
  const result = evaluate(commits);
  const md = renderMarkdown(result, commits.length);
  process.stdout.write(md);
  if (opts.summary) fs.appendFileSync(opts.summary, md);
  if (opts.json)
    fs.writeFileSync(
      opts.json,
      `${JSON.stringify({ ...result, commits: commits.length }, null, 2)}\n`,
    );
  for (const v of result.violations) {
    process.stdout.write(
      `::error${v.file ? ` file=${v.file}` : ''}::lane-check ${v.sha.slice(0, 7)} (${v.agent ?? 'no trailer'}): ${v.reason}\n`,
    );
  }
  return result.ok ? 0 : 1;
}

module.exports = {
  LANES,
  globToRegExp,
  inLane,
  addedExclusions,
  evaluate,
  renderMarkdown,
  parseNameStatus,
  parsePatch,
  collect,
  main,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
