// Regressionstests für die Kalenderwochen-Labels (KW/CW) bei
// Granularität „Woche" — siehe format.ts (isoWeek/shortWeek) und
// granTickFmt im Dashboard. Hintergrund: Vorher zeigten Kostenverlauf und
// Token-Anteile bei week/month immer Tages-Labels („MM-DD").
import { test, expect, type Page } from "@playwright/test";
import { isoWeek } from "../src/lib/format";

test.describe("isoWeek (ISO-8601, Donnerstags-Regel)", () => {
  test("bekannte Randfälle", () => {
    expect(isoWeek("2026-08-17")).toEqual({ year: 2026, week: 34 });
    // ISO-Sonderfall: 2024-12-30 gehört noch zu 2025-KW1.
    expect(isoWeek("2024-12-30")).toEqual({ year: 2025, week: 1 });
    // 2027-01-01 liegt noch in der letzten Woche des Vorjahres.
    expect(isoWeek("2027-01-01")).toEqual({ year: 2026, week: 53 });
    // Jahresanfang ohne Sonderfall.
    expect(isoWeek("2026-01-01")).toEqual({ year: 2026, week: 1 });
  });

  test("jeder Tag einer Woche liefert dieselbe KW", () => {
    for (let d = 17; d <= 23; d++) {
      const day = `2026-08-${String(d).padStart(2, "0")}`;
      expect(isoWeek(day), day).toEqual({ year: 2026, week: 34 });
    }
  });
});

/** X-Achsen-Ticks aller Recharts-Wrapper auf der Dashboard-Seite. */
async function allXTicks(page: Page): Promise<string[][]> {
  const wrappers = page.locator(".recharts-wrapper");
  const n = await wrappers.count();
  const out: string[][] = [];
  for (let i = 0; i < n; i++) {
    out.push(
      await wrappers
        .nth(i)
        .locator("g[class*='xAxis'] text")
        .allTextContents(),
    );
  }
  return out;
}

/** Pollt, bis alle drei Charts gerendert sind und das Prädikat greift. */
async function waitForChartTicks(
  page: Page,
  pred: (ticks: string[][]) => boolean,
): Promise<void> {
  await page.waitForSelector(".recharts-wrapper");
  await expect(page.locator(".recharts-wrapper")).toHaveCount(3);
  await expect
    .poll(async () => pred(await allXTicks(page)), { timeout: 15_000 })
    .toBe(true);
}

test.describe("KW-Labels im Dashboard", () => {
  test("?gran=week: alle Zeit-Charts ticken mit YYYY-KWnn", async ({
    page,
  }) => {
    await page.goto("/?gran=week");
    await waitForChartTicks(page, (charts) =>
      charts.every((ticks) =>
        ticks.some((s) => /^\d{4}-KW\d{2}$/.test(s)),
      ),
    );
    // Kein Rest von Tages-Labels („MM-DD") in irgendeinem Chart.
    for (const ticks of await allXTicks(page)) {
      for (const s of ticks) expect(s).not.toMatch(/^\d{2}-\d{2}$/);
    }
  });

  test("?gran=day zeigt weiterhin Tages-Labels (MM-DD)", async ({ page }) => {
    await page.goto("/?gran=day");
    await waitForChartTicks(page, (charts) =>
      charts.some((ticks) => ticks.some((s) => /^\d{2}-\d{2}$/.test(s))),
    );
  });

  test("?gran=month zeigt Monats-Labels (YYYY-MM)", async ({ page }) => {
    await page.goto("/?gran=month");
    await waitForChartTicks(page, (charts) =>
      charts.every((ticks) =>
        ticks.some((s) => /^\d{4}-\d{2}$/.test(s) && !s.includes("KW")),
      ),
    );
  });

  test("Heatmap-Spaltenköpfe zeigen KW statt Tagesdatum", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".recharts-wrapper");
    // Heatmap-Kopfzellen tragen das volle Datum als title und das kurze
    // Label als Text — seit der Umstellung ein KW-Label statt „MM-DD".
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            return [
              ...document.querySelectorAll<HTMLDivElement>(
                "div[title]:not([title=''])",
              ),
            ].filter((el) => /^\d{2}-\d{2}$/.test(el.textContent ?? "")).length;
          }),
        { timeout: 15_000 },
      )
      .toBe(0);
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            [...document.querySelectorAll<HTMLDivElement>("div[title]")].filter(
              (el) => /^\d{4}-(KW|CW)\d{2}$/.test(el.textContent ?? ""),
            ).length,
        ),
      )
      .toBeGreaterThan(0);
  });
});
