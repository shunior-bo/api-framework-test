# Day 2 experiment: AI coverage estimate vs. the coverage tool

**Concept under test:** *deterministic control.* The AI proposes, and deterministic tools verify. How close does an AI get to the real coverage just by reading the spec and the tests? And how much does its answer change between two identical runs?

**Ground truth:** the committed Day 1 baseline, [`docs/coverage/day1-baseline/`](coverage/day1-baseline/) (see [day1-baseline.md](coverage/day1-baseline.md)). Both the estimate and the tool measure the same code, `session/01-api-framework-baseline`, under the same definitions and exclusions.

## 1. Protocol

The estimate must come from **fresh sessions that cannot see the tool or its output**. The session that built the tool is contaminated and must not produce it.

Isolation rules:

- **Export the Day 1 code with `git archive`, not `git worktree`.** A worktree's `.git` file points back to this repo, where `reports/` and the tool live. The export is plain files with no git metadata. That branch contains no `tools/`, no `reports/` and no `docs/coverage/`.
- **Put the export outside `~/ses/task/`,** so a curious session cannot find this repo by walking `../`.
- **Use read-only tools** (`--allowedTools "Read,Grep,Glob"`), so the session cannot run tests, start GAD or reach the network. Each `claude -p` call is a separate session with no shared memory, and a new folder has no project memory.
- Use the **same model** for both runs and write it down below.

```bash
# from api-framework-test/ (on session/02-coverage-tool or later)
EXP=/tmp/aft-day2-estimate
rm -rf "$EXP" && mkdir -p "$EXP/snapshot" docs/day2-ai-estimates
git archive session/01-api-framework-baseline | tar -x -C "$EXP/snapshot"
cp docs/day2-ai-estimate-prompt.md "$EXP/prompt.md"
ls "$EXP/snapshot"            # check: no tools/, reports/ or docs/coverage/

MODEL=claude-opus-5-5         # same model for both runs; record it below
for i in 1 2; do
  (cd "$EXP/snapshot" && claude -p "$(cat ../prompt.md)" \
      --model "$MODEL" --allowedTools "Read,Grep,Glob" --output-format text) \
    > "docs/day2-ai-estimates/run-$i.md"
done

# check that neither run peeked at tool output (expect no matches)
grep -nE "coverage\.json|gaps\.json|reports/coverage|tools/coverage" docs/day2-ai-estimates/run-*.md

npm run coverage:compare-estimate > docs/day2-ai-estimates/comparison.md
cat docs/day2-ai-estimates/comparison.md
rm -rf "$EXP"
```

`coverage:compare-estimate` extracts the last fenced JSON block of each `run-*.md` and compares it with `docs/coverage/day1-baseline/{coverage,gaps}.json`. It prints:

- the metric table: AI value per run, tool value, error per run, and spread between runs;
- the false positives and false negatives for covered operations;
- how many of the AI's `topGaps` are real gaps and how many appear in the tool's top 20.

If a run ends without a valid JSON block, the script exits 2. Re-run that session; don't edit its answer by hand.

The prompt is in [`docs/day2-ai-estimate-prompt.md`](day2-ai-estimate-prompt.md). It copies the tool's definitions and the 10 exclusions verbatim, and requires this fixed JSON shape:
`{ operations:{covered,total,pct}, statuses:{…}, parameters:{…}, coveredOperations:[…], topGaps:[…] }`.

## 2. Run log

| | Run 1 | Run 2 |
|---|---|---|
| Date | | |
| Model | | |
| Wall-clock time | | |
| Tool calls (approx.) | | |
| Valid JSON block? | | |

## 3. Results

Paste the table from `docs/day2-ai-estimates/comparison.md`:

| Metric | Run 1 | Run 2 | Tool | Error run 1 | Error run 2 | Variance run 1 vs run 2 |
|---|---|---|---|---|---|---|
| operations.covered | | | 16 | | | |
| operations.total | | | 160 | | | |
| operations.pct | | | 10.00 | | | |
| statuses.covered | | | 27 | | | |
| statuses.total | | | 374 | | | |
| statuses.pct | | | 7.22 | | | |
| parameters.covered | | | 7 | | | |
| parameters.total | | | 95 | | | |
| parameters.pct | | | 7.37 | | | |

| | Run 1 | Run 2 |
|---|---|---|
| False positives (operations) | | |
| False negatives (operations) | | |
| topGaps that are real gaps / in tool top 20 | | |

## 4. Conclusions

_To be filled in after the runs._

- How large is the error per dimension? Which dimension is hardest to estimate (statuses?), and why?
- How large is the run-to-run variance? Would you trust a single AI run as a CI gate?
- Which systematic mistakes appear (for example, missing cleanup `DELETE`s, counting `beforeAll` requests, miscounting the spec's denominators)?
- What does this mean for Day 3? Which parts may the agent propose, and which must the tool verify?
