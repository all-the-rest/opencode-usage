// Generic manifest-driven screenshot spec for the ui-review skill.
//
// Reads the route/state/viewport matrix from the manifest and captures a
// full-page PNG PER COMBO plus viewport-height SECTION captures of the whole
// page (see `captureSections`). This file is intentionally generic — route
// specifics live in ui-review.config.ts.
//
// WHY SECTIONS: Full-page PNGs of long pages get downscaled for the vision model
// — regions below the fold become unreadable and bugs there are missed.
// `captureSections` therefore scrolls the ENTIRE page in 80 %-viewport steps
// (20 % overlap) and saves `<name>-secN.png` files. It detects the REAL scroll
// container: the window normally, but if the app scrolls in an inner overflow
// container (100vh layout, `<main class="…overflow-auto">`), that container is
// scrolled instead — otherwise long pages would only ever produce `sec0`.
//
// The manifest's `expectedTitle` is asserted so a foreign dev-server on the
// port can never be silently screenshotted.
//
// opencode-usage specifics:
// - NO auth, NO tenants. Each route is reached by a justified direct-URL load
//   (SPA deep link) — no login, no UI nav steps, no seeds.
// - Two servers back the two states: "filled" -> origins.filled (real data),
//   "empty" -> origins.empty (schema-only fixture DB). The spec navigates with
//   an absolute origin+path per state.

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import process from 'node:process';
import { routes, uiReviewConfig, filledOrigin, emptyOrigin } from './ui-review.config';
import type { UiReviewRoute, UiReviewState, UiReviewViewport } from './ui-review.config';

const SCREENSHOT_OUTPUT_DIR = uiReviewConfig.outputDir; // mirrors the config outputDir

const out = (state: UiReviewState, viewport: UiReviewViewport, file: string) =>
    path.resolve(process.cwd(), SCREENSHOT_OUTPUT_DIR, state, viewport, file);

function viewportForProject(projectName: string): UiReviewViewport {
    return projectName === 'Mobile Chrome' ? 'mobile' : 'desktop';
}

function originForState(state: UiReviewState): string {
    return state === 'empty' ? emptyOrigin : filledOrigin;
}

/** Let the SPA + lazy route settle so later captures never race a layout shift. */
async function waitForAppSettled(page: Page, expectedTitle?: string): Promise<void> {
    await page.waitForLoadState('networkidle');
    if (expectedTitle) {
        // Guard: stellt sicher, dass wirklich diese App gerendert wird und nicht
        // ein fremder Dev-Server, der zufällig den Port belegt.
        await expect(page).toHaveTitle(expectedTitle);
    }
    await page.waitForTimeout(300);
}

/**
 * Captures the whole page in readable viewport-height sections (80 % step,
 * 20 % overlap). Detects the real scroll container: prefers the window
 * (document.scrollingElement); if the app scrolls in an INNER overflow
 * container (100vh layout, `<main class="…overflow-auto">`), that container
 * is scrolled instead — otherwise long pages only ever produce sec0.
 */
async function captureSections(
    page: Page,
    state: UiReviewState,
    viewport: UiReviewViewport,
    name: string,
): Promise<void> {
    const scroller = await page.evaluate(() => {
        const doc = document.scrollingElement;
        const winH = window.innerHeight;
        if (doc && doc.scrollHeight > winH + 4) {
            return { kind: 'window', max: doc.scrollHeight - winH, step: Math.round(winH * 0.8) };
        }
        const main = document.querySelector('main');
        if (main && main.scrollHeight > main.clientHeight + 4) {
            return {
                kind: 'main',
                max: main.scrollHeight - main.clientHeight,
                step: Math.round(main.clientHeight * 0.8),
            };
        }
        return { kind: 'window', max: 0, step: Math.round(winH * 0.8) };
    });
    const scroll = (y: number) =>
        page.evaluate(
            ({ kind, y }) => {
                if (kind === 'main') {
                    const el = document.querySelector('main');
                    if (el) el.scrollTop = y;
                } else {
                    window.scrollTo(0, y);
                }
            },
            { kind: scroller.kind, y },
        );
    let y = 0;
    let i = 0;
    for (;;) {
        await scroll(y);
        await page.waitForTimeout(150);
        await page.screenshot({ path: out(state, viewport, `${name}-sec${i}.png`), fullPage: false });
        if (y >= scroller.max) break;
        i += 1;
        y = Math.min(scroller.max, y + scroller.step);
    }
    await scroll(0);
}

async function settleAndCapture(
    page: Page,
    route: UiReviewRoute,
    state: UiReviewState,
    viewport: UiReviewViewport,
): Promise<void> {
    await waitForAppSettled(page, route.expectedTitle);
    await expect(page.getByRole('main')).toBeVisible();
    // page.screenshot resolves relative paths against process.cwd(), not the
    // config outputDir — build the absolute path explicitly.
    await page.screenshot({ path: out(state, viewport, `${route.name}.png`), fullPage: true });
    await captureSections(page, state, viewport, route.name);
}

for (const route of routes) {
    for (const state of route.states) {
        for (const viewport of route.viewports ?? ['desktop', 'mobile']) {
            test(`screenshot ${route.name} (${state}, ${viewport})`, { tag: ['@screenshot'] }, async ({ page }, testInfo) => {
                test.skip(
                    viewportForProject(testInfo.project.name) !== viewport,
                    `project ${testInfo.project.name} renders the ${viewportForProject(testInfo.project.name)} viewport`,
                );

                // Collect console errors / uncaught page errors as annotations
                // (non-failing). App bugs surface here for the UI-review report;
                // the harness itself must stay green.
                const consoleErrors: string[] = [];
                page.on('console', (msg) => {
                    if (msg.type() === 'error') consoleErrors.push(msg.text());
                });
                page.on('pageerror', (err) => {
                    consoleErrors.push(`pageerror: ${err.message}`);
                });

                const origin = originForState(state);

                // No auth / no nav steps in this app: load the route by its
                // justified direct URL (SPA deep link).
                await page.goto(`${origin}${route.path}`);
                await settleAndCapture(page, route, state, viewport);

                if (consoleErrors.length > 0) {
                    testInfo.annotations.push({
                        type: 'console-errors',
                        description: `${consoleErrors.length} error(s): ${consoleErrors.slice(0, 5).join(' | ')}`,
                    });
                }
            });
        }
    }
}
