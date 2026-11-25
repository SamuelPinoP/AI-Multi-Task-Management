import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, openSection, signUpAndLogIn } from "./helpers";

// The Integrations page (#480, designs 1A and 2A): the MCP server's address, and each AI app's steps
// opening in its row. The sidebar's Tools link to it while MCP_ENABLED is on, as on the e2e server.

/** The address the endpoint binds tokens to, as its 401 challenge names it (see mcp.spec.ts). */
async function endpointAddress(page: Page) {
  const response = await page.request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" }, maxRedirects: 0 });
  expect(response.status()).toBe(401);
  const metadata = /resource_metadata="([^"]+)"/.exec(response.headers()["www-authenticate"] ?? "")?.[1];
  expect(metadata, "the challenge names the protected resource metadata").toBeTruthy();
  return `${new URL(metadata!).origin}/api/mcp`;
}

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(" ")).join(", ")})`);
}

test("an account copies the server's address and follows each app's steps", async ({ page, context, isMobile }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signUpAndLogIn(page, "Integrations");
  const serverUrl = await endpointAddress(page);

  // From the sidebar's Tools on a computer, or the menu sheet on a phone (design 1A).
  await openSection(page, "Integrations");
  await expect(page).toHaveURL(/\/integrations$/);
  await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
  if (!isMobile) await expect(page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Integrations" })).toHaveAttribute("aria-current", "page");

  // The address is the endpoint's own, so an app that's given it reaches the sign-in it asks for.
  const address = page.getByRole("region", { name: "Server address" });
  await expect(address.locator("code")).toHaveText(serverUrl);

  const assistants = page.getByRole("region", { name: "AI assistants" });
  await expect(assistants.getByRole("button", { expanded: false })).toHaveCount(7);

  // Connect opens the steps in the row (2A), with the address to paste.
  const connectClaude = assistants.getByRole("button", { name: "Connect Claude", exact: true });
  await connectClaude.click();
  await expect(connectClaude).toHaveCount(0);
  await expect(assistants.getByRole("button", { name: "Close the Claude steps", exact: true })).toHaveAttribute("aria-expanded", "true");
  const claudeSteps = page.getByRole("list", { name: "Connect Claude", exact: true });
  await expect(claudeSteps.getByRole("listitem")).toHaveCount(3);
  await expect(claudeSteps).toContainText("In Claude, open Settings, then Connectors, and click Add custom connector.");
  await expect(claudeSteps.locator("code")).toHaveText(serverUrl);
  await expect(assistants.getByText(/^Then try asking/)).toHaveText(
    "Then try asking “What's due this week?”, “What's on my calendar tomorrow?” or “How am I doing on this week's goals?”",
  );

  // One app's steps at a time: Claude Code's replace Claude's, with a command to copy.
  await assistants.getByRole("button", { name: "Connect Claude Code", exact: true }).click();
  await expect(claudeSteps).toHaveCount(0);
  const command = `claude mcp add --transport http ai-multi ${serverUrl}`;
  const claudeCodeSteps = page.getByRole("list", { name: "Connect Claude Code", exact: true });
  await expect(claudeCodeSteps.locator("code")).toHaveText(command);
  // The longest command wraps on a phone rather than widening the page.
  expect(await page.locator("#main-content").evaluate((main) => main.scrollWidth <= main.clientWidth)).toBe(true);
  // Scanned before any toast, whose fade-in axe could catch half drawn.
  expect(await axeViolations(page)).toEqual([]);

  await claudeCodeSteps.getByRole("button", { name: "Copy the command" }).click();
  await expect(page.getByText("Command copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  await address.getByRole("button", { name: "Copy the server address" }).click();
  await expect(page.getByText("Server address copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(serverUrl);

  // Cursor and VS Code install with one click, carrying the same address; phones say Connect on every row.
  await assistants.getByRole("button", { name: isMobile ? "Connect Cursor" : "Add to Cursor", exact: true }).click();
  const cursorLink = new URL((await page.getByRole("list", { name: "Connect Cursor" }).getByRole("link", { name: "Add to Cursor" }).getAttribute("href"))!);
  expect(`${cursorLink.protocol}//${cursorLink.host}${cursorLink.pathname}`).toBe("cursor://anysphere.cursor-deeplink/mcp/install");
  expect(JSON.parse(Buffer.from(cursorLink.searchParams.get("config")!, "base64").toString())).toEqual({ url: serverUrl });

  const addToVsCode = assistants.getByRole("button", { name: isMobile ? "Connect VS Code" : "Add to VS Code", exact: true });
  await addToVsCode.click();
  const vscodeLink = (await page.getByRole("list", { name: "Connect VS Code" }).getByRole("link", { name: "Add to VS Code" }).getAttribute("href"))!;
  expect(vscodeLink.startsWith("vscode:mcp/install?")).toBe(true);
  expect(JSON.parse(decodeURIComponent(vscodeLink.slice("vscode:mcp/install?".length)))).toEqual({ name: "ai-multi", type: "http", url: serverUrl });

  // The keyboard closes the steps and keeps its place, and Tab goes on to the next app.
  await assistants.getByRole("button", { name: "Close the VS Code steps", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(addToVsCode).toHaveAttribute("aria-expanded", "false");
  await expect(addToVsCode).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(assistants.getByRole("button", { name: "Connect Other AI apps", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Connect Other AI apps" }).locator("code")).toHaveText(serverUrl);

  if (!isMobile) {
    // The command palette finds it too.
    await page.keyboard.press("Control+K");
    await page.getByPlaceholder("Search or run a command...").fill("mcp");
    await expect(page.getByRole("option", { name: "Integrations", exact: true })).toBeVisible();
  }
});

test("a guest's Connect and Copy open the sign-up pop-up: apps sign in to an account", async ({ page }) => {
  await continueAsGuest(page);
  await openSection(page, "Integrations");
  await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();

  const signUp = page.getByRole("dialog", { name: "Connecting AI apps needs a free account" });
  const connectClaude = page.getByRole("button", { name: "Connect Claude", exact: true });
  await connectClaude.click();
  await expect(signUp).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(signUp).toBeHidden();
  // No steps opened behind the pop-up.
  await expect(connectClaude).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("list", { name: "Connect Claude", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Copy the server address" }).click();
  await expect(signUp).toBeVisible();
});
