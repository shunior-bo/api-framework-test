/**
 * Side effects injected into every CLI subcommand (real process I/O in cli.ts,
 * captured buffers in unit tests).
 */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  /** Clock for `generatedAt`. */
  now: () => Date;
  /** Whether stdout is a TTY (enables colors unless NO_COLOR is set). */
  isTTY: boolean;
  /** Git lookup; return nulls when unavailable. Defaults to the `git` binary. */
  git?: () => { sha: string | null; branch: string | null };
}

/**
 * Parses a comma-separated list flag ("a, b,,c" → ["a","b","c"]).
 *
 * @param value - Raw flag value.
 */
export function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
