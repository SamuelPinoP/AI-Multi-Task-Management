// Sign-in's endpoints for AI apps (#477), end to end with the tables kept in memory: the consent
// page's Allow and Cancel, codes (single use, PKCE, exact redirects), refresh tokens (rotation, reuse,
// narrower scopes, expiry), client authentication, registration, revocation and the rate limits.
import assert from "node:assert/strict";
import test from "node:test";
import { verifyAccessToken } from "./access-token";
import type { ClientMetadataResolver, ClientMetadataResult } from "./client-metadata";
import { FATAL_PROBLEMS, hashSecret, type OAuthApp } from "./oauth";
import { createOAuthServer } from "./oauth-server";
import { mayConnectApps, type AccountCheck, type NewAuthorizationCode, type NewRefreshToken, type OAuthStore, type RegisteredClient } from "./oauth-store";

const ORIGIN = "https://ai-multi.example";
const RESOURCE = `${ORIGIN}/api/mcp`;
const SECRET = "test-secret-that-is-long-enough-0123456789";
const ENV = { MCP_ENABLED: "true", MCP_TOKEN_SECRET: SECRET, APP_BASE_URL: ORIGIN };
const START = Date.parse("2026-11-25T12:00:00.000Z");
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
// RFC 7636, appendix B.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const APP: OAuthApp = {
  id: "https://app.example/oauth/client.json",
  name: "Example App",
  redirectUris: ["https://app.example/oauth/callback", "http://127.0.0.1/callback"],
};
const [APP_REDIRECT] = APP.redirectUris;
const OTHER_APP_ID = "https://other.example/oauth/client.json";
const IP = "198.51.100.7";

type Grant = { id: string; userId: string; clientId: string; clientName: string; clientAddress: string; scopes: string[]; revokedAt: Date | null };

/** The tables, kept in memory, doing what prismaOAuthStore's queries do. */
function memoryStore(accounts: Map<string, AccountCheck>) {
  const clients = new Map<string, RegisteredClient>();
  const codes = new Map<string, NewAuthorizationCode & { usedAt: Date | null; grantId: string | null }>();
  const grants = new Map<string, Grant>();
  const refreshTokens = new Map<string, NewRefreshToken & { grantId: string; createdAt: Date }>();
  const allowed = (userId: string) => mayConnectApps(accounts.get(userId)!);
  const revoke = (grantId: string, now: Date) => {
    const grant = grants.get(grantId);
    if (grant && !grant.revokedAt) grant.revokedAt = now;
  };

  const store: OAuthStore = {
    findClient: async (id) => clients.get(id) ?? null,
    createClient: async (client) => void clients.set(client.id, client),
    createCode: async (code) => void codes.set(code.codeHash, { ...code, usedAt: null, grantId: null }),
    async findCode(codeHash) {
      const code = codes.get(codeHash);
      return code ? { ...code, accountAllowed: allowed(code.userId) } : null;
    },
    async claimCode(codeHash, now) {
      const code = codes.get(codeHash);
      if (!code || code.usedAt) return false;
      code.usedAt = now;
      return true;
    },
    async connect({ codeHash, userId, clientId, clientName, clientAddress, scopes, refreshToken, now }) {
      let grant = [...grants.values()].find((row) => row.userId === userId && row.clientId === clientId && !row.revokedAt);
      if (grant) Object.assign(grant, { clientName, clientAddress, scopes: [...new Set([...grant.scopes, ...scopes])] });
      else {
        grant = { id: `grant-${grants.size + 1}`, userId, clientId, clientName, clientAddress, scopes, revokedAt: null };
        grants.set(grant.id, grant);
      }
      refreshTokens.set(refreshToken.id, { ...refreshToken, grantId: grant.id, createdAt: now });
      codes.get(codeHash)!.grantId = grant.id;
      return { grantId: grant.id };
    },
    async findRefreshToken(id) {
      const token = refreshTokens.get(id);
      if (!token) return null;
      const grant = grants.get(token.grantId)!;
      return { ...token, grant: { userId: grant.userId, clientId: grant.clientId, revoked: Boolean(grant.revokedAt), accountAllowed: allowed(grant.userId) } };
    },
    async rotateRefreshToken({ id, oldHash, newHash, expiresAt }) {
      const token = refreshTokens.get(id);
      if (!token || token.tokenHash !== oldHash) return false;
      Object.assign(token, { tokenHash: newHash, expiresAt });
      return true;
    },
    async disconnectDevice({ refreshTokenId, grantId, now }) {
      refreshTokens.delete(refreshTokenId);
      if (![...refreshTokens.values()].some((token) => token.grantId === grantId && token.expiresAt > now)) revoke(grantId, now);
    },
    async revokeGrant(grantId, now) {
      revoke(grantId, now);
      for (const [id, token] of refreshTokens) if (token.grantId === grantId) refreshTokens.delete(id);
    },
  };
  return { store, clients, codes, grants, refreshTokens };
}

