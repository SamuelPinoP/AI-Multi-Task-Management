import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_PATH_HEADER, SESSION_COOKIE_NAME } from "@/lib/auth-constants";

const publicPaths = new Set(["/", "/login", "/signup", "/forgot-password", "/reset-password", "/verify-email"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (!hasSession && !publicPaths.has(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  // A cookie whose session has ended still gets this far. Pages then send the
  // visitor to log in and back here (requirePageUser in src/lib/auth.ts), so
  // they need the address; it replaces anything the browser sent under that name.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATH_HEADER, `${pathname}${search}`);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // The installable app's files must load signed out too: browsers fetch the
  // manifest, icons and service worker without following a login redirect.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|uploads|sw.js|manifest.webmanifest|icons/).*)"],
};
