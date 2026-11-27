// Sign-in's rules for AI apps (#477): scopes, PKCE, the secrets' formats, redirect URIs, consent
// links and the metadata documents.
import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizationResponse,
  authorizationServerMetadata,
  checkAuthorizationRequest,
  codeChallengeFor,
  FATAL_PROBLEMS,
  grantedScope,
  hashSecret,
  isAllowedRedirectUri,
  isCodeChallenge,
  isLoopbackRedirect,
  isThisResource,
  mcpResource,
  newAuthorizationCode,
  newClientId,
  newClientSecret,
  newRefreshToken,
  oauthOrigin,
  protectedResourceMetadata,
  readClientId,
  readRefreshToken,
  redirectAddress,
  redirectUriMatches,
  requestedScopes,
  returnAddress,
  sameText,
  verifyCodeVerifier,
  type AuthorizationCheck,
  type OAuthApp,
} from "./oauth";

const ORIGIN = "https://ai-multi.example";
const RESOURCE = `${ORIGIN}/api/mcp`;
// RFC 7636, appendix B.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const APP: OAuthApp = {
  id: "https://app.example/oauth/client.json",
  name: "Example App",
  redirectUris: ["https://app.example/oauth/callback", "http://127.0.0.1/callback"],
};
const headersOf = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

test("an app gets read always and write when it asks; an unknown scope is refused", () => {
  assert.deepEqual(requestedScopes(null), ["read"]);
  assert.deepEqual(requestedScopes(""), ["read"]);
  assert.deepEqual(requestedScopes("read"), ["read"]);
  assert.deepEqual(requestedScopes("offline_access"), ["read"]);
  assert.deepEqual(requestedScopes("write"), ["read", "write"]);
  assert.deepEqual(requestedScopes("read  write offline_access"), ["read", "write"]);
  assert.equal(requestedScopes("admin"), null);
  assert.equal(requestedScopes("read admin"), null);
  assert.equal(requestedScopes("READ"), null);
  // The token response names the refresh token every app gets.
  assert.equal(grantedScope(["read"]), "read offline_access");
  assert.equal(grantedScope(["read", "write"]), "read write offline_access");
});

test("PKCE takes only the S256 secret behind the challenge", () => {
  assert.equal(codeChallengeFor(VERIFIER), CHALLENGE);
  assert.equal(isCodeChallenge(CHALLENGE), true);
  assert.equal(verifyCodeVerifier(VERIFIER, CHALLENGE), true);

  assert.equal(verifyCodeVerifier(`${VERIFIER.slice(0, -1)}A`, CHALLENGE), false);
  assert.equal(verifyCodeVerifier(null, CHALLENGE), false);
  assert.equal(verifyCodeVerifier("", CHALLENGE), false);
  // "plain" PKCE, where the challenge is the verifier itself, never passes.
  assert.equal(verifyCodeVerifier(CHALLENGE, CHALLENGE), false);
  // Verifiers are 43 to 128 unreserved characters (RFC 7636, section 4.1), even when the hash matches.
  for (const verifier of ["a".repeat(42), "a".repeat(129), `${"a".repeat(42)}+`, `${"a".repeat(42)} `]) {
    assert.equal(verifyCodeVerifier(verifier, codeChallengeFor(verifier)), false, verifier);
  }
  assert.equal(verifyCodeVerifier("a".repeat(128), codeChallengeFor("a".repeat(128))), true);
  for (const challenge of [`${CHALLENGE}A`, CHALLENGE.slice(1), CHALLENGE.replace("-", "+"), `${CHALLENGE.slice(0, -1)}=`]) {
    assert.equal(isCodeChallenge(challenge), false, challenge);
  }
});

test("codes, client IDs, secrets and refresh tokens are random, prefixed, and stored only as hashes", () => {
  assert.match(newAuthorizationCode(), /^aim_ac_[A-Za-z0-9_-]{43}$/);
  assert.match(newClientId(), /^aim_ci_[A-Za-z0-9_-]{22}$/);
  assert.match(newClientSecret(), /^aim_cs_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newAuthorizationCode(), newAuthorizationCode());
  assert.match(hashSecret("aim_ac_x"), /^[0-9a-f]{64}$/);
  assert.equal(hashSecret("same"), hashSecret("same"));
  assert.equal(sameText("abc", "abc"), true);
  assert.equal(sameText("abc", "abd"), false);
  assert.equal(sameText("abc", "abcd"), false);
});

