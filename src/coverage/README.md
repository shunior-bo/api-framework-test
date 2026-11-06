# `src/coverage/` — Request Recorder (coverage runtime)

## What belongs here

The runtime side of API coverage: the code that observes the HTTP traffic of the API tests and writes it as raw JSONL for the coverage CLI (`tools/coverage/`).

| File | Responsibility |
|------|----------------|
| `RequestRecorder.ts` | Wraps an `APIRequestContext` in a `Proxy`. Intercepts `get`, `post`, `put`, `patch`, `delete`, `head` and `fetch`, and buffers one record per call. Returns the original `APIResponse` unchanged. |
| `recordWriter.ts` | Appends records to `reports/coverage/raw/requests-<runId>-w<worker>.jsonl` and deletes the files of previous runs. |
| `globalSetup.ts` | Stamps each Playwright run with `COVERAGE_RUN_ID`. |
| `types.ts` | The record contract (`RecordedRequest`, v1). |

The recorder is wired in through `src/fixtures/coverage.fixture.ts`, which overrides the `request` fixture. Clients and specs don't know it exists.

**What a record contains:** method, decoded path, query parameter **names**, explicitly sent header **names**, top-level body **keys**, status, duration, test file/title/id, phase (`test` or `hook`) and the test outcome.

**What a record never contains:** header values (tokens), query values, request or response bodies, passwords.

## SOLID principle

**Single Responsibility Principle (SRP)**: observing, writing and run stamping are separate files.

**Open/Closed Principle (OCP)**: coverage is added by *wrapping* the request context. No client, fixture or spec changed.

## What must NOT be here

- Assertions (`expect(...)`)
- Any change to requests or responses
- Reads of header, query or body **values**
- Coverage analysis (that is `tools/coverage/`, which never imports Playwright)
- `process.env` reads (the fixture reads `COVERAGE_RAW_DIR` / `COVERAGE_RECORD` / `COVERAGE_RUN_ID`; `globalSetup.ts` only *writes* `COVERAGE_RUN_ID`)

## Example file

`RequestRecorder.ts`: `new RequestRecorder(context).wrap(request)` returns a drop-in `APIRequestContext` that records every call.