/** AI Multi's sign-in on a clock the test moves, with accounts, one app's metadata document and rate limits it controls. */
function setup({ env = ENV as Record<string, string | undefined> } = {}) {
  let clock = START;
  const accounts = new Map<string, AccountCheck>([
    ["person", { isGuest: false, emailVerifiedAt: new Date(START - DAY) }],
    ["guest", { isGuest: true, emailVerifiedAt: null }],
    ["unconfirmed", { isGuest: false, emailVerifiedAt: null }],
  ]);
  const memory = memoryStore(accounts);
  const documents = new Map<string, ClientMetadataResult>([[APP.id, { ok: true, app: APP }]]);
  const fetched: string[] = [];
  const resolveClientMetadata: ClientMetadataResolver = async (clientId) => {
    fetched.push(clientId);
    return documents.get(clientId) ?? { ok: false, problem: "unreachable", detail: "No such document." };
  };
  const limited = new Set<string>();
  const counted: Array<[string, string | null]> = [];
  const server = createOAuthServer({
    env,
    store: memory.store,
    resolveClientMetadata,
    rateLimit: async (rule, identifier) => {
      counted.push([rule.name, identifier]);
      return { allowed: !limited.has(rule.name), retryAfterSeconds: 120 };
    },
    now: () => new Date(clock),
  });
  return {
    server,
    ...memory,
    accounts,
    documents,
    fetched,
    limited,
    counted,
    now: () => new Date(clock),
    advance: (ms: number) => void (clock += ms),
    /** The consent page's session: this account, or signed out. */
    as: (userId: string | null) => async () => (userId ? { id: userId, ...accounts.get(userId)! } : null),
  };
}
type Site = ReturnType<typeof setup>;

/** A consent link as the app builds it; null leaves a parameter out. */
function consentLink(overrides: Record<string, string | null> = {}) {
  const values: Record<string, string | null> = {
    client_id: APP.id,
    redirect_uri: APP_REDIRECT,
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "state-123",
    scope: "read write",
    resource: RESOURCE,
    ...overrides,
  };
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) if (value !== null) params.set(name, value);
  return params;
}

