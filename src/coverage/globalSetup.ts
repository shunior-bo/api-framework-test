/**
 * Playwright globalSetup: stamps the current run with a coverage run id.
 *
 * SOLID: Single Responsibility Principle (SRP) — only creates the run id.
 *
 * Why not delete the raw directory here: globalSetup receives every configured
 * project even when the run is filtered with `--project=unit`, so wiping here
 * would erase API coverage whenever unit tests run. Instead, the run id is
 * exported through `process.env.COVERAGE_RUN_ID` (inherited by workers), and
 * recordWriter.ts deletes files of OTHER runs the first time a worker records.
 * Net effect: coverage always reflects the last run that made API requests.
 *
 * This is the only file outside playwright.config.ts and src/fixtures/ that
 * touches `process.env`, and it only WRITES the run id.
 *
 * Must NOT: delete files, make network calls, or read other environment variables.
 */
export default function globalSetup(): void {
  process.env.COVERAGE_RUN_ID = `${new Date().toISOString().replace(/[:.]/g, '-')}-p${process.pid}`;
}
