/**
 * Tests for GET /api/labels.
 *
 * GAD ships with the `feature_labels` flag OFF, and then every /api/labels
 * request answers 404 (documented in the contract as "Not found"). The 200 case
 * needs the flag ON, which is set through ConfigClient (POST /api/config/features,
 * an endpoint that is NOT in spec/openapi.json — test infrastructure only).
 *
 * The flag is global server state, so this file runs serially and always
 * restores the flag to its default (OFF) in afterAll.
 */
import { test, expect } from '@src/fixtures/api.fixture';
import { LabelsSchema } from '@src/utils/schema';

test.describe.configure({ mode: 'serial' });

test.describe('Labels API', () => {
  test.describe('with feature_labels enabled', () => {
    test.beforeAll(async ({ configClient }) => {
      const response = await configClient.setFeatures({ feature_labels: true });
      expect(response.status(), 'could not enable feature_labels').toBe(200);
    });

    test.afterAll(async ({ configClient }) => {
      await configClient.setFeatures({ feature_labels: false });
    });

    test(
      'GET /api/labels returns 200 and a list of labels',
      { tag: ['@smoke', '@tc-labels-01'] },
      async ({ labelsClient }) => {
        // --- ARRANGE -------------------------------------------------------
        // Feature flag enabled in beforeAll; seed data contains labels.

        // --- ACT -----------------------------------------------------------
        const response = await labelsClient.getAll();
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(200);

        const parsed = LabelsSchema.safeParse(body);
        expect(parsed.success, parsed.error?.message).toBe(true);

        expect(parsed.data?.length).toBeGreaterThan(0);
      },
    );
  });

  test.describe('with feature_labels disabled (GAD default)', () => {
    test.beforeAll(async ({ configClient }) => {
      const response = await configClient.setFeatures({ feature_labels: false });
      expect(response.status(), 'could not disable feature_labels').toBe(200);
    });

    test(
      'GET /api/labels returns 404 when the labels feature is disabled',
      { tag: ['@negative', '@tc-labels-02'] },
      async ({ labelsClient }) => {
        // --- ARRANGE -------------------------------------------------------
        // Feature flag disabled in beforeAll.

        // --- ACT -----------------------------------------------------------
        const response = await labelsClient.getAll();
        const body: unknown = await response.json();

        // --- ASSERT --------------------------------------------------------
        expect(response.status()).toBe(404);
        expect(body).toEqual({});
      },
    );
  });
});
