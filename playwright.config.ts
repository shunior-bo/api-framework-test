import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load environment variables from .env before anything else
dotenv.config({ quiet: true });

export default defineConfig({
  use: {
    baseURL: process.env.BASE_URL,
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  },
  projects: [
    {
      // API specs — require a running GAD instance at BASE_URL.
      name: 'api',
      testDir: './tests/api',
    },
    {
      // Unit tests run with no network access — no server required.
      // These test pure utility logic inside src/utils/ and src/data/.
      name: 'unit',
      testDir: './tests/unit',
    },
  ],
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['junit', { outputFile: 'reports/results.xml' }],
  ],
});
