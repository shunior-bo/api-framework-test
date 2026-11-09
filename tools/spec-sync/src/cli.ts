/**
 * Entrypoint: `node tools/spec-sync/src/cli.ts <sync|check|pin|ref-guard> [options]`
 * (Node ≥ 22.18 / 24, native TypeScript type stripping, zero dependencies).
 *
 * All logic lives in main.ts; this file only wires real process I/O.
 */
import { run } from './main.ts';

process.exitCode = run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
});
