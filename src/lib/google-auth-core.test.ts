import assert from "node:assert/strict";
import test from "node:test";
import {
  checkIdToken,
  googleAuthorizationUrl,
  googleSignInConfig,
  googleSignInErrorMessage,
  isGoogleAuthoritative,
  pkceChallenge,
  planGoogleSignIn,
  randomUrlSafe,
  readIdToken,
} from "./google-auth-core";

const clientId = "123-abc.apps.googleusercontent.com";
const now = new Date("2026-11-05T12:00:00Z");
const nowSeconds = now.getTime() / 1000;

/** An ID token as Google's token endpoint returns it; the signature part isn't read. */
function idToken(claims: Record<string, unknown>) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256", kid: "test" })}.${part(claims)}.signature`;
}

const goodClaims = {
  iss: "https://accounts.google.com",
  aud: clientId,
  exp: nowSeconds + 3600,
  iat: nowSeconds,
  nonce: "the-nonce",
  sub: "110169484474386276334",
  email: "Sam.Pino@Gmail.com",
  email_verified: true,
  name: " Sam Pino ",
};

const check = (claims: Record<string, unknown>) => checkIdToken(readIdToken(idToken(claims)), { clientId, nonce: "the-nonce", now });

test("Google sign-in is on only with both halves of the OAuth client", () => {
  assert.equal(googleSignInConfig({}), null);
  assert.equal(googleSignInConfig({ GOOGLE_CLIENT_ID: clientId }), null);
  assert.equal(googleSignInConfig({ GOOGLE_CLIENT_ID: " ", GOOGLE_CLIENT_SECRET: "secret" }), null);
  assert.deepEqual(googleSignInConfig({ GOOGLE_CLIENT_ID: ` ${clientId} `, GOOGLE_CLIENT_SECRET: "secret" }), {
    clientId,
    clientSecret: "secret",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
  });
  // The tests' stand-in answers under Google's own paths.
  const standIn = googleSignInConfig({ GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: "s", GOOGLE_OAUTH_URL: "http://127.0.0.1:4100/" });
  assert.equal(standIn?.authorizeUrl, "http://127.0.0.1:4100/o/oauth2/v2/auth");
  assert.equal(standIn?.tokenUrl, "http://127.0.0.1:4100/token");
});

