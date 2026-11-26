// Sign-in for AI apps connected over MCP (#477): the rules every step follows, as plain functions with
// no database or network, so tests can check each one. MCP 2026-07-28 asks for OAuth 2.1
// (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization):
//
// 1. The app reads the metadata documents and finds the consent page, /oauth/authorize.
// 2. It sends the person there with a PKCE challenge. They click Allow, and come back with a one-time code.
// 3. The app trades the code for an hour-long access token (access-token.ts) and a refresh token,
//    which changes on every use.
//
// The endpoints are in oauth-server.ts, the documents apps publish for their client IDs in
// client-metadata.ts, and the tables in oauth-store.ts.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { configuredOrigin, MCP_PATH, originFromHeaders } from "@/lib/mcp/connect";

type Env = Record<string, string | undefined>;

/** Where each part of sign-in lives. The consent page is a page; the rest answer apps directly. */
export const OAUTH_PATHS = {
  authorize: "/oauth/authorize",
  /** Where the consent page's Allow and Cancel post to. */
  decide: "/api/oauth/authorize",
  token: "/api/oauth/token",
  register: "/api/oauth/register",
  revoke: "/api/oauth/revoke",
  authorizationServerMetadata: "/.well-known/oauth-authorization-server",
  protectedResourceMetadata: "/.well-known/oauth-protected-resource",
} as const;

/** How long a code from the consent page lasts. Apps trade theirs within seconds. */
export const AUTHORIZATION_CODE_SECONDS = 5 * 60;
/** How long a used code is kept, so a second use can still revoke what the first one got. */
export const USED_CODE_DAYS = 1;

// Prefixes let secret scanners and logs recognize a leaked value, like access tokens' aim_at_.
export const AUTHORIZATION_CODE_PREFIX = "aim_ac_";
export const REFRESH_TOKEN_PREFIX = "aim_rt_";
export const CLIENT_ID_PREFIX = "aim_ci_";
export const CLIENT_SECRET_PREFIX = "aim_cs_";

/**
 * What an app can ask for. Tokens carry "read" and "write"; "offline_access" asks for a refresh
 * token, which every app gets, so it stays connected until the person disconnects it.
 */
export const SCOPES = ["read", "write", "offline_access"] as const;
export type ResourceScope = "read" | "write";
/**
 * The scopes the MCP endpoint's tools use, in its metadata. Only "read" until the write tools land
 * (#479); sign-in already handles "write" for apps that ask.
 */
export const RESOURCE_METADATA_SCOPES: ResourceScope[] = ["read"];
/** Public apps prove themselves with PKCE alone; apps that registered with a secret send it. */
export const TOKEN_ENDPOINT_AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;

/** OAuth's error codes (RFC 6749 sections 4.1.2.1 and 5.2, RFC 7009, RFC 7591, RFC 8707). */
export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "unsupported_response_type"
  | "unsupported_token_type"
  | "invalid_scope"
  | "invalid_target"
  | "access_denied"
  | "invalid_redirect_uri"
  | "invalid_client_metadata"
  | "temporarily_unavailable"
  | "server_error";

/**
 * The scopes an app asked for, as its tokens would carry them: "read" always, since nothing works
 * without it, and "write" when asked. Null when it names one that doesn't exist (invalid_scope).
 */
export function requestedScopes(scope: string | null | undefined): ResourceScope[] | null {
  const asked = (scope ?? "").split(" ").filter(Boolean);
  if (asked.some((value) => !(SCOPES as readonly string[]).includes(value))) return null;
  return asked.includes("write") ? ["read", "write"] : ["read"];
}

/** The `scope` of a token response: what the access token carries, and the refresh token that came with it. */
export function grantedScope(scopes: readonly string[]) {
  return [...scopes, "offline_access"].join(" ");
}

