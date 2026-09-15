import { expect, test } from "@playwright/test";

/**
 * The full path a customer takes, in one test.
 *
 * Deliberately one long test rather than several: each step depends on the
 * previous one's state, and splitting it would mean either re-doing the setup
 * four times or sharing mutable state between tests.
 */

const DEMO_DB = {
  host: "localhost",
  port: "5434",
  database: "demo_saas",
  user: "readonly",
  password: "readonly",
};

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

test("sign up, connect a database, build a dashboard, publish it", async ({ page, browser }) => {
  const workspace = unique("e2e");
  const email = `${workspace}@example.com`;

  /* --- sign up ----------------------------------------------------------- */

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("E2E User");
  await page.getByLabel("Workspace name").fill(workspace);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-1234");
  await page.getByRole("button", { name: "Create workspace" }).click();

  await expect(page).toHaveURL(new RegExp(`/${workspace}/dashboards`));

  /* --- connect the demo database ----------------------------------------- */

  await page.getByRole("link", { name: "Connections" }).click();
  await page.getByRole("button", { name: "Add connection" }).click();

  await page.getByLabel("Name").fill("Demo DB");
  await page.getByLabel("Host").fill(DEMO_DB.host);
  await page.getByLabel("Port").fill(DEMO_DB.port);
  await page.getByLabel("Database").fill(DEMO_DB.database);
  await page.getByLabel("User").fill(DEMO_DB.user);
  await page.getByLabel("Password").fill(DEMO_DB.password);
  // The demo database is plain TCP.
  await page.getByLabel("Connect over TLS").uncheck();
  await page.getByRole("button", { name: "Test and save" }).click();

  // The connection test actually connects, so this proves the whole
  // credential encrypt -> store -> decrypt -> connect path works.
  await expect(page.getByText(/Connected to PostgreSQL/)).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Demo DB")).toBeVisible();

  /* --- write a dataset ---------------------------------------------------- */

  await page.getByRole("link", { name: "Datasets" }).click();
  await page.getByRole("link", { name: "New dataset" }).click();
  await page.getByLabel("Name").fill("Revenue by plan");
  await page.getByRole("button", { name: /Create and write the query/ }).click();

  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await editor.pressSequentially(
    "SELECT a.plan, SUM(s.mrr_cents)/100.0 AS revenue FROM subscriptions s JOIN accounts a ON a.id = s.account_id GROUP BY 1 ORDER BY 2 DESC",
  );

  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("columnheader", { name: /revenue/ })).toBeVisible();

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  /* --- the read-only guard rejects a write ------------------------------- */

  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await editor.pressSequentially("DROP TABLE accounts");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText(/must be a read-only query/)).toBeVisible();

  /* --- build a dashboard -------------------------------------------------- */

  await page.getByRole("link", { name: "Dashboards" }).click();
  await page.getByRole("button", { name: "New dashboard" }).click();
  await page.getByLabel("Name").fill("Revenue overview");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Revenue overview" })).toBeVisible();

  await page.getByRole("button", { name: "Share of total" }).click();
  await page.getByLabel("Dataset").selectOption({ label: "Revenue by plan" });

  // The widget renders real rows from the customer database.
  await expect(page.getByText(/enterprise/)).toBeVisible();

  /* --- publish and view anonymously -------------------------------------- */

  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("button", { name: "Create link" }).click();

  const linkInput = page.locator('input[readonly]');
  await expect(linkInput).toBeVisible();
  const shareUrl = await linkInput.inputValue();
  expect(shareUrl).toContain("/p/");

  // A separate context, so there is no session cookie: this is what the
  // customer's customer sees.
  const anonymous = await browser.newContext();
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(shareUrl);

  await expect(anonymousPage.getByRole("heading", { name: "Revenue overview" })).toBeVisible();
  await expect(anonymousPage.getByText(/enterprise/)).toBeVisible();

  // The published payload must not carry the SQL or the connection details.
  const html = await anonymousPage.content();
  expect(html).not.toContain("mrr_cents");
  expect(html).not.toContain("readonly");
  expect(html).not.toContain("5434");

  /* --- revoking breaks the link ------------------------------------------ */

  await page.getByRole("button", { name: "Revoke link" }).click();
  await expect(page.getByRole("button", { name: "Create link" })).toBeVisible();

  const afterRevoke = await anonymousPage.goto(shareUrl);
  expect(afterRevoke?.status()).toBe(404);

  await anonymous.close();
});
