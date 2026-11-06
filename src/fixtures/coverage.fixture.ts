/**
 * Coverage fixture — records every HTTP request a test makes.
 *
 * SOLID: Single Responsibility Principle (SRP) — this file only swaps the
 *        `request` fixture for a recording proxy and flushes the records.
 * SOLID: Open/Closed Principle (OCP) — no client or spec changes. The fixture
 *        chain is `@playwright/test` → coverage.fixture → api.fixture → auth.fixture,
 *        so every client built in api.fixture.ts receives the recorded context.
 *
 * Phase detection (test vs hook):
 *   `coverageScope` is an AUTO test-scoped fixture. Playwright instantiates auto
 *   fixtures for each test (including its beforeEach/afterEach), but NOT for
 *   beforeAll/afterAll hooks, and sets them up before non-auto fixtures. If
 *   `request` is created while `coverageScope` is active for the same test id,
 *   the phase is "test"; otherwise the request belongs to a beforeAll/afterAll
 *   hook and the phase is "hook".
 *
 * Environment (read only here):
 *   COVERAGE_RECORD=0   disables recording (the original `request` is used)
 *   COVERAGE_RAW_DIR    raw JSONL directory (default reports/coverage/raw)
 *   COVERAGE_RUN_ID     set by src/coverage/globalSetup.ts
 *
 * Must NOT: perform assertions, log in, or record header/query/body values.
 */
import { dirname, relative, resolve } from 'node:path';
import { test as base, expect } from '@playwright/test';
import { appendRecords } from '@src/coverage/recordWriter';
import { RequestRecorder } from '@src/coverage/RequestRecorder';

/** Default raw records directory, relative to the repo root. */
const DEFAULT_RAW_DIR = 'reports/coverage/raw';

/** Test id whose body is currently running in this worker (undefined in hooks). */
let activeTestId: string | undefined;

/**
 * Fixtures added by this file.
 */
export interface CoverageFixtures {
  /** Auto fixture that marks the test-body window. Never use it directly. */
  coverageScope: void;
}

/**
 * Playwright `test` whose `request` fixture records every call.
 *
 * Do not import it in specs — import from `@src/fixtures/api.fixture` or
 * `@src/fixtures/auth.fixture`, which extend it.
 */
const test = base.extend<CoverageFixtures>({
  coverageScope: [
    async ({}, use, testInfo) => {
      activeTestId = testInfo.testId;
      try {
        await use();
      } finally {
        activeTestId = undefined;
      }
    },
    { auto: true },
  ],

  request: async ({ request, baseURL }, use, testInfo) => {
    if (process.env.COVERAGE_RECORD === '0') {
      await use(request);
      return;
    }

    const rootDir = testInfo.config.configFile
      ? dirname(testInfo.config.configFile)
      : process.cwd();
    const rawDir = resolve(rootDir, process.env.COVERAGE_RAW_DIR || DEFAULT_RAW_DIR);
    const runId = process.env.COVERAGE_RUN_ID || `ppid${process.ppid}`;
    const isTest = activeTestId === testInfo.testId;
    const describePath = testInfo.titlePath.slice(1, -1);

    const recorder = new RequestRecorder({
      project: testInfo.project.name,
      file: relative(rootDir, testInfo.file).split('\\').join('/'),
      testId: testInfo.testId,
      title: isTest
        ? testInfo.titlePath.slice(1).join(' > ')
        : [...describePath, '[beforeAll/afterAll]'].join(' > '),
      phase: isTest ? 'test' : 'hook',
      baseURL,
    });

    await use(recorder.wrap(request));

    // Teardown: the test outcome is known now, so records can be stamped with it.
    const records = isTest
      ? recorder.drain(testInfo.status ?? null, testInfo.expectedStatus)
      : recorder.drain(null, null);
    appendRecords(rawDir, runId, testInfo.workerIndex, records);
  },
});

export { test, expect };