test("a refresh token keeps its id across rotations and reads back as id and secret", () => {
  const first = newRefreshToken();
  assert.match(first.token, /^aim_rt_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(readRefreshToken(first.token), { id: first.id, secret: first.secret });
  const rotated = newRefreshToken(first.id);
  assert.equal(rotated.id, first.id);
  assert.notEqual(rotated.secret, first.secret);

  for (const token of [null, undefined, "", "aim_at_abc.def", `aim_rt_${first.id}`, `aim_rt_${first.id}.${first.secret}.x`, `aim_rt_.${first.secret}`, "aim_rt_a+b.c", `aim_rt_a.${"b".repeat(300)}`]) {
    assert.equal(readRefreshToken(token), null, String(token));
  }
});

test("apps may return people to https, loopback http and their own schemes, nowhere that runs code", () => {
  for (const uri of [
    "https://app.example/oauth/callback",
    "https://app.example:8443/callback?app=1",
    "http://127.0.0.1/callback",
    "http://127.0.0.1:33418/callback",
    "http://localhost:3000/",
    "http://[::1]:8080/callback",
    "cursor://anysphere.cursor-retrieval/oauth/callback",
    "vscode://vscode.github-authentication/did-authenticate",
    "com.example.app:/oauth2redirect",
  ]) {
    assert.equal(isAllowedRedirectUri(uri), true, uri);
  }
  for (const uri of [
    "http://app.example/callback",
    "http://127.0.0.1.example/callback",
    "https://app.example/callback#fragment",
    "https://user:pass@app.example/callback",
    "https://app.example/call back",
    "https://app.example/\ncallback",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "about:blank",
    "blob:https://app.example/1",
    "wss://app.example/socket",
    "mailto:someone@example.com",
    "not a url",
    "/relative/callback",
    `https://app.example/${"a".repeat(2000)}`,
  ]) {
    assert.equal(isAllowedRedirectUri(uri), false, uri);
  }
});

test("a redirect URI matches character for character, except a loopback address's port", () => {
  const registered = ["https://app.example/callback", "http://127.0.0.1/callback", "http://localhost:8000/done?app=1"];
  assert.equal(redirectUriMatches(registered, "https://app.example/callback"), true);
  assert.equal(redirectUriMatches(registered, "http://127.0.0.1:51234/callback"), true);
  assert.equal(redirectUriMatches(registered, "http://127.0.0.1/callback"), true);
  assert.equal(redirectUriMatches(registered, "http://localhost:9999/done?app=1"), true);
  assert.equal(redirectUriMatches(registered, "http://localhost/done?app=1"), true);

  for (const uri of [
    "https://app.example/callback/",
    "https://app.example/Callback",
    "https://APP.example/callback",
    "https://app.example:443/callback",
    "https://app.example:8443/callback",
    "https://app.example/callback?extra=1",
    "https://app.example.evil.example/callback",
    "http://127.0.0.1:51234/other",
    "http://localhost:51234/callback",
    "http://[::1]:51234/callback",
    "http://localhost:9999/done?app=2",
    "https://app.example/callback#x",
  ]) {
    assert.equal(redirectUriMatches(registered, uri), false, uri);
  }
  // A forbidden address never matches, even when an app managed to register it.
  assert.equal(redirectUriMatches(["javascript:alert(1)"], "javascript:alert(1)"), false);
  assert.equal(isLoopbackRedirect("http://127.0.0.1:4000/callback"), true);
  assert.equal(isLoopbackRedirect("https://127.0.0.1/callback"), false);
  assert.equal(isLoopbackRedirect("https://app.example/callback"), false);
});

test("the consent page names where the person returns to", () => {
  assert.equal(redirectAddress("https://claude.ai/api/mcp/auth_callback"), "claude.ai");
  assert.equal(redirectAddress("https://app.example:8443/callback"), "app.example:8443");
  assert.equal(redirectAddress("http://127.0.0.1:33418/callback"), "localhost");
  assert.equal(redirectAddress("http://[::1]:33418/callback"), "localhost");
  assert.equal(redirectAddress("cursor://anysphere.cursor-retrieval/oauth/callback"), "cursor://anysphere.cursor-retrieval");
  assert.equal(redirectAddress("com.example.app:/oauth2redirect"), "com.example.app");
});

test("answers are added to the app's address, its own query kept", () => {
  assert.equal(returnAddress("https://app.example/cb", { code: "aim_ac_1", state: null, iss: ORIGIN }), "https://app.example/cb?code=aim_ac_1&iss=https%3A%2F%2Fai-multi.example");
  assert.equal(returnAddress("https://app.example/cb?app=1", { code: "a b&c" }), "https://app.example/cb?app=1&code=a+b%26c");
});

test("sign-in's address is APP_BASE_URL, else the request's, and tokens are bound to its MCP endpoint", () => {
  assert.equal(oauthOrigin({ APP_BASE_URL: "https://ai-multi.example/" }, headersOf({ host: "other.example" })), ORIGIN);
  assert.equal(oauthOrigin({}, headersOf({ host: "localhost:3100" })), "http://localhost:3100");
  assert.equal(oauthOrigin({}, headersOf({}), "https://preview.example/api/oauth/token"), "https://preview.example");
  assert.equal(oauthOrigin({}, headersOf({})), "http://localhost");
  assert.equal(mcpResource(ORIGIN), RESOURCE);

  assert.equal(isThisResource(RESOURCE, RESOURCE), true);
  assert.equal(isThisResource(`${RESOURCE}/`, RESOURCE), true);
  assert.equal(isThisResource("HTTPS://AI-MULTI.EXAMPLE/api/mcp", RESOURCE), true);
  for (const value of [`${ORIGIN}/api/mcp2`, `${ORIGIN}/api`, `${RESOURCE}?x=1`, `${RESOURCE}#x`, "https://other.example/api/mcp", `http://ai-multi.example/api/mcp`, "not a url", ""]) {
    assert.equal(isThisResource(value, RESOURCE), false, value);
  }
});

/** A consent link as an app builds one; null leaves a parameter out. */
function link(overrides: Record<string, string | string[] | null> = {}) {
  const values: Record<string, string | string[] | null> = {
    client_id: APP.id,
    redirect_uri: APP.redirectUris[0],
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "state-123",
    scope: "read",
    resource: RESOURCE,
    ...overrides,
  };
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    for (const item of value === null ? [] : Array.isArray(value) ? value : [value]) params.append(name, item);
  }
  return params;
}
const check = (params: URLSearchParams, app: OAuthApp = APP) => checkAuthorizationRequest(params, app, { issuer: ORIGIN, resource: RESOURCE });

