import { after, NextResponse, type NextRequest } from "next/server";
import { createSessionRecord, getSafeRedirectPath, getSessionCookieOptions, getSessionUser, SESSION_COOKIE_NAME, signedInBeforeCookie } from "@/lib/auth";
import { authPageHref } from "@/lib/auth-links";
import {
  accountForGoogleIdentity,
  GOOGLE_SIGN_IN_COOKIE,
  GOOGLE_SIGN_IN_PATH,
  getGoogleSignInConfig,
  googleRedirectUri,
  readPendingSignIn,
  verifyGoogleSignIn,
} from "@/lib/google-auth";
import { alertAdminsOfNewAccount } from "@/lib/new-account-alert";
import { clientIpFrom } from "@/lib/rate-limit-core";

/**
 * Where Google sends the browser back (#356). Checks that this browser started
 * the sign-in (`state`), trades the code for the ID token, then logs in to the
 * account for that Google account, making it the first time. Problems go back
 * to the login page with a message.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const pending = readPendingSignIn(request.cookies.get(GOOGLE_SIGN_IN_COOKIE)?.value);
  // Checked when the sign-in started, and again here, so the cookie can only ever lead within the site.
  const next = getSafeRedirectPath(pending?.next);

  const finish = (path: string) => {
    const response = NextResponse.redirect(new URL(path, url), 303);
    // One try per trip to Google: the code and the cookie are both spent.
    response.cookies.set(GOOGLE_SIGN_IN_COOKIE, "", { path: GOOGLE_SIGN_IN_PATH, maxAge: 0 });
    return response;
  };
  const fail = (error: string, retry?: number) => finish(authPageHref("login", { error, retry, next }));

  // Not started in this browser, or started too long ago: never finish someone else's sign-in.
  if (!pending || url.searchParams.get("state") !== pending.state) return fail("google-failed");
  const googleError = url.searchParams.get("error");
  if (googleError) return fail(googleError === "access_denied" ? "google-cancelled" : "google-failed");
  const code = url.searchParams.get("code");
  const config = getGoogleSignInConfig();
  if (!config) return fail("google-unavailable");
  if (!code) return fail("google-failed");

  const verified = await verifyGoogleSignIn(config, { code, redirectUri: googleRedirectUri(url.origin), pending });
  if ("error" in verified) return fail(verified.error);

  // From a guest workspace, a new account keeps it (#459).
  const current = await getSessionUser();
  const account = await accountForGoogleIdentity(verified.identity, clientIpFrom(request.headers), current?.isGuest ? current.id : null);
  if ("error" in account) return fail(account.error);
  if ("retryAfterSeconds" in account) return fail("rate-limited", account.retryAfterSeconds);

  const { token, cookieExpiresAt } = await createSessionRecord(account.userId, { method: "GOOGLE", newAccount: account.created });
  if (account.created) {
    // The owner hears about it once the response is on its way (#429). Google accounts start without a username.
    const { identity } = verified;
    after(() => alertAdminsOfNewAccount({ id: account.userId, name: identity.name, username: null, email: identity.email }, "google", url.origin));
  }
  const response = finish(next);
  response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions(cookieExpiresAt));
  response.cookies.set(...signedInBeforeCookie());
  return response;
}
