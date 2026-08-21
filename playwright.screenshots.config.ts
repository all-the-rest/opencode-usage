// Playwright config for the UI-review screenshot set.
//
// Deliberately SEPARATE from any standard playwright.config.ts: this set only
// captures screenshots and must never run inside a functional E2E suite.
//
// The app has no auth and no tenants. The "filled" and "empty" states are
// served by TWO different local servers (real data on 3712, an empty fixture
// DB on 3713), so this config does NOT set a single baseURL — the generic spec
// builds absolute URLs from per-state origins (SCREENSHOT_FILLED_URL /
// SCREENSHOT_EMPTY_URL, defaulting to localhost:3712 / localhost:3713).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/screenshots',
    testMatch: '**/*.spec.ts',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    // No login/auth in this app, so the per-IP throttle is irrelevant; a modest
    // worker count keeps the capture snappy without hammering the servers.
    workers: process.env.CI ? 2 : 4,
    timeout: 120000,
    reporter: [
        ['html', { open: 'never', outputFolder: 'playwright-report/ui-screenshots' }],
    ],
    use: {
        // Only used as a fallthrough if a spec navigates with a relative path.
        baseURL: process.env.SCREENSHOT_FILLED_URL ?? 'http://localhost:3712',
        trace: 'off',
        video: 'off',
    },
    outputDir: 'test-results/ui-screenshots',
    projects: [
        { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 950 } } },
        { name: 'Mobile Chrome', use: { ...devices['Galaxy A55'] } },
    ],
});
