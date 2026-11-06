import { NextResponse } from "next/server";
import { getSafeRedirectPath } from "@/lib/auth";
import { authPageHref } from "@/lib/auth-links";
import { GOOGLE_SIGN_IN_COOKIE, GOOGLE_SIGN_IN_PATH, getGoogleSignInConfig, googleRedirectUri } from "@/lib/google-auth";
import { googleAuthorizationUrl, randomUrlSafe } from "@/lib/google-auth-core";

/** Long enough to pick an account at Google, short enough that a stale sign-in can't be finished later. */
const SIGN_IN_WINDOW_SECONDS = 10 * 60;

/**
 * "Continue with Google" (#356): off to Google to choose an account. A form
 * post, so links aren't prefetched into sign-ins. The state, nonce and PKCE
 * verifier wait in a short-lived cookie that only the callback reads.
 */
export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const next = getSafeRedirectPath(String(formData?.get("next") ?? ""));
  const config = getGoogleSignInConfig();
  if (!config) return NextResponse.redirect(new URL(authPageHref("login", { error: "google-unavailable", next }), request.url), 303);

  const pending = { state: randomUrlSafe(), nonce: randomUrlSafe(), codeVerifier: randomUrlSafe(), next };
  const redirectUri = googleRedirectUri(new URL(request.url).origin);
  const response = NextResponse.redirect(googleAuthorizationUrl(config, { redirectUri, ...pending }), 303);
  response.cookies.set(GOOGLE_SIGN_IN_COOKIE, JSON.stringify(pending), {
    httpOnly: true,
    // Lax still comes along on Google's redirect back, a top-level navigation.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: GOOGLE_SIGN_IN_PATH,
    maxAge: SIGN_IN_WINDOW_SECONDS,
  });
  return response;
}
