/**
 * Functional E2E suite — Todo 28 "Share-Card" frontend (share dialog).
 *
 * Covers the URL-synced share dialog on the dashboard:
 *  1. /?share=week opens the dialog with the title visible and the week
 *     segment as the active (btn-primary) button.
 *  2. Clicking "Heute" rewrites the URL to ?share=today.
 *  3. Closing (✕) removes ?share=, ?shareproj= and ?sharelang= from the URL.
 *  4. The download button produces a real PNG download named
 *     opencode-usage-<range>.png.
 *  5. The preview <img> actually loads from /api/stats/share.svg.
 *
 * Prerequisite: app served at http://localhost:3712 (override via
 * E2E_BASE_URL). This suite NEVER starts/stops a server — it polls until the
 * server answers, because the parallel-built /api/stats/share* endpoints may
 * go live only shortly before/during the run.
 * Run: npx playwright test tests/share-dialog.spec.ts -c playwright.config.ts
 */
import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3712";

/**
 * Poll until the static app answers (bounded — must stay inside the 60s
 * beforeAll hook timeout). Failing loudly gives a clear message instead of
 * per-test navigation errors. LATE-BRINGING endpoints are handled by the
 * preview test's own long reload-poll below.
 */
test.beforeAll(async () => {
  const deadline = Date.now() + 45_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      // Server not up yet — keep polling.
    }
    if (Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(`App not reachable at ${BASE} within 45s`);
});

test("?share=week opens the dialog with the week segment active", async ({
  page,
}) => {
  await page.goto("/?share=week");
  const dialog = page.locator(".modal.modal-open");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Statistik teilen" }),
  ).toBeVisible();
  // Range-Join ist das erste .join im Dialog; nur sein aktiver Button trägt
  // „Diese Woche“ (DE/Sprach-Joins haben eigene Defaults).
  const rangeJoin = dialog.locator(".join").first();
  await expect(rangeJoin.locator("button.btn-primary")).toHaveText([
    "Diese Woche",
  ]);
});

test("clicking 'Heute' rewrites the URL to ?share=today", async ({ page }) => {
  await page.goto("/?share=week");
  const dialog = page.locator(".modal.modal-open");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Heute", exact: true }).click();

  await expect(page).toHaveURL(/([?&])share=today(&|$)/);
  // Range-Join ist das erste .join im Dialog — nur dort darf btn-primary
  // „Heute“ tragen (Projekt-/Sprach-Joins haben eigene Labels).
  const rangeJoin = dialog.locator(".join").first();
  await expect(rangeJoin.locator("button.btn-primary")).toHaveText(["Heute"]);
});

test("project tri-state writes ?shareproj= (all|hide|none)", async ({
  page,
}) => {
  await page.goto("/?share=week");
  const dialog = page.locator(".modal.modal-open");
  await expect(dialog).toBeVisible();

  // Default = all → kein shareproj in der URL.
  await expect(page).not.toHaveURL(/([?&])shareproj=/);
  await dialog.getByRole("button", { name: "Ohne", exact: true }).click();
  await expect(page).toHaveURL(/([?&])shareproj=none(&|$)/);
  await dialog.getByRole("button", { name: "Namen verbergen" }).click();
  await expect(page).toHaveURL(/([?&])shareproj=hide(&|$)/);
  await dialog.getByRole("button", { name: "Alle", exact: true }).click();
  await expect(page).not.toHaveURL(/([?&])shareproj=/);
});

test("image language is independent of the UI language (?sharelang=)", async ({
  page,
}) => {
  await page.goto("/?share=week");
  const dialog = page.locator(".modal.modal-open");
  await expect(dialog).toBeVisible();

  // Default = UI-Sprache (de) → kein Parameter.
  await expect(page).not.toHaveURL(/([?&])sharelang=/);
  await dialog.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page).toHaveURL(/([?&])sharelang=en(&|$)/);
  // Dialog-UI bleibt deutsch (unabhängige Bildsprache).
  await expect(
    dialog.getByRole("heading", { name: "Statistik teilen" }),
  ).toBeVisible();
});

test("closing removes all share params from the URL", async ({ page }) => {
  await page.goto("/?share=week&shareproj=none&sharelang=en");
  const dialog = page.locator(".modal.modal-open");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Ohne", exact: true }),
  ).toHaveClass(/btn-primary/);

  await dialog.getByRole("button", { name: "Schließen" }).click();

  await expect(page).not.toHaveURL(/([?&])share=/);
  await expect(page).not.toHaveURL(/([?&])shareproj=/);
  await expect(page).not.toHaveURL(/([?&])sharelang=/);
  await expect(dialog).toHaveCount(0);
});

test("download button produces opencode-usage-<range>.png", async ({ page }) => {
  await page.goto("/?share=week");
  const dialog = page.locator(".modal.modal-open");
  await expect(dialog).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    dialog.getByRole("button", { name: "PNG herunterladen" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("opencode-usage-week.png");
});

test("preview image loads from /api/stats/share.svg", async ({ page }) => {
  test.setTimeout(180_000); // generous budget for late endpoint deployment
  await page.goto("/?share=week");
  const img = page.locator(".modal.modal-open img[alt]");
  await expect(img).toBeAttached();

  // A failed <img> load is never retried by the browser, so poll WITH reloads
  // until the SVG endpoint serves a real image (naturalWidth > 0).
  await expect(async () => {
    await page.reload();
    await expect(img).toBeAttached();
    const width = await img.evaluate(
      (el) => (el as HTMLImageElement).naturalWidth,
    );
    expect(width).toBeGreaterThan(0);
  }).toPass({ timeout: 150_000, intervals: [1_000, 3_000, 5_000] });
});