// PKCE (RFC 7636), S256 only: the challenge is the SHA-256 of a secret only the app knows.
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function codeChallengeFor(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function isCodeChallenge(value: string) {
  return CODE_CHALLENGE.test(value);
}

/** Whether the token request's code_verifier is the secret behind the consent page's code_challenge. */
export function verifyCodeVerifier(verifier: string | null | undefined, challenge: string) {
  return Boolean(verifier && CODE_VERIFIER.test(verifier)) && sameText(codeChallengeFor(verifier!), challenge);
}

/** SHA-256 in hex. Codes, refresh tokens and client secrets are stored only this way. */
export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Compares in constant time, so how long an answer takes says nothing about how much matched. */
export function sameText(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const randomText = (bytes: number) => randomBytes(bytes).toString("base64url");
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export const newAuthorizationCode = () => `${AUTHORIZATION_CODE_PREFIX}${randomText(32)}`;
export const newClientId = () => `${CLIENT_ID_PREFIX}${randomText(16)}`;
export const newClientSecret = () => `${CLIENT_SECRET_PREFIX}${randomText(32)}`;

/**
 * A refresh token, `aim_rt_<id>.<secret>`. The id finds its row; only the secret's hash is stored,
 * and every refresh gives the same id a new secret, so an old secret coming back means a copy leaked.
 */
export function newRefreshToken(id = randomText(16)) {
  const secret = randomText(32);
  return { id, secret, token: `${REFRESH_TOKEN_PREFIX}${id}.${secret}` };
}

export function readRefreshToken(token: string | null | undefined) {
  if (!token || token.length > 256 || !token.startsWith(REFRESH_TOKEN_PREFIX)) return null;
  const parts = token.slice(REFRESH_TOKEN_PREFIX.length).split(".");
  if (parts.length !== 2 || !BASE64URL.test(parts[0]) || !BASE64URL.test(parts[1])) return null;
  return { id: parts[0], secret: parts[1] };
}

// Redirect URIs (OAuth 2.1 sections 2.3 and 8.4, RFC 8252 for desktop apps).
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);
/** Schemes that run code, open files or aren't a place to send someone back to. */
const FORBIDDEN_SCHEMES = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
  "blob:",
  "about:",
  "filesystem:",
  "view-source:",
  "ws:",
  "wss:",
  "ftp:",
  "mailto:",
  "tel:",
  "sms:",
]);
const MAX_REDIRECT_URI_LENGTH = 2000;
const LOOPBACK_URI = /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(?::\d{1,5})?([/?][^#]*)?$/;

/**
 * Whether an app may name this as the place sign-in sends the person back to: an https address, a
 * loopback http address for desktop apps, or an app's own scheme, such as cursor://. Never one with
 * a fragment, a user name or a password.
 */
export function isAllowedRedirectUri(value: string) {
  if (value.length > MAX_REDIRECT_URI_LENGTH || value.includes("#") || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return Boolean(url.hostname);
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  return !FORBIDDEN_SCHEMES.has(url.protocol);
}

/** A loopback address without its port, or null for any other address. */
function loopbackWithoutPort(uri: string) {
  const match = LOOPBACK_URI.exec(uri);
  return match ? `${match[1]}${match[2] ?? ""}` : null;
}

/**
 * Whether `requested` is one of the app's `registered` addresses: character for character, except
 * that a loopback address may use any port, because desktop apps listen on whichever port is free.
 */
export function redirectUriMatches(registered: readonly string[], requested: string) {
  if (!isAllowedRedirectUri(requested)) return false;
  if (registered.includes(requested)) return true;
  const asked = loopbackWithoutPort(requested);
  return asked !== null && registered.some((uri) => loopbackWithoutPort(uri) === asked);
}

export function isLoopbackRedirect(uri: string) {
  return loopbackWithoutPort(uri) !== null;
}

/**
 * The address the consent page shows beneath the app's name: where the person returns to, which
 * MCP requires showing. Loopback addresses show as "localhost"; app schemes keep their scheme.
 */
export function redirectAddress(uri: string) {
  const url = new URL(uri);
  if (url.protocol === "https:" || url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname) ? "localhost" : url.host;
  return url.host ? `${url.protocol}//${url.host}` : url.protocol.slice(0, -1);
}

/** Adds the answer to the app's address as it registered it, so its own query is kept as it was. */
export function returnAddress(redirectUri: string, params: Record<string, string | null>) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== null) query.set(name, value);
  return `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}${query}`;
}

/**
 * The site's address for sign-in: APP_BASE_URL, or the one the request came in on, as on the
 * Integrations page (#480), so the address apps are given and the one they sign in to agree.
 */
export function oauthOrigin(env: Env, headers: { get(name: string): string | null }, url?: string) {
  return configuredOrigin(env) ?? originFromHeaders(headers) ?? (url ? new URL(url).origin : "http://localhost");
}

/** The MCP endpoint's address, which tokens are bound to (RFC 8707). */
export function mcpResource(origin: string) {
  return `${origin}${MCP_PATH}`;
}

/**
 * Whether an app's `resource` names the MCP endpoint. Apps should send its address as given; a
 * trailing slash, or capitals in the scheme and host, still count (MCP's canonical server URI).
 */
export function isThisResource(value: string, resource: string) {
  try {
    const url = new URL(value);
    if (url.hash || url.search || url.username || url.password || value.includes("#")) return false;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}` === resource;
  } catch {
    return false;
  }
}

/** An app as sign-in sees it: from its metadata document, or from registering. */
export type OAuthApp = {
  id: string;
  name: string;
  redirectUris: string[];
};

/** A consent request that passed every check: what the page shows and what Allow saves. */
export type AuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  /** Whether the app sent redirect_uri. If it did, its token request must send the same (OAuth 2.1, section 4.1.3). */
  redirectUriSent: boolean;
  codeChallenge: string;
  /** What the app asked for: "read", and "write" when it asked. */
  scopes: ResourceScope[];
  state: string | null;
  resource: string;
};

export type AuthorizationCheck =
  | { ok: true; request: AuthorizationRequest }
  /** The app or its address can't be trusted: the page explains, and never redirects. */
  | { ok: false; fatal: string }
  /** The app and its address are fine, so the error goes back to it (RFC 6749, section 4.1.2.1). */
  | { ok: false; redirect: string };

/** Why the consent page can't continue, in the person's words. */
export const FATAL_PROBLEMS = {
  missingClient: "This link doesn't say which app is asking.",
  unknownClient: "This app isn't registered with AI Multi. Start connecting it again from the app.",
  unreadableClient: "AI Multi couldn't read this app's sign-in details. Try again in a moment, or start connecting it again from the app.",
  badRedirect: "This app asked to send you to an address it didn't register, so AI Multi stopped.",
  tooMany: "Too many sign-in attempts. Wait a few minutes, then start connecting the app again.",
} as const;

const MAX_STATE_LENGTH = 4096;

/** The one value of a parameter: null when it's missing, undefined when it's there twice (RFC 6749, section 3.1). */
function one(params: URLSearchParams, name: string) {
  const values = params.getAll(name);
  return values.length > 1 ? undefined : (values[0] ?? null);
}

/** The app's client ID from a consent link, checked before anything else. */
export function readClientId(params: URLSearchParams): { ok: true; clientId: string } | { ok: false; fatal: string } {
  const clientId = one(params, "client_id");
  return clientId ? { ok: true, clientId } : { ok: false, fatal: FATAL_PROBLEMS.missingClient };
}

/**
 * Checks a consent link against the app it names. Problems with the app's address are shown on
 * the page; once the address is the app's own, every other problem goes back to it with `state`
 * and `iss` (RFC 9207), as OAuth expects.
 */
export function checkAuthorizationRequest(
  params: URLSearchParams,
  app: OAuthApp,
  { issuer, resource }: { issuer: string; resource: string },
): AuthorizationCheck {
  const sentRedirect = one(params, "redirect_uri");
  if (sentRedirect === undefined) return { ok: false, fatal: FATAL_PROBLEMS.badRedirect };
  // An app with one address may leave it out (OAuth 2.1, section 4.1.1).
  const redirectUri = sentRedirect ?? (app.redirectUris.length === 1 ? app.redirectUris[0] : null);
  if (!redirectUri || !redirectUriMatches(app.redirectUris, redirectUri)) return { ok: false, fatal: FATAL_PROBLEMS.badRedirect };

  const rawState = one(params, "state");
  const state = typeof rawState === "string" && rawState.length <= MAX_STATE_LENGTH ? rawState : null;
  const fail = (error: OAuthErrorCode, description: string): AuthorizationCheck => ({
    ok: false,
    redirect: returnAddress(redirectUri, { error, error_description: description, state, iss: issuer }),
  });

  if (rawState === undefined) return fail("invalid_request", "state was sent more than once.");
  if (typeof rawState === "string" && rawState.length > MAX_STATE_LENGTH) return fail("invalid_request", "state is too long.");

  const responseType = one(params, "response_type");
  if (responseType === undefined || !responseType) return fail("invalid_request", "response_type is required, once.");
  if (responseType !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");

  const codeChallenge = one(params, "code_challenge");
  if (!codeChallenge) return fail("invalid_request", "code_challenge is required, once (PKCE).");
  if (!isCodeChallenge(codeChallenge)) return fail("invalid_request", "code_challenge must be a base64url SHA-256.");
  if (one(params, "code_challenge_method") !== "S256") return fail("invalid_request", "code_challenge_method must be S256.");

  const scope = one(params, "scope");
  if (scope === undefined) return fail("invalid_request", "scope was sent more than once.");
  const scopes = requestedScopes(scope);
  if (!scopes) return fail("invalid_scope", `Supported scopes: ${SCOPES.join(", ")}.`);

  const askedResource = one(params, "resource");
  if (askedResource === undefined) return fail("invalid_target", "Only one resource is supported.");
  if (askedResource !== null && !isThisResource(askedResource, resource)) return fail("invalid_target", `The resource must be ${resource}.`);

  return {
    ok: true,
    request: { clientId: app.id, redirectUri, redirectUriSent: sentRedirect !== null, codeChallenge, scopes, state, resource },
  };
}

/** The address an app is sent back to after the consent page: a code, or why there isn't one. */
export function authorizationResponse(
  request: Pick<AuthorizationRequest, "redirectUri" | "state">,
  issuer: string,
  answer: { code: string } | { error: OAuthErrorCode; description: string },
) {
  const fields: Record<string, string> = "code" in answer ? { code: answer.code } : { error: answer.error, error_description: answer.description };
  return returnAddress(request.redirectUri, { ...fields, state: request.state, iss: issuer });
}

/** Authorization server metadata (RFC 8414), at /.well-known/oauth-authorization-server. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${OAUTH_PATHS.authorize}`,
    token_endpoint: `${origin}${OAUTH_PATHS.token}`,
    registration_endpoint: `${origin}${OAUTH_PATHS.register}`,
    revocation_endpoint: `${origin}${OAUTH_PATHS.revoke}`,
    scopes_supported: [...SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [...TOKEN_ENDPOINT_AUTH_METHODS],
    revocation_endpoint_auth_methods_supported: [...TOKEN_ENDPOINT_AUTH_METHODS],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  };
}

/**
 * Protected resource metadata (RFC 9728) for the MCP endpoint. It's served at
 * /.well-known/oauth-protected-resource/api/mcp, where the endpoint's 401 points, and at the root
 * for apps that look there first.
 */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: RESOURCE_METADATA_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "AI Multi",
  };
}