/** The consent page's form: the link's parameters as hidden fields, and the button clicked. */
function consentPost(link: URLSearchParams, choice: Record<string, string>, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  const body = new URLSearchParams(link);
  for (const [name, value] of Object.entries(choice)) body.append(name, value);
  return new Request(`${ORIGIN}/api/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: body.toString(),
  });
}

/** An app's form post to the token or revoke endpoint; null leaves a field out. */
function post(path: string, fields: Record<string, string | null>, headers: Record<string, string> = {}) {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) if (value !== null) body.set(name, value);
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": IP, ...headers },
    body: body.toString(),
  });
}

const register = (site: Site, body: unknown, headers: Record<string, string> = {}) =>
  site.server.register(
    new Request(`${ORIGIN}/api/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": IP, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

/** Allow on the consent page: where the person is sent, and the code in it. */
async function allow(site: Site, { link = consentLink(), write = true, user = "person" } = {}) {
  const response = await site.server.decide(consentPost(link, { decision: "allow", ...(write ? { write: "on" } : {}) }), site.as(user));
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location")!, ORIGIN);
  return { location, code: location.searchParams.get("code")! };
}

const exchange = (site: Site, code: string, fields: Record<string, string | null> = {}, headers?: Record<string, string>) =>
  site.server.token(
    post("/api/oauth/token", { grant_type: "authorization_code", client_id: APP.id, code, code_verifier: VERIFIER, redirect_uri: APP_REDIRECT, ...fields }, headers),
  );

const refresh = (site: Site, refreshToken: string, fields: Record<string, string | null> = {}, headers?: Record<string, string>) =>
  site.server.token(post("/api/oauth/token", { grant_type: "refresh_token", client_id: APP.id, refresh_token: refreshToken, ...fields }, headers));

type Tokens = { access_token: string; token_type: string; expires_in: number; refresh_token: string; scope: string };

/** Connects the app for the person: Allow, then the code for tokens. */
async function connect(site: Site, options: Parameters<typeof allow>[1] = {}) {
  const { code } = await allow(site, options);
  const response = await exchange(site, code);
  assert.equal(response.status, 200);
  return (await response.json()) as Tokens;
}

const tokensOf = async (response: Response) => {
  assert.equal(response.status, 200);
  return (await response.json()) as Tokens;
};
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error;
function claimsOf(site: Site, accessToken: string) {
  const check = verifyAccessToken(accessToken, { secret: SECRET, resource: RESOURCE, now: site.now() });
  assert.ok(check.ok);
  return check.claims;
}
const onlyGrant = (site: Site) => {
  assert.equal(site.grants.size, 1);
  return [...site.grants.values()][0];
};

test("everything answers 404 while MCP_ENABLED is off", async () => {
  const site = setup({ env: { ...ENV, MCP_ENABLED: "false" } });
  const get = new Request(`${ORIGIN}/.well-known/oauth-authorization-server`);
  const responses = [
    site.server.authorizationServerMetadata(get),
    site.server.protectedResourceMetadata(get),
    await site.server.decide(consentPost(consentLink(), { decision: "allow" }), site.as("person")),
    await refresh(site, "aim_rt_a.b"),
    await register(site, { redirect_uris: [APP_REDIRECT] }),
    await site.server.revoke(post("/api/oauth/revoke", { client_id: APP.id, token: "aim_rt_a.b" })),
  ];
  assert.deepEqual(
    responses.map((response) => response.status),
    [404, 404, 404, 404, 404, 404],
  );
  assert.equal(site.counted.length, 0);
});

test("the metadata documents name this server, for any site to read", async () => {
  const site = setup();
  const server = site.server.authorizationServerMetadata(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`));
  assert.equal(server.headers.get("access-control-allow-origin"), "*");
  assert.equal(server.headers.get("cache-control"), "public, max-age=3600");
  const metadata = await server.json();
  assert.equal(metadata.issuer, ORIGIN);
  assert.equal(metadata.authorization_endpoint, `${ORIGIN}/oauth/authorize`);
  const resource = await site.server.protectedResourceMetadata(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`)).json();
  assert.equal(resource.resource, RESOURCE);
  assert.deepEqual(resource.authorization_servers, [ORIGIN]);

  // Without APP_BASE_URL, the address the request came in on, as on the Integrations page.
  const preview = setup({ env: { MCP_ENABLED: "true", MCP_TOKEN_SECRET: SECRET } });
  const request = new Request("http://internal/.well-known/oauth-authorization-server", {
    headers: { "x-forwarded-host": "preview.example", "x-forwarded-proto": "https" },
  });
  assert.equal((await preview.server.authorizationServerMetadata(request).json()).issuer, "https://preview.example");
  assert.equal((await preview.server.protectedResourceMetadata(request).json()).resource, "https://preview.example/api/mcp");
});

test("the consent page reads the app from its document, and shows where the person returns to", async () => {
  const site = setup();
  assert.deepEqual(await site.server.prepareConsent(consentLink(), { origin: ORIGIN, ip: IP }), {
    kind: "consent",
    request: {
      clientId: APP.id,
      redirectUri: APP_REDIRECT,
      redirectUriSent: true,
      codeChallenge: CHALLENGE,
      scopes: ["read", "write"],
      state: "state-123",
      resource: RESOURCE,
    },
    app: { name: "Example App", address: "app.example", loopback: false },
  });
  assert.deepEqual(site.counted, [
    ["oauth-ip", IP],
    ["oauth-client", APP.id],
  ]);
  const desktop = await site.server.prepareConsent(consentLink({ redirect_uri: "http://127.0.0.1:50123/callback" }), { origin: ORIGIN, ip: IP });
  assert.ok(desktop.kind === "consent");
  assert.deepEqual(desktop.app, { name: "Example App", address: "localhost", loopback: true });
});

test("a link from an app AI Multi can't read or trust stops on the page", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const site = setup();
  const check = (params: URLSearchParams) => site.server.prepareConsent(params, { origin: ORIGIN, ip: IP });
  const fatal = (message: string) => ({ kind: "fatal", message });
  assert.deepEqual(await check(consentLink({ client_id: null })), fatal(FATAL_PROBLEMS.missingClient));
  assert.deepEqual(await check(consentLink({ client_id: "aim_ci_nobody" })), fatal(FATAL_PROBLEMS.unknownClient));
  assert.deepEqual(await check(consentLink({ client_id: "some-app" })), fatal(FATAL_PROBLEMS.unknownClient));
  assert.deepEqual(await check(consentLink({ client_id: OTHER_APP_ID })), fatal(FATAL_PROBLEMS.unreadableClient));
  assert.equal(warn.mock.calls[0].arguments[0], "mcp_client_metadata_failed");
  assert.deepEqual(await check(consentLink({ redirect_uri: "https://evil.example/callback" })), fatal(FATAL_PROBLEMS.badRedirect));

  // Once the address is the app's own, other mistakes go back to it.
  const wrongScope = await check(consentLink({ scope: "admin" }));
  assert.ok(wrongScope.kind === "redirect");
  const back = new URL(wrongScope.location);
  assert.equal(`${back.origin}${back.pathname}`, APP_REDIRECT);
  assert.deepEqual([back.searchParams.get("error"), back.searchParams.get("state"), back.searchParams.get("iss")], ["invalid_scope", "state-123", ORIGIN]);

  // Too many tries: the page says so, and nothing is fetched.
  site.limited.add("oauth-client");
  const fetchedBefore = site.fetched.length;
  assert.deepEqual(await check(consentLink({ client_id: "https://third.example/client.json" })), fatal(FATAL_PROBLEMS.tooMany));
  assert.equal(site.fetched.length, fetchedBefore);
});

