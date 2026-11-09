/**
 * `gaps` subcommand: deterministic batch selection for test-generation agents.
 *
 *   node tools/coverage/src/cli.ts gaps [--from reports/coverage/gaps.json]
 *        [--spec spec/openapi.json] [--priority high,medium] [--type operation,status,parameter]
 *        [--tag likes,bookmarks] [--path-prefix /likes] [--exclude-ids <file|csv>]
 *        [--limit 5] [--format json|markdown]
 *
 * Prints the batch to stdout. Fully deterministic (no timestamp).
 * Exit codes: 0 OK (an empty batch is OK) · 2 input/usage error.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { GapsReport } from '../analyze/types.ts';
import { InputError } from '../shared/errors.ts';
import { csv, type CliIo } from '../shared/io.ts';
import { loadSpecDocument } from '../spec/operationContext.ts';
import { renderBatchMarkdown, selectBatch, type GapFilters } from './select.ts';

export const GAPS_USAGE = `Usage: node tools/coverage/src/cli.ts gaps [options]

  --from <file>          gaps.json to select from (default: reports/coverage/gaps.json)
  --spec <file>          OpenAPI JSON for the context (default: $OPENAPI_PATH or spec/openapi.json)
  --priority <list>      high,medium,low
  --type <list>          operation,status,parameter
  --tag <list>           OpenAPI tags (a gap matches if it has any of them)
  --path-prefix <path>   Template path prefix, segment-aware (e.g. /likes)
  --exclude-ids <v>      File (one id per line, or a JSON array) or comma-separated ids to skip
  --limit <n>            Batch size (default: 5; 0 = no limit)
  --format <f>           json (default) | markdown
  -h, --help             Show this help
`;

const PRIORITIES = ['high', 'medium', 'low'];
const TYPES = ['operation', 'status', 'parameter'];

/**
 * Reads --exclude-ids: a file path (lines or JSON array) or a CSV of ids.
 *
 * @param value - Flag value.
 */
export function parseExcludeIds(value: string | undefined): string[] {
  if (!value) return [];
  if (existsSync(value)) {
    const text = readFileSync(value, 'utf8').trim();
    if (text.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
      } catch {
        throw new InputError(`--exclude-ids file "${value}" is not a valid JSON array.`);
      }
    }
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  }
  return csv(value);
}

/**
 * Validates that every value belongs to an allowed set.
 *
 * @param flag - Flag name.
 * @param values - Values.
 * @param allowed - Allowed values.
 */
function checkValues(flag: string, values: string[], allowed: string[]): void {
  for (const v of values) {
    if (!allowed.includes(v)) {
      throw new InputError(`--${flag} accepts ${allowed.join(', ')}; got "${v}".`);
    }
  }
}

/**
 * Runs the gaps subcommand.
 *
 * @param argv - Arguments after "gaps".
 * @param io - Injected side effects.
 */
export function runGaps(argv: string[], io: CliIo): number {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        from: { type: 'string' },
        spec: { type: 'string' },
        priority: { type: 'string' },
        type: { type: 'string' },
        tag: { type: 'string' },
        'path-prefix': { type: 'string' },
        'exclude-ids': { type: 'string' },
        limit: { type: 'string' },
        format: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (error) {
    throw new InputError(
      `${error instanceof Error ? error.message : String(error)}\n\n${GAPS_USAGE}`,
    );
  }
  if (values.help) {
    io.stdout(GAPS_USAGE);
    return 0;
  }
  const format = values.format ?? 'json';
  if (format !== 'json' && format !== 'markdown') {
    throw new InputError(`--format must be json or markdown, got "${format}".`);
  }
  const limitRaw = values.limit === undefined ? 5 : Number(values.limit);
  if (!Number.isInteger(limitRaw) || limitRaw < 0) {
    throw new InputError(`--limit expects a non-negative integer, got "${values.limit}".`);
  }
  const filters: Partial<GapFilters> = {
    priority: csv(values.priority),
    type: csv(values.type),
    tag: csv(values.tag),
    pathPrefix: values['path-prefix'] ?? null,
    excludeIds: parseExcludeIds(values['exclude-ids']),
    limit: limitRaw === 0 ? null : limitRaw,
  };
  checkValues('priority', filters.priority ?? [], PRIORITIES);
  checkValues('type', filters.type ?? [], TYPES);

  const gapsPath = values.from ?? 'reports/coverage/gaps.json';
  let report: GapsReport;
  try {
    report = JSON.parse(readFileSync(gapsPath, 'utf8')) as GapsReport;
  } catch {
    throw new InputError(
      `Cannot read gaps "${gapsPath}". Run \`npm run test:api:coverage\` (or pass --from).`,
    );
  }
  if (report.schemaVersion !== 1 || !Array.isArray(report.gaps)) {
    throw new InputError(`"${gapsPath}" is not a gaps.json with schemaVersion 1.`);
  }
  const spec = loadSpecDocument(values.spec ?? (io.env.OPENAPI_PATH || 'spec/openapi.json'));
  const batch = selectBatch(report, gapsPath, spec, filters);
  if (!batch.source.specMatches) {
    io.stderr(
      'api-coverage: warning: spec changed since gaps.json was produced; re-run coverage.\n',
    );
  }
  io.stdout(format === 'json' ? `${JSON.stringify(batch, null, 2)}\n` : renderBatchMarkdown(batch));
  return 0;
}
