/**
 * spec-sync CLI logic: keeps `spec/openapi.json` and `gad.ref.json` in step
 * with the GAD revision under test.
 *
 *   cli.ts sync      --gad-dir <path>              copy GAD's spec into spec/openapi.json
 *   cli.ts check     --gad-dir <path>              exit 1 if spec/openapi.json ≠ GAD's spec (drift)
 *   cli.ts pin       --sha <sha> [--ref <ref>]     update gad.ref.json
 *   cli.ts ref-guard --expect-ref <ref>            exit 1 if gad.ref.json.ref ≠ <ref> (PR merge guard)
 *
 * Kept free of `import.meta` and process globals so it can be unit-tested
 * in-process; cli.ts wires the real I/O.
 *
 * Exit codes: 0 OK · 1 drift / guard failed · 2 input or usage error.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { InputError } from '../../coverage/src/shared/errors.ts';
import {
  assertRef,
  assertSha,
  DEFAULT_REF_FILE,
  readGadRef,
  refGuardProblems,
  writeGadRef,
} from './gadRef.ts';
import { diffSpecs, normalizeSpecText, renderDiff } from './specDiff.ts';

/** Side effects injected by cli.ts (buffers in unit tests). */
export interface SpecSyncIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  /** Commit sha checked out in a GAD directory, or null. Defaults to `git rev-parse HEAD`. */
  gitHead?: (dir: string) => string | null;
}

const NAME = 'spec-sync';

/** Default framework spec path. */
export const DEFAULT_SPEC = 'spec/openapi.json';

/** Default GAD checkout: $GAD_DIR, else the sibling folder used locally. */
const defaultGadDir = (env: SpecSyncIo['env']): string => env.GAD_DIR || '../gad-gui-api-demo';

export const USAGE = `Usage: node tools/spec-sync/src/cli.ts <command> [options]

Commands:
  sync       Copy <gad-dir>/<specPath> to spec/openapi.json (byte-identical, LF, one trailing newline)
  check      Exit 1 if spec/openapi.json differs from the GAD spec (drift); prints the operation diff
  pin        Update gad.ref.json: --sha <40-char sha> [--ref <branch>] [--repository owner/name]
  ref-guard  Exit 1 unless gad.ref.json.ref equals --expect-ref (default: main)

Options:
  --gad-dir <path>      GAD checkout (default: $GAD_DIR or ../gad-gui-api-demo)       [sync, check]
  --spec <file>         Framework spec (default: spec/openapi.json)                    [sync, check]
  --ref-file <file>     Pin file (default: gad.ref.json)                               [all]
  --sha <sha>           GAD commit to pin                                              [pin]
  --ref <ref>           GAD branch the sha belongs to (default: keep current)          [pin]
  --repository <repo>   GAD repository owner/name (default: keep current)              [pin]
  --expect-ref <ref>    Ref a PR head must pin (default: main)                         [ref-guard]
  -h, --help            Show this help

npm scripts: spec:sync, spec:check, gad:pin (pass flags after --).
Exit codes: 0 OK · 1 drift or guard failed · 2 input/usage error.
`;

/**
 * Default `git rev-parse HEAD` lookup.
 *
 * @param dir - Repository directory.
 */