test("Allow sends the app back with a five-minute code; Cancel with access_denied", async () => {
  const site = setup();
  const { location, code } = await allow(site);
  assert.equal(`${location.origin}${location.pathname}`, APP_REDIRECT);
  assert.match(code, /^aim_ac_[A-Za-z0-9_-]{43}$/);
  assert.equal(location.searchParams.get("state"), "state-123");
  assert.equal(location.searchParams.get("iss"), ORIGIN);
  // Only its hash is kept, with what the person allowed and the app as the page showed it.
  const [stored] = site.codes.values();
  assert.equal(stored.codeHash, hashSecret(code));
  assert.deepEqual(
    { userId: stored.userId, clientName: stored.clientName, clientAddress: stored.clientAddress, scopes: stored.scopes, resource: stored.resource },
    { userId: "person", clientName: "Example App", clientAddress: "app.example", scopes: ["read", "write"], resource: RESOURCE },
  );
  assert.equal(stored.expiresAt.getTime(), START + 5 * MINUTE);

  const cancelled = await site.server.decide(consentPost(consentLink(), { decision: "cancel" }), site.as("person"));
  assert.equal(cancelled.status, 303);
  const back = new URL(cancelled.headers.get("location")!);
  assert.equal(`${back.origin}${back.pathname}`, APP_REDIRECT);
  assert.deepEqual(Object.fromEntries(back.searchParams), { error: "access_denied", error_description: "The person clicked Cancel.", state: "state-123", iss: ORIGIN });
  assert.equal(site.codes.size, 1);
});

test("without the write box ticked, or when the app asked only to read, the code can only read", async () => {
  const site = setup();
  await allow(site, { write: false });
  // A write box added to the form doesn't add what the app didn't ask for.
  await allow(site, { link: consentLink({ scope: "read" }), write: true });
  assert.deepEqual(
    [...site.codes.values()].map((code) => code.scopes),
    [["read"], ["read"]],
  );
});

test("signed-out people sign in first, unconfirmed emails are confirmed first, and both come back", async () => {
  const site = setup();
  const link = consentLink();
  const signedOut = await site.server.decide(consentPost(link, { decision: "allow", write: "on" }), site.as(null));
  assert.equal(signedOut.status, 303);
  const login = new URL(signedOut.headers.get("location")!, ORIGIN);
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("next"), `/oauth/authorize?${link}`);

  const unconfirmed = await site.server.decide(consentPost(link, { decision: "allow" }), site.as("unconfirmed"));
  const confirm = new URL(unconfirmed.headers.get("location")!, ORIGIN);
  assert.equal(confirm.pathname, "/verify-email");
  assert.equal(confirm.searchParams.get("next"), `/oauth/authorize?${link}`);
  assert.equal(site.codes.size, 0);
});

test("guests can cancel, but Allow takes them back to the page that asks them to sign up", async () => {
  const site = setup();
  const allowed = await site.server.decide(consentPost(consentLink(), { decision: "allow", write: "on" }), site.as("guest"));
  assert.equal(allowed.status, 303);
  assert.equal(allowed.headers.get("location"), `/oauth/authorize?${consentLink()}`);
  assert.equal(site.codes.size, 0);
  const cancelled = await site.server.decide(consentPost(consentLink(), { decision: "cancel" }), site.as("guest"));
  assert.equal(new URL(cancelled.headers.get("location")!).searchParams.get("error"), "access_denied");
});

