/**
 * Integration test of the api-coverage MCP server over stdio (no GAD needed).
 *
 * The test produces coverage.json + gaps.json from the mini fixtures, starts
 * `node tools/coverage-mcp/src/server.ts` as a child process through the
 * official SDK client, and calls the read-only tools.
 *
 * Run with: npm run test:unit
 */
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { run } from '@coverage/main';
import { parseJunit } from '@coverage-mcp/handlers';

const FIXTURES = join(__dirname, 'fixtures');
const SPEC = join(FIXTURES, 'mini-openapi.json');

/** Minimal typing of the SDK client used here (loaded with require: CJS build). */
interface McpClient {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools: { name: string }[] }>;
  callTool(req: { name: string; arguments: Record<string, unknown> }): Promise<{
    content: { type: string; text: string }[];
    isError?: boolean;
  }>;
  close(): Promise<void>;
}
const { Client } = require('@modelcontextprotocol/sdk/client/index.js') as {
  Client: new (info: { name: string; version: string }) => McpClient;
};
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js') as {
  StdioClientTransport: new (params: {
    command: string;
    args: string[];
    stderr?: string;
  }) => unknown;
};

/**
 * Parses the JSON text of a tool result.
 *
 * @param result - callTool result.
 */
function payload(result: Awaited<ReturnType<McpClient['callTool']>>): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? 'null') as Record<string, unknown>;
}

test.describe('api-coverage MCP server', () => {
  let client: McpClient;

  test.beforeAll(async () => {
    const coverageDir = test.info().outputPath('coverage');
    const silent = { stdout: () => undefined, stderr: () => undefined };
    run(
      [
        '--spec',
        SPEC,
        '--records',
        FIXTURES,
        '--config',
        join(FIXTURES, 'coverage.config.json'),
        '--format',
        'json,gaps',
        '--out',
        coverageDir,
      ],
      { ...silent, env: {}, now: () => new Date('2026-01-01T00:00:00.000Z'), isTTY: false },
    );
    client = new Client({ name: 'unit-test', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          'tools/coverage-mcp/src/server.ts',
          '--root',
          process.cwd(),
          '--coverage-dir',
          coverageDir,
          '--spec',
          SPEC,
        ],
        stderr: 'ignore',
      }),
    );
  });

  test.afterAll(async () => {
    await client?.close();
  });

  test('lists the five coverage tools', { tag: ['@smoke', '@tc-coverage-55'] }, async () => {
    // --- ACT -------------------------------------------------------------
    const { tools } = await client.listTools();

    // --- ASSERT ----------------------------------------------------------
    expect(tools.map((t) => t.name).sort()).toEqual([
      'coverage_compare',
      'coverage_get_operation',
      'coverage_list_gaps',
      'coverage_run',
      'coverage_summary',
    ]);
  });

  test(
    'coverage_summary returns the totals of the latest run',
    { tag: ['@regression', '@tc-coverage-56'] },
    async () => {
      // --- ACT -------------------------------------------------------------
      const result = await client.callTool({ name: 'coverage_summary', arguments: {} });
      const body = payload(result);

      // --- ASSERT ----------------------------------------------------------
      expect(result.isError).toBeFalsy();
      expect(body.totals).toMatchObject({ operations: { covered: 6, total: 7, pct: 85.71 } });
      expect(body.gaps).toEqual({ total: 5, high: 1, medium: 4, low: 0 });
    },
  );

  test(
    'coverage_list_gaps returns the same deterministic batch as the CLI, with spec context',
    { tag: ['@regression', '@tc-coverage-57'] },
    async () => {
      // --- ACT -------------------------------------------------------------
      const result = await client.callTool({
        name: 'coverage_list_gaps',
        arguments: { type: ['status'], limit: 2 },
      });
      const body = payload(result) as {
        totalMatching: number;
        batch: { gap: { id: string }; operation: { url: string } }[];
      };

      // --- ASSERT ----------------------------------------------------------
      expect(body.totalMatching).toBe(3);
      expect(body.batch.map((b) => b.gap.id)).toEqual([
        'status:GET /items:401',
        'status:POST /items:422',
      ]);
      expect(body.batch[0]?.operation.url).toBe('/api/items');
    },
  );

  test(
    'tools report input errors as MCP errors instead of crashing',
    { tag: ['@negative', '@tc-coverage-58'] },
    async () => {
      // --- ACT -------------------------------------------------------------
      const badKey = await client.callTool({
        name: 'coverage_get_operation',
        arguments: { key: 'nonsense' },
      });
      const badFiles = await client.callTool({
        name: 'coverage_run',
        arguments: { files: ['../../etc/passwd'] },
      });
      const ok = await client.callTool({
        name: 'coverage_get_operation',
        arguments: { key: 'get /never' },
      });

      // --- ASSERT ----------------------------------------------------------
      expect(badKey.isError).toBe(true);
      expect(badFiles.isError).toBe(true);
      expect(badFiles.content[0]?.text).toContain('under tests/api/');
      expect(payload(ok)).toMatchObject({ key: 'GET /never', coverage: { covered: false } });
    },
  );

  test(
    'parseJunit extracts counts and failure messages',
    { tag: ['@regression', '@tc-coverage-59'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const xml = `<testsuites tests="3" failures="1" skipped="0" errors="0">
<testsuite><testcase name="POST /api/likes returns 201" classname="likes.spec.ts"><failure message="expect(received).toBe(expected) &quot;201&quot;" type="FAILURE">x</failure></testcase>
<testcase name="GET /api/likes returns 200" classname="likes.spec.ts"></testcase></testsuite></testsuites>`;

      // --- ACT -------------------------------------------------------------
      const parsed = parseJunit(xml);

      // --- ASSERT ----------------------------------------------------------
      expect(parsed).toEqual({
        tests: 3,
        failures: 1,
        skipped: 0,
        failed: [
          { name: 'POST /api/likes returns 201', message: 'expect(received).toBe(expected) "201"' },
        ],
      });
    },
  );
});
