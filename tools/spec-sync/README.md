# `tools/spec-sync/`: GAD pin and spec sync

A small, dependency-free CLI (Node-native TypeScript, same style as `tools/coverage`) that keeps two files in step with the GAD revision under test:

| File | Meaning |
|---|---|
| `gad.ref.json` | **Single source of truth** for which GAD is tested: `repository`, `ref` (branch), `sha` (40 chars, what CI checks out) and `specPath` inside GAD. On `main` it always names a GAD `main` commit; on a feature PR it names the GAD feature branch commit. |
| `spec/openapi.json` | The vendored contract: a **byte-identical** copy of `<GAD>/<specPath>` (only line endings and the trailing newline are normalized). |

```bash
npm run spec:check                                        # exit 1 on drift (GAD at $GAD_DIR or ../gad-gui-api-demo)
npm run spec:check -- --gad-dir gad                       # CI: GAD checked out at the pinned sha into ./gad
npm run spec:sync  -- --gad-dir ../gad-gui-api-demo       # copy GAD's spec into spec/openapi.json
npm run gad:pin    -- --sha <40-char sha> --ref feature/12-article-stats
npm run gad:ref-guard -- --expect-ref main                # exit 1 unless gad.ref.json.ref is main
```

| Command | What it does | Exit codes |
|---|---|---|
| `sync` | Copies the GAD spec (path from `gad.ref.json`) to `spec/openapi.json`. It refuses a spec the coverage loader cannot parse. A sync with no change writes nothing, so `git diff` stays empty. Prints the operation diff. | 0 · 2 input error |
| `check` | Compares `spec/openapi.json` with the GAD spec. On drift it prints `spec/openapi.json is out of sync with GAD@<sha>; run npm run spec:sync` and the operations **added / removed / changed**. | 0 in sync · 1 drift · 2 input error |
| `pin` | Updates `gad.ref.json` (`--sha` required and validated, `--ref` and `--repository` optional; `specPath` is kept). | 0 · 2 invalid sha/ref |
| `ref-guard` | Merge guard: a PR into `main` must pin a GAD `main` commit (`ref == --expect-ref`). | 0 · 1 wrong ref · 2 input error |

The operation diff **reuses the coverage tool's spec loader** (`tools/coverage/src/spec/loadSpec.ts` → `parseSpec`), so "operation", "parameter" and "response" mean exactly what coverage measures. A change compares `operationId`, `summary`, `tags`, auth, request body `$ref`, parameters and responses. A change inside a `components` schema that keeps the same `$ref` name shows as "no operation changed" (the texts still differ, so `check` still fails).

## Where it is used

- `.github/workflows/api-coverage.yml`: each side checks out GAD at **its own** `gad.ref.json` sha. Head runs `spec:check` (drift fails the job) and, on PRs into `main`, `gad:ref-guard` runs in the `merge-guards` job.
- The `feature-developer` agent changes the framework **only** through `spec:sync` and `gad:pin`.

## Source layout

```
src/
├── cli.ts       # entrypoint (process I/O only)
├── main.ts      # run(argv, io): commands, flags, exit codes (unit-testable)
├── gadRef.ts    # gad.ref.json: parse/validate/format, ref guard
└── specDiff.ts  # normalizeSpecText, diffSpecs (via the coverage spec loader), renderDiff
```

Same code rules as `tools/coverage`: erasable TypeScript only, relative imports with `.ts`, no Playwright, no `src/`, no dependencies. Type-checked by `npm run typecheck` (`tools/spec-sync/tsconfig.json`) and tested in `tests/unit/spec-sync/`.
