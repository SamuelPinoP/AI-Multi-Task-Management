import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  auth,
  Client,
  StreamableHTTPClientTransport,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { continueAsGuest, queryDatabase, signUpAndLogIn, uniqueName } from "./helpers";

// Sign-in for AI apps (#477): the MCP SDK's own OAuth client finds the consent page from the
// endpoint's metadata, registers, and trades the code for tokens; the person clicks Allow or
// Cancel; Connected apps on the Integrations page disconnects. No test calls an AI.

// A desktop app listens on a loopback port for the browser to bring the code back; so does this file,
// on a port the system picks. The browser has to reach it for real: page.route() never sees a
// redirect's next stop, such as the one after Allow.
const callbackServer = createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Done</title><p>You can close this tab.</p>");
});
let CALLBACK_ORIGIN = "";
let CALLBACK = "";
test.beforeAll(async () => {
  await new Promise<void>((resolve) => callbackServer.listen(0, "127.0.0.1", resolve));
  CALLBACK_ORIGIN = `http://127.0.0.1:${(callbackServer.address() as AddressInfo).port}`;
  CALLBACK = `${CALLBACK_ORIGIN}/callback`;
});
test.afterAll(async () => {
  callbackServer.closeAllConnections();
  await new Promise((resolve) => callbackServer.close(resolve));
});
/** What apps without a metadata document register: a loopback address may come back on any port. */
const APP_REDIRECT = "http://127.0.0.1/callback";

type Tokens = { access_token: string; refresh_token: string; scope: string; token_type: string; expires_in: number };

/** An AI app on the person's computer, as the MCP SDK runs one: what it registers and receives, kept in memory. */
class DesktopApp implements OAuthClientProvider {
  readonly name = uniqueName("E2E Desktop App");
  readonly appState = randomBytes(12).toString("base64url");
  information?: StoredOAuthClientInformation;
  saved?: StoredOAuthTokens;
  consentUrl?: URL;
  private verifier = "";
  private discovery?: OAuthDiscoveryState;

