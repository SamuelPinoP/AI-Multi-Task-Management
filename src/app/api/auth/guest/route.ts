import { NextResponse } from "next/server";
import {
  createGuestUser,
  createSessionRecord,
  getSafeRedirectPath,
  getSessionCookieOptions,
  isGuestLoginEnabled,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";

function redirectTo(request: Request, path: string, status = 303) {
  return NextResponse.redirect(new URL(path, request.url), status);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const nextPath = getSafeRedirectPath(String(formData.get("next") || ""));

  if (!isGuestLoginEnabled()) {
    return redirectTo(
      request,
      `/login?error=guest-disabled&next=${encodeURIComponent(nextPath)}`,
    );
  }

  const user = await createGuestUser();
  const { token, expiresAt } = await createSessionRecord(user.id);
  const response = redirectTo(request, nextPath);
  response.cookies.set(
    SESSION_COOKIE_NAME,
    token,
    getSessionCookieOptions(expiresAt),
  );

  return response;
}