/** The error a check sent back to the app, as the app reads it. */
function returned(result: AuthorizationCheck): Record<string, string | undefined> {
  assert.ok(!result.ok && "redirect" in result, JSON.stringify(result));
  const url = new URL(result.redirect);
  return { at: `${url.origin}${url.pathname}`, ...Object.fromEntries(url.searchParams) };
}

test("a good consent link passes with what the app asked for", () => {
  assert.deepEqual(check(link({ scope: "read write offline_access" })), {
    ok: true,
    request: {
      clientId: APP.id,
      redirectUri: APP.redirectUris[0],
      redirectUriSent: true,
      codeChallenge: CHALLENGE,
      scopes: ["read", "write"],
      state: "state-123",
      resource: RESOURCE,
    },
  });
  // state and resource are optional; loopback addresses may use any port.
  const loopback = check(link({ state: null, resource: null, scope: null, redirect_uri: "http://127.0.0.1:61000/callback" }));
  assert.ok(loopback.ok);
  assert.equal(loopback.request.state, null);
  assert.equal(loopback.request.redirectUri, "http://127.0.0.1:61000/callback");
  assert.deepEqual(loopback.request.scopes, ["read"]);
  // An app with one address may leave it out, and its token request may too.
  const single = check(link({ redirect_uri: null }), { ...APP, redirectUris: [APP.redirectUris[0]] });
  assert.ok(single.ok);
  assert.equal(single.request.redirectUri, APP.redirectUris[0]);
  assert.equal(single.request.redirectUriSent, false);
});

