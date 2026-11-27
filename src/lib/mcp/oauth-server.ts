// Sign-in's endpoints for AI apps (#477), as plain (Request) => Response functions with the
// database, the document fetcher, the rate limiter and the clock passed in, so tests can run every
// step without Next.js. The routes under src/app wire them up (oauth-routes.ts).
//
// - Metadata: /.well-known/oauth-authorization-server (RFC 8414) and /.well-known/oauth-protected-resource (RFC 9728).
// - The consent page, /oauth/authorize, shows what prepareConsent returns; its Allow and Cancel post to decide.
// - Token: trades a code (with PKCE) or a refresh token for an access token and a new refresh token.
// - Register (RFC 7591) for apps without a metadata document, and revoke (RFC 7009).
//
// Everything answers 404 while MCP_ENABLED is off. Every request an app makes is rate-limited per
// network. A code or refresh token that proves who's asking also counts against its device (for a
// refresh), its account and its app, in that order.
import { ACCESS_TOKEN_PREFIX, ACCESS_TOKEN_SECONDS, mcpTokenSecret, mintAccessToken } from "@/lib/mcp/access-token";
import { clientMetadataUrl, cleanAppName, type ClientMetadataResolver } from "@/lib/mcp/client-metadata";
import { isMcpEnabled } from "@/lib/mcp/connect";
import {
  AUTHORIZATION_CODE_SECONDS,
  authorizationResponse,
  authorizationServerMetadata,
  checkAuthorizationRequest,
  CLIENT_ID_PREFIX,
  FATAL_PROBLEMS,
  grantedScope,
  hashSecret,
  isAllowedRedirectUri,
  isLoopbackRedirect,
  isThisResource,
  mcpResource,
  newAuthorizationCode,
  newClientId,
  newClientSecret,
  newRefreshToken,
  OAUTH_PATHS,
  oauthOrigin,
  protectedResourceMetadata,
  readClientId,
  readRefreshToken,
  redirectAddress,
  requestedScopes,
  sameText,
  TOKEN_ENDPOINT_AUTH_METHODS,
  verifyCodeVerifier,
  type AuthorizationRequest,
  type OAuthApp,
  type OAuthErrorCode,
  type ResourceScope,
} from "@/lib/mcp/oauth";
import { mayConnectApps, type AccountCheck, type OAuthStore } from "@/lib/mcp/oauth-store";
import { authPageHref, confirmEmailHref } from "@/lib/auth-links";
import { clientIpFrom, RATE_LIMITS, tooManyAttemptsMessage, type RateLimitRule } from "@/lib/rate-limit-core";
import { fromThisSite } from "@/lib/same-site";
import { sessionEndsAt } from "@/lib/session-lifetime";

type Env = Record<string, string | undefined>;
type RateLimit = (rule: RateLimitRule, identifier: string | null) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;

export type OAuthServerDeps = {
  env: Env;
  store: OAuthStore;
  resolveClientMetadata: ClientMetadataResolver;
  rateLimit: RateLimit;
  now?: () => Date;
};

/** Who is on the consent page: the session's user, or null when signed out. */
export type ConsentUser = ({ id: string } & AccountCheck) | null;

/** What the consent page shows, or why it can't. */
export type ConsentCheck =
  | { kind: "consent"; request: AuthorizationRequest; app: { name: string; address: string; loopback: boolean } }
  | { kind: "fatal"; message: string }
  | { kind: "redirect"; location: string };

// Apps on other sites, such as a browser-based MCP client, call these directly. Nothing here reads cookies.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };
const MAX_BODY_BYTES = 16 * 1024;

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

export function oauthError(error: OAuthErrorCode, description: string, status = 400, headers: Record<string, string> = {}) {
  return Response.json({ error, error_description: description }, { status, headers: { ...CORS_HEADERS, ...NO_STORE, ...headers } });
}

/** The answer to a browser's CORS preflight. */
export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const seeOther = (location: string) => new Response(null, { status: 303, headers: { Location: location, ...NO_STORE } });

/** The one value of a form field: null when it's missing, undefined when it's there twice. */
function one(form: URLSearchParams, name: string) {
  const values = form.getAll(name);
  return values.length > 1 ? undefined : (values[0] ?? null);
}

