// Connecting an AI app to AI Multi's MCP server (#480): the switch, the server's address, each
// app's steps and the install links Cursor and VS Code open. Nothing here loads the MCP SDK, so the
// root layout and the Integrations page can import it; the endpoint itself is in handler.ts.

type Env = Record<string, string | undefined>;

export const MCP_PATH = "/api/mcp";
/** The server's name in apps' lists, the terminal commands and the install links. */
export const MCP_SERVER_NAME = "ai-multi";

/** The switch: anything but "true" keeps the endpoint, the Integrations page and every link to it off. */
export function isMcpEnabled(env: Env) {
  return env.MCP_ENABLED?.trim() === "true";
}

/** APP_BASE_URL's origin, or null when it's unset or not a web address (the deploy check warns about that). */
export function configuredOrigin(env: Env): string | null {
  const configured = env.APP_BASE_URL?.trim();
  if (!configured) return null;
  try {
    const { origin, protocol } = new URL(configured);
    return protocol === "https:" || protocol === "http:" ? origin : null;
  } catch {
    return null;
  }
}

/** The address a request came in on, from the headers Vercel and `next start` set; null without a host. */
export function originFromHeaders(headers: { get(name: string): string | null }): string | null {
  const first = (value: string | null | undefined) => value?.split(",")[0]?.trim() || null;
  const host = first(headers.get("x-forwarded-host")) ?? first(headers.get("host"));
  return host ? `${first(headers.get("x-forwarded-proto")) ?? "http"}://${host}` : null;
}

/** Cursor's one-click install: the server's entry as base64 JSON (https://cursor.com/docs/mcp/install-links). */
export function cursorInstallLink(serverUrl: string) {
  const config = btoa(JSON.stringify({ url: serverUrl }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(config)}`;
}

/** VS Code's one-click install: the server's entry as URL-encoded JSON (https://code.visualstudio.com/api/extension-guides/ai/mcp). */
export function vscodeInstallLink(serverUrl: string) {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: MCP_SERVER_NAME, type: "http", url: serverUrl }))}`;
}

export type ConnectStep = {
  text: string;
  /** A command, or the server's address, shown with Copy. */
  code?: string;
  /** A one-click install link. */
  install?: { label: string; href: string };
};

export type ConnectApp = {
  id: string;
  /** Letters on the row's tile, rather than the apps' logos. */
  tile: string;
  name: string;
  description: string;
  /** The row's button on computers; on phones every row says Connect. */
  action: string;
  steps: ConnectStep[];
};

/** Requests that work with the read tools apps get today (#478); the first ends every app's steps. */
export const EXAMPLE_REQUESTS = ["What's due this week?", "What's on my calendar tomorrow?", "How am I doing on this week's goals?"] as const;

const ALLOW = "Click Allow on the AI Multi page that opens in your browser.";

/**
 * Each app's steps, checked against its own docs (November 2026): Claude's custom connectors,
 * ChatGPT's developer mode, `claude mcp add` and `codex mcp add`, and Cursor's and VS Code's install
 * links. Every app signs in with OAuth, so nobody copies a key.
 */
export function connectApps(serverUrl: string): ConnectApp[] {
  return [
    {
      id: "claude",
      tile: "Cl",
      name: "Claude",
      description: "Claude on the web, the desktop app and phones",
      action: "Connect",
      steps: [
        { text: "In Claude, open Settings, then Connectors, and click Add custom connector." },
        { text: "Name it AI Multi and paste the server address:", code: serverUrl },
        { text: "Click Add, then Connect, and click Allow on the AI Multi page that opens." },
      ],
    },
    {
      id: "chatgpt",
      tile: "Ch",
      name: "ChatGPT",
      description: "Add AI Multi as an app in developer mode",
      action: "Connect",
      steps: [
        { text: "In ChatGPT, open Settings, then Apps, then Advanced settings, and turn on Developer mode." },
        { text: "Click Create app, name it AI Multi and paste the server address:", code: serverUrl },
        { text: "Choose OAuth, click Create, and click Allow on the AI Multi page that opens." },
      ],
    },
    {
      id: "claude-code",
      tile: "CC",
      name: "Claude Code",
      description: "Anthropic's coding agent, in your terminal",
      action: "Connect",
      steps: [
        { text: "Run this in your terminal:", code: `claude mcp add --transport http ${MCP_SERVER_NAME} ${serverUrl}` },
        { text: `In Claude Code, type /mcp, pick ${MCP_SERVER_NAME} and choose Authenticate.` },
        { text: ALLOW },
      ],
    },
    {
      id: "codex",
      tile: "Cx",
      name: "Codex",
      description: "OpenAI's coding agent, in your terminal",
      action: "Connect",
      steps: [
        { text: "Run this in your terminal:", code: `codex mcp add ${MCP_SERVER_NAME} --url ${serverUrl}` },
        { text: "Then sign in:", code: `codex mcp login ${MCP_SERVER_NAME}` },
        { text: ALLOW },
      ],
    },
    {
      id: "cursor",
      tile: "Cu",
      name: "Cursor",
      description: "One click adds AI Multi to Cursor",
      action: "Add to Cursor",
      steps: [
        { text: "Click Add to Cursor. Cursor opens and asks to install AI Multi.", install: { label: "Add to Cursor", href: cursorInstallLink(serverUrl) } },
        { text: `Click Install, then Connect beside ${MCP_SERVER_NAME}.` },
        { text: ALLOW },
      ],
    },
    {
      id: "vscode",
      tile: "VS",
      name: "VS Code",
      description: "One click adds AI Multi to Copilot's agent mode",
      action: "Add to VS Code",
      steps: [
        { text: "Click Add to VS Code. VS Code opens and asks to install AI Multi.", install: { label: "Add to VS Code", href: vscodeInstallLink(serverUrl) } },
        { text: `Click Install, then Start beside ${MCP_SERVER_NAME} in the list of MCP servers.` },
        { text: "Click Allow on the AI Multi page, then ask Copilot in agent mode." },
      ],
    },
    {
      id: "other",
      tile: "+",
      name: "Other AI apps",
      description: "Gemini CLI, Windsurf, Zed and any app that connects to MCP servers",
      action: "Connect",
      steps: [
        { text: "In the app, add a remote MCP server and paste the server address:", code: serverUrl },
        { text: "If it asks how to sign in, choose OAuth. There is no key to copy." },
        { text: "Click Allow on the AI Multi page that opens." },
      ],
    },
  ];
}