test("a link that's wrong about where to send the person stops on the page, never redirecting", () => {
  const badRedirect = { ok: false, fatal: FATAL_PROBLEMS.badRedirect };
  assert.deepEqual(check(link({ redirect_uri: "https://evil.example/callback" })), badRedirect);
  assert.deepEqual(check(link({ redirect_uri: "https://app.example/oauth/callback/" })), badRedirect);
  assert.deepEqual(check(link({ redirect_uri: [APP.redirectUris[0], APP.redirectUris[0]] })), badRedirect);
  // Leaving it out is fine only for an app with one address.
  assert.deepEqual(check(link({ redirect_uri: null })), badRedirect);
  // Even a link with every other mistake doesn't redirect to an unregistered address.
  assert.deepEqual(check(link({ redirect_uri: "https://evil.example/callback", response_type: "token", code_challenge: null })), badRedirect);

  assert.deepEqual(readClientId(link({ client_id: null })), { ok: false, fatal: FATAL_PROBLEMS.missingClient });
  assert.deepEqual(readClientId(link({ client_id: [APP.id, "https://other.example/client.json"] })), { ok: false, fatal: FATAL_PROBLEMS.missingClient });
  assert.deepEqual(readClientId(link()), { ok: true, clientId: APP.id });
});

test("every other mistake goes back to the app as an OAuth error, with state and iss", () => {
  const at = APP.redirectUris[0];
  const expectError = (params: URLSearchParams, error: string, state: string | null = "state-123") => {
    const answer = returned(check(params));
    assert.equal(answer.at, at);
    assert.equal(answer.error, error);
    assert.equal(answer.iss, ORIGIN);
    assert.equal(answer.state ?? null, state);
    assert.ok(answer.error_description);
  };
  expectError(link({ response_type: null }), "invalid_request");
  expectError(link({ response_type: "token" }), "unsupported_response_type");
  expectError(link({ response_type: ["code", "code"] }), "invalid_request");
  expectError(link({ code_challenge: null }), "invalid_request");
  expectError(link({ code_challenge: "too-short" }), "invalid_request");
  expectError(link({ code_challenge_method: null }), "invalid_request");
  expectError(link({ code_challenge_method: "plain" }), "invalid_request");
  expectError(link({ scope: "read admin" }), "invalid_scope");
  expectError(link({ scope: ["read", "write"] }), "invalid_request");
  expectError(link({ resource: "https://other.example/api/mcp" }), "invalid_target");
  expectError(link({ resource: [RESOURCE, RESOURCE] }), "invalid_target");
  // A state sent twice, or too long to send back, isn't sent back.
  expectError(link({ state: ["a", "b"] }), "invalid_request", null);
  expectError(link({ state: "s".repeat(4097) }), "invalid_request", null);
  assert.ok(check(link({ state: "s".repeat(4096) })).ok);
});

test("the answer to the app carries the code or the error, with state and iss", () => {
  const request = { redirectUri: "https://app.example/cb", state: "xyz" };
  assert.equal(authorizationResponse(request, ORIGIN, { code: "aim_ac_1" }), "https://app.example/cb?code=aim_ac_1&state=xyz&iss=https%3A%2F%2Fai-multi.example");
  const denied = new URL(authorizationResponse({ ...request, state: null }, ORIGIN, { error: "access_denied", description: "The person clicked Cancel." }));
  assert.deepEqual(Object.fromEntries(denied.searchParams), { error: "access_denied", error_description: "The person clicked Cancel.", iss: ORIGIN });
});

test("the metadata names every endpoint, PKCE S256 only, and the MCP endpoint's scopes", () => {
  const server = authorizationServerMetadata(ORIGIN);
  assert.equal(server.issuer, ORIGIN);
  assert.equal(server.authorization_endpoint, `${ORIGIN}/oauth/authorize`);
  assert.equal(server.token_endpoint, `${ORIGIN}/api/oauth/token`);
  assert.equal(server.registration_endpoint, `${ORIGIN}/api/oauth/register`);
  assert.equal(server.revocation_endpoint, `${ORIGIN}/api/oauth/revoke`);
  assert.deepEqual(server.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(server.response_types_supported, ["code"]);
  assert.deepEqual(server.grant_types_supported, ["authorization_code", "refresh_token"]);
  assert.deepEqual(server.scopes_supported, ["read", "write", "offline_access"]);
  assert.deepEqual(server.token_endpoint_auth_methods_supported, ["none", "client_secret_post", "client_secret_basic"]);
  assert.equal(server.authorization_response_iss_parameter_supported, true);
  assert.equal(server.client_id_metadata_document_supported, true);

  assert.deepEqual(protectedResourceMetadata(ORIGIN), {
    resource: RESOURCE,
    authorization_servers: [ORIGIN],
    // "write" for the tools that make changes (#479).
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"],
    resource_name: "AI Multi",
  });
});
