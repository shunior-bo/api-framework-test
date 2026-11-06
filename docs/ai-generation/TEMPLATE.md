# AI test generation run `<run-id>`

| | |
|---|---|
| Scope | `<scope>` |
| Parameters | batches ≤ `<N>`, batch size ≤ `<N>` |
| Branch | `ai/<run-id>` (from `main` @ `<sha>`) |
| Model / session | `<model>`, fresh session |
| Start snapshot | `reports/ai-runs/<run-id>/start`: operations `x/y`, statuses `x/y`, parameters `x/y` |

## Batches

| Batch | Target gaps (ids) | Tests added | Passed on 1st attempt | Attempts | Closed | Blocked (reason) | Δ operations / Δ statuses / Δ parameters |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |

## Total delta vs start

_Paste the table from `node tools/coverage/src/cli.ts compare --base reports/ai-runs/<run-id>/start --head reports/coverage --format markdown`._

## Spec drift (GAD contradicts the spec)

| Gap / test | Spec says | GAD does | Evidence (curl command + output) |
|---|---|---|---|

## Blocked gaps

| Gap id | Reason |
|---|---|

## Where CONVENTIONS.md was insufficient

- _Notes for a human to improve CONVENTIONS.md later (the agent does not edit it)._
