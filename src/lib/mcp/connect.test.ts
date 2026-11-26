// The Integrations page's pieces (#480): the switch, the address apps are given, each app's steps,
// the one-click install links, decoded the way Cursor and VS Code read them, and how Connected
// apps (#477) names and dates the apps already connected.
import assert from "node:assert/strict";
import test from "node:test";
import {
  appTile,
  configuredOrigin,
  connectApps,
  connectedAppDay,
  cursorInstallLink,
  EXAMPLE_REQUESTS,
  isMcpEnabled,
  knownApp,
  knownAppId,
  MCP_PATH,
  MCP_SERVER_NAME,
  originFromHeaders,
  vscodeInstallLink,
} from "./connect";
import { appOrigin, isMcpEnabled as endpointSwitch, MCP_PATH as endpointPath, MCP_SERVER_INFO } from "./handler";

const SERVER_URL = "https://ai-multi.example/api/mcp";
const headersOf = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

test("the endpoint, the page and its links share one switch, one path and one server name", () => {
  assert.equal(endpointSwitch, isMcpEnabled);
  assert.equal(endpointPath, MCP_PATH);
  assert.equal(MCP_PATH, "/api/mcp");
  assert.equal(MCP_SERVER_INFO.name, MCP_SERVER_NAME);
});

test("APP_BASE_URL gives the address when it's a web address", () => {
  assert.equal(configuredOrigin({ APP_BASE_URL: "https://ai-multi.example/" }), "https://ai-multi.example");
  assert.equal(configuredOrigin({ APP_BASE_URL: " https://ai-multi.example/some/path " }), "https://ai-multi.example");
  assert.equal(configuredOrigin({ APP_BASE_URL: "http://localhost:3000" }), "http://localhost:3000");
  for (const APP_BASE_URL of [undefined, "", "  ", "not a url", "localhost:3000", "ftp://ai-multi.example"]) {
    assert.equal(configuredOrigin({ APP_BASE_URL }), null, String(APP_BASE_URL));
  }
});

test("without APP_BASE_URL, the address is the one the request came in on, the first of each header", () => {
  assert.equal(originFromHeaders(headersOf({ host: "localhost:3100" })), "http://localhost:3100");
  assert.equal(
    originFromHeaders(headersOf({ host: "internal", "x-forwarded-host": "ai-multi.example, proxy.internal", "x-forwarded-proto": "https,http" })),
    "https://ai-multi.example",
  );
  assert.equal(originFromHeaders(headersOf({})), null);
});

test("the page shows the address the endpoint binds tokens to", () => {
  const configured = { APP_BASE_URL: "https://ai-multi.example" };
  assert.equal(configuredOrigin(configured), appOrigin(configured, new Request("http://10.0.0.1/api/mcp")));
  const forwarded = { "x-forwarded-host": "ai-multi.example", "x-forwarded-proto": "https" };
  assert.equal(originFromHeaders(headersOf(forwarded)), appOrigin({}, new Request("http://internal/api/mcp", { headers: forwarded })));
  // An APP_BASE_URL without its scheme falls back to the request's address, not to the origin "null".
  assert.equal(appOrigin({ APP_BASE_URL: "localhost:3000" }, new Request("http://localhost:3000/api/mcp")), "http://localhost:3000");
});

test("Add to Cursor opens Cursor's installer with the server's entry as base64 JSON", () => {
  // This address's base64 holds "+" and "=", which a query string would otherwise turn into a space and a separator.
  for (const url of [SERVER_URL, "https://a~b.example/api/mcp"]) {
    const link = new URL(cursorInstallLink(url));
    assert.equal(`${link.protocol}//${link.host}${link.pathname}`, "cursor://anysphere.cursor-deeplink/mcp/install");
    assert.equal(link.searchParams.get("name"), MCP_SERVER_NAME);
    assert.deepEqual(JSON.parse(atob(link.searchParams.get("config") ?? "")), { url });
  }
});

test("Add to VS Code opens VS Code's installer with an HTTP server entry as URL-encoded JSON", () => {
  const link = vscodeInstallLink(SERVER_URL);
  const prefix = "vscode:mcp/install?";
  assert.ok(link.startsWith(prefix));
  assert.deepEqual(JSON.parse(decodeURIComponent(link.slice(prefix.length))), { name: MCP_SERVER_NAME, type: "http", url: SERVER_URL });
});