test("PKCE uses S256 (RFC 7636, appendix B)", () => {
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const value = randomUrlSafe();
  assert.match(value, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(value, randomUrlSafe());
});

test("the authorization request asks for the account, with state, nonce and a PKCE challenge", () => {
  const url = new URL(
    googleAuthorizationUrl(
      { clientId, authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth" },
      { redirectUri: "https://app.example/api/auth/google/callback", state: "s1", nonce: "n1", codeVerifier: "v".repeat(43) },
    ),
  );
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: clientId,
    redirect_uri: "https://app.example/api/auth/google/callback",
    response_type: "code",
    scope: "openid email profile",
    state: "s1",
    nonce: "n1",
    code_challenge: pkceChallenge("v".repeat(43)),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
});

test("a good ID token gives the Google account's id, address and name", () => {
  assert.deepEqual(check(goodClaims), {
    ok: true,
    identity: { sub: goodClaims.sub, email: "sam.pino@gmail.com", name: "Sam Pino", hostedDomain: null },
  });
  // Older tokens: the issuer without https, email_verified as a string, aud as a list.
  assert.equal(check({ ...goodClaims, iss: "accounts.google.com", email_verified: "true", aud: [clientId] }).ok, true);
  const workspace = check({ ...goodClaims, email: "sam@Company.test", hd: "Company.test", name: "" });
  assert.deepEqual(workspace.ok && workspace.identity, { sub: goodClaims.sub, email: "sam@company.test", name: null, hostedDomain: "company.test" });
});

test("ID tokens that aren't Google's, aren't ours, or aren't from this sign-in are refused", () => {
  const reason = (claims: Record<string, unknown>) => {
    const result = check(claims);
    return result.ok ? "ok" : result.reason;
  };
  assert.equal(reason({ ...goodClaims, iss: "https://evil.example" }), "issuer");
  assert.equal(reason({ ...goodClaims, aud: "another-app.apps.googleusercontent.com" }), "audience");
  assert.equal(reason({ ...goodClaims, exp: nowSeconds }), "expired");
  assert.equal(reason({ ...goodClaims, exp: String(nowSeconds + 60) }), "expired");
  assert.equal(reason({ ...goodClaims, nonce: "another-nonce" }), "nonce");
  assert.equal(reason({ ...goodClaims, nonce: undefined }), "nonce");
  assert.equal(reason({ ...goodClaims, sub: "" }), "malformed");
  assert.equal(reason({ ...goodClaims, email: "no-at-sign" }), "malformed");
  assert.equal(reason({ ...goodClaims, email_verified: false }), "unverified-email");
  assert.equal(reason({ ...goodClaims, email_verified: undefined }), "unverified-email");
});

test("garbage in the token is refused, not thrown", () => {
  for (const token of [undefined, 42, "", "a.b", "a.b.c.d", `a.${Buffer.from("[1]").toString("base64url")}.c`, "a.not-json.c"]) {
    assert.equal(readIdToken(token), null, String(token));
  }
  assert.deepEqual(checkIdToken(null, { clientId, nonce: "n", now }), { ok: false, reason: "malformed" });
});

test("Google vouches for Gmail and Google Workspace addresses only", () => {
  assert.equal(isGoogleAuthoritative({ email: "sam@gmail.com", hostedDomain: null }), true);
  assert.equal(isGoogleAuthoritative({ email: "sam@company.test", hostedDomain: "company.test" }), true);
  assert.equal(isGoogleAuthoritative({ email: "sam@yahoo.com", hostedDomain: null }), false);
  assert.equal(isGoogleAuthoritative({ email: "sam@gmail.com.evil.test", hostedDomain: null }), false);
});

test("a sign-in logs in, links, creates or refuses an account", () => {
  const gmail = { email: "sam@gmail.com", hostedDomain: null };
  const yahoo = { email: "sam@yahoo.com", hostedDomain: null };
  const confirmed = { id: "u1", emailVerifiedAt: now };
  const unconfirmed = { id: "u2", emailVerifiedAt: null };

  // Linked before: that account, whatever the address says now.
  assert.deepEqual(planGoogleSignIn({ linkedUserId: "u9", existingUser: confirmed, identity: yahoo, signupEnabled: false }), {
    action: "sign-in",
    userId: "u9",
  });
  // The address has an account and Google vouches for it: link, dropping a password nobody proved.
  assert.deepEqual(planGoogleSignIn({ linkedUserId: null, existingUser: confirmed, identity: gmail, signupEnabled: true }), {
    action: "link",
    userId: "u1",
    dropUnconfirmedPassword: false,
  });
  assert.deepEqual(planGoogleSignIn({ linkedUserId: null, existingUser: unconfirmed, identity: gmail, signupEnabled: true }), {
    action: "link",
    userId: "u2",
    dropUnconfirmedPassword: true,
  });
  // Google doesn't vouch for it: the password has to be used.
  assert.deepEqual(planGoogleSignIn({ linkedUserId: null, existingUser: confirmed, identity: yahoo, signupEnabled: true }), {
    action: "refuse",
    reason: "account-exists",
  });
  // A new address signs up, unless sign-up is closed.
  assert.deepEqual(planGoogleSignIn({ linkedUserId: null, existingUser: null, identity: yahoo, signupEnabled: true }), { action: "create" });
  assert.deepEqual(planGoogleSignIn({ linkedUserId: null, existingUser: null, identity: gmail, signupEnabled: false }), {
    action: "refuse",
    reason: "signup-disabled",
  });
});

test("the login page has a message for each Google error, and ignores others", () => {
  assert.equal(googleSignInErrorMessage("google-cancelled"), "Google sign-in was cancelled.");
  assert.equal(googleSignInErrorMessage("invalid"), null);
  assert.equal(googleSignInErrorMessage("toString"), null);
  assert.equal(googleSignInErrorMessage(undefined), null);
});
