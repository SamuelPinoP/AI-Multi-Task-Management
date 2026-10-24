import { NextRequest, NextResponse } from "next/server";
import { getSafeRedirectPath, hashSecureToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getLogoutRedirect(request: NextRequest) {
  // "Switch accounts?" on the log in and sign up pages sends the page to reopen signed out.
  const formData = await request.formData().catch(() => null);
  const next = formData?.get("next");
  const nextPath = typeof next === "string" ? getSafeRedirectPath(next) : "/";
  return new URL(nextPath === "/" ? "/login?error=logged-out" : nextPath, request.url);
}

function expireSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await prisma.session.deleteMany({ where: { token: hashSecureToken(token) } });
  }

  const response = NextResponse.redirect(await getLogoutRedirect(request), 303);
  expireSessionCookie(response);

  return response;
}
