import { expect, type Locator, type Page, test } from "@playwright/test";

/** The demo manager from `npm run db:reset`. */
async function signIn(page: Page, next = "/") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill("manager@example.com");
  await page.getByLabel("Password").fill("turnover-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === next);
}

/** Pages stay mounted when you navigate away, so always look at the visible one. */
const main = (page: Page) => page.locator("main:visible").last();
const step = (page: Page, name: string): Locator => main(page).locator(`article[aria-label="${name}"]`);
const dialog = (page: Page) => page.locator("dialog[open]");

async function expectTurn(page: Page, name: string) {
  await expect(step(page, name).getByText("Their turn now")).toBeVisible();
}

test("visitors who aren't signed in are sent to the login page", async ({ page }) => {
  await page.goto("/settings/people");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fpeople/);
  await page.getByLabel("Email").fill("manager@example.com");
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
});

test("the dashboard shows the demo units with their flags", async ({ page }) => {
  await signIn(page);
  const board = main(page).getByRole("region", { name: "Board" });
  await expect(board.getByRole("link", { name: /WR 315/ })).toContainText("Overdue");
  await expect(board.getByRole("link", { name: /Oakwood 101/ })).toContainText("Waiting on the replacement fridge");
  await main(page).getByLabel("Flag").selectOption("Overdue");
  await expect(main(page).getByText("2 units match")).toBeVisible();
});

test("a manager creates a turnover and walks it to Complete", async ({ page }) => {
  await signIn(page, "/turnovers/new");
  await main(page).getByLabel("Property").selectOption({ label: "Acadian" });
  await main(page).getByLabel("Unit").fill("E2E-1");
  await main(page).getByLabel("Move-out date").fill("2026-11-02");
  await main(page).getByRole("button", { name: "Create turnover" }).click();
  await expect(main(page).getByRole("heading", { level: 1 })).toContainText("Acadian E2E-1");
  await expectTurn(page, "Inspection");

  await step(page, "Inspection").getByRole("button", { name: "Mark done" }).click();
  await expectTurn(page, "Scope of work");

  // The scope becomes the in-house work checklist.
  await step(page, "Scope of work").getByPlaceholder(/Add what needs doing/).fill("Patch the hallway wall");
  await step(page, "Scope of work").getByRole("button", { name: "Add" }).click();
  await expect(step(page, "Scope of work").getByText("Patch the hallway wall", { exact: true })).toBeVisible();
  await step(page, "Scope of work").getByRole("button", { name: /Approve scope/ }).click();
  await dialog(page).getByRole("button", { name: "Approve" }).click();
  await expectTurn(page, "In-house work");

  const work = step(page, "In-house work");
  await work.getByLabel("Patch the hallway wall").check();
  await expect(work.getByText("Checklist · 1 of 1")).toBeVisible();
  await work.getByRole("button", { name: "Mark done" }).click();
  await expectTurn(page, "Cleaning");

  // Block and unblock cleaning: managers see the reason, the clock keeps running.
  await step(page, "Cleaning").getByRole("button", { name: "Block" }).click();
  await dialog(page).getByLabel("What is it waiting on?").fill("No key at the office");
  await dialog(page).getByRole("button", { name: "Block" }).click();
  await expect(step(page, "Cleaning")).toContainText("Blocked: No key at the office");
  await step(page, "Cleaning").getByRole("button", { name: "Unblock" }).click();
  await dialog(page).getByRole("button", { name: "Unblock" }).click();
  await expect(step(page, "Cleaning")).not.toContainText("Blocked:");
  await step(page, "Cleaning").getByRole("button", { name: "Mark done" }).click();
  await expectTurn(page, "Photos");

  // Photos finds a problem and sends the unit back to work.
  await step(page, "Photos").getByRole("button", { name: "Send back" }).click();
  await dialog(page).getByLabel("Send back to").selectOption({ label: "In-house work" });
  await dialog(page).getByLabel("What needs fixing?").fill("Scuff by the door");
  await dialog(page).getByRole("button", { name: "Send back" }).click();
  await expectTurn(page, "In-house work");
  await expect(step(page, "In-house work")).toContainText("Sent back once");
  await step(page, "In-house work").getByLabel(/Sent back from Photos: Scuff by the door/).check();
  await expect(step(page, "In-house work").getByText("Checklist · 2 of 2")).toBeVisible();
  await step(page, "In-house work").getByRole("button", { name: "Mark done" }).click();
  await expectTurn(page, "Cleaning");
  await step(page, "Cleaning").getByRole("button", { name: "Mark done" }).click();
  await expectTurn(page, "Photos");

  await step(page, "Photos").getByRole("button", { name: "Book" }).click();
  await dialog(page).getByLabel("Date").fill("2026-11-14");
  await dialog(page).getByRole("button", { name: "Save booking" }).click();
  await expect(step(page, "Photos")).toContainText("Booked Sat Nov 14");
  await step(page, "Photos").getByRole("button", { name: "Mark done" }).click();
  await expectTurn(page, "Leasing upload");
  await step(page, "Leasing upload").getByRole("button", { name: "Mark done" }).click();

  await expect(main(page).getByRole("heading", { level: 1 })).toContainText("Complete");
  await expect(main(page).getByText("Complete: every step is Done or N/A")).toBeVisible();
  await expect(main(page).getByText("Manager sent the unit back from Photos to In-house work")).toBeVisible();

  await page.goto("/?stage=complete&view=list");
  await expect(main(page).getByRole("link", { name: "Acadian E2E-1" })).toBeVisible();
});

test("pasting a list creates several turnovers at once", async ({ page }) => {
  await signIn(page, "/turnovers/new");
  await page.goto("/turnovers/new?mode=bulk");
  await main(page).getByLabel("Units, one per line").fill("Arbor 301-303, Nov 5\nNowhere 1");
  await expect(main(page).getByText("Preview: 3 to create, 1 with problems")).toBeVisible();
  await expect(main(page).getByRole("button", { name: /Create 3 turnovers/ })).toBeDisabled();
  await main(page).getByLabel("Units, one per line").fill("Arbor 301-303, Nov 5");
  await main(page).getByRole("button", { name: "Create 3 turnovers" }).click();
  await expect(main(page).getByText("Created 3 turnovers")).toBeVisible();
});
