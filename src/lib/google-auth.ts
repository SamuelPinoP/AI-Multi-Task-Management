import "server-only";
import { Prisma } from "@prisma/client";
import { isPublicSignupEnabled } from "@/lib/auth";
import {
  checkIdToken,
  GOOGLE_PROVIDER,
  type GoogleIdentity,
  type GoogleSignInConfig,
  type GoogleSignInError,
  googleSignInConfig,
  planGoogleSignIn,
  readIdToken,
} from "@/lib/google-auth-core";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";

// Sign in with Google (#356), using Google's OpenID Connect code flow with
// state, a nonce and PKCE. The first sign-in with a Google account creates the
// AI Multi account, already confirmed, so there's no form and no email to wait
// for; later ones find it by the Google account's id. Free: Google doesn't
// charge for sign-in, and each one is two requests to Google.

/** The OAuth client, or null when Google sign-in isn't set up here. */
export function getGoogleSignInConfig() {
  return googleSignInConfig(process.env);
}

export function isGoogleSignInEnabled() {
  return getGoogleSignInConfig() !== null;
}

/** Holds the sign-in's state, nonce, PKCE verifier and `next` between leaving for Google and coming back. */
export const GOOGLE_SIGN_IN_COOKIE = "ai_multi_task_google_signin";
export const GOOGLE_SIGN_IN_PATH = "/api/auth/google";
export const GOOGLE_CALLBACK_PATH = `${GOOGLE_SIGN_IN_PATH}/callback`;

export type PendingGoogleSignIn = { state: string; nonce: string; codeVerifier: string; next: string };

/** The address Google sends the browser back to; it must be listed on the OAuth client exactly. */
export function googleRedirectUri(requestOrigin: string) {
  return `${(process.env.APP_BASE_URL?.trim() || requestOrigin).replace(/\/+$/, "")}${GOOGLE_CALLBACK_PATH}`;
}

export function readPendingSignIn(value: string | undefined): PendingGoogleSignIn | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingGoogleSignIn>;
    const { state, nonce, codeVerifier, next } = parsed;
    if ([state, nonce, codeVerifier, next].every((part) => typeof part === "string" && part)) return parsed as PendingGoogleSignIn;
  } catch {
    // A cookie that isn't ours: start over.
  }
  return null;
}

/**
 * Trades the one-time code for the ID token and checks it. Failures are logged
 * with Google's error code, never a token or the client secret.
 */
export async function verifyGoogleSignIn(
  config: GoogleSignInConfig,
  { code, redirectUri, pending }: { code: string; redirectUri: string; pending: PendingGoogleSignIn },
): Promise<{ identity: GoogleIdentity } | { error: GoogleSignInError }> {
  let body: { id_token?: unknown; error?: unknown };
  try {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        code_verifier: pending.codeVerifier,
      }),
      // Vercel functions have short time limits; give up on a slow answer.
      signal: AbortSignal.timeout(10_000),
    });
    body = (await response.json().catch(() => ({}))) as typeof body;
    if (!response.ok) {
      console.error(`Google sign-in: the token endpoint answered ${response.status} (${String(body.error ?? "no error code")}).`);
      return { error: "google-failed" };
    }
  } catch (error) {
    console.error("Google sign-in: the token endpoint couldn't be reached.", error instanceof Error ? error.name : "");
    return { error: "google-failed" };
  }

  const checked = checkIdToken(readIdToken(body.id_token), { clientId: config.clientId, nonce: pending.nonce, now: new Date() });
  if (!checked.ok) {
    console.error(`Google sign-in: refused the ID token (${checked.reason}).`);
    return { error: checked.reason === "unverified-email" ? "google-unverified" : "google-failed" };
  }
  return { identity: checked.identity };
}

const linkedAccount = (sub: string) => ({ provider_providerAccountId: { provider: GOOGLE_PROVIDER, providerAccountId: sub } });

/**
 * The AI Multi account a verified Google identity logs in as: found by the
 * Google account's id, linked by address when Google vouches for it, or made
 * now. `clientIp` limits how many accounts one network makes, as sign-up does.
 */
export async function accountForGoogleIdentity(
  identity: GoogleIdentity,
  clientIp: string | null,
): Promise<{ userId: string } | { error: GoogleSignInError } | { retryAfterSeconds: number }> {
  const [linked, existingUser] = await Promise.all([
    prisma.oAuthAccount.findUnique({ where: linkedAccount(identity.sub), select: { id: true, userId: true, email: true } }),
    prisma.user.findUnique({ where: { email: identity.email }, select: { id: true, emailVerifiedAt: true } }),
  ]);
  const plan = planGoogleSignIn({ linkedUserId: linked?.userId ?? null, existingUser, identity, signupEnabled: isPublicSignupEnabled() });

  switch (plan.action) {
    case "sign-in":
      if (linked && linked.email !== identity.email) {
        await prisma.oAuthAccount.update({ where: { id: linked.id }, data: { email: identity.email } });
      }
      return { userId: plan.userId };

    case "link": {
      const now = new Date();
      await prisma.$transaction([
        prisma.oAuthAccount.create({
          data: { userId: plan.userId, provider: GOOGLE_PROVIDER, providerAccountId: identity.sub, email: identity.email },
        }),
        ...(plan.dropUnconfirmedPassword
          ? [
              // Google proved who owns the address, and it wasn't proven before: the password
              // was chosen by whoever signed up with it, so it stops working, and so do their sessions.
              prisma.user.update({ where: { id: plan.userId }, data: { emailVerifiedAt: now, passwordHash: null } }),
              prisma.session.deleteMany({ where: { userId: plan.userId } }),
              prisma.emailVerificationToken.deleteMany({ where: { userId: plan.userId } }),
            ]
          : []),
      ]);
      return { userId: plan.userId };
    }

    case "create": {
      const limit = await consumeRateLimit(RATE_LIMITS.signupIp, clientIp);
      if (!limit.allowed) return { retryAfterSeconds: limit.retryAfterSeconds };
      try {
        const user = await prisma.user.create({
          data: {
            email: identity.email,
            name: identity.name,
            emailVerifiedAt: new Date(),
            oauthAccounts: { create: { provider: GOOGLE_PROVIDER, providerAccountId: identity.sub, email: identity.email } },
          },
          select: { id: true },
        });
        return { userId: user.id };
      } catch (error) {
        // The same sign-in finished in another tab a moment ago, or the address was just taken.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "google-failed" };
        throw error;
      }
    }

    case "refuse":
      return { error: plan.reason === "account-exists" ? "google-account-exists" : "google-signup-disabled" };
  }
}