function defaultGitHead(dir: string): string | null {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** Parsed options shared by every command. */
interface Options {
  gadDir: string;
  spec: string;
  refFile: string;
  sha: string | undefined;
  ref: string | undefined;
  repository: string | undefined;
  expectRef: string;
  help: boolean;
}

/**
 * Parses the flags of a command.
 *
 * @param argv - Arguments after the command.
 * @param env - Environment.
 */
function parseOptions(argv: string[], env: SpecSyncIo['env']): Options {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        'gad-dir': { type: 'string' },
        spec: { type: 'string' },
        'ref-file': { type: 'string' },
        sha: { type: 'string' },
        ref: { type: 'string' },
        repository: { type: 'string' },
        'expect-ref': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (error) {
    throw new InputError(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  }
  return {
    gadDir: values['gad-dir'] ?? defaultGadDir(env),
    spec: values.spec ?? DEFAULT_SPEC,
    refFile: values['ref-file'] ?? DEFAULT_REF_FILE,
    sha: values.sha,
    ref: values.ref,
    repository: values.repository,
    expectRef: values['expect-ref'] ?? 'main',
    help: values.help === true,
  };
}

/**
 * Reads GAD's spec (path from gad.ref.json) and the framework spec.
 *
 * @param opts - Options.
 */
function readBothSpecs(opts: Options): {
  gadSpecFile: string;
  gadText: string;
  local: string | null;
} {
  const pin = readGadRef(opts.refFile);
  if (!existsSync(opts.gadDir)) {
    throw new InputError(`GAD directory "${opts.gadDir}" does not exist. Pass --gad-dir <path>.`);
  }
  const gadSpecFile = join(opts.gadDir, pin.specPath);
  let gadText: string;
  try {
    gadText = readFileSync(gadSpecFile, 'utf8');
  } catch {
    throw new InputError(
      `Cannot read the GAD spec "${gadSpecFile}" (specPath in ${opts.refFile}).`,
    );
  }
  const local = existsSync(opts.spec) ? readFileSync(opts.spec, 'utf8') : null;
  return { gadSpecFile, gadText, local };
}

/**
 * Describes the checked-out GAD revision for messages.
 *
 * @param opts - Options.
 * @param io - I/O.
 */
function gadLabel(opts: Options, io: SpecSyncIo): string {
  const head = (io.gitHead ?? defaultGitHead)(opts.gadDir);
  return head ? `GAD@${head.slice(0, 12)}` : `GAD (${opts.gadDir})`;
}

/**
 * `sync`: copies GAD's spec into the framework.
 *
 * @param opts - Options.
 * @param io - I/O.
 */
function runSync(opts: Options, io: SpecSyncIo): number {
  const { gadSpecFile, gadText, local } = readBothSpecs(opts);
  const next = normalizeSpecText(gadText);
  // parse it once: never vendor something the coverage tool cannot read
  const diff = diffSpecs(local ?? next, next);
  if (local === next) {
    io.stdout(
      `${NAME}: ${opts.spec} already matches ${gadSpecFile} (${gadLabel(opts, io)}). No change.\n`,
    );
    return 0;
  }
  writeFileSync(opts.spec, next, 'utf8');
  io.stdout(
    `${NAME}: wrote ${opts.spec} from ${gadSpecFile} (${gadLabel(opts, io)}).\n${renderDiff(diff)}`,
  );
  return 0;
}

/**
 * `check`: drift detection.
 *
 * @param opts - Options.
 * @param io - I/O.
 */
function runCheck(opts: Options, io: SpecSyncIo): number {
  const { gadSpecFile, gadText, local } = readBothSpecs(opts);
  const label = gadLabel(opts, io);
  if (local === null) {
    io.stderr(`${NAME}: ${opts.spec} does not exist; run npm run spec:sync.\n`);
    return 1;
  }
  const expected = normalizeSpecText(gadText);
  if (local === expected) {
    io.stdout(`${NAME}: OK — ${opts.spec} matches ${gadSpecFile} (${label}).\n`);
    return 0;
  }
  const diff = diffSpecs(local, expected);
  io.stderr(
    `${NAME}: DRIFT — ${opts.spec} is out of sync with ${label}; run npm run spec:sync.\n` +
      `Diff from ${opts.spec} to the GAD spec:\n${renderDiff(diff)}`,
  );
  return 1;
}

/**
 * `pin`: updates gad.ref.json.
 *
 * @param opts - Options.
 * @param io - I/O.
 */
function runPin(opts: Options, io: SpecSyncIo): number {
  if (!opts.sha) throw new InputError(`pin needs --sha <40-char sha>.\n\n${USAGE}`);
  const current = readGadRef(opts.refFile);
  const next = {
    repository: opts.repository ?? current.repository,
    ref: opts.ref === undefined ? current.ref : assertRef(opts.ref),
    sha: assertSha(opts.sha),
    specPath: current.specPath,
  };
  writeGadRef(opts.refFile, next);
  io.stdout(
    `${NAME}: pinned ${next.repository}@${next.ref} ${next.sha} in ${opts.refFile}` +
      (current.sha === next.sha && current.ref === next.ref ? ' (unchanged)' : '') +
      '.\n',
  );
  return 0;
}

/**
 * `ref-guard`: the pin of a PR into main must name main.
 *
 * @param opts - Options.
 * @param io - I/O.
 */
function runRefGuard(opts: Options, io: SpecSyncIo): number {
  const pin = readGadRef(opts.refFile);
  const problems = refGuardProblems(pin, assertRef(opts.expectRef));
  if (problems.length === 0) {
    io.stdout(`${NAME}: OK — ${opts.refFile} pins ${pin.repository}@${pin.ref} ${pin.sha}.\n`);
    return 0;
  }
  io.stderr(`${NAME}: ${problems.join('\n')}\n`);
  return 1;
}

const COMMANDS: Record<string, (opts: Options, io: SpecSyncIo) => number> = {
  sync: runSync,
  check: runCheck,
  pin: runPin,
  'ref-guard': runRefGuard,
};

/**
 * Runs the CLI.
 *
 * @param argv - Arguments without "node" and the script path.
 * @param io - Injected side effects.
 * @returns The process exit code.
 */
export function run(argv: string[], io: SpecSyncIo): number {
  try {
    const [command, ...rest] = argv;
    if (command === undefined || command === '-h' || command === '--help') {
      io.stdout(USAGE);
      return command === undefined ? 2 : 0;
    }
    const handler = COMMANDS[command];
    if (!handler) {
      throw new InputError(
        `Unknown command "${command}". Use one of: ${Object.keys(COMMANDS).join(', ')}.\n\n${USAGE}`,
      );
    }
    const opts = parseOptions(rest, io.env);
    if (opts.help) {
      io.stdout(USAGE);
      return 0;
    }
    return handler(opts, io);
  } catch (error) {
    if (error instanceof InputError) {
      io.stderr(`${NAME}: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}
