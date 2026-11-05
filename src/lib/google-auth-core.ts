// Sign in with Google (#356): the pure parts of Google's OpenID Connect code
// flow. Kept free of server-only imports so they can be unit tested with plain
// Node. The flow itself is in src/lib/google-auth.ts.
import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_PROVIDER = "google";

/** Google writes either form in `iss`. */
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export type GoogleSignInConfig = {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
};

/**
 * The OAuth client from GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or null
 * when either is missing, which hides the button. GOOGLE_OAUTH_URL points the
 * tests at a local stand-in that answers under Google's own paths.
 */
export function googleSignInConfig(env: Record<string, string | undefined>): GoogleSignInConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const standIn = env.GOOGLE_OAUTH_URL?.trim().replace(/\/+$/, "");
  return {
    clientId,
    clientSecret,
    authorizeUrl: `${standIn || "https://accounts.google.com"}/o/oauth2/v2/auth`,
    tokenUrl: standIn ? `${standIn}/token` : "https://oauth2.googleapis.com/token",
  };
}

/** A random, URL-safe value for `state`, `nonce` and the PKCE verifier: 32 bytes. */
export function randomUrlSafe() {
  return randomBytes(32).toString("base64url");
}

/** PKCE's S256 challenge for a verifier (RFC 7636). */
export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Where to send the browser to choose a Google account. */
export function googleAuthorizationUrl(
  config: Pick<GoogleSignInConfig, "clientId" | "authorizeUrl">,
  { redirectUri, state, nonce, codeVerifier }: { redirectUri: string; state: string; nonce: string; codeVerifier: string },
) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: pkceChallenge(codeVerifier),
    code_challenge_method: "S256",
    // Always ask which account, so someone signed in to several can pick the right one.
    prompt: "select_account",
  });
  return `${config.authorizeUrl}?${params}`;
}

/**
 * The claims of an ID token. Its signature isn't checked: the token comes
 * straight from Google's token endpoint over TLS, in exchange for a one-time
 * code and our client secret, which OpenID Connect Core 3.1.3.7 accepts in
 * place of the signature. Every claim that matters is checked in checkIdToken.
 */
export function readIdToken(idToken: unknown): Record<string, unknown> | null {
  if (typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return claims && typeof claims === "object" && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type GoogleIdentity = {
  /** Google's id for the person; it never changes. */
  sub: string;
  /** Lowercase. */
  email: string;
  name: string | null;
  /** The Google Workspace domain (`hd`), or null for a personal account. */
  hostedDomain: string | null;
};

export type IdTokenCheck =
  | { ok: true; identity: GoogleIdentity }
  | { ok: false; reason: "malformed" | "issuer" | "audience" | "expired" | "nonce" | "unverified-email" };

/** Checks that the token is Google's, for this app, still valid, from this sign-in, and for a confirmed address. */
export function checkIdToken(
  claims: Record<string, unknown> | null,
  { clientId, nonce, now }: { clientId: string; nonce: string; now: Date },
): IdTokenCheck {
  if (!claims) return { ok: false, reason: "malformed" };
  const { iss, aud, exp, sub, email, email_verified: emailVerified, name, hd } = claims;
  if (typeof iss !== "string" || !GOOGLE_ISSUERS.has(iss)) return { ok: false, reason: "issuer" };
  if (!(Array.isArray(aud) ? aud : [aud]).includes(clientId)) return { ok: false, reason: "audience" };
  if (typeof exp !== "number" || exp * 1000 <= now.getTime()) return { ok: false, reason: "expired" };
  // Ties the token to the browser that started this sign-in, so it can't be replayed into another.
  if (typeof claims.nonce !== "string" || claims.nonce !== nonce) return { ok: false, reason: "nonce" };
  if (typeof sub !== "string" || !sub || typeof email !== "string" || !email.includes("@")) return { ok: false, reason: "malformed" };
  // A boolean today; older tokens sent the string "true".
  if (emailVerified !== true && emailVerified !== "true") return { ok: false, reason: "unverified-email" };
  return {
    ok: true,
    identity: {
      sub,
      email: email.trim().toLowerCase(),
      name: typeof name === "string" && name.trim() ? name.trim() : null,
      hostedDomain: typeof hd === "string" && hd ? hd.toLowerCase() : null,
    },
  };
}

/**
 * Whether Google vouches for the address today, so it may open an account that
 * already has it. Google's guidance: it does for Gmail addresses and for
 * Google Workspace accounts (an `hd` claim). For any other address,
 * email_verified only says Google checked it when the Google account was made,
 * and someone else may own the address now. Callers have already required
 * email_verified (checkIdToken).
 */
export function isGoogleAuthoritative(identity: Pick<GoogleIdentity, "email" | "hostedDomain">) {
  return identity.email.endsWith("@gmail.com") || identity.hostedDomain !== null;
}

export type GoogleSignInPlan =
  /** The Google account is already linked: log in as its user. */
  | { action: "sign-in"; userId: string }
  /**
   * An account has the address and Google vouches for it: link and log in.
   * If that account never confirmed its email, whoever chose its password never
   * proved they own the address, so the password and sessions go (pre-hijacking).
   */
  | { action: "link"; userId: string; dropUnconfirmedPassword: boolean }
  /** Nobody has the address: Google's sign-in is the sign-up. */
  | { action: "create" }
  | { action: "refuse"; reason: "account-exists" | "signup-disabled" };

/** What a verified Google sign-in does, from what the database already has. */
export function planGoogleSignIn({
  linkedUserId,
  existingUser,
  identity,
  signupEnabled,
}: {
  linkedUserId: string | null;
  existingUser: { id: string; emailVerifiedAt: Date | null } | null;
  identity: Pick<GoogleIdentity, "email" | "hostedDomain">;
  signupEnabled: boolean;
}): GoogleSignInPlan {
  if (linkedUserId) return { action: "sign-in", userId: linkedUserId };
  if (existingUser) {
    if (!isGoogleAuthoritative(identity)) return { action: "refuse", reason: "account-exists" };
    return { action: "link", userId: existingUser.id, dropUnconfirmedPassword: !existingUser.emailVerifiedAt };
  }
  return signupEnabled ? { action: "create" } : { action: "refuse", reason: "signup-disabled" };
}

/** What the login page says when Google sign-in doesn't work out, by its `error` code. */
export const GOOGLE_SIGN_IN_ERRORS = {
  "google-cancelled": "Google sign-in was cancelled.",
  "google-failed": "Google sign-in didn't work. Try again.",
  "google-unverified": "Google hasn't confirmed that email address, so it can't be used to sign in.",
  "google-account-exists": "An account with this email already exists. Log in with your email or username and password.",
  "google-signup-disabled": "No account uses that Google address, and sign-up is closed on this deployment.",
  "google-unavailable": "Google sign-in isn't set up on this deployment.",
} as const;

export type GoogleSignInError = keyof typeof GOOGLE_SIGN_IN_ERRORS;

export function googleSignInErrorMessage(error: string | undefined) {
  return error && Object.hasOwn(GOOGLE_SIGN_IN_ERRORS, error) ? GOOGLE_SIGN_IN_ERRORS[error as GoogleSignInError] : null;
}