test("Allow and Cancel work only from AI Multi's own page, and check the link again", async () => {
  const site = setup();
  const elsewhere: Array<Record<string, string>> = [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { origin: "https://evil.example", host: "ai-multi.example" }, {}];
  for (const headers of elsewhere) {
    const response = await site.server.decide(consentPost(consentLink(), { decision: "allow", write: "on" }, headers), site.as("person"));
    assert.equal(response.status, 403, JSON.stringify(headers));
  }
  assert.equal(site.codes.size, 0);
  // Browsers without Sec-Fetch-Site send an Origin.
  const fromOrigin = await site.server.decide(consentPost(consentLink(), { decision: "allow" }, { origin: ORIGIN, host: "ai-multi.example" }), site.as("person"));
  assert.equal(fromOrigin.status, 303);
  assert.equal(site.codes.size, 1);

  const notAForm = new Request(`${ORIGIN}/api/oauth/authorize`, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: "{}" });
  assert.equal((await site.server.decide(notAForm, site.as("person"))).status, 400);
  assert.equal((await site.server.decide(consentPost(consentLink(), {}), site.as("person"))).status, 400);
  // A form whose link was changed to another address goes back to the page, which says why.
  const changed = await site.server.decide(consentPost(consentLink({ redirect_uri: "https://evil.example/callback" }), { decision: "allow" }), site.as("person"));
  assert.equal(new URL(changed.headers.get("location")!, ORIGIN).pathname, "/oauth/authorize");
  assert.equal(site.codes.size, 1);
});

test("an app trades its code and PKCE secret for an hour's access token and a refresh token", async () => {
  const site = setup();
  const { code } = await allow(site);
  const response = await exchange(site, code);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const tokens = await tokensOf(response);
  assert.equal(tokens.token_type, "Bearer");
  assert.equal(tokens.expires_in, 3600);
  assert.equal(tokens.scope, "read write offline_access");
  assert.match(tokens.refresh_token, /^aim_rt_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const grant = onlyGrant(site);
  const claims = claimsOf(site, tokens.access_token);
  assert.deepEqual(
    { userId: claims.userId, grantId: claims.grantId, clientId: claims.clientId, scopes: claims.scopes, resource: claims.resource },
    { userId: "person", grantId: grant.id, clientId: APP.id, scopes: ["read", "write"], resource: RESOURCE },
  );
  assert.deepEqual(
    { clientName: grant.clientName, clientAddress: grant.clientAddress, scopes: grant.scopes },
    { clientName: "Example App", clientAddress: "app.example", scopes: ["read", "write"] },
  );
  // The device's refresh token is kept as a hash, for 30 days unless it's used.
  const [device] = site.refreshTokens.values();
  assert.equal(device.tokenHash, hashSecret(tokens.refresh_token.split(".")[1]));
  assert.equal(device.expiresAt.getTime(), START + 30 * DAY);
});

test("a code works once: using it again fails and disconnects what the first use got", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const site = setup();
  const { code } = await allow(site);
  const first = await tokensOf(await exchange(site, code));
  const again = await exchange(site, code);
  assert.equal(again.status, 400);
  assert.equal(await errorOf(again), "invalid_grant");
  assert.equal(onlyGrant(site).revokedAt?.getTime(), START);
  assert.equal(await errorOf(await refresh(site, first.refresh_token)), "invalid_grant");
  assert.equal(warn.mock.calls[0].arguments[0], "mcp_code_reused");
});

test("a code is for one app, one address and one PKCE secret, for five minutes", async () => {
  const site = setup();
  const refused = async (code: string, fields: Record<string, string | null>, error = "invalid_grant") => {
    const response = await exchange(site, code, fields);
    assert.equal(response.status, 400, JSON.stringify(fields));
    assert.equal(await errorOf(response), error, JSON.stringify(fields));
  };
  const { code } = await allow(site);
  await refused(code, { code_verifier: "a".repeat(43) });
  await refused(code, { code_verifier: CHALLENGE });
  await refused(code, { code_verifier: null }, "invalid_request");
  await refused(code, { client_id: OTHER_APP_ID });
  await refused(code, { redirect_uri: "https://app.example/oauth/callback/" });
  // The consent link named the address, so the token request must too (OAuth 2.1, section 4.1.3).
  await refused(code, { redirect_uri: null });
  await refused(code, { resource: "https://other.example/api/mcp" }, "invalid_target");
  await refused("aim_ac_made-up", {});
  // None of those used the code up.
  await tokensOf(await exchange(site, code, { resource: `${RESOURCE}/` }));

  const late = await allow(site);
  site.advance(5 * MINUTE);
  await refused(late.code, {});

  // An app with one address may leave it out of both requests.
  const single = setup();
  single.documents.set(APP.id, { ok: true, app: { ...APP, redirectUris: [APP_REDIRECT] } });
  const { code: unnamed } = await allow(single, { link: consentLink({ redirect_uri: null }) });
  await tokensOf(await exchange(single, unnamed, { redirect_uri: null }));
});

