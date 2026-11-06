/**
 * api-coverage MCP server (stdio).
 *
 * Exposes the coverage tool to agents through the Model Context Protocol:
 *
 *   coverage_summary        totals + byTag of the latest run              read-only
 *   coverage_list_gaps      deterministic gap batch with spec context     read-only
 *   coverage_get_operation  coverage detail + resolved spec of one op     read-only
 *   coverage_compare        delta between two snapshot directories        writes reports/
 *   coverage_run            run API tests (optional grep/files) + coverage runs tests against local GAD
 *
 * Registered in .mcp.json as "api-coverage". Run manually:
 *   node tools/coverage-mcp/src/server.ts [--root <repo>] [--coverage-dir <dir>] [--spec <file>] [--config <file>]
 *
 * Logs go to stderr only (stdout carries the protocol).
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  compare,
  defaultPaths,
  getOperation,
  listGaps,
  MAX_RUN_SECONDS,
  runCoverage,
  summary,
} from './handlers.ts';

const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  options: {
    root: { type: 'string' },
    'coverage-dir': { type: 'string' },
    spec: { type: 'string' },
    config: { type: 'string' },
  },
});

const repoRoot = values.root ?? fileURLToPath(new URL('../../..', import.meta.url));
const paths = defaultPaths(repoRoot, {
  coverageDir: values['coverage-dir'],
  spec: values.spec,
  config: values.config,
});

/**
 * Wraps a handler result (or error) as MCP tool content.
 *
 * @param work - Handler call.
 */
async function respond(
  work: () => unknown,
): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  try {
    const value = await work();
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
  } catch (error) {
    return {
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }
}

const gapFilterShape = {
  priority: z
    .array(z.enum(['high', 'medium', 'low']))
    .optional()
    .describe('Gap priorities to include.'),
  type: z
    .array(z.enum(['operation', 'status', 'parameter']))
    .optional()
    .describe('Gap types to include.'),
  tag: z
    .array(z.string())
    .optional()
    .describe('OpenAPI tags; a gap matches if it has any of them.'),
  pathPrefix: z.string().optional().describe('Segment-aware template path prefix, e.g. "/likes".'),
  excludeIds: z
    .array(z.string())
    .optional()
    .describe('Gap ids to skip (e.g. ones already flagged as blocked).'),
  limit: z.number().int().min(0).max(100).optional().describe('Batch size (default 5; 0 = all).'),
};

const server = new McpServer({ name: 'api-coverage', version: '1.0.0' });

server.registerTool(
  'coverage_summary',
  {
    title: 'Coverage summary',
    description:
      'Totals (operations, documented statuses, parameters), per-tag coverage and gap counts of the latest coverage run (reports/coverage). Read-only.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => respond(() => summary(paths)),
);

server.registerTool(
  'coverage_list_gaps',
  {
    title: 'List coverage gaps (batch)',
    description:
      'Deterministic batch of gaps from reports/coverage/gaps.json, filtered and ordered like the `gaps` CLI, each with the full spec context of its operation ($refs resolved). Use this instead of reading gaps.json or the spec by hand. Read-only.',
    inputSchema: gapFilterShape,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async (args) =>
    respond(() =>
      listGaps(paths, {
        priority: args.priority,
        type: args.type,
        tag: args.tag,
        pathPrefix: args.pathPrefix ?? null,
        excludeIds: args.excludeIds,
        limit: args.limit === undefined ? 5 : args.limit === 0 ? null : args.limit,
      }),
    ),
);

server.registerTool(
  'coverage_get_operation',
  {
    title: 'Get one operation',
    description:
      'Coverage detail (statuses, parameters, observed statuses, tests), open gaps and resolved spec of one operation, e.g. key "POST /likes" (template path without /api). Read-only.',
    inputSchema: { key: z.string().describe('Operation key: "METHOD /template/path".') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async (args) => respond(() => getOperation(paths, args.key)),
);

server.registerTool(
  'coverage_compare',
  {
    title: 'Compare two coverage snapshots',
    description:
      'Delta between a base and a head snapshot directory (each with coverage.json + gaps.json): totals, newly covered / regressed operations, opened and closed gap ids, verdict. Writes delta.json and delta.md (default reports/coverage/delta).',
    inputSchema: {
      base: z.string().describe('Base snapshot directory, relative to the repo root.'),
      head: z.string().optional().describe('Head snapshot directory (default: reports/coverage).'),
      out: z.string().optional().describe('Output directory (default: reports/coverage/delta).'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => respond(() => compare(paths, args.base, args.head, args.out)),
);

server.registerTool(
  'coverage_run',
  {
    title: 'Run API tests and measure coverage',
    description: `Runs the Playwright API tests against the local GAD (BASE_URL in .env), then re-analyzes coverage. Returns test counts, failed tests (name + message), coverage totals and gap counts, plus stdout/stderr tails. A filtered run (grep/files) REPLACES the recorded data: run without filters to measure the full suite. Timeout default 600 s (max ${MAX_RUN_SECONDS}).`,
    inputSchema: {
      grep: z.string().optional().describe('Playwright --grep pattern, e.g. "@tc-likes".'),
      files: z
        .array(z.string())
        .optional()
        .describe('Spec files under tests/api/, e.g. ["tests/api/likes.spec.ts"].'),
      timeoutSec: z.number().int().min(10).max(MAX_RUN_SECONDS).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (args) => respond(() => runCoverage(paths, args)),
);

await server.connect(new StdioServerTransport());
process.stderr.write(`api-coverage MCP server ready (root ${paths.root})\n`);
