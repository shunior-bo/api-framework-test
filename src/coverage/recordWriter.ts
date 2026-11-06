/**
 * Appends recorded requests to the raw JSONL files read by the coverage CLI.
 *
 * SOLID: Single Responsibility Principle (SRP) — file I/O for raw records only.
 *
 * File layout: `<rawDir>/requests-<runId>-w<workerIndex>.jsonl`, one JSON
 * object per line. Each worker writes its own file, so parallel workers never
 * interleave lines.
 *
 * Run isolation: `globalSetup` stamps every Playwright run with a run id. The
 * first time a worker writes in a run, it deletes raw files that belong to
 * OTHER run ids. Files of the current run are never deleted, so concurrent
 * workers cannot race, and runs that record nothing (e.g. `npm run test:unit`)
 * leave the previous coverage data untouched.
 *
 * Must NOT: read environment variables, perform assertions, or record values.
 */
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type RecordedRequest } from '@src/coverage/types';

/** Matches every raw record file name. */
const RAW_FILE = /^requests-.+\.jsonl$/;

/** Directories already cleaned for a given run id in this worker process. */
const preparedRuns = new Set<string>();

/**
 * Makes a run id safe to embed in a file name.
 *
 * @param runId - Any string.
 */
export function sanitizeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9_-]/g, '-');
}

/**
 * Builds the raw file name for one worker of one run.
 *
 * @param runId - The run id (sanitized here).
 * @param workerIndex - Playwright `testInfo.workerIndex`.
 */
export function rawFileName(runId: string, workerIndex: number): string {
  return `requests-${sanitizeRunId(runId)}-w${workerIndex}.jsonl`;
}

/**
 * Deletes raw files that belong to runs other than `runId` (once per process).
 *
 * @param rawDir - Absolute raw records directory.
 * @param runId - The current run id.
 */
export function prepareRunDir(rawDir: string, runId: string): void {
  const key = `${rawDir}::${runId}`;
  if (preparedRuns.has(key)) return;
  mkdirSync(rawDir, { recursive: true });
  const currentPrefix = `requests-${sanitizeRunId(runId)}-`;
  for (const name of readdirSync(rawDir)) {
    if (RAW_FILE.test(name) && !name.startsWith(currentPrefix)) {
      rmSync(join(rawDir, name), { force: true });
    }
  }
  preparedRuns.add(key);
}

/**
 * Appends records as JSONL to this worker's raw file.
 *
 * @param rawDir - Absolute raw records directory.
 * @param runId - The current run id.
 * @param workerIndex - Playwright `testInfo.workerIndex`.
 * @param records - Records to append; nothing is written when empty.
 */
export function appendRecords(
  rawDir: string,
  runId: string,
  workerIndex: number,
  records: readonly RecordedRequest[],
): void {
  if (records.length === 0) return;
  prepareRunDir(rawDir, runId);
  const lines = records.map((record) => JSON.stringify(record)).join('\n');
  appendFileSync(join(rawDir, rawFileName(runId, workerIndex)), `${lines}\n`, 'utf8');
}