test("a desktop app's loopback address may change its port between registering and signing in", async () => {
  const site = setup();
  const { code, location } = await allow(site, { link: consentLink({ redirect_uri: "http://127.0.0.1:43123/callback" }) });
  assert.equal(location.origin, "http://127.0.0.1:43123");
  await tokensOf(await exchange(site, code, { redirect_uri: "http://127.0.0.1:43123/callback" }));
});

test("an account that can no longer connect apps can't trade its code", async () => {
  const site = setup();
  const { code } = await allow(site);
  site.accounts.set("person", { isGuest: false, emailVerifiedAt: null });
  assert.equal(await errorOf(await exchange(site, code)), "invalid_grant");
  assert.equal(site.grants.size, 0);
});

test("every refresh gives a new refresh token, and an old one coming back disconnects the app", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const site = setup();
  const first = await connect(site);
  site.advance(DAY);
  const second = await tokensOf(await refresh(site, first.refresh_token));
  assert.notEqual(second.refresh_token, first.refresh_token);
  // The same device: its id stays, its secret changes.
  assert.equal(second.refresh_token.split(".")[0], first.refresh_token.split(".")[0]);
  assert.equal(site.refreshTokens.size, 1);
  assert.equal(claimsOf(site, second.access_token).grantId, onlyGrant(site).id);

  // The old one again means a copy is out there: the app is disconnected, and neither copy works.
  assert.equal(await errorOf(await refresh(site, first.refresh_token)), "invalid_grant");
  assert.ok(onlyGrant(site).revokedAt);
  assert.equal(await errorOf(await refresh(site, second.refresh_token)), "invalid_grant");
  assert.equal(warn.mock.calls.at(-1)?.arguments[0], "mcp_refresh_token_reused");
});

test("two refreshes with the same token at once count as reuse", async (t) => {
  t.mock.method(console, "warn", () => {});
  const site = setup();
  const { refresh_token } = await connect(site);
  const answers = await Promise.all([refresh(site, refresh_token), refresh(site, refresh_token)]);
  assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 400]);
  assert.ok(onlyGrant(site).revokedAt);
});

test("a refresh may ask for less than the person allowed, never more", async () => {
  const site = setup();
  const both = await connect(site);
  const narrowed = await tokensOf(await refresh(site, both.refresh_token, { scope: "read" }));
  assert.equal(narrowed.scope, "read offline_access");
  assert.deepEqual(claimsOf(site, narrowed.access_token).scopes, ["read"]);
  // The device keeps what it was allowed, so it can ask for write again.
  const again = await tokensOf(await refresh(site, narrowed.refresh_token, { scope: "read write" }));
  assert.deepEqual(claimsOf(site, again.access_token).scopes, ["read", "write"]);

  const readOnly = setup();
  const reader = await connect(readOnly, { write: false });
  assert.equal(reader.scope, "read offline_access");
  assert.equal(await errorOf(await refresh(readOnly, reader.refresh_token, { scope: "read write" })), "invalid_scope");
  assert.equal(await errorOf(await refresh(readOnly, reader.refresh_token, { scope: "admin" })), "invalid_scope");
  // A refused refresh doesn't use the token up.
  const still = await tokensOf(await refresh(readOnly, reader.refresh_token));
  assert.deepEqual(claimsOf(readOnly, still.access_token).scopes, ["read"]);
});

test("a refresh token lasts 30 days without use, and a year at most", async () => {
  const site = setup();
  let { refresh_token: token } = await connect(site);
  site.advance(29 * DAY);
  token = (await tokensOf(await refresh(site, token))).refresh_token;
  site.advance(30 * DAY);
  assert.equal(await errorOf(await refresh(site, token)), "invalid_grant");

  const yearly = setup();
  let { refresh_token: kept } = await connect(yearly);
  for (let day = 29; day <= 348; day += 29) {
    yearly.advance(29 * DAY);
    const response = await refresh(yearly, kept);
    assert.equal(response.status, 200, `day ${day}`);
    kept = ((await response.json()) as Tokens).refresh_token;
  }
  yearly.advance(29 * DAY);
  assert.equal(await errorOf(await refresh(yearly, kept)), "invalid_grant");
});

