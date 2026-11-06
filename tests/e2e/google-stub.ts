import { createHash } from "node:crypto";
import http from "node:http";

/**
 * Playwright global setup: a stand-in for Google's sign-in endpoints (#356), so
 * the Google tests never depend on accounts.google.com. The app reaches it
 * through GOOGLE_OAUTH_URL, which scripts/run-playwright-e2e.mjs and
 * playwright.config.ts set to http://127.0.0.1:<E2E port + 1001>, with the
 * client below. It keeps no state: the code it hands out carries the request.
 *
 * - /o/oauth2/v2/auth stands in for Google's account chooser. The account
 *   "picked" is the JSON claims in the `stub_account` cookie that a test sets
 *   for this host; `stub_error` (such as "access_denied") cancels instead.
 * - /token checks the code, client, secret, redirect address and PKCE verifier
 *   the way Google does, then returns an ID token for that account. The
 *   account's claims can override any other (nonce, aud, iss, exp,
 *   email_verified), to test the app's own checks.
 */
export const GOOGLE_STUB_CLIENT_ID = "e2e-client.apps.googleusercontent.com";
export const GOOGLE_STUB_CLIENT_SECRET = "e2e-client-secret";

export function googleStubUrl() {
  return `http://127.0.0.1:${Number(process.env.E2E_PORT || "3100") + 1001}`;
}

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function cookie(request: http.IncomingMessage, name: string) {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

type Grant = { account: Record<string, unknown>; clientId: string | null; redirectUri: string; nonce: string | null; challenge: string | null; method: string | null };

function authorize(request: http.IncomingMessage, url: URL, response: http.ServerResponse) {
  const redirectUri = url.searchParams.get("redirect_uri");
  if (!redirectUri) {
    response.writeHead(400).end("redirect_uri is required");
    return;
  }
  const back = new URL(redirectUri);
  back.searchParams.set("state", url.searchParams.get("state") ?? "");
  const error = cookie(request, "stub_error");
  if (error) {
    back.searchParams.set("error", error);
  } else {
    const grant: Grant = {
      account: JSON.parse(cookie(request, "stub_account") ?? "{}") as Record<string, unknown>,
      clientId: url.searchParams.get("client_id"),
      redirectUri,
      nonce: url.searchParams.get("nonce"),
      challenge: url.searchParams.get("code_challenge"),
      method: url.searchParams.get("code_challenge_method"),
    };
    back.searchParams.set("code", base64url(grant));
  }
  response.writeHead(302, { Location: back.toString() }).end();
}

function token(body: string, response: http.ServerResponse) {
  const form = new URLSearchParams(body);
  const json = (status: number, value: unknown) =>
    response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
  let grant: Grant;
  try {
    grant = JSON.parse(Buffer.from(form.get("code") ?? "", "base64url").toString("utf8")) as Grant;
  } catch {
    json(400, { error: "invalid_grant" });
    return;
  }
  const verifier = form.get("code_verifier") ?? "";
  const valid =
    form.get("grant_type") === "authorization_code" &&
    form.get("client_id") === GOOGLE_STUB_CLIENT_ID &&
    form.get("client_secret") === GOOGLE_STUB_CLIENT_SECRET &&
    grant.clientId === GOOGLE_STUB_CLIENT_ID &&
    form.get("redirect_uri") === grant.redirectUri &&
    grant.method === "S256" &&
    createHash("sha256").update(verifier).digest("base64url") === grant.challenge;
  if (!valid) {
    json(400, { error: "invalid_grant" });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "https://accounts.google.com",
    aud: GOOGLE_STUB_CLIENT_ID,
    iat: now,
    exp: now + 3600,
    nonce: grant.nonce,
    email_verified: true,
    ...grant.account,
  };
  json(200, {
    access_token: "stub-access-token",
    expires_in: 3599,
    token_type: "Bearer",
    scope: "openid email profile",
    id_token: `${base64url({ alg: "RS256", typ: "JWT" })}.${base64url(claims)}.stub-signature`,
  });
}

export default async function globalSetup() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://stub");
    if (request.method === "GET" && url.pathname === "/o/oauth2/v2/auth") {
      authorize(request, url, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/token") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => (body += chunk));
      request.on("end", () => token(body, response));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(new URL(googleStubUrl()).port), "127.0.0.1", resolve);
  });
  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}
