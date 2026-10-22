import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth-constants";

const publicPaths = new Set(["/", "/login", "/signup", "/forgot-password", "/reset-password"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  // Read-only share pages (SMART-12) open without an account; the token is the key.
  const isSharePage = pathname.startsWith("/share/");

  if (!hasSession && !publicPaths.has(pathname) && !isSharePage) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // The installable app's files must load signed out too: browsers fetch the
  // manifest, icons and service worker without following a login redirect.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|uploads|sw.js|manifest.webmanifest|icons/).*)"],
};