test("a refresh token works only for its app and its endpoint, while the account may connect apps", async () => {
  const site = setup();
  const { refresh_token } = await connect(site);
  assert.equal(await errorOf(await refresh(site, refresh_token, { client_id: OTHER_APP_ID })), "invalid_grant");
  assert.equal(await errorOf(await refresh(site, refresh_token, { resource: "https://other.example/api/mcp" })), "invalid_target");
  assert.equal(await errorOf(await refresh(site, "aim_rt_made.up")), "invalid_grant");
  assert.equal(await errorOf(await refresh(site, "not-a-token")), "invalid_grant");
  // None of those disconnected the app.
  const next = await tokensOf(await refresh(site, refresh_token, { resource: RESOURCE }));
  assert.equal(onlyGrant(site).revokedAt, null);

  site.accounts.set("person", { isGuest: false, emailVerifiedAt: null });
  assert.equal(await errorOf(await refresh(site, next.refresh_token)), "invalid_grant");
});

test("apps that registered with a secret must send it; public apps must not", async () => {
  const site = setup();
  const registration = await (await register(site, { client_name: "Desktop App", redirect_uris: ["http://127.0.0.1/callback"] })).json();
  const { client_id: clientId, client_secret: clientSecret } = registration as { client_id: string; client_secret: string };
  const redirect = "http://127.0.0.1:43210/callback";
  const { code } = await allow(site, { link: consentLink({ client_id: clientId, redirect_uri: redirect }) });
  const basic = (secret: string) => ({ authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`).toString("base64")}` });
  const trade = (fields: Record<string, string | null>, headers?: Record<string, string>) =>
    site.server.token(post("/api/oauth/token", { grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: redirect, ...fields }, headers));

  const missing = await trade({ client_id: clientId });
  assert.equal(missing.status, 401);
  assert.equal(await errorOf(missing), "invalid_client");
  const wrong = await trade({}, basic("aim_cs_wrong"));
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("www-authenticate"), 'Basic realm="AI Multi"');
  assert.equal(await errorOf(await trade({ client_secret: clientSecret }, basic(clientSecret))), "invalid_request");
  assert.equal(await errorOf(await trade({ client_id: "aim_ci_someone-else" }, basic(clientSecret))), "invalid_request");
  const tokens = await tokensOf(await trade({}, basic(clientSecret)));
  assert.equal(claimsOf(site, tokens.access_token).clientId, clientId);
  // The secret may come in the form instead (client_secret_post).
  await tokensOf(await site.server.token(post("/api/oauth/token", { grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: tokens.refresh_token })));

  const publicApp = (await (await register(site, { redirect_uris: [APP_REDIRECT], token_endpoint_auth_method: "none" })).json()) as { client_id: string };
  const refusedClients: Array<Record<string, string>> = [
    { client_id: APP.id, client_secret: "aim_cs_anything" },
    { client_id: publicApp.client_id, client_secret: "aim_cs_anything" },
    { client_id: "aim_ci_nobody" },
    { client_id: "nobody" },
  ];
  for (const fields of refusedClients) {
    const response = await site.server.token(post("/api/oauth/token", { grant_type: "refresh_token", refresh_token: "aim_rt_a.b", ...fields }));
    assert.equal(response.status, 401, JSON.stringify(fields));
    assert.equal(await errorOf(response), "invalid_client");
  }
});

test("the token endpoint takes form posts, counts every request, and needs MCP_TOKEN_SECRET", async (t) => {
  const site = setup();
  const json = new Request(`${ORIGIN}/api/oauth/token`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(await errorOf(await site.server.token(json)), "invalid_request");
  assert.equal(await errorOf(await site.server.token(post("/api/oauth/token", { client_id: APP.id, grant_type: "password" }))), "unsupported_grant_type");
  assert.equal(await errorOf(await site.server.token(post("/api/oauth/token", { client_id: APP.id }))), "invalid_request");
  assert.equal(await errorOf(await site.server.token(post("/api/oauth/token", { grant_type: "refresh_token" }))), "invalid_request");

  site.counted.length = 0;
  site.limited.add("oauth-ip");
  const limited = await refresh(site, "aim_rt_a.b");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "120");
  assert.equal(await errorOf(limited), "temporarily_unavailable");
  assert.deepEqual(site.counted, [
    ["oauth-ip", IP],
    ["oauth-client", APP.id],
  ]);

  const error = t.mock.method(console, "error", () => {});
  const unset = setup({ env: { MCP_ENABLED: "true", APP_BASE_URL: ORIGIN } });
  const misconfigured = await refresh(unset, "aim_rt_a.b");
  assert.equal(misconfigured.status, 503);
  assert.equal(await errorOf(misconfigured), "server_error");
  assert.equal(error.mock.calls[0].arguments[0], "mcp_misconfigured");
});

