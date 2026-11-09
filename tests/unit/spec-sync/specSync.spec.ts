/**
 * Unit tests for tools/spec-sync (gad.ref.json pin, spec sync, drift check,
 * PR ref guard). The CLI runs in-process through `run()` with injected I/O, on
 * temporary copies of the coverage tool's mini OpenAPI fixture. No network.
 *
 * Run with: npm run test:unit
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { formatGadRef, parseGadRef, refGuardProblems, type GadRef } from '@spec-sync/gadRef';
import { run, type SpecSyncIo } from '@spec-sync/main';
import { diffSpecs, normalizeSpecText } from '@spec-sync/specDiff';

const MINI_SPEC = readFileSync(
  join(__dirname, '..', 'coverage', 'fixtures', 'mini-openapi.json'),
  'utf8',
);
const SHA_A = 'a'.repeat(40);
const SHA_B = '0123456789abcdef0123456789abcdef01234567';

const PIN: GadRef = {
  repository: 'shunior-bo/gad-gui-api-demo',
  ref: 'main',
  sha: SHA_A,
  specPath: 'public/tools/schema/openapi_rest_demo.json',
};

/** A temporary framework root + GAD checkout. */
interface Sandbox {
  root: string;
  gad: string;
  spec: string;
  refFile: string;
  gadSpec: string;
}

/**
 * Creates a sandbox where both specs equal `MINI_SPEC`.
 *
 * @param pin - Pin to write.
 */
function sandbox(pin: GadRef = PIN): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'spec-sync-'));
  const gad = join(root, 'gad');
  const gadSpec = join(gad, pin.specPath);
  mkdirSync(join(gadSpec, '..'), { recursive: true });
  mkdirSync(join(root, 'spec'));
  writeFileSync(gadSpec, MINI_SPEC);
  writeFileSync(join(root, 'spec', 'openapi.json'), MINI_SPEC);
  writeFileSync(join(root, 'gad.ref.json'), formatGadRef(pin));
  return {
    root,
    gad,
    gadSpec,
    spec: join(root, 'spec', 'openapi.json'),
    refFile: join(root, 'gad.ref.json'),
  };
}

/** Result of one CLI run. */
interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the CLI in-process.
 *
 * @param args - Arguments.
 */
function cli(args: string[]): Captured {
  let stdout = '';
  let stderr = '';
  const io: SpecSyncIo = {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    env: {},
    gitHead: () => SHA_B,
  };
  const code = run(args, io);
  return { code, stdout, stderr };
}

/**
 * Common flags pointing at a sandbox.
 *
 * @param s - Sandbox.
 */
const paths = (s: Sandbox): string[] => [
  '--gad-dir',
  s.gad,
  '--spec',
  s.spec,
  '--ref-file',
  s.refFile,
];

/**
 * Adds an operation to a spec text.
 *
 * @param text - Spec JSON.
 */
