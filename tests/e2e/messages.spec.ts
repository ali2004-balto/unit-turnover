import { devices, expect, type Page, test } from "@playwright/test";

async function signInManager(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill("manager@example.com");
  await page.getByLabel("Password").fill("turnover-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === next.split("?")[0]);
}

const visible = (page: Page) => page.locator("main:visible").last();

test("a new turnover texts the inspector a link that opens their task", async ({ page: manager, browser }) => {
  test.setTimeout(120_000);

  // Texts wait for the morning during quiet hours; switch them off so this runs at any hour.
  await signInManager(manager, "/settings/messages");
  await expect(visible(manager).getByText("Dry run: no texts or emails leave the app.")).toBeVisible();
  await visible(manager).getByLabel("Quiet hours start").fill("00:00");
  await visible(manager).getByLabel("Quiet hours end").fill("00:00");
  await visible(manager).getByRole("button", { name: "Save" }).click();
  await expect(visible(manager).getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  await manager.goto("/turnovers/new");
  await visible(manager).getByLabel("Property").selectOption({ label: "Acadian" });
  await visible(manager).getByLabel("Unit").fill("E2E-MSG");
  await visible(manager).getByLabel("Move-out date").fill("2026-11-02");
  await visible(manager).getByRole("button", { name: "Create turnover" }).click();
  await expect(manager.locator("h1:visible")).toContainText("Acadian E2E-MSG");

  // The text goes out right after the turnover is created; in dry-run mode it's in the Outbox in full.
  await manager.goto("/settings/messages");
  const message = visible(manager).locator("li").filter({ hasText: "Acadian E2E-MSG" }).filter({ hasText: "Task ready" }).first();
  await expect(async () => {
    await manager.reload();
    await expect(message).toContainText("Sent by text", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(message).toContainText("to Inspector A");
  const text = await message.locator("p").first().innerText();
  expect(text).toMatch(/^Acadian E2E-MSG: Inspection is ready for you, due \w{3} \w{3} \d{1,2}\. Open: http:\/\/localhost:3100\/l\/[\w-]{22}$/);

  // On the inspector's phone, the link opens the inspection, ready to work on.
  const phone = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
  await phone.goto(text.split("Open: ")[1]);
  await expect(phone.locator("h1:visible")).toHaveText("Acadian E2E-MSG");
  await expect(phone.getByRole("button", { name: "Finish inspection" })).toBeVisible();
});
