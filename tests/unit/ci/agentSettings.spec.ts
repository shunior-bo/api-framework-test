/**
 * Regression tests for the agent permission files (.claude/*.settings.json).
 *
 * E2E run 42663915002 (issue #8) showed that in a `--settings` file a rule like
 * `Edit(./tools/**)` matches a `tools/` folder at ANY depth: it denied
 * `gad/public/tools/schema/openapi_rest_demo.json`, which the feature agent must
 * edit, and deny always wins over allow. These tests model that observed,
 * unanchored semantics and fail if a deny rule shadows a GAD path the
 * feature-developer agent is meant to edit, or stops protecting the framework.
 *
 * Run with: npm run test:unit
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

/** Permissions block of a settings file. */
interface Settings {
  permissions: { allow?: string[]; deny: string[] };
}

/**
 * Loads a settings file.
 *
 * @param name - File name under .claude/.
 */
function load(name: string): Settings {
  return JSON.parse(readFileSync(join(process.cwd(), '.claude', name), 'utf8')) as Settings;
}

/**
 * Converts the glob of an `Edit(./…)` rule to a RegExp that matches the
 * pattern at any directory depth (the behavior observed in CI).
 *
 * @param rule - e.g. `Edit(./tools/coverage/**)`.
 */
function editRuleToRegExp(rule: string): RegExp | null {
  const match = /^Edit\(\.\/(.+)\)$/.exec(rule);
  if (!match?.[1]) return null;
  let re = '';
  const glob = match[1];
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] ?? '';
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += 1;
    } else if (c === '*') {
      re += '[^/]*';
    } else {
      re += /[.+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
    }
  }
  return new RegExp(`(^|/)${re}$`);
}

/**
 * Deny rules of a settings file that match a path.
 *
 * @param settings - Settings.
 * @param path - Repository-relative path.
 */
function denying(settings: Settings, path: string): string[] {
  return settings.permissions.deny.filter((rule) => editRuleToRegExp(rule)?.test(path));
}

/** Files the feature-developer agent must be able to edit (its GAD lane + scratch). */
const FEATURE_EDITABLE = [
  'gad/endpoints/article-stats-endpoint.helpers.js',
  'gad/routes/validations.route.js',
  'gad/public/tools/schema/openapi_rest_demo.json',
  'gad/config/config-features.js',
  'gad/config/enums.js',
  '.agent-work/contract.md',
];

/** Files no agent of this repo may edit by hand. */
const PROTECTED = [
  'tools/coverage/src/main.ts',
  'tools/coverage/coverage.config.json',
  'tools/coverage-mcp/src/server.ts',
  'tools/spec-sync/src/main.ts',
  'spec/openapi.json',
  'gad.ref.json',
  '.github/workflows/api-coverage.yml',
  '.claude/feature-developer.settings.json',
  'tests/api/articles.spec.ts',
  'src/api/ArticlesClient.ts',
];

test.describe('agent settings: feature-developer', () => {
  const settings = load('feature-developer.settings.json');

  test('no deny rule shadows a GAD file the agent must edit', () => {
    for (const path of FEATURE_EDITABLE) {
      expect(denying(settings, path), path).toEqual([]);
    }
  });

  test('framework files stay denied (edits only through spec:sync / gad:pin)', () => {
    for (const path of PROTECTED) {
      expect(denying(settings, path).length, path).toBeGreaterThan(0);
    }
  });

  test('GAD files outside the lane stay denied', () => {
    for (const path of [
      'gad/db/db.json',
      'gad/config/config-bugs.js',
      'gad/package.json',
      'gad/tests/test/articles.spec.js',
    ]) {
      expect(denying(settings, path).length, path).toBeGreaterThan(0);
    }
  });
});

test.describe('agent settings: test-generator', () => {
  const settings = load('test-generator.settings.json');

  test('denies the judge (tools, spec, CI, agent config) and GAD', () => {
    for (const path of [
      ...PROTECTED.filter((p) => !p.startsWith('tests/') && !p.startsWith('src/api')),
      'gad/server.js',
    ]) {
      expect(denying(settings, path).length, path).toBeGreaterThan(0);
    }
  });

  test('leaves its own lane editable', () => {
    for (const path of [
      'tests/api/stats.spec.ts',
      'src/api/StatsClient.ts',
      'src/utils/schema.ts',
      'docs/ai-generation/run.md',
      '.agent-work/test-agent-result.json',
    ]) {
      expect(denying(settings, path), path).toEqual([]);
    }
  });
});
