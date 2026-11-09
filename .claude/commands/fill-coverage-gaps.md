---
description: Generate API tests that close coverage gaps for a scope, in verified batches, and open an AI-generated PR
argument-hint: <scope: tags | /path-prefix | status-gaps> [--batches N] [--batch-size N] | --mode ci-pr --gap-ids <file> [--run-number N]
---

Delegate this task to the **test-generator** subagent (`.claude/agents/test-generator.md`). Do not write the tests yourself.

Arguments: `$ARGUMENTS`

Parse the arguments and pass them to the subagent explicitly.

**Mode.** `--mode ci-pr` selects the CI mode (see "Mode ci-pr" in the agent): then `--gap-ids <file>` is required and the scope argument is not used (the gap ids are the scope); `--run-number N` defaults to 1, `--batches` to 3 and `--batch-size` to 5; the run-id is `<YYYYMMDD-HHMM>-<branch-slug>-run<N>` with the branch slug taken from `git rev-parse --abbrev-ref HEAD` without `feature/`. Without `--mode`, or with `--mode local`, everything below applies unchanged (Day 3 behavior). Any other `--mode` value: stop and print the usage.

- **scope:** the first argument (required in local mode). If it is missing, stop and print the usage: `/fill-coverage-gaps <scope> [--batches N] [--batch-size N]` or `/fill-coverage-gaps --mode ci-pr --gap-ids <file> [--run-number N]`.
  - Comma-separated tags (e.g. `likes,bookmarks`) → `coverage_list_gaps` filter `tag: [...]`.
  - A value starting with `/` (e.g. `/likes`) → filter `pathPrefix`.
  - `status-gaps` → filter `type: ["status"]`, restricted to tags that already have at least one covered operation. Get those tags from `coverage_summary.byTag` (`operations.covered > 0`).
- **--batches N:** the maximum number of batches (default 4).
- **--batch-size N:** the maximum number of gaps per batch (default 5).
- **run-id:** `<YYYYMMDD-HHMM>-<scope-slug>`, using the current local time. The scope slug is lowercase, with `,` and `/` replaced by `-`, and leading or trailing `-` trimmed.

Give the subagent the parsed parameters (including the mode) and the run-id, and tell it to follow its instructions end to end: preflight, bounded batch loop, tracking log, then push, PR and final report (in ci-pr mode: push to the current feature branch and the result file, **no** PR). When it finishes, relay its final report: the PR URL, the gaps closed and blocked, the spec-drift found, and the final delta.
