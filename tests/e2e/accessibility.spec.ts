import { AxeBuilder } from "@axe-core/playwright";
import { type Browser, devices, expect, type Page, test } from "@playwright/test";

/**
 * Every screen, checked with axe against WCAG 2.2 AA (contrast, labels,
 * names, keyboard access…) in light and dark mode, on a desktop and a phone.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function problems(page: Page): Promise<string[]> {
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return violations.map((v) => `${v.id} (${v.impact}) on ${new URL(page.url()).pathname}: ${v.help} at ${v.nodes[0]?.target.join(" ")}`);
}

async function signInManager(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@example.com");
  await page.getByLabel("Password").fill("turnover-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

async function managerPages(page: Page): Promise<string[]> {
  await page.goto("/");
  const turnover = await page.locator('main:visible a[href^="/turnovers/"]:not([href="/turnovers/new"])').first().getAttribute("href");
  const found: string[] = [];
  for (const path of [
    "/",
    "/?view=list",
    "/turnovers/new",
    turnover!,
    "/tracker",
    "/reports?period=12m",
    "/settings/general",
    "/settings/properties",
    "/settings/people",
    "/settings/defaults",
    "/settings/templates",
    "/settings/messages",
    "/settings/sheet",
  ]) {
    await page.goto(path);
    found.push(...(await problems(page)));
  }
  return found;
}

async function inspectorPhone(browser: Browser, manager: Page, colorScheme: "light" | "dark"): Promise<string[]> {
  await manager.goto("/settings/people");
  await manager.locator("tr", { hasText: "Inspector A" }).getByRole("button", { name: "Sign-in link" }).click();
  const link = await manager.getByLabel("Sign-in link for Inspector A").inputValue();
  const phone = await (await browser.newContext({ ...devices["iPhone 13"], colorScheme })).newPage();
  const found: string[] = [];
  await phone.goto("/signin");
  found.push(...(await problems(phone)));
  await phone.goto(link);
  await phone.waitForURL((url) => url.pathname.startsWith("/tasks"));
  found.push(...(await problems(phone)));
  await phone.locator('main:visible a[href^="/tasks/"]').first().click();
  await phone.waitForURL((url) => /^\/tasks\/.+/.test(url.pathname));
  found.push(...(await problems(phone)));
  await phone.context().close();
  return found;
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`every screen passes an accessibility check (${colorScheme} mode)`, async ({ browser }) => {
    test.setTimeout(180_000);
    const desktop = await browser.newContext({ colorScheme, viewport: { width: 1280, height: 900 } });
    const manager = await desktop.newPage();
    await manager.goto("/login");
    const found = await problems(manager);
    await signInManager(manager);
    found.push(...(await managerPages(manager)));

    // The same manager screens on a phone, where wide tables scroll.
    const phone = await browser.newContext({ ...devices["iPhone 13"], colorScheme });
    await phone.addCookies(await desktop.cookies());
    found.push(...(await managerPages(await phone.newPage())));

    found.push(...(await inspectorPhone(browser, manager, colorScheme)));
    expect([...new Set(found)]).toEqual([]);
  });
}
