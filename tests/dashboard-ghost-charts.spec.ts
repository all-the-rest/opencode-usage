/**
 * Functional E2E regression suite — Todo 27 "Ghost charts".
 *
 * Bug being guarded against: every click on a "Gruppieren nach" (group-by) or
 * resolution (granularity) switch of the dashboard token-trend chart left an
 * additional stale `.recharts-wrapper` element in the DOM (+1 per click), so
 * charts/legend entries visibly duplicated.
 *
 * Layout since the granularity became a GLOBAL filter (Todo 29): the
 * resolution switch lives ABOVE the charts (direct child of the dashboard
 * root), the group-by switch stays inside the token-trend card.
 *
 * Covered here:
 *  1. ≥14 alternating group-by/granularity clicks keep `.recharts-wrapper`
 *     at exactly 3 (token trend + cost trend + token share; the heatmap is a
 *     CSS grid, not a Recharts chart).
 *  2. No duplicated KPI card ("Gesamt-Tokens") and no duplicated card title
 *     ("Token-Anteile") in the DOM.
 *  3. Clicking a bar sets the global period filter (?period=YYYY-MM-DD&
 *     pperiod=day): the drill-down is INTEGRATED (no separate card, chart count
 *     stays at 3), a "Zeitraum:" chip appears in the filter bar, and its ✕
 *     clears the filter again.
 *  4. URL state restore: /?gran=week&group=provider restores both switches.
 *
 * Prerequisite: app served at http://localhost:3712 (`pnpm start`; override
 * via E2E_BASE_URL). Run: npx playwright test -c playwright.config.ts
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

/** Charts on a loaded dashboard WITHOUT the day drill-down. */
const BASE_WRAPPER_COUNT = 3;

let page: Page;

test.beforeEach(async ({ page: p }) => {
  page = p;
  await p.goto("/");
  await expect(p.locator(".recharts-wrapper")).toHaveCount(BASE_WRAPPER_COUNT);
});

/** The dashboard card containing the token-trend chart + group-by switch. */
function trendCard(): Locator {
  return page
    .locator(".card")
    .filter({ has: page.getByRole("heading", { name: "Token-Zeitverlauf" }) });
}

/** Global resolution switch (ABOVE the charts, outside any .card). */
function globalGranSwitch(): Locator {
  return page.locator(".space-y-6 > div:not(.card) .join");
}

async function clickGroup(label: string): Promise<void> {
  await trendCard().getByRole("button", { name: label }).click();
}

async function clickGran(label: string): Promise<void> {
  await globalGranSwitch().getByRole("button", { name: label }).click();
}

test("group/resolution switches keep exactly 3 .recharts-wrapper nodes (>14 clicks)", async () => {
  const wrappers = page.locator(".recharts-wrapper");

  // Alternating group-by (in-card) / granularity (global) clicks. Every label
  // exists in its respective switch in every state, so each one is clickable
  // at every step.
  const sequence: Array<[() => Promise<void>, string]> = [
    [() => clickGroup("Hersteller"), "Hersteller"],
    [() => clickGran("Woche"), "Woche"],
    [() => clickGroup("Familie"), "Familie"],
    [() => clickGran("Monat"), "Monat"],
    [() => clickGroup("Anbieter"), "Anbieter"],
    [() => clickGran("Tag"), "Tag"],
    [() => clickGroup("Gesamt"), "Gesamt"],
    [() => clickGran("Woche"), "Woche"],
    [() => clickGroup("Hersteller"), "Hersteller"],
    [() => clickGran("Monat"), "Monat"],
    [() => clickGroup("Familie"), "Familie"],
    [() => clickGran("Tag"), "Tag"],
    [() => clickGroup("Anbieter"), "Anbieter"],
    [() => clickGran("Gesamt"), "Gesamt"],
  ];

  for (const [i, [click, label]] of sequence.entries()) {
    await click();
    // Auto-retries through the transient loading swap (chart unmounts while
    // the new fetch is in flight) — but must SETTLE at exactly 3. A leftover
    // ghost wrapper makes this fail with "received 4".
    await expect(wrappers).toHaveCount(BASE_WRAPPER_COUNT);
    // eslint-disable-next-line no-console
    console.log(`click ${i + 1} (${label}): ${await wrappers.count()} wrappers`);
  }

  // No duplicated KPI card / card title after all the switching.
  await expect(page.getByText("Gesamt-Tokens", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Token-Anteile", { exact: true })).toHaveCount(1);
});

test("bar click sets ?period=…&pperiod=day; integrated drill-down; chip ✕ clears it", async () => {
  // Click the tallest visible bar of the token-trend chart via real mouse
  // events (zero-height segments of stacked series are skipped).
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

  // The drill-down is now INTEGRATED (no separate card): the global period
  // filter is set, the chip appears in the filter bar, chart count stays 3.
  await expect(page).toHaveURL(/([?&])period=\d{4}-\d{2}-\d{2}/);
  await expect(page).toHaveURL(/([?&])pperiod=day/);
  await expect(page.locator(".recharts-wrapper")).toHaveCount(BASE_WRAPPER_COUNT);

  const chip = page.locator(".badge-secondary");
  await expect(chip).toContainText("Zeitraum:");

  // Clear the filter via the chip's ✕ — restores the full overview.
  await chip.getByRole("button").click();
  await expect(page).not.toHaveURL(/([?&])period=/);
  await expect(page.locator(".badge-secondary")).toHaveCount(0);
  await expect(page.locator(".recharts-wrapper")).toHaveCount(BASE_WRAPPER_COUNT);
});

test("shared link ?gran=week&group=provider restores switch state", async () => {
  await page.goto("/?gran=week&group=provider");
  await expect(page.locator(".recharts-wrapper")).toHaveCount(BASE_WRAPPER_COUNT);

  // Resolution switch is global, group-by switch lives in the trend card.
  await expect(
    globalGranSwitch().locator("button.btn-primary"),
  ).toHaveText(["Woche"]);
  await expect(trendCard().locator("button.btn-primary")).toHaveText([
    "Anbieter",
  ]);
});
