import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

// Runs after the other browser tests (files run in name order): it adds units to the shared test database.
const SNAPSHOT = path.join(__dirname, "..", "..", "data", "import", "master-tracker-2026-11-09.csv");
const HEADERS =
  "Property,Unit,Move-out date,Target ready date,Current stage,Days vacant,Days in stage,Flag,Inspection status,Inspection date,Scope status,Scope date,Scope of work (what's required),Work status,Work date,Assigned to (employee),Cleaning status,Cleaning date,Photos status,Photos date,Leasing status,Leasing date,Notes / blockers";

async function signInManager(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill("manager@example.com");
  await page.getByLabel("Password").fill("turnover-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === next.split("?")[0]);
}

const visible = (page: Page) => page.locator("main:visible").last();

test("a manager brings in the sheet: sees what it will do, then imports it, and nobody is messaged", async ({ page }) => {
  await signInManager(page, "/settings/sheet");
  const main = visible(page);
  await main.getByLabel("The CSV file").setInputFiles(SNAPSHOT);
  await main.getByRole("button", { name: "Check the file" }).click();
  await expect(main.getByText(/^master-tracker-2026-11-09\.csv: 17 units found\./)).toBeVisible();

  const importButton = main.getByRole("button", { name: /^Import \d+ units?$/ });
  const count = Number((await importButton.innerText()).match(/\d+/)![0]);
  expect(count).toBeGreaterThan(0);
  await importButton.click();
  await expect(main.getByText(`Imported ${count} units from master-tracker-2026-11-09.csv. Nobody was sent a message.`)).toBeVisible();

  // The same file again: everything is already in the app.
  await main.getByRole("button", { name: "Import another file" }).click();
  await main.getByLabel("The CSV file").setInputFiles(SNAPSHOT);
  await main.getByRole("button", { name: "Check the file" }).click();
  await expect(main.getByText(/Nothing new to add; 17 already in the app/)).toBeVisible();
  await expect(main.getByRole("button", { name: "Import 0 units" })).toBeDisabled();
});

test("the Master Tracker downloads in the sheet's layout, and a live link serves it to Google Sheets", async ({ page, request }) => {
  await signInManager(page, "/settings/sheet");
  const download = await page.request.get("/api/tracker");
  expect(download.status()).toBe(200);
  expect((await download.text()).split("\r\n")[2]).toBe(HEADERS);

  await visible(page).getByRole("button", { name: "Make a link" }).click();
  const formula = await visible(page).getByLabel("Formula for Google Sheets").inputValue();
  const url = formula.match(/^=IMPORTDATA\("(.+)"\)$/)![1];
  // A request with no sign-in, as Google's servers make it.
  const live = await request.get(url);
  expect(live.status()).toBe(200);
  expect(await live.text()).toContain("UNIT TURNOVER MASTER TRACKER");

  page.on("dialog", (dialog) => dialog.accept());
  await visible(page).getByRole("button", { name: "Turn off" }).click();
  await expect(visible(page).getByRole("button", { name: "Make a link" })).toBeVisible();
  expect((await request.get(url)).status()).toBe(404);
});
