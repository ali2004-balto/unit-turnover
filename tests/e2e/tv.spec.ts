import { expect, type Page, test } from "@playwright/test";

async function signInManager(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill("manager@example.com");
  await page.getByLabel("Password").fill("turnover-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === next.split("?")[0]);
}

test("a manager makes the TV link, the board shows every panel, and a wrong link is a 404", async ({ page, request }) => {
  await signInManager(page, "/settings/tv");
  const main = page.locator("main:visible").last();
  await main.getByRole("button", { name: "Make a link" }).click();
  const url = await main.getByLabel("TV link").inputValue();
  expect(url).toMatch(/\/tv\/[\w-]{20,}$/);

  // The TV has no sign-in: a plain request with the link is enough.
  const response = await request.get(url);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-robots-tag"]).toContain("noindex");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  const html = await response.text();
  expect(html).toContain('http-equiv="refresh"');
  expect(html).not.toMatch(/@example\.com|\+1604/);

  const tv = await page.context().browser()!.newContext();
  const tvPage = await tv.newPage();
  await tvPage.goto(url);
  for (const heading of ["Turnovers", "Needs you", "Done overnight", "Today", "Projects", "Email and deadlines"]) {
    await expect(tvPage.getByRole("heading", { name: heading })).toBeVisible();
  }
  for (const label of ["Active turns", "Need you", "Overdue", "Avg days vacant", "Finished, 30 days", "On time, 90 days"]) {
    await expect(tvPage.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(tvPage.getByText("Connects in a later step")).toHaveCount(3);
  await expect(tvPage.getByText(/\bAcadian\b/).first()).toBeVisible();
  await tv.close();

  expect((await request.get("/tv/not-a-real-link")).status()).toBe(404);

  // Replacing the link switches the old one off.
  page.on("dialog", (dialog) => dialog.accept());
  await main.getByRole("button", { name: "Make a new link" }).click();
  await expect(main.getByLabel("TV link")).not.toHaveValue(url);
  expect((await request.get(url)).status()).toBe(404);
});
