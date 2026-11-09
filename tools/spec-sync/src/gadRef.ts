/**
 * `gad.ref.json`: the single source of truth for which GAD revision the
 * framework tests (repository, ref, exact commit sha, spec path inside GAD).
 *
 * SOLID: Single Responsibility Principle (SRP) — parse, validate and serialize the pin file.
 *
 * Must NOT: read or write the spec, run git, or touch the network.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { InputError } from '../../coverage/src/shared/errors.ts';

/** Contents of gad.ref.json. */
export interface GadRef {
  /** `owner/name` of the GAD repository. */
  repository: string;
  /** Branch (or tag) the sha belongs to: `main` on main, `feature/<n>-<slug>` on a feature PR. */
  ref: string;
  /** Full 40-character commit sha that CI checks out. */
  sha: string;
  /** Path of the OpenAPI document inside the GAD repository. */
  specPath: string;
}

/** Default location of the pin file (repository root). */
export const DEFAULT_REF_FILE = 'gad.ref.json';

/** A full, lower-case git commit sha. */
export const SHA_RE = /^[0-9a-f]{40}$/;

/** A git ref name we accept (no spaces, no `..`, no leading `-`, no control chars). */
const REF_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/;

/** `owner/name`. */
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Validates a commit sha.
 *
 * @param sha - Candidate sha.
 * @returns The sha (unchanged).
 */
export function assertSha(sha: string): string {
  if (!SHA_RE.test(sha)) {
    throw new InputError(`"${sha}" is not a full 40-character lower-case commit sha.`);
  }
  return sha;
}

/**
 * Validates a ref name.
 *
 * @param ref - Candidate ref (branch or tag name).
 * @returns The ref (unchanged).
 */
export function assertRef(ref: string): string {
  if (!REF_RE.test(ref)) throw new InputError(`"${ref}" is not a valid git ref name.`);
  return ref;
}

/**
 * Parses and validates the text of gad.ref.json.
 *
 * @param text - Raw JSON.
 * @param source - File name for messages.
 * @returns The validated pin.
 */
export function parseGadRef(text: string, source = DEFAULT_REF_FILE): GadRef {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new InputError(`${source} is not valid JSON.`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new InputError(`${source} must be a JSON object.`);
  }
  const obj = raw as Record<string, unknown>;
  const field = (name: keyof GadRef): string => {
    const value = obj[name];
    if (typeof value !== 'string' || value === '') {
      throw new InputError(`${source}: "${name}" must be a non-empty string.`);
    }
    return value;
  };
  const repository = field('repository');
  if (!REPO_RE.test(repository)) {
    throw new InputError(`${source}: "repository" must look like owner/name, got "${repository}".`);
  }
  const specPath = field('specPath');
  if (specPath.startsWith('/') || specPath.split('/').includes('..')) {
    throw new InputError(
      `${source}: "specPath" must be relative to the GAD root, got "${specPath}".`,
    );
  }
  return {
    repository,
    ref: assertRef(field('ref')),
    sha: assertSha(field('sha')),
    specPath,
  };
}

/**
 * Reads and validates gad.ref.json.
 *
 * @param file - Path of the pin file.
 */
export function readGadRef(file = DEFAULT_REF_FILE): GadRef {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new InputError(`Cannot read ${file}. It must exist at the repository root.`);
  }
  return parseGadRef(text, file);
}

/**
 * Serializes a pin in the repo's JSON style (2 spaces, trailing newline; Prettier-stable).
 *
 * @param ref - The pin.
 */
export function formatGadRef(ref: GadRef): string {
  const ordered: GadRef = {
    repository: ref.repository,
    ref: ref.ref,
    sha: ref.sha,
    specPath: ref.specPath,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * Writes gad.ref.json.
 *
 * @param file - Path of the pin file.
 * @param ref - The pin.
 */
export function writeGadRef(file: string, ref: GadRef): void {
  writeFileSync(file, formatGadRef(ref), 'utf8');
}

/**
 * Guard for pull requests: a PR into `targetBranch` must be pinned to a GAD
 * commit on the same branch name (`main` → `main`), never to a feature branch.
 *
 * @param ref - The pin of the PR head.
 * @param expectedRef - The ref the pin must name (e.g. "main").
 * @returns Problems found (empty = OK).
 */
export function refGuardProblems(ref: GadRef, expectedRef: string): string[] {
  if (ref.ref === expectedRef) return [];
  return [
    `gad.ref.json pins GAD "${ref.ref}" @ ${ref.sha.slice(0, 7)}, but a PR into ${expectedRef} must pin a GAD ${expectedRef} commit. ` +
      `Merge the GAD PR first, then run: npm run gad:pin -- --sha <GAD ${expectedRef} sha> --ref ${expectedRef}`,
  ];
}
