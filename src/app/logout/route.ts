import { clearSession, getSafeRedirectPath } from "@/lib/auth";
import { redirect } from "next/navigation";

function getLogoutRedirect(request: Request) {
  const url = new URL(request.url);
  const nextPath = getSafeRedirectPath(url.searchParams.get("next"));

  if (nextPath !== "/") return nextPath;
  return "/login?error=logged-out";
}

export async function GET(request: Request) {
  await clearSession();
  redirect(getLogoutRedirect(request));
}

export async function POST(request: Request) {
  await clearSession();
  redirect(getLogoutRedirect(request));
}