/** A form body (RFC 6749 sends every token request as one), or null when it's something else or too big. */
async function readForm(request: Request) {
  if (!/^application\/x-www-form-urlencoded\b/i.test(request.headers.get("content-type") ?? "")) return null;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  const text = await request.text().catch(() => null);
  return text === null || text.length > MAX_BODY_BYTES ? null : new URLSearchParams(text);
}

/** How a client ID and secret arrive in HTTP Basic: each form-encoded first (RFC 6749, section 2.3.1). */
function decodeBasicPart(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

type ClientCredentials = { clientId: string; secret: string | null; basic: boolean };

function readClientCredentials(request: Request, form: URLSearchParams): ClientCredentials | { problem: string } {
  const formId = one(form, "client_id");
  const formSecret = one(form, "client_secret");
  if (formId === undefined || formSecret === undefined) return { problem: "Send client_id and client_secret once each." };
  const header = request.headers.get("authorization");
  if (header && /^basic\s/i.test(header)) {
    if (formSecret) return { problem: "Send the client secret one way, not two." };
    const decoded = Buffer.from(header.replace(/^basic\s+/i, ""), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    const clientId = colon > 0 ? decodeBasicPart(decoded.slice(0, colon)) : null;
    const secret = colon > 0 ? decodeBasicPart(decoded.slice(colon + 1)) : null;
    if (!clientId || secret === null) return { problem: "The Authorization header isn't valid HTTP Basic." };
    if (formId && formId !== clientId) return { problem: "client_id doesn't match the Authorization header." };
    return { clientId, secret: secret || null, basic: true };
  }
  if (!formId) return { problem: "client_id is required." };
  return { clientId: formId, secret: formSecret || null, basic: false };
}

export function createOAuthServer(deps: OAuthServerDeps) {
  const { env, store } = deps;
  const now = deps.now ?? (() => new Date());

  /**
   * Counts the request against each limit in turn, narrowest first. The first one that's used up
   * answers 429, and the wider ones after it don't count the request, so a device or an account
   * over its own limit can't go on using up its app's share (#562).
   */
  async function overLimit(limits: Array<[RateLimitRule, string | null]>) {
    for (const [rule, identifier] of limits) {
      const result = await deps.rateLimit(rule, identifier);
      if (!result.allowed) {
        return oauthError("temporarily_unavailable", tooManyAttemptsMessage("sign-in requests", result.retryAfterSeconds), 429, {
          "Retry-After": String(result.retryAfterSeconds),
        });
      }
    }
    return null;
  }

  /**
   * Every request counts against its network. A client ID is public, so a request counts against
   * its app only once it proves it comes from the app (a code with its PKCE secret, or a valid
   * refresh token). Otherwise anyone could use up a popular app's share by naming it, and lock out
   * everyone who uses that app.
   */
  const networkLimit = (request: Request): Array<[RateLimitRule, string | null]> => [[RATE_LIMITS.oauthIp, clientIpFrom(request.headers)]];

  /**
   * Checks who's calling the token or revoke endpoint. Apps that registered with a secret must send
   * it; apps with a metadata document, and apps that registered without one, are public: what
   * proves them is the code's PKCE secret or the refresh token itself.
   */
  async function authenticate(credentials: ClientCredentials): Promise<Response | null> {
    const refuse = (description: string) =>
      oauthError("invalid_client", description, 401, credentials.basic ? { "WWW-Authenticate": 'Basic realm="AI Multi"' } : {});
    if (clientMetadataUrl(credentials.clientId)) {
      return credentials.secret ? refuse("An app with a metadata document can't use a client secret.") : null;
    }
    const client = credentials.clientId.startsWith(CLIENT_ID_PREFIX) ? await store.findClient(credentials.clientId) : null;
    if (!client) return refuse("AI Multi doesn't know this client. Register it again.");
    if (!client.secretHash) return credentials.secret ? refuse("This client registered without a secret.") : null;
    if (!credentials.secret || !sameText(hashSecret(credentials.secret), client.secretHash)) return refuse("The client secret is wrong.");
    return null;
  }

  function tokenResponse(
    secret: string,
    claims: { userId: string; grantId: string; clientId: string; scopes: string[]; resource: string },
    refreshToken: string,
    at: Date,
  ) {
    return Response.json(
      {
        access_token: mintAccessToken(claims, { secret, now: at }),
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_SECONDS,
        refresh_token: refreshToken,
        scope: grantedScope(claims.scopes),
      },
      { headers: { ...CORS_HEADERS, ...NO_STORE } },
    );
  }

  async function exchangeCode(form: URLSearchParams, clientId: string, secret: string) {
    const at = now();
    const code = one(form, "code");
    const verifier = one(form, "code_verifier");
    if (!code || !verifier) return oauthError("invalid_request", "code and code_verifier are required, once each.");

    const codeHash = hashSecret(code);
    const stored = await store.findCode(codeHash);
    if (!stored || stored.clientId !== clientId) return oauthError("invalid_grant", "The code isn't valid.");
    if (stored.usedAt) {
      // A second use means someone else may hold the code, so what the first use got stops working (OAuth 2.1, section 4.1.3).
      if (stored.grantId) await store.revokeGrant(stored.grantId, at);
      console.warn("mcp_code_reused", { grantId: stored.grantId });
      return oauthError("invalid_grant", "The code was already used. Connect the app again.");
    }
    if (stored.expiresAt <= at) return oauthError("invalid_grant", "The code expired. Connect the app again.");

    const redirectUri = one(form, "redirect_uri");
    const redirectMatches = stored.redirectUriSent ? redirectUri === stored.redirectUri : redirectUri === null || redirectUri === stored.redirectUri;
    if (!redirectMatches) return oauthError("invalid_grant", "redirect_uri isn't the one the consent page was given.");
    if (!verifyCodeVerifier(verifier, stored.codeChallenge)) return oauthError("invalid_grant", "code_verifier doesn't match the code_challenge.");
    const resource = one(form, "resource");
    if (resource === undefined || (resource !== null && !isThisResource(resource, stored.resource))) {
      return oauthError("invalid_target", `The resource must be ${stored.resource}.`);
    }
    if (!stored.accountAllowed) return oauthError("invalid_grant", "This account can't connect apps.");
    // The code and its PKCE secret prove this comes from the sign-in that made the code, so it counts
    // against that account, then the app. Over either, the code stays unused for a retry.
    const limited = await overLimit([
      [RATE_LIMITS.oauthAccountTokens, stored.userId],
      [RATE_LIMITS.oauthClient, clientId],
    ]);
    if (limited) return limited;
    if (!(await store.claimCode(codeHash, at))) return oauthError("invalid_grant", "The code was already used. Connect the app again.");

    const refresh = newRefreshToken();
    const { grantId } = await store.connect({
      codeHash,
      userId: stored.userId,
      clientId,
      clientName: stored.clientName,
      clientAddress: stored.clientAddress,
      scopes: stored.scopes,
      refreshToken: { id: refresh.id, tokenHash: hashSecret(refresh.secret), scopes: stored.scopes, resource: stored.resource, expiresAt: sessionEndsAt(at, at) },
      now: at,
    });
    return tokenResponse(secret, { userId: stored.userId, grantId, clientId, scopes: stored.scopes, resource: stored.resource }, refresh.token, at);
  }

  async function refresh(form: URLSearchParams, clientId: string, secret: string) {
    const at = now();
    const presented = one(form, "refresh_token");
    if (!presented) return oauthError("invalid_request", "refresh_token is required, once.");
    const parsed = readRefreshToken(presented);
    const stored = parsed ? await store.findRefreshToken(parsed.id) : null;
    if (!parsed || !stored || stored.grant.clientId !== clientId) return oauthError("invalid_grant", "The refresh token isn't valid.");

    const presentedHash = hashSecret(parsed.secret);
    const reused = async () => {
      // An old secret came back, so a copy of the token is out there: neither copy may keep working (OAuth 2.1, section 4.3.1).
      await store.revokeGrant(stored.grantId, at);
      console.warn("mcp_refresh_token_reused", { grantId: stored.grantId });
      return oauthError("invalid_grant", "The refresh token was already used. Connect the app again.");
    };
    if (!sameText(presentedHash, stored.tokenHash)) return reused();
    if (stored.grant.revoked || !stored.grant.accountAllowed) return oauthError("invalid_grant", "The app was disconnected. Connect it again.");
    if (stored.expiresAt <= at) return oauthError("invalid_grant", "The refresh token expired. Connect the app again.");

    // A refresh may ask for less than the device was allowed, never more (RFC 6749, section 6).
    const scope = one(form, "scope");
    if (scope === undefined) return oauthError("invalid_request", "scope was sent more than once.");
    const asked = scope === null ? stored.scopes : requestedScopes(scope);
    if (!asked || !asked.every((value) => stored.scopes.includes(value))) return oauthError("invalid_scope", "A refresh can't add scopes.");
    const resource = one(form, "resource");
    if (resource === undefined || (resource !== null && !isThisResource(resource, stored.resource))) {
      return oauthError("invalid_target", `The resource must be ${stored.resource}.`);
    }
    // The token proves who's asking, so it counts against its device, then its account, then the app,
    // and stops at the first that's used up. A device stuck in a loop, or an account with many
    // devices, then uses at most its own limit of the app's share. Over any of them, the token stays
    // as it was for a retry.
    const limited = await overLimit([
      [RATE_LIMITS.oauthDevice, stored.id],
      [RATE_LIMITS.oauthAccountTokens, stored.grant.userId],
      [RATE_LIMITS.oauthClient, clientId],
    ]);
    if (limited) return limited;

    const next = newRefreshToken(stored.id);
    const rotated = await store.rotateRefreshToken({
      id: stored.id,
      oldHash: stored.tokenHash,
      newHash: hashSecret(next.secret),
      expiresAt: sessionEndsAt(stored.createdAt, at),
      now: at,
    });
    // Another request used this secret a moment ago: the same as an old secret coming back.
    if (!rotated) return reused();
    return tokenResponse(secret, { userId: stored.grant.userId, grantId: stored.grantId, clientId, scopes: asked, resource: stored.resource }, next.token, at);
  }

  /** The app a consent link names: its metadata document, or its registration. */
  async function findApp(clientId: string): Promise<{ ok: true; app: OAuthApp } | { ok: false; message: string }> {
    if (clientMetadataUrl(clientId)) {
      const result = await deps.resolveClientMetadata(clientId);
      if (result.ok) return result;
      console.warn("mcp_client_metadata_failed", { host: new URL(clientId).host, problem: result.problem, detail: result.detail });
      return { ok: false, message: FATAL_PROBLEMS.unreadableClient };
    }
    const client = clientId.startsWith(CLIENT_ID_PREFIX) && clientId.length <= 64 ? await store.findClient(clientId) : null;
    return client ? { ok: true, app: client } : { ok: false, message: FATAL_PROBLEMS.unknownClient };
  }

  /**
   * Everything the consent page needs, or why it can't show. The page and its Allow and Cancel both
   * call it, so a post can't skip a check the page made.
   */
  async function prepareConsent(params: URLSearchParams, { origin, ip }: { origin: string; ip: string | null }): Promise<ConsentCheck> {
    const id = readClientId(params);
    if (!id.ok) return { kind: "fatal", message: id.fatal };
    // Anyone can build a consent link naming any app, so it counts only against the network.
    const limited = await overLimit([[RATE_LIMITS.oauthIp, ip]]);
    if (limited) return { kind: "fatal", message: FATAL_PROBLEMS.tooMany };
    const found = await findApp(id.clientId);
    if (!found.ok) return { kind: "fatal", message: found.message };

    const check = checkAuthorizationRequest(params, found.app, { issuer: origin, resource: mcpResource(origin) });
    if (!check.ok) return "fatal" in check ? { kind: "fatal", message: check.fatal } : { kind: "redirect", location: check.redirect };
    const { redirectUri } = check.request;
    return {
      kind: "consent",
      request: check.request,
      app: { name: found.app.name, address: redirectAddress(redirectUri), loopback: isLoopbackRedirect(redirectUri) },
    };
  }

  return {
    /** RFC 8414 metadata. */
    authorizationServerMetadata(request: Request) {
      if (!isMcpEnabled(env)) return notFound();
      const origin = oauthOrigin(env, request.headers, request.url);
      return Response.json(authorizationServerMetadata(origin), { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" } });
    },

    /** RFC 9728 metadata for /api/mcp. */
    protectedResourceMetadata(request: Request) {
      if (!isMcpEnabled(env)) return notFound();
      const origin = oauthOrigin(env, request.headers, request.url);
      return Response.json(protectedResourceMetadata(origin), { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" } });
    },

    prepareConsent,

    /**
     * Allow or Cancel on the consent page. The consent link's parameters come back as hidden fields,
     * so every check runs again. Allow saves a code with what the person allowed; either way the
     * person goes back to the app with 303, which a browser follows with GET.
     */
    async decide(request: Request, currentUser: () => Promise<ConsentUser>): Promise<Response> {
      if (!isMcpEnabled(env)) return notFound();
      // Only AI Multi's own page may post here, so another site can't click Allow for someone.
      if (!fromThisSite(request)) return oauthError("access_denied", "Allow and Cancel only work on AI Multi's own page.", 403);
      const form = await readForm(request);
      if (!form) return oauthError("invalid_request", "Send the consent form as application/x-www-form-urlencoded.");
      const decision = form.get("decision");
      const allowWrite = form.get("write") === "on";
      form.delete("decision");
      form.delete("write");

      const consentPath = `${OAUTH_PATHS.authorize}?${form}`;
      const user = await currentUser();
      if (!user) return seeOther(authPageHref("login", { next: consentPath }));
      if (!user.isGuest && !user.emailVerifiedAt) return seeOther(confirmEmailHref({ next: consentPath }));

      const origin = oauthOrigin(env, request.headers, request.url);
      const consent = await prepareConsent(form, { origin, ip: clientIpFrom(request.headers) });
      if (consent.kind === "redirect") return seeOther(consent.location);
      // The page shows what's wrong.
      if (consent.kind === "fatal") return seeOther(consentPath);
      if (decision === "cancel") {
        return seeOther(authorizationResponse(consent.request, origin, { error: "access_denied", description: "The person clicked Cancel." }));
      }
      if (decision !== "allow") return oauthError("invalid_request", "decision must be allow or cancel.");
      // Guests can only cancel: the page asks them to sign up first.
      if (!mayConnectApps(user)) return seeOther(consentPath);
      // Each Allow saves a code that counts against the app, so one account can't do it endlessly.
      const accountLimit = await deps.rateLimit(RATE_LIMITS.oauthAccount, user.id);
      if (!accountLimit.allowed) {
        return seeOther(
          authorizationResponse(consent.request, origin, {
            error: "temporarily_unavailable",
            description: tooManyAttemptsMessage("connections", accountLimit.retryAfterSeconds),
          }),
        );
      }

      const at = now();
      const scopes: ResourceScope[] = consent.request.scopes.filter((scope) => scope === "read" || allowWrite);
      const code = newAuthorizationCode();
      const { request: consented, app } = consent;
      await store.createCode({
        codeHash: hashSecret(code),
        userId: user.id,
        clientId: consented.clientId,
        clientName: app.name,
        clientAddress: app.address,
        redirectUri: consented.redirectUri,
        redirectUriSent: consented.redirectUriSent,
        codeChallenge: consented.codeChallenge,
        scopes,
        resource: consented.resource,
        expiresAt: new Date(at.getTime() + AUTHORIZATION_CODE_SECONDS * 1000),
      });
      return seeOther(authorizationResponse(consented, origin, { code }));
    },

    /** The token endpoint: authorization_code (with PKCE) and refresh_token. */
    async token(request: Request): Promise<Response> {
      if (!isMcpEnabled(env)) return notFound();
      const secret = mcpTokenSecret(env);
      if (!secret) {
        console.error("mcp_misconfigured", { missing: "MCP_TOKEN_SECRET" });
        return oauthError("server_error", "Sign-in isn't set up on this server.", 503);
      }
      const form = await readForm(request);
      if (!form) return oauthError("invalid_request", "Send the request as application/x-www-form-urlencoded.");
      const credentials = readClientCredentials(request, form);
      if ("problem" in credentials) return oauthError("invalid_request", credentials.problem);
      const limited = await overLimit(networkLimit(request));
      if (limited) return limited;
      const refused = await authenticate(credentials);
      if (refused) return refused;

      const grantType = one(form, "grant_type");
      if (grantType === "authorization_code") return exchangeCode(form, credentials.clientId, secret);
      if (grantType === "refresh_token") return refresh(form, credentials.clientId, secret);
      return grantType
        ? oauthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token.")
        : oauthError("invalid_request", "grant_type is required, once.");
    },

    /** Dynamic Client Registration (RFC 7591), for apps without a metadata document. */
    async register(request: Request): Promise<Response> {
      if (!isMcpEnabled(env)) return notFound();
      const limited = await overLimit([[RATE_LIMITS.oauthRegisterIp, clientIpFrom(request.headers)]]);
      if (limited) return limited;
      if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
        return oauthError("invalid_client_metadata", "Send the registration as application/json.");
      }
      if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return oauthError("invalid_client_metadata", "The registration is too big.");
      const text = await request.text().catch(() => "");
      let parsed: unknown = null;
      try {
        if (text.length <= MAX_BODY_BYTES) parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return oauthError("invalid_client_metadata", "The registration must be a JSON object.");
      const body = parsed as Record<string, unknown>;

      const redirectUris = body.redirect_uris;
      if (
        !Array.isArray(redirectUris) ||
        redirectUris.length === 0 ||
        redirectUris.length > 10 ||
        !redirectUris.every((uri) => typeof uri === "string" && isAllowedRedirectUri(uri))
      ) {
        return oauthError("invalid_redirect_uri", "redirect_uris must list 1 to 10 https, loopback (http://127.0.0.1, http://localhost) or app addresses.");
      }
      // RFC 7591 makes client_secret_basic the default when an app doesn't say.
      const method = body.token_endpoint_auth_method ?? "client_secret_basic";
      if (typeof method !== "string" || !(TOKEN_ENDPOINT_AUTH_METHODS as readonly string[]).includes(method)) {
        return oauthError("invalid_client_metadata", `token_endpoint_auth_method must be one of ${TOKEN_ENDPOINT_AUTH_METHODS.join(", ")}.`);
      }
      const grantTypes = body.grant_types ?? ["authorization_code"];
      if (!Array.isArray(grantTypes) || !grantTypes.includes("authorization_code") || !grantTypes.every((type) => type === "authorization_code" || type === "refresh_token")) {
        return oauthError("invalid_client_metadata", "grant_types may be authorization_code and refresh_token.");
      }
      const responseTypes = body.response_types ?? ["code"];
      if (!Array.isArray(responseTypes) || responseTypes.length !== 1 || responseTypes[0] !== "code") {
        return oauthError("invalid_client_metadata", "response_types must be [\"code\"].");
      }
      if (body.scope !== undefined && (typeof body.scope !== "string" || !requestedScopes(body.scope))) {
        return oauthError("invalid_client_metadata", "scope may hold read, write and offline_access.");
      }

      const at = now();
      const clientId = newClientId();
      const clientSecret = method === "none" ? null : newClientSecret();
      const name = cleanAppName(body.client_name) ?? "Unnamed app";
      await store.createClient({ id: clientId, name, redirectUris: redirectUris as string[], secretHash: clientSecret ? hashSecret(clientSecret) : null }, at);
      return Response.json(
        {
          client_id: clientId,
          client_id_issued_at: Math.floor(at.getTime() / 1000),
          ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
          client_name: name,
          redirect_uris: redirectUris,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: method,
          ...(typeof body.scope === "string" ? { scope: body.scope } : {}),
        },
        { status: 201, headers: { ...CORS_HEADERS, ...NO_STORE } },
      );
    },

    /**
     * Token revocation (RFC 7009). Revoking a refresh token ends that device's connection, and the
     * app's grant with its last device. Access tokens aren't stored, so they can't be revoked one
     * by one: they last an hour, and disconnecting the app stops them at once.
     */
    async revoke(request: Request): Promise<Response> {
      if (!isMcpEnabled(env)) return notFound();
      const form = await readForm(request);
      if (!form) return oauthError("invalid_request", "Send the request as application/x-www-form-urlencoded.");
      const credentials = readClientCredentials(request, form);
      if ("problem" in credentials) return oauthError("invalid_request", credentials.problem);
      const limited = await overLimit(networkLimit(request));
      if (limited) return limited;
      const refused = await authenticate(credentials);
      if (refused) return refused;

      const token = one(form, "token");
      if (!token) return oauthError("invalid_request", "token is required, once.");
      if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
        return oauthError("unsupported_token_type", "Access tokens can't be revoked one by one. Revoke the refresh token instead.");
      }
      const parsed = readRefreshToken(token);
      const stored = parsed ? await store.findRefreshToken(parsed.id) : null;
      // A token that isn't valid, or isn't this app's, gets the same answer (RFC 7009, section 2.2).
      if (parsed && stored && stored.grant.clientId === credentials.clientId && sameText(hashSecret(parsed.secret), stored.tokenHash)) {
        await store.disconnectDevice({ refreshTokenId: stored.id, grantId: stored.grantId, now: now() });
      }
      return new Response(null, { status: 200, headers: { ...CORS_HEADERS, ...NO_STORE } });
    },
  };
}

export type OAuthServer = ReturnType<typeof createOAuthServer>;
