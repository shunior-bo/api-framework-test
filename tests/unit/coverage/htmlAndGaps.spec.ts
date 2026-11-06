/**
 * Unit tests for the HTML report (escaping, determinism) and the `gaps`
 * subcommand (filters, ordering, limit, exclusions, resolved spec context).
 *
 * Run with: npm run test:unit
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { type CliIo, run } from '@coverage/main';
import { type GapBatch } from '@coverage/gaps/select';

const FIXTURES = join(__dirname, 'fixtures');
const GAPS = join(FIXTURES, 'compare', 'base', 'gaps.json');
const SPEC = join(FIXTURES, 'mini-openapi.json');

/**
 * Runs the CLI in-process.
 *
 * @param args - Full argument list.
 * @param now - Clock value.
 */
function cli(
  args: string[],
  now = '2026-01-01T00:00:00.000Z',
): { code: number; stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    env: {},
    now: () => new Date(now),
    isTTY: false,
    git: () => ({ sha: 'abc', branch: '<b>branch</b>' }),
  };
  return { code: run(args, io), stdout, stderr };
}

/**
 * Runs `gaps` and parses the JSON batch.
 *
 * @param args - Arguments after "gaps".
 */
function gaps(args: string[]): GapBatch {
  const result = cli(['gaps', '--from', GAPS, '--spec', SPEC, ...args]);
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as GapBatch;
}

