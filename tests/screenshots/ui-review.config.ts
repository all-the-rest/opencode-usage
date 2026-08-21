// UI-review route manifest — the single source of truth for which pages get
// screenshotted and in which states. Edit this file to add/remove routes; the
// generic spec picks the changes up automatically.
//
// outputDir mirrors playwright.screenshots.config.ts; the spec builds absolute
// screenshot paths from process.cwd().
//
// Project context (opencode-usage):
// - React SPA (React Router), NO auth, NO tenants, single local user.
// - "filled" = real data on http://localhost:3712 (data/stats.db).
// - "empty"  = a second server on http://localhost:3713 backed by a schema-only
//   fixture DB (data/stats-empty.db, generated from docs/stats-db-schema.md).
// - No login / no seeding / no tenant setup is required — the auth/seed/tenant
//   machinery from the template is intentionally dropped. Every route is reached
//   by a justified direct-URL load (SPA deep link, no auth gate), documented
//   below. The static <title> "opencode-usage" is asserted so a foreign
//   dev-server on the port can never be silently screenshotted.

export type UiReviewState = 'filled' | 'empty';
export type UiReviewViewport = 'desktop' | 'mobile';

export interface UiReviewRoute {
    name: string;
    /** Route pattern; loaded directly (SPA deep link, no auth gate). */
    path: string;
    states: UiReviewState[];
    viewports?: UiReviewViewport[];
    /** Static <title> of the app — asserted by the spec. */
    expectedTitle?: string;
    note?: string;
}

export interface UiReviewConfig {
    /** Mirrors `outputDir` in playwright.screenshots.config.ts. */
    outputDir: string;
    /** Origins per state (overridable via env). */
    origins: {
        filled: string;
        empty: string;
    };
    routes: UiReviewRoute[];
}

export const uiReviewConfig: UiReviewConfig = {
    outputDir: 'test-results/ui-screenshots',
    origins: {
        filled: process.env.SCREENSHOT_FILLED_URL ?? 'http://localhost:3712',
        empty: process.env.SCREENSHOT_EMPTY_URL ?? 'http://localhost:3713',
    },
    routes: [
        {
            name: 'dashboard',
            path: '/',
            states: ['filled', 'empty'],
            expectedTitle: 'opencode-usage',
            note: 'Direct-URL load: SPA deep link, no auth gate. Summary + charts + heatmap.',
        },
        {
            name: 'models',
            path: '/models',
            states: ['filled', 'empty'],
            expectedTitle: 'opencode-usage',
            note: 'Direct-URL load: SPA deep link, no auth gate. Per-model breakdown table + charts.',
        },
        {
            name: 'projects',
            path: '/projects',
            states: ['filled', 'empty'],
            expectedTitle: 'opencode-usage',
            note: 'Direct-URL load: SPA deep link, no auth gate. Per-project table sorted by cost.',
        },
        {
            name: 'sessions',
            path: '/sessions',
            states: ['filled', 'empty'],
            expectedTitle: 'opencode-usage',
            note: 'Direct-URL load: SPA deep link, no auth gate. Session list + cache analysis.',
        },
    ],
};

export const routes = uiReviewConfig.routes;
export const filledOrigin = uiReviewConfig.origins.filled;
export const emptyOrigin = uiReviewConfig.origins.empty;
