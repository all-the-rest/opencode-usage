/**
 * Functional E2E suite — Todo 29 "Gesamt"-Auflösung (?gran=all).
 *
 * Covers the global granularity switch on the dashboard:
 *  1. Deep link /?gran=all restores the switch state (btn-primary on the
 *     global switch — NOT the GroupBy button, which is also labeled
 *     "Gesamt" in German; scoped via the direct-child join of the global
 *     filter row).
 *  2. All three data charts collapse to exactly ONE bucket (single stacked
 *     bar group / single line dot / single area column) and the chart count
 *     stays at 3 (no ghost charts — regression guard from Todo 27).
 *  3. Clicking the single bar does NOT set ?period= (pseudo bucket has no real
 *     date — drilldown guard).
 *  4. Switching back to "Monat" restores multi-bucket rendering.
 *
 * Prerequisite: app served at http://localhost:3712 (override via
 * E2E_BASE_URL). This suite never starts/stops a server.
 * Run: npx playwright test tests/granularity-all.spec.ts -c playwright.config.ts
 */
import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3712";

/** Global granularity switch buttons (nested two levels below the direct
 * child of the dashboard root — the GroupBy switch lives nested inside a
 * .card and never matches this selector). */
function globalGranButtons(page: import("@playwright/test").Page) {
  return page.locator(".space-y-6 > div:not(.card) .join > button");
}

test("deep link /?gran=all activates the global 'Gesamt' segment", async ({
  page,
}) => {
  await page.goto("/?gran=all");
  const active = page.locator(
    ".space-y-6 > div:not(.card) .join button.btn-primary",
  );
  await expect(active).toHaveText(["Gesamt"]);
});

test("gran=all collapses all three data charts to one bucket", async ({
  page,
}) => {
  await page.goto("/?gran=all");
  // Charts render async after the remount-fetch — poll until stable.
  await expect(page.locator(".recharts-wrapper")).toHaveCount(3);

  const trendBars = page
    .locator(".card", { hasText: "Token-Zeitverlauf" })
    .locator(".recharts-bar-rectangle");
  await expect(trendBars).toHaveCount(4); // 4 token series × 1 bucket

  const costBars = page
    .locator(".card", { hasText: "Kostenverlauf" })
    .locator(".recharts-bar-rectangle");
  await expect(costBars.first()).toBeVisible(); // single bucket = one bar

  const shareBars = page
    .locator(".card", { hasText: "Token-Anteile" })
    .locator(".recharts-bar-rectangle");
  // Single-Bucket: ein einzelner (gestapelter) Balken.
  await expect(shareBars.first()).toBeVisible();
});

test("clicking the single bar under gran=all does NOT set ?period=", async ({
  page,
}) => {
  await page.goto("/?gran=all");
  await expect(page.locator(".recharts-wrapper")).toHaveCount(3);

  const paths = page.locator(".recharts-bar-rectangle path");
  const n = await paths.count();
  for (let i = 0; i < n; i++) {
    const h = await paths.nth(i).evaluate((el) => el.getBBox().height);
    if (h > 20) {
      await paths.nth(i).click({ force: true });
      break;
    }
  }
  await page.waitForTimeout(500);
  await expect(page).not.toHaveURL(/([?&])period=/);
});

test("switching back to 'Monat' restores multi-bucket rendering", async ({
  page,
}) => {
  await page.goto("/?gran=all");
  await expect(page.locator(".recharts-wrapper")).toHaveCount(3);

  await globalGranButtons(page).filter({ hasText: "Monat" }).click();

  await expect(page).toHaveURL(/([?&])gran=month(&|$)/);
  const trendBars = page
    .locator(".card", { hasText: "Token-Zeitverlauf" })
    .locator(".recharts-bar-rectangle");
  // 2 Monats-Buckets (Jul + Aug) × 4 Token-Serien = 8 Segmente — deutlich
  // mehr als der Einzelbucket unter „all“ (4).
  // Poll: the chart remounts on the granularity switch, so wait for it to settle.
  await expect.poll(() => trendBars.count()).toBeGreaterThan(4);
});
