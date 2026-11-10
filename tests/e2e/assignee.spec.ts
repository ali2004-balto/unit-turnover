import path from "node:path";
import { type Browser, devices, expect, type Locator, type Page, test } from "@playwright/test";

const PHOTO = path.join(__dirname, "fixtures", "tile.jpg");

async function signInManager(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill("manager@example.com");
  await page.getByLabel("Password").fill("turnover-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === next.split("?")[0]);
}

const visible = (page: Page) => page.locator("main:visible").last();
const step = (page: Page, name: string): Locator => visible(page).locator(`article[aria-label="${name}"]`);

/** The manager copies the sign-in link for whoever has this step now. */
async function linkForStep(manager: Page, stepName: string): Promise<string> {
  await manager.reload();
  const card = step(manager, stepName);
  await expect(card.getByText("Their turn now")).toBeVisible();
  await card.getByRole("button", { name: /Sign-in link for/ }).click();
  return card.locator("input[readonly]").inputValue();
}

/** Opens a sign-in link on a fresh phone, as that person would from their text message. */
async function openOnPhone(browser: Browser, link: string): Promise<Page> {
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const phone = await context.newPage();
  await phone.goto(link);
  await expect(phone.locator("h1:visible")).toBeVisible();
  return phone;
}

test("a unit goes from inspection to Complete, each person working from their own phone", async ({ page: manager, browser }) => {
  test.setTimeout(180_000);

  await signInManager(manager, "/turnovers/new");
  await visible(manager).getByLabel("Property").selectOption({ label: "Acadian" });
  await visible(manager).getByLabel("Unit").fill("E2E-7");
  await visible(manager).getByLabel("Move-out date").fill("2026-11-02");
  await visible(manager).getByRole("button", { name: "Create turnover" }).click();
  await expect(manager.locator("h1:visible")).toContainText("Acadian E2E-7");
  const turnoverUrl = manager.url();

  // Inspector: the link opens straight to the inspection.
  const inspector = await openOnPhone(browser, await linkForStep(manager, "Inspection"));
  await expect(inspector.locator("h1:visible")).toHaveText("Acadian E2E-7");
  const im = visible(inspector);
  await im.getByLabel("Room").selectOption("Kitchen");
  await im.getByLabel("What did you find?").fill("Cracked floor tile by the fridge");
  await im.getByRole("button", { name: "Add finding" }).click();
  const finding = im.locator("li", { hasText: "Cracked floor tile by the fridge" });
  await expect(finding).toBeVisible();
  await finding.locator("input[type=file][multiple]").setInputFiles(PHOTO);
  await expect(finding.locator("img")).toBeVisible();
  await im.getByLabel("Room").selectOption("Bathroom 1");
  await im.getByLabel("What did you find?").fill("Grout stained, cleaning will handle it");
  await im.getByRole("radio", { name: "Just a note" }).click();
  await im.getByRole("button", { name: "Add finding" }).click();
  await expect(im.getByText("Grout stained, cleaning will handle it")).toBeVisible();
  await inspector.getByRole("button", { name: "Finish inspection" }).click();
  await expect(inspector.locator("dialog[open]")).toContainText("One thing needs work. It goes to the manager as the draft scope.");
  await inspector.locator("dialog[open]").getByRole("button", { name: "Send to the manager" }).click();
  await expect(visible(inspector).getByText("Marked complete. Thanks!")).toBeVisible();
  await expect(visible(inspector).getByRole("link", { name: /Acadian E2E-7/ })).toHaveCount(0);

  // Manager: the finding is now the draft scope, with its photo on the inspection.
  await manager.goto(turnoverUrl);
  await expect(step(manager, "Inspection").locator("img")).toBeVisible();
  const scope = step(manager, "Scope of work");
  await expect(scope.getByText("Kitchen: Cracked floor tile by the fridge", { exact: true })).toBeVisible();
  await scope.getByRole("button", { name: /Approve scope/ }).click();
  await manager.locator("dialog[open]").getByRole("button", { name: "Approve" }).click();
  // Wait for the approval to be saved before the next step reloads the page.
  await expect(scope.getByRole("button", { name: /Approve scope/ })).toHaveCount(0);

  // Crew: ticks off the scope and finishes. They can't open the inspection.
  const crew = await openOnPhone(browser, await linkForStep(manager, "In-house work"));
  const cm = visible(crew);
  await expect(crew.getByRole("button", { name: "1 item left to tick" })).toBeDisabled();
  await cm.getByLabel("Kitchen: Cracked floor tile by the fridge").check();
  await crew.getByRole("button", { name: "Mark complete" }).click();
  await expect(visible(crew).getByText("Marked complete. Thanks!")).toBeVisible();
  await expect(visible(crew).getByRole("link", { name: /Acadian E2E-7/ })).toHaveCount(0);

  // Cleaner, then photographer (full-quality upload and a folder link), then leasing.
  const cleaner = await openOnPhone(browser, await linkForStep(manager, "Cleaning"));
  await cleaner.getByRole("button", { name: "Mark complete" }).click();
  await expect(visible(cleaner).getByText("Marked complete. Thanks!")).toBeVisible();

  const photographer = await openOnPhone(browser, await linkForStep(manager, "Photos"));
  const pm = visible(photographer);
  await expect(pm.getByText("Final photos")).toBeVisible();
  await pm.getByRole("region", { name: "Photos" }).locator("input[type=file][multiple]").setInputFiles(PHOTO);
  await expect(pm.getByRole("region", { name: "Photos" }).locator("img")).toBeVisible();
  await pm.getByLabel("Dropbox or Google Drive folder").fill("https://www.dropbox.com/sh/example/finals");
  await pm.getByRole("button", { name: "Add link" }).click();
  await expect(pm.getByRole("link", { name: "https://www.dropbox.com/sh/example/finals" })).toBeVisible();
  await photographer.getByRole("button", { name: "Mark complete" }).click();
  await expect(visible(photographer).getByText("Marked complete. Thanks!")).toBeVisible();

  const leasing = await openOnPhone(browser, await linkForStep(manager, "Leasing upload"));
  const zip = visible(leasing).getByRole("link", { name: "Download all photos (.zip)" });
  await expect(zip).toBeVisible();
  const download = await leasing.request.get((await zip.getAttribute("href"))!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("application/zip");
  await leasing.getByRole("button", { name: "Mark complete" }).click();
  await expect(visible(leasing).getByText("Marked complete. Thanks!")).toBeVisible();

  // Manager: complete, with everyone's work on the timeline.
  await manager.goto(turnoverUrl);
  await expect(manager.locator("h1:visible")).toContainText("Complete");
  const timeline = visible(manager).getByRole("complementary");
  await expect(timeline.getByText("Inspector A noted in Kitchen")).toBeVisible();
  await expect(timeline.getByText("Crew A marked In-house work Done")).toBeVisible();
  await expect(timeline.getByText("Photographer A added a link to Photos")).toBeVisible();
  await expect(timeline.getByText("Leasing A marked Leasing upload Done")).toBeVisible();
});

test("people only ever see their own tasks", async ({ page: manager, browser }) => {
  await signInManager(manager, "/");
  await visible(manager).getByRole("link", { name: /Rivergate 303/ }).first().click();
  await manager.waitForURL(/\/turnovers\/[0-9a-f-]{36}$/);
  const inspectionLink = await linkForStep(manager, "Inspection");
  const inspectionPath = new URL(inspectionLink).pathname;

  // The cleaner signs in with their own link…
  await manager.goto("/settings/people");
  const row = visible(manager).locator("tr", { hasText: "Cleaner A" });
  await row.getByRole("button", { name: "Sign-in link" }).click();
  const cleaner = await openOnPhone(browser, await row.locator("input[readonly]").inputValue());
  await expect(cleaner).toHaveURL(/\/tasks$/);
  await expect(visible(cleaner).getByText("Balwin 1").first()).toBeVisible();

  // …and can't open the inspector's task, or manager screens.
  const inspector = await openOnPhone(browser, inspectionLink);
  const inspectionTask = new URL(inspector.url()).pathname;
  expect(inspectionPath).toMatch(/^\/l\//);
  await cleaner.goto(inspectionTask);
  await expect(visible(cleaner).getByText("This task isn't available")).toBeVisible();
  await expect(visible(cleaner).getByText("Rivergate 303")).toHaveCount(0);
  await cleaner.goto("/");
  await expect(cleaner).toHaveURL(/\/login/);

  // The home-screen icon opens their tasks; a manager's opens the dashboard.
  await cleaner.goto("/start");
  await expect(cleaner).toHaveURL(/\/tasks$/);
  await manager.goto("/start");
  await expect(manager).toHaveURL(/\/$/);
});

test("broken and missing links explain what to do", async ({ page }) => {
  await page.goto("/l/not-a-real-link-at-all");
  await expect(page.getByText("That link isn't valid")).toBeVisible();
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/signin/);
  await page.getByLabel("Mobile number or email").fill("604 555 0101");
  await page.getByRole("button", { name: "Send me a sign-in link" }).click();
  await expect(page.getByText("Check your phone or email")).toBeVisible();
});
