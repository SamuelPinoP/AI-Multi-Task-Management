import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

const root = process.cwd();
const e2ePort = process.env.E2E_PORT || "3100";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${e2ePort}`;
const shouldStartServer = !process.env.PLAYWRIGHT_BASE_URL;
// "start" serves the production build (run `npm run build` first); CI uses it
// because a cold dev server compiles every route on first use.
const serverMode = process.env.E2E_SERVER_MODE === "start" ? "start" : "dev";

const e2eEnv = {
  ...process.env,
  EMAIL_PROVIDER: "disabled",
  GUEST_LOGIN_ENABLED: "true",
  PLAYWRIGHT_BASE_URL: baseURL,
  PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER: "local",
  PROJECT_CHAT_PUBLIC_UPLOAD_PATH: "/uploads/project-chat",
  PROJECT_CHAT_STORAGE_PROVIDER: "",
  PROJECT_CHAT_VIDEO_STORAGE_PROVIDER: "local",
  SIGNUP_ENABLED: "true",
  // The GitHub stand-in from tests/e2e/github-stub.ts (Playwright's global setup).
  GITHUB_API_URL: `http://127.0.0.1:${Number(e2ePort) + 1000}`,
  GITHUB_TOKEN: "",
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(server) {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error("The Next.js E2E server exited before it was ready.");
    }

    try {
      const response = await fetch(baseURL, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {}

    await delay(250);
  }

  throw new Error(`Timed out waiting for the E2E server at ${baseURL}.`);
}

async function stopServer(server) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;

  server.kill();
  const exited = await Promise.race([
    once(server, "exit").then(() => true),
    delay(5_000).then(() => false),
  ]);

  if (exited) return;

  if (process.platform === "win32" && server.pid) {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    server.kill("SIGKILL");
  }

  await Promise.race([once(server, "exit"), delay(5_000)]);
}

function pipeServerOutput(server) {
  server.stdout?.on("data", (chunk) => {
    process.stdout.write(`[E2E server] ${chunk}`);
  });
  server.stderr?.on("data", (chunk) => {
    process.stderr.write(`[E2E server] ${chunk}`);
  });
}

async function main() {
  let server = null;

  try {
    if (shouldStartServer) {
      const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
      server = spawn(
        process.execPath,
        [
          nextCli,
          ...(serverMode === "start" ? ["start"] : ["dev", "--webpack"]),
          "--hostname",
          "localhost",
          "--port",
          e2ePort,
        ],
        {
          cwd: root,
          env: e2eEnv,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      pipeServerOutput(server);
      await waitForServer(server);
    }

    const playwrightCli = path.join(root, "node_modules", "playwright", "cli.js");
    const testProcess = spawn(
      process.execPath,
      [playwrightCli, "test", ...process.argv.slice(2)],
      {
        cwd: root,
        env: e2eEnv,
        stdio: "inherit",
      },
    );

    const [code, signal] = await once(testProcess, "exit");
    if (signal) process.kill(process.pid, signal);
    process.exitCode = typeof code === "number" ? code : 1;
  } finally {
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
