// Playwright config for FUNCTIONAL E2E regression tests (tests/*.spec.ts).
//
// Deliberately SEPARATE from playwright.screenshots.config.ts: that config owns
// ./tests/screenshots (screenshot capture only, must never run functional
// specs); this config owns everything else under ./tests and ignores the
// screenshots directory.
//
// Prerequisite: the app must already be served (API + built frontend), by
// default on http://localhost:3712 (`pnpm start`). Override via E2E_BASE_URL.
// This config never starts or stops a server.
// Run: npx playwright test -c playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  // The screenshot suite lives in ./tests/screenshots with its own config.
  testIgnore: "**/screenshots/**",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3712",
    // Deterministic labels (the app defaults to German anyway).
    locale: "de-DE",
    trace: "off",
    video: "off",
  },
  outputDir: "test-results/e2e",
  projects: [
    { name: "Desktop Chrome", use: { ...devices["Desktop Chrome"] } },
  ],
});