  get redirectUrl() {
    return CALLBACK;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.name,
      redirect_uris: [CALLBACK],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  state() {
    return this.appState;
  }
  clientInformation() {
    return this.information;
  }
  saveClientInformation(information: StoredOAuthClientInformation) {
    this.information = information;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: StoredOAuthTokens) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.consentUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
  // Kept with the PKCE secret, so the SDK checks the code comes back from the server it was sent to (SEP-2352).
  saveDiscoveryState(state: OAuthDiscoveryState) {
    this.discovery = state;
  }
  discoveryState() {
    return this.discovery;
  }
}

/** Waits until the browser has landed on the app's loopback page, and gives the address it landed on. */
async function nextCallback(page: Page) {
  await page.waitForURL((url) => url.origin === CALLBACK_ORIGIN);
  return new URL(page.url());
}

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(" ")).join(", ")})`);
}

/** Registers an app the way one without a metadata document does (RFC 7591), as a public client. */
async function registerApp(request: APIRequestContext) {
  const name = uniqueName("E2E app");
  const response = await request.post("/api/oauth/register", {
    data: { client_name: name, redirect_uris: [APP_REDIRECT], token_endpoint_auth_method: "none" },
  });
  expect(response.status(), await response.text()).toBe(201);
  return { name, clientId: ((await response.json()) as { client_id: string }).client_id };
}

/** A consent link as an app builds one, with a fresh PKCE secret. */
function consentLink(clientId: string, overrides: Record<string, string> = {}) {
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: CALLBACK,
    response_type: "code",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "e2e-state",
    scope: "read write",
    ...overrides,
  });
  return { path: `/oauth/authorize?${params}`, verifier };
}

async function tradeCode(request: APIRequestContext, clientId: string, code: string, verifier: string) {
  const response = await request.post("/api/oauth/token", {
    form: { grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: CALLBACK },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as Tokens;
}

const refreshWith = (request: APIRequestContext, clientId: string, refreshToken: string) =>
  request.post("/api/oauth/token", { form: { grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken } });

async function mcpClient(baseURL: string, authProvider: OAuthClientProvider | { token: () => Promise<string> }) {
  const client = new Client({ name: "e2e-oauth-client", version: "1.0.0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", baseURL), { authProvider }));
  return client;
}

async function listProjects(client: Client) {
  const result = await client.callTool({ name: "list_projects", arguments: {} });
  return { isError: result.isError === true, text: (result.content as Array<{ text: string }>)[0]?.text ?? "" };
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

test("an AI app signs in with the MCP SDK's OAuth client, calls a tool and refreshes; an old refresh token disconnects it", async ({
  page,
  request,
  baseURL,
  isMobile,
}) => {
  // The metadata documents open signed out, where apps look for them.
  const resourceMetadata = await request.get("/.well-known/oauth-protected-resource/api/mcp");
  expect(resourceMetadata.status()).toBe(200);
  const { resource, authorization_servers: servers } = (await resourceMetadata.json()) as { resource: string; authorization_servers: string[] };
  const origin = new URL(resource).origin;
  expect(resource).toBe(`${origin}/api/mcp`);
  expect(servers).toEqual([origin]);
  expect((await request.get("/.well-known/oauth-protected-resource")).status()).toBe(200);
  const serverMetadata = (await (await request.get("/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
  expect(serverMetadata).toMatchObject({ issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, code_challenge_methods_supported: ["S256"] });

  await signUpAndLogIn(page, "OAuth person");
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });

  // The SDK discovers sign-in, registers the app and builds the consent link.
  const app = new DesktopApp();
  const serverUrl = new URL("/api/mcp", baseURL);
  expect(await auth(app, { serverUrl, scope: "read write" })).toBe("REDIRECT");
  const consentUrl = app.consentUrl!;
  expect(consentUrl.pathname).toBe("/oauth/authorize");
  expect(consentUrl.searchParams.get("code_challenge_method")).toBe("S256");
  expect(consentUrl.searchParams.get("resource")).toBe(resource);
  expect(app.information?.client_id).toMatch(/^aim_ci_/);

  // The consent page (design 3C): the app, where it returns to, and what it may do.
  await page.goto(consentUrl.href);
  await expect(page.getByRole("heading", { level: 1, name: `${app.name} wants to use your AI Multi account` })).toBeVisible();
  await expect(page.getByText("localhost", { exact: true })).toBeVisible();
  await expect(page.getByText("It runs on your computer. Allow it only if you started connecting it just now.")).toBeVisible();
  await expect(page.getByText("See your tasks, projects, calendar, notes and goals")).toBeVisible();
  const write = page.getByRole("checkbox", { name: /Create, change and delete tasks, events and notes/ });
  await expect(write).toBeChecked();
  await expect(page.getByText("It can't see your password.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "nothing scrolls sideways").toBe(true);
  expect(await axeViolations(page)).toEqual([]);

  // All by keyboard: the box ticks and unticks, and Enter on Allow sends the person back.
  await write.focus();
  await page.keyboard.press("Space");
  await expect(page.getByText(`${app.name} will only read your work.`)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByText(`${app.name} will read and change your work.`)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Allow", exact: true })).toBeFocused();
  const callback = nextCallback(page);
  await page.keyboard.press("Enter");
  const answer = await callback;
  expect(answer.searchParams.get("state")).toBe(app.appState);
  expect(answer.searchParams.get("iss")).toBe(origin);
  const code = answer.searchParams.get("code")!;
  expect(code).toMatch(/^aim_ac_/);

  // The SDK checks iss (RFC 9207) and trades the code, with its PKCE secret and the resource.
  expect(await auth(app, { serverUrl, authorizationCode: code, iss: answer.searchParams.get("iss")! })).toBe("AUTHORIZED");
  const first = app.saved!;
  expect(first.scope?.split(" ").sort()).toEqual(["offline_access", "read", "write"]);
  expect(first.refresh_token).toMatch(/^aim_rt_/);
  // Codes and refresh tokens are kept only as hashes.
  const [, firstSecret] = first.refresh_token!.slice("aim_rt_".length).split(".");
  expect((await queryDatabase(`SELECT 1 FROM "McpRefreshToken" WHERE "tokenHash" = $1`, [sha256(firstSecret)])).rowCount).toBe(1);
  expect((await queryDatabase(`SELECT 1 FROM "McpAuthorizationCode" WHERE "codeHash" = $1 AND "usedAt" IS NOT NULL`, [sha256(code)])).rowCount).toBe(1);

  const client = await mcpClient(baseURL!, app);
  try {
    expect(await listProjects(client)).toMatchObject({ isError: false });

    // A refresh gives a new refresh token for the same device.
    expect(await auth(app, { serverUrl })).toBe("AUTHORIZED");
    const second = app.saved!;
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.refresh_token!.split(".")[0]).toBe(first.refresh_token!.split(".")[0]);
    expect(await listProjects(client)).toMatchObject({ isError: false });

    // The old one coming back means a copy is out there: the app is disconnected, and neither works.
    const reused = await refreshWith(request, app.information!.client_id, first.refresh_token!);
    expect(reused.status()).toBe(400);
    expect(await reused.json()).toMatchObject({ error: "invalid_grant" });
    expect((await refreshWith(request, app.information!.client_id, second.refresh_token!)).status()).toBe(400);
    const grants = await queryDatabase<{ revokedAt: Date | null }>(`SELECT "revokedAt" FROM "McpGrant" WHERE "clientId" = $1`, [app.information!.client_id]);
    expect(grants.rows).toHaveLength(1);
    expect(grants.rows[0].revokedAt).not.toBeNull();
    const refused = await listProjects(client);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("disconnected");
  } finally {
    await client.close();
  }
});

test("Connected apps lists the app with when it connected and was last used, and Disconnect stops it at once", async ({ page, request, baseURL, isMobile }) => {
  await signUpAndLogIn(page, "Connected apps");
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  const { name, clientId } = await registerApp(request);
  const { path, verifier } = consentLink(clientId);
  await page.goto(path);
  const callback = nextCallback(page);
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  const tokens = await tradeCode(request, clientId, (await callback).searchParams.get("code")!, verifier);
  const client = await mcpClient(baseURL!, { token: async () => tokens.access_token });

  try {
    expect(await listProjects(client)).toMatchObject({ isError: false });

    await page.goto("/integrations");
    const connected = page.getByRole("region", { name: "Connected apps" });
    const row = connected.getByRole("listitem").filter({ hasText: name });
    await expect(row).toBeVisible();
    if (isMobile) await expect(row.getByText("Connected Today · Last used Today")).toBeVisible();
    else {
      await expect(row.getByText("localhost", { exact: true })).toBeVisible();
      await expect(row.getByText("Today", { exact: true })).toHaveCount(2);
    }
    // An app the list doesn't know leaves every listed app in place.
    await expect(page.getByRole("region", { name: "AI assistants" }).getByRole("listitem")).toHaveCount(7);
    expect(await page.locator("#main-content").evaluate((main) => main.scrollWidth <= main.clientWidth)).toBe(true);
    expect(await axeViolations(page)).toEqual([]);

    await row.getByRole("button", { name: `Disconnect ${name}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Disconnect ${name}?` });
    await expect(dialog).toContainText(`${name} loses access to your AI Multi account right away.`);
    await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.getByText(`${name} is disconnected`)).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(connected).toHaveCount(0);

    // At once: the access token's next tool call is refused, and the refresh token is gone.
    const refused = await listProjects(client);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("disconnected");
    expect(await (await refreshWith(request, clientId, tokens.refresh_token)).json()).toMatchObject({ error: "invalid_grant" });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Connected apps" })).toHaveCount(0);
  } finally {
    await client.close();
  }
});

test("Cancel sends the app access_denied, and a code the app never got can't be guessed into tokens", async ({ page, request, baseURL }) => {
  await signUpAndLogIn(page, "OAuth cancel");
  const { clientId } = await registerApp(request);
  const { path } = consentLink(clientId, { scope: "read" });
  await page.goto(path);
  // An app that asks only to read gets no box to tick.
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText(/will only read your work\.$/)).toBeVisible();

  const callback = nextCallback(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const answer = await callback;
  expect(Object.fromEntries(answer.searchParams)).toMatchObject({ error: "access_denied", state: "e2e-state", iss: new URL(baseURL!).origin });
  expect(answer.searchParams.get("code")).toBeNull();
  const guessed = await request.post("/api/oauth/token", {
    form: { grant_type: "authorization_code", client_id: clientId, code: "aim_ac_guess", code_verifier: "a".repeat(43), redirect_uri: CALLBACK },
  });
  expect(guessed.status()).toBe(400);
  expect(await guessed.json()).toMatchObject({ error: "invalid_grant" });
});

test("a link that names an address the app didn't register stops on the page; other mistakes go back to the app", async ({ page, request }) => {
  await signUpAndLogIn(page, "OAuth bad link");
  let reachedElsewhere = false;
  await page.route("https://evil.example/**", (route) => {
    reachedElsewhere = true;
    return route.abort();
  });
  const { clientId } = await registerApp(request);

  await page.goto(consentLink(clientId, { redirect_uri: "https://evil.example/callback" }).path);
  await expect(page.getByRole("heading", { level: 1, name: "Can't connect this app" })).toBeVisible();
  await expect(page.getByText("This app asked to send you to an address it didn't register, so AI Multi stopped.")).toBeVisible();
  await page.goto(consentLink("aim_ci_nobody").path);
  await expect(page.getByText("This app isn't registered with AI Multi. Start connecting it again from the app.")).toBeVisible();
  expect(reachedElsewhere).toBe(false);

  // The page sends the error on in the browser, since it has started streaming (src/app/loading.tsx).
  const callback = nextCallback(page);
  await page.goto(consentLink(clientId, { scope: "read admin" }).path, { waitUntil: "commit" });
  expect(Object.fromEntries((await callback).searchParams)).toMatchObject({ error: "invalid_scope", state: "e2e-state" });
});

test("someone signed out logs in first and comes back to the consent page", async ({ browser, page }) => {
  const { email, password } = await signUpAndLogIn(page, "OAuth returning");
  const { name, clientId } = await registerApp(page.request);
  const { path } = consentLink(clientId);

  const visitorContext = await browser.newContext();
  try {
    const visitor = await visitorContext.newPage();
    await visitor.goto(path);
    await expect(visitor).toHaveURL(/\/login\?next=/);
    await visitor.getByLabel("Email or username").fill(email);
    await visitor.getByLabel("Password").fill(password);
    await visitor.getByRole("button", { name: "Log in" }).click();
    await expect(visitor.getByRole("heading", { level: 1, name: `${name} wants to use your AI Multi account` })).toBeVisible();
    const back = new URL(visitor.url());
    const sent = new URL(path, back.origin);
    expect(back.pathname).toBe(sent.pathname);
    expect(Object.fromEntries(back.searchParams)).toEqual(Object.fromEntries(sent.searchParams));
  } finally {
    await visitorContext.close();
  }
});

test("a guest is asked to sign up, since apps connect to an account, and can cancel", async ({ page, request }) => {
  await continueAsGuest(page);
  const { name, clientId } = await registerApp(request);
  await page.goto(consentLink(clientId).path);
  await expect(page.getByRole("heading", { level: 1, name: `${name} wants to use your AI Multi account` })).toBeVisible();
  await expect(page.getByText("Connecting AI apps needs a free account. Everything you made here comes with you.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Sign up free" }).click();
  const signUp = page.getByRole("dialog", { name: "Connecting AI apps needs a free account" });
  await expect(signUp).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(signUp).toBeHidden();

  const callback = nextCallback(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await callback).searchParams.get("error")).toBe("access_denied");
});

// The sign-up pop-up's Log in switches to the log-in pop-up (#543), which comes back here as the account.
test("a guest with an account logs in from the pop-up and comes back to the consent page", async ({ browser, baseURL, page, request }) => {
  const other = await browser.newContext({ baseURL });
  const { email, password } = await signUpAndLogIn(await other.newPage(), "OAuth guest login");
  await other.close();
  const { clientId } = await registerApp(request);
  const { path } = consentLink(clientId);

  await continueAsGuest(page);
  await page.goto(path);
  await page.getByRole("button", { name: "Sign up free" }).click();
  await page.getByRole("dialog", { name: "Connecting AI apps needs a free account" }).getByRole("button", { name: "Log in", exact: true }).click();
  const login = page.getByRole("dialog", { name: "Log in to AI Multi" });
  await login.getByLabel("Email or username").fill(email);
  await login.getByLabel("Password").fill(password);
  await login.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Allow" })).toBeVisible();
  const back = new URL(page.url());
  const sent = new URL(path, back.origin);
  expect(back.pathname).toBe(sent.pathname);
  expect(Object.fromEntries(back.searchParams)).toEqual(Object.fromEntries(sent.searchParams));
});