test("every app gets three steps with the server's address, and nobody copies a key", () => {
  const apps = connectApps(SERVER_URL);
  assert.deepEqual(
    apps.map((app) => [app.name, app.action]),
    [
      ["Claude", "Connect"],
      ["ChatGPT", "Connect"],
      ["Claude Code", "Connect"],
      ["Codex", "Connect"],
      ["Cursor", "Add to Cursor"],
      ["VS Code", "Add to VS Code"],
      ["Other AI apps", "Connect"],
    ],
  );
  assert.equal(new Set(apps.map((app) => app.id)).size, apps.length, "ids name each row's steps");
  for (const app of apps) assert.equal(app.steps.length, 3, app.name);

  const app = (id: string) => apps.find((candidate) => candidate.id === id)!;
  const codes = (id: string) => app(id).steps.flatMap((step) => (step.code ? [step.code] : []));
  for (const id of ["claude", "chatgpt", "other"]) assert.deepEqual(codes(id), [SERVER_URL], id);
  assert.deepEqual(codes("claude-code"), [`claude mcp add --transport http ai-multi ${SERVER_URL}`]);
  assert.deepEqual(codes("codex"), [`codex mcp add ai-multi --url ${SERVER_URL}`, "codex mcp login ai-multi"]);
  assert.deepEqual(app("cursor").steps[0].install, { label: "Add to Cursor", href: cursorInstallLink(SERVER_URL) });
  assert.deepEqual(app("vscode").steps[0].install, { label: "Add to VS Code", href: vscodeInstallLink(SERVER_URL) });

  // Each ends with the consent page (#477), where the person clicks Allow.
  for (const { name, steps } of apps) assert.match(steps[2].text, /Allow/, name);
  assert.equal(EXAMPLE_REQUESTS.length, 3);
});

test("Connected apps knows the listed apps by the name they registered or the address they return to (#477)", () => {
  assert.equal(knownAppId({ name: "Claude Code (ai-multi)", address: "localhost" }), "claude-code");
  assert.equal(knownAppId({ name: "Codex", address: "localhost" }), "codex");
  assert.equal(knownAppId({ name: "Cursor", address: "cursor://anysphere.cursor-retrieval" }), "cursor");
  assert.equal(knownAppId({ name: "MCP client", address: "cursor://anysphere.cursor-retrieval" }), "cursor");
  assert.equal(knownAppId({ name: "Visual Studio Code", address: "localhost" }), "vscode");
  assert.equal(knownAppId({ name: "MCP client", address: "insiders.vscode.dev" }), "vscode");
  // Claude and ChatGPT are known only by their address, which their metadata documents prove.
  assert.equal(knownAppId({ name: "Claude", address: "claude.ai" }), "claude");
  assert.equal(knownAppId({ name: "ChatGPT", address: "chatgpt.com" }), "chatgpt");
  assert.equal(knownAppId({ name: "Claude", address: "claude.ai.evil.example" }), null);
  assert.equal(knownAppId({ name: "ChatGPT", address: "evil.example" }), null);
  assert.equal(knownAppId({ name: "Notes helper", address: null }), null);
  assert.equal(knownApp({ name: "Claude", address: "claude.ai" }, SERVER_URL)?.tile, "Cl");
  assert.equal(knownApp({ name: "Notes helper", address: "notes.example" }), null);
});

test("an app the list doesn't know gets its initials on its tile", () => {
  assert.equal(appTile("Example App"), "EA");
  assert.equal(appTile("notes"), "No");
  assert.equal(appTile("  Zed  "), "Ze");
  assert.equal(appTile("été app"), "ÉA");
  assert.equal(appTile("(beta) tool"), "To");
  assert.equal(appTile("---"), "+");
  assert.equal(appTile(""), "+");
});

test("Connected apps says when, in the person's time zone", () => {
  const today = "2026-11-25";
  assert.equal(connectedAppDay("2026-11-25T08:00:00.000Z", "UTC", today), "Today");
  assert.equal(connectedAppDay("2026-11-24T23:30:00.000Z", "UTC", today), "Yesterday");
  // 2 AM UTC on the 25th is still the 24th in New York.
  assert.equal(connectedAppDay("2026-11-25T02:00:00.000Z", "America/New_York", today), "Yesterday");
  assert.equal(connectedAppDay("2026-11-18T12:00:00.000Z", "UTC", today), "Nov 18");
  assert.equal(connectedAppDay("2025-11-18T12:00:00.000Z", "UTC", today), "Nov 18, 2025");
  assert.equal(connectedAppDay("2026-12-31T12:00:00.000Z", "UTC", "2027-01-01"), "Yesterday");
});
