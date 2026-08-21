/**
 * Functional E2E regression suite — Todo 27 "Ghost charts".
 *
 * Bug being guarded against: every click on a "Gruppieren nach" (group-by) or
 * resolution (granularity) switch of the dashboard token-trend chart left an
 * additional stale `.recharts-wrapper` element in the DOM (+1 per click), so
 * charts/legend entries visibly duplicated.
 *
 * Covered here:
 *  1. ≥10 alternating group-by/granularity clicks keep `.recharts-wrapper`
 *     at exactly 3 (token trend + cost trend + token share; the heatmap is a
 *     CSS grid, not a Recharts chart).
 *  2. No duplicated KPI card ("Gesamt-Tokens") and no duplicated card title
 *     ("Token-Anteile pro Tag") in the DOM.
 *  3. Clicking a bar drills down: URL gets ?day=YYYY-MM-DD, the day-detail
 *     section appears (adding exactly ONE more chart — its hourly histogram),
 *     and "Schließen" removes it again.
 *  4. URL state restore: /?gran=week&group=provider restores both switches.
 *
 * Prerequisite: app served at http://localhost:3712 (`pnpm start`; override
 * via E2E_BASE_URL). Run: npx playwright test -c playwright.config.ts
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

/** Charts on a loaded dashboard WITHOUT the day drill-down. */
const BASE_WRAPPER_COUNT = 3;

/**
 * Alternating group-by / granularity click sequence (14 clicks). All labels
 * exist on the token-trend card in every state, so each one is clickable at
 * every step.
 */
const CLICK_SEQUENCE = [
  "Hersteller", "Woche",
  "Familie", "Monat",
  "Anbieter", "Tag",
  "Gesamt", "Woche",
  "Hersteller", "Monat",
  "Familie", "Tag",
  "Anbieter", "Gesamt",
] as const;

let page: Page;

test.beforeEach(async ({ page: p }) => {
  page = p;
  await p.goto("/");
  await expect(p.locator(".recharts-wrapper")).toHaveCount(BASE_WRAPPER_COUNT);
});

/** The dashboard card containing the token-trend chart and its switches. */
function trendCard(): Locator {
  return page
    .locator(".card")
    .filter({ has: page.getByRole("heading", { name: "Token-Zeitverlauf" }) });
}

test("group/resolution switches keep exactly 3 .recharts-wrapper nodes (>10 clicks)", async () => {
  const wrappers = page.locator(".recharts-wrapper");

  for (const [i, label] of CLICK_SEQUENCE.entries()) {
    await trendCard().getByRole("button", { name: label }).click();
    // Auto-retries through the transient loading swap (chart unmounts while
    // the new fetch is in flight) — but must SETTLE at exactly 3. A leftover
    // ghost wrapper makes this fail with "received 4".
    await expect(wrappers).toHaveCount(BASE_WRAPPER_COUNT);
    // eslint-disable-next-line no-console
    console.log(`click ${i + 1} (${label}): ${await wrappers.count()} wrappers`);
  }

  // No duplicated KPI card / card title after all the switching.
  await expect(page.getByText("Gesamt-Tokens", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Token-Anteile pro Tag", { exact: true })).toHaveCount(1);
});

test("bar click sets ?day=…, opens day detail; Schließen removes it", async () => {
  // Click the tallest visible bar of the token-trend chart via real mouse
  // events (zero-height segments of stacked series are skipped). Recharts 3
  // nests the path two levels below .recharts-bar-rectangle.
  const target = await trendCard()
    .locator(".recharts-bar-rectangle path")
    .evaluateAll((els) => {
      let best: { x: number; y: number } | null = null;
      let bestH = 0;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width >= 2 && r.height > bestH) {
          bestH = r.height;
          best = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return best;
    });
  expect(target, "token-trend chart should have a visible bar").not.toBeNull();
  await page.mouse.click(target!.x, target!.y);

  await expect(page).toHaveURL(/([?&])day=\d{4}-\d{2}-\d{2}/);
  const detail = page.locator("section.card");
  await expect(detail.getByRole("heading")).toContainText("Statistik für");
  // The drill-down adds exactly ONE chart (hourly histogram) — no ghosts.
  await expect(page.locator(".recharts-wrapper")).toHaveCount(
    BASE_WRAPPER_COUNT + 1,
  );

  await detail.getByRole("button", { name: "Schließen" }).click();
  await expect(page).not.toHaveURL(/([?&])day=/);
  await expect(detail).toHaveCount(0);
  await expect(page.locator(".recharts-wrapper")).toHaveCount(BASE_WRAPPER_COUNT);
});

test("shared link ?gran=week&group=provider restores switch state", async () => {
  await page.goto("/?gran=week&group=provider");
  await expect(page.locator(".recharts-wrapper")).toHaveCount(BASE_WRAPPER_COUNT);

  const active = trendCard().locator("button.btn-primary");
  await expect(active).toHaveText(["Woche", "Anbieter"]);
});