test.describe('Coverage HTML report', () => {
  test(
    'escapes every text from the spec, the records and git (XSS)',
    { tag: ['@negative', '@tc-coverage-46'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const dir = test.info().outputPath('xss');
      mkdirSync(join(dir, 'raw'), { recursive: true });
      const spec = JSON.parse(readFileSync(SPEC, 'utf8')) as {
        paths: Record<string, Record<string, Record<string, unknown>>>;
      };
      const never = spec.paths['/never']?.get;
      if (never) {
        never.summary = '<script>alert("summary")</script>';
        never.tags = ['"><img src=x onerror=alert(1)>'];
      }
      writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec));
      const record = {
        v: 1,
        ts: 'x',
        project: 'api',
        file: 'tests/api/x.spec.ts',
        testId: 't',
        title: 'Evil > <script>alert("title")</script>',
        phase: 'test',
        method: 'GET',
        url: '/api/items',
        path: '/api/items',
        query: [],
        headers: [],
        bodyKeys: [],
        status: 200,
        durationMs: 1,
        testStatus: 'passed',
        expectedStatus: 'passed',
      };
      writeFileSync(join(dir, 'raw', 'r.jsonl'), `${JSON.stringify(record)}\n`);

      // --- ACT -------------------------------------------------------------
      const result = cli([
        '--spec',
        join(dir, 'spec.json'),
        '--records',
        join(dir, 'raw'),
        '--config',
        join(FIXTURES, 'coverage.config.json'),
        '--format',
        'html',
        '--out',
        dir,
      ]);
      const html = readFileSync(join(dir, 'index.html'), 'utf8');

      // --- ASSERT ----------------------------------------------------------
      expect(result.code).toBe(0);
      expect(html.match(/<script/g)).toHaveLength(1); // only the report's own filter script
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<b>branch</b>');
      expect(html).toContain('&lt;script&gt;alert(&quot;summary&quot;)&lt;/script&gt;');
      expect(html).toContain('&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;');
      expect(html).toContain("default-src 'none'");
    },
  );

  test(
    'is a single deterministic file with no external resources',
    { tag: ['@regression', '@tc-coverage-47'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const args = [
        '--spec',
        SPEC,
        '--records',
        FIXTURES,
        '--config',
        join(FIXTURES, 'coverage.config.json'),
        '--format',
        'html',
      ];
      const out1 = test.info().outputPath('h1');
      const out2 = test.info().outputPath('h2');

      // --- ACT -------------------------------------------------------------
      cli([...args, '--out', out1]);
      cli([...args, '--out', out2]);
      const html = readFileSync(join(out1, 'index.html'), 'utf8');

      // --- ASSERT ----------------------------------------------------------
      expect(html).toBe(readFileSync(join(out2, 'index.html'), 'utf8'));
      expect(html).not.toMatch(/(src|href)="(https?:)?\/\//);
      expect(html).toContain('id="ops"');
      expect(html).toContain('data-covered="no"');
    },
  );
});

test.describe('Coverage gaps subcommand', () => {
  test(
    'filters by priority, type, tag and segment-aware path prefix',
    { tag: ['@smoke', '@tc-coverage-48'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const medium = gaps(['--priority', 'medium', '--limit', '0']);
      const statusOnly = gaps(['--type', 'status', '--limit', '0']);
      const untaggedTag = gaps(['--tag', 'parts', '--limit', '0']);
      const prefix = gaps(['--path-prefix', '/items/', '--limit', '0']);
      const partial = gaps(['--path-prefix', '/item', '--limit', '0']);

      // --- ASSERT ----------------------------------------------------------
      expect(medium.batch.map((b) => b.gap.priority)).toEqual([
        'medium',
        'medium',
        'medium',
        'medium',
      ]);
      expect(statusOnly.batch.map((b) => b.gap.id)).toEqual([
        'status:GET /items:401',
        'status:POST /items:422',
        'status:DELETE /items/{id}:404',
      ]);
      expect(untaggedTag.totalMatching).toBe(0);
      expect(prefix.filters.pathPrefix).toBe('/items');
      expect(prefix.totalMatching).toBe(4);
      expect(partial.totalMatching).toBe(0);
    },
  );

  test(
    'keeps the canonical order, applies --limit and --exclude-ids (csv and file)',
    { tag: ['@regression', '@tc-coverage-49'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const file = test.info().outputPath('blocked.txt');
      mkdirSync(test.info().outputPath(), { recursive: true });
      writeFileSync(file, '# blocked by the agent\noperation:GET /never\n');

      // --- ACT -------------------------------------------------------------
      const first2 = gaps(['--limit', '2']);
      const csvExcluded = gaps([
        '--limit',
        '2',
        '--exclude-ids',
        'operation:GET /never,status:GET /items:401',
      ]);
      const fileExcluded = gaps(['--limit', '1', '--exclude-ids', file]);

      // --- ASSERT ----------------------------------------------------------
      expect(first2.totalMatching).toBe(5);
      expect(first2.batch.map((b) => b.gap.id)).toEqual([
        'operation:GET /never',
        'status:GET /items:401',
      ]);
      expect(csvExcluded.batch.map((b) => b.gap.id)).toEqual([
        'parameter:GET /items:query:q',
        'status:POST /items:422',
      ]);
      expect(fileExcluded.batch.map((b) => b.gap.id)).toEqual(['status:GET /items:401']);
    },
  );

  test(
    'adds the operation context with $refs resolved',
    { tag: ['@regression', '@tc-coverage-50'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      // gaps.json produced from THIS spec file (the compare/base fixture was
      // produced from a re-serialized copy, so its spec sha256 differs).
      const out = test.info().outputPath('fresh');
      cli([
        '--spec',
        SPEC,
        '--records',
        FIXTURES,
        '--config',
        join(FIXTURES, 'coverage.config.json'),
        '--format',
        'gaps',
        '--out',
        out,
      ]);
      const fresh = cli(['gaps', '--from', join(out, 'gaps.json'), '--spec', SPEC, '--limit', '0']);
      const stale = cli(['gaps', '--from', GAPS, '--spec', SPEC, '--limit', '1']);

      // --- ACT -------------------------------------------------------------
      const batch = JSON.parse(fresh.stdout) as GapBatch;
      const listItems = batch.batch.find((b) => b.gap.id === 'status:GET /items:401')?.operation;
      const createItem = batch.batch.find((b) => b.gap.id === 'status:POST /items:422')?.operation;

      // --- ASSERT ----------------------------------------------------------
      expect(batch.source.specMatches).toBe(true);
      expect((JSON.parse(stale.stdout) as GapBatch).source.specMatches).toBe(false);
      expect(stale.stderr).toContain('spec changed since gaps.json was produced');
      expect(listItems?.url).toBe('/api/items');
      expect(listItems?.parameters).toContainEqual({
        name: '_limit',
        in: 'query',
        required: false,
        schema: { type: 'integer' },
      });
      expect(listItems?.responses['401']).toEqual({ description: 'Missing or invalid token' });
      expect(createItem?.requestBody).toEqual({
        content: {
          'application/json': {
            schema: { type: 'object', properties: { name: { type: 'string' } } },
          },
        },
      });
      expect(createItem?.securitySchemes).toEqual({ bearerAuth: null });
      expect(JSON.stringify(batch)).not.toContain('$ref');
    },
  );

  test(
    'is deterministic and validates its inputs',
    { tag: ['@negative', '@tc-coverage-51'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const a = cli(['gaps', '--from', GAPS, '--spec', SPEC, '--format', 'markdown']);
      const b = cli(
        ['gaps', '--from', GAPS, '--spec', SPEC, '--format', 'markdown'],
        '2031-01-01T00:00:00.000Z',
      );
      const badPriority = cli(['gaps', '--from', GAPS, '--spec', SPEC, '--priority', 'urgent']);
      const missing = cli(['gaps', '--from', join(FIXTURES, 'nope.json'), '--spec', SPEC]);

      // --- ASSERT ----------------------------------------------------------
      expect(a.stdout).toBe(b.stdout);
      expect(a.stdout).toContain('## `operation:GET /never` (high operation)');
      expect(badPriority.code).toBe(2);
      expect(missing.code).toBe(2);
      expect(missing.stderr).toContain('npm run test:api:coverage');
    },
  );
});