function withExtraOperation(text: string): string {
  const doc = JSON.parse(text) as { paths: Record<string, unknown> };
  doc.paths['/items/{id}/stats'] = {
    get: {
      tags: ['items'],
      summary: 'Item stats',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
    },
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

test.describe('spec-sync: normalizeSpecText', () => {
  test('keeps content byte-identical and normalizes only EOL, BOM and trailing newlines', () => {
    expect(normalizeSpecText('{\r\n  "a": 1\r\n}')).toBe('{\n  "a": 1\n}\n');
    expect(normalizeSpecText('﻿{"a":1}\n\n\n')).toBe('{"a":1}\n');
    expect(normalizeSpecText(MINI_SPEC)).toBe(MINI_SPEC);
  });
});

test.describe('spec-sync: diffSpecs (reuses the coverage spec loader)', () => {
  test('reports added, removed and changed operations', () => {
    const doc = JSON.parse(withExtraOperation(MINI_SPEC)) as {
      paths: Record<string, Record<string, { summary?: string }>>;
    };
    delete doc.paths['/never'];
    const items = doc.paths['/items'];
    if (items?.get) items.get.summary = 'Changed summary';
    const diff = diffSpecs(MINI_SPEC, JSON.stringify(doc));
    expect(diff.added).toEqual(['GET /items/{id}/stats']);
    expect(diff.removed.length).toBeGreaterThan(0);
    expect(diff.removed.every((k) => k.endsWith(' /never'))).toBe(true);
    expect(diff.changed).toEqual([{ key: 'GET /items', fields: ['summary'] }]);
    expect(diff.textChanged).toBe(true);
  });

  test('a whitespace-only difference is text-only (no operation changed)', () => {
    const diff = diffSpecs(MINI_SPEC, JSON.stringify(JSON.parse(MINI_SPEC)));
    expect(diff).toMatchObject({ added: [], removed: [], changed: [], textChanged: true });
  });
});

test.describe('spec-sync: check', () => {
  test('passes (exit 0) when the specs match', () => {
    const s = sandbox();
    const r = cli(['check', ...paths(s)]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('OK');
  });

  test('fails (exit 1) on drift with the fix command and the operation diff', () => {
    const s = sandbox();
    writeFileSync(s.gadSpec, withExtraOperation(MINI_SPEC));
    const r = cli(['check', ...paths(s)]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      `is out of sync with GAD@${SHA_B.slice(0, 12)}; run npm run spec:sync`,
    );
    expect(r.stderr).toContain('+ GET /items/{id}/stats');
  });
});

test.describe('spec-sync: sync', () => {
  test('a sync without changes leaves the file byte-identical', () => {
    const s = sandbox();
    const r = cli(['sync', ...paths(s)]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('No change');
    expect(readFileSync(s.spec, 'utf8')).toBe(MINI_SPEC);
  });

  test('copies the GAD spec, normalizing CRLF, and then check passes', () => {
    const s = sandbox();
    writeFileSync(s.gadSpec, withExtraOperation(MINI_SPEC).replace(/\n/g, '\r\n'));
    const r = cli(['sync', ...paths(s)]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('+ GET /items/{id}/stats');
    expect(readFileSync(s.spec, 'utf8')).toBe(withExtraOperation(MINI_SPEC));
    expect(cli(['check', ...paths(s)]).code).toBe(0);
  });

  test('refuses a GAD spec that is not valid JSON (exit 2, nothing written)', () => {
    const s = sandbox();
    writeFileSync(s.gadSpec, '{ not json');
    const r = cli(['sync', ...paths(s)]);
    expect(r.code).toBe(2);
    expect(readFileSync(s.spec, 'utf8')).toBe(MINI_SPEC);
  });
});

test.describe('spec-sync: pin and gad.ref.json', () => {
  test('pin updates sha and ref and keeps repository and specPath', () => {
    const s = sandbox();
    const r = cli(['pin', '--ref-file', s.refFile, '--sha', SHA_B, '--ref', 'feature/7-stats']);
    expect(r.code, r.stderr).toBe(0);
    const text = readFileSync(s.refFile, 'utf8');
    expect(parseGadRef(text)).toEqual({ ...PIN, sha: SHA_B, ref: 'feature/7-stats' });
    expect(text).toBe(formatGadRef({ ...PIN, sha: SHA_B, ref: 'feature/7-stats' }));
  });

  test('pin rejects a short or upper-case sha and a bad ref (exit 2, file untouched)', () => {
    const s = sandbox();
    const before = readFileSync(s.refFile, 'utf8');
    expect(cli(['pin', '--ref-file', s.refFile, '--sha', 'abc1234']).code).toBe(2);
    expect(cli(['pin', '--ref-file', s.refFile, '--sha', SHA_A.toUpperCase()]).code).toBe(2);
    expect(cli(['pin', '--ref-file', s.refFile, '--sha', SHA_B, '--ref', 'a..b']).code).toBe(2);
    expect(cli(['pin', '--ref-file', s.refFile]).code).toBe(2);
    expect(readFileSync(s.refFile, 'utf8')).toBe(before);
  });

  test('parseGadRef validates every field', () => {
    const good = formatGadRef(PIN);
    expect(parseGadRef(good)).toEqual(PIN);
    const bad = (patch: Record<string, unknown>): string => JSON.stringify({ ...PIN, ...patch });
    expect(() => parseGadRef(bad({ repository: 'no-slash' }))).toThrow(/owner\/name/);
    expect(() => parseGadRef(bad({ specPath: '/etc/passwd' }))).toThrow(/relative/);
    expect(() => parseGadRef(bad({ specPath: '../x.json' }))).toThrow(/relative/);
    expect(() => parseGadRef(bad({ sha: 'deadbeef' }))).toThrow(/40-character/);
    expect(() => parseGadRef(bad({ ref: '' }))).toThrow(/non-empty/);
    expect(() => parseGadRef('[]')).toThrow(/object/);
  });
});

test.describe('spec-sync: ref-guard (a PR into main must pin GAD main)', () => {
  test('passes when the pin names main', () => {
    expect(refGuardProblems(PIN, 'main')).toEqual([]);
    const s = sandbox();
    expect(cli(['ref-guard', '--ref-file', s.refFile]).code).toBe(0);
  });

  test('fails when the pin still names a feature branch, with the re-pin command', () => {
    const s = sandbox({ ...PIN, ref: 'feature/7-stats', sha: SHA_B });
    const r = cli(['ref-guard', '--ref-file', s.refFile, '--expect-ref', 'main']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('pins GAD "feature/7-stats"');
    expect(r.stderr).toContain('npm run gad:pin -- --sha <GAD main sha> --ref main');
  });
});

test.describe('spec-sync: usage', () => {
  test('unknown commands and flags exit 2; --help exits 0', () => {
    expect(cli(['nope']).code).toBe(2);
    expect(cli(['check', '--nope']).code).toBe(2);
    expect(cli([]).code).toBe(2);
    expect(cli(['--help']).code).toBe(0);
    expect(cli(['sync', '--help']).code).toBe(0);
  });

  test('a missing GAD directory is an input error (exit 2)', () => {
    const s = sandbox();
    const r = cli([
      'check',
      '--gad-dir',
      join(s.root, 'missing'),
      '--spec',
      s.spec,
      '--ref-file',
      s.refFile,
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('does not exist');
  });
});
