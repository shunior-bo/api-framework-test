---
description: Generate API tests that close coverage gaps for a scope, in verified batches, and open an AI-generated PR
argument-hint: <scope: tags | /path-prefix | status-gaps> [--batches N] [--batch-size N]
---

Delegate this task to the **test-generator** subagent (`.claude/agents/test-generator.md`). Do not write the tests yourself.

Arguments: `$ARGUMENTS`

Parse the arguments and pass them to the subagent explicitly:

- **scope:** the first argument (required). If it is missing, stop and print the usage: `/fill-coverage-gaps <scope> [--batches N] [--batch-size N]`.
  - Comma-separated tags (e.g. `likes,bookmarks`) → `coverage_list_gaps` filter `tag: [...]`.
  - A value starting with `/` (e.g. `/likes`) → filter `pathPrefix`.
  - `status-gaps` → filter `type: ["status"]`, restricted to tags that already have at least one covered operation. Get those tags from `coverage_summary.byTag` (`operations.covered > 0`).
- **--batches N:** the maximum number of batches (default 4).
- **--batch-size N:** the maximum number of gaps per batch (default 5).
- **run-id:** `<YYYYMMDD-HHMM>-<scope-slug>`, using the current local time. The scope slug is lowercase, with `,` and `/` replaced by `-`, and leading or trailing `-` trimmed.

Give the subagent the parsed parameters and the run-id, and tell it to follow its instructions end to end: preflight, bounded batch loop, tracking log, then push, PR and final report. When it finishes, relay its final report: the PR URL, the gaps closed and blocked, the spec-drift found, and the final delta.
