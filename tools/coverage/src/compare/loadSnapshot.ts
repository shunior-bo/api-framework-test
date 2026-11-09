/**
 * Loads one side of a comparison: `<dir>/coverage.json` + `<dir>/gaps.json`.
 *
 * Validates the files exist, parse, and carry a supported `schemaVersion`.
 * Every problem is an InputError (exit 2) with an actionable message.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CoverageReport, GapsReport } from '../analyze/types.ts';
import { InputError } from '../shared/errors.ts';
import type { CoverageSnapshot } from './delta.ts';

/** schemaVersion values this tool can compare. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1];

/**
 * Reads and parses one JSON file of a snapshot.
 *
 * @param dir - Snapshot directory.
 * @param name - File name.
 * @param label - "base" or "head", for messages.
 */
function readJson(dir: string, name: string, label: string): Record<string, unknown> {
  const file = join(dir, name);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new InputError(
      `${label}: cannot read ${file}. Produce it with \`node tools/coverage/src/cli.ts --format json,gaps --out ${dir}\`.`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InputError(`${label}: ${file} is not valid JSON.`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError(`${label}: ${file} is not a JSON object.`);
  }
  const doc = value as Record<string, unknown>;
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(doc.schemaVersion as number)) {
    throw new InputError(
      `${label}: ${file} has schemaVersion ${JSON.stringify(doc.schemaVersion)}; this tool compares schemaVersion ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}. Re-generate both sides with the same tool version.`,
    );
  }
  return doc;
}

/**
 * Loads a snapshot directory.
 *
 * @param dir - Directory holding coverage.json and gaps.json.
 * @param label - "base" or "head", for messages.
 */
export function loadSnapshot(dir: string, label: string): CoverageSnapshot {
  const coverage = readJson(dir, 'coverage.json', label);
  const gaps = readJson(dir, 'gaps.json', label);
  if (typeof coverage.totals !== 'object' || !Array.isArray(coverage.operations)) {
    throw new InputError(`${label}: ${join(dir, 'coverage.json')} lacks "totals"/"operations".`);
  }
  if (!Array.isArray(gaps.gaps)) {
    throw new InputError(`${label}: ${join(dir, 'gaps.json')} lacks "gaps".`);
  }
  return {
    coverage: coverage as unknown as CoverageReport,
    gaps: gaps as unknown as GapsReport,
  };
}