test("registering gives an app an ID, and a secret unless it registers as public", async () => {
  const site = setup();
  const response = await register(site, {
    client_name: "My‮ App",
    redirect_uris: [APP_REDIRECT, "cursor://anysphere.cursor-retrieval/oauth/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    scope: "read write",
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.match(body.client_id, /^aim_ci_/);
  assert.match(body.client_secret, /^aim_cs_/);
  assert.equal(body.client_secret_expires_at, 0);
  assert.equal(body.client_id_issued_at, START / 1000);
  assert.equal(body.client_name, "My App");
  assert.equal(body.token_endpoint_auth_method, "client_secret_basic");
  assert.deepEqual(body.grant_types, ["authorization_code", "refresh_token"]);
  assert.deepEqual(site.clients.get(body.client_id), {
    id: body.client_id,
    name: "My App",
    redirectUris: [APP_REDIRECT, "cursor://anysphere.cursor-retrieval/oauth/callback"],
    secretHash: hashSecret(body.client_secret),
  });

  const unnamed = await (await register(site, { redirect_uris: [APP_REDIRECT], token_endpoint_auth_method: "none" })).json();
  assert.equal(unnamed.client_name, "Unnamed app");
  assert.equal(unnamed.client_secret, undefined);
  assert.equal(site.clients.get(unnamed.client_id)?.secretHash, null);
});

test("registering refuses what sign-in can't honor", async () => {
  const site = setup();
  const cases: Array<[string, unknown]> = [
    ["invalid_redirect_uri", {}],
    ["invalid_redirect_uri", { redirect_uris: [] }],
    ["invalid_redirect_uri", { redirect_uris: ["http://app.example/callback"] }],
    ["invalid_redirect_uri", { redirect_uris: ["javascript:alert(1)"] }],
    ["invalid_redirect_uri", { redirect_uris: Array.from({ length: 11 }, (_, index) => `https://app.example/${index}`) }],
    ["invalid_client_metadata", { redirect_uris: [APP_REDIRECT], token_endpoint_auth_method: "private_key_jwt" }],
    ["invalid_client_metadata", { redirect_uris: [APP_REDIRECT], grant_types: ["client_credentials"] }],
    ["invalid_client_metadata", { redirect_uris: [APP_REDIRECT], grant_types: ["authorization_code", "implicit"] }],
    ["invalid_client_metadata", { redirect_uris: [APP_REDIRECT], response_types: ["token"] }],
    ["invalid_client_metadata", { redirect_uris: [APP_REDIRECT], scope: "admin" }],
    ["invalid_client_metadata", [APP_REDIRECT]],
    ["invalid_client_metadata", "{ not json"],
  ];
  for (const [error, body] of cases) {
    const response = await register(site, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(await errorOf(response), error, JSON.stringify(body));
  }
  assert.equal(await errorOf(await register(site, { redirect_uris: [APP_REDIRECT] }, { "content-type": "text/plain" })), "invalid_client_metadata");
  assert.equal(site.clients.size, 0);

  site.limited.add("oauth-register-ip");
  const limited = await register(site, { redirect_uris: [APP_REDIRECT] });
  assert.equal(limited.status, 429);
  assert.equal(site.clients.size, 0);
});

test("revoking a refresh token ends that device's connection, and the app's with its last device", async () => {
  const site = setup();
  const laptop = await connect(site);
  const phone = await connect(site, { write: false });
  // Both devices joined one grant, each with what its own consent allowed.
  assert.deepEqual(onlyGrant(site).scopes, ["read", "write"]);
  assert.deepEqual(
    [...site.refreshTokens.values()].map((token) => token.scopes),
    [["read", "write"], ["read"]],
  );
  const revoke = (token: string, clientId = APP.id) => site.server.revoke(post("/api/oauth/revoke", { client_id: clientId, token }));

  assert.equal((await revoke(laptop.refresh_token)).status, 200);
  assert.equal(await errorOf(await refresh(site, laptop.refresh_token)), "invalid_grant");
  assert.equal(onlyGrant(site).revokedAt, null);

  // A made-up token, one already revoked, or another app's: the same empty answer, and nothing changes.
  for (const [token, clientId] of [["aim_rt_made.up", APP.id], [laptop.refresh_token, APP.id], [phone.refresh_token, OTHER_APP_ID]]) {
    const response = await revoke(token, clientId);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
  }
  const phoneNow = await tokensOf(await refresh(site, phone.refresh_token));

  assert.equal(await errorOf(await revoke(phoneNow.access_token)), "unsupported_token_type");
  assert.equal(await errorOf(await site.server.revoke(post("/api/oauth/revoke", { client_id: APP.id }))), "invalid_request");
  assert.equal((await revoke(phoneNow.refresh_token)).status, 200);
  assert.ok(onlyGrant(site).revokedAt);
  assert.equal(site.refreshTokens.size, 0);
});
