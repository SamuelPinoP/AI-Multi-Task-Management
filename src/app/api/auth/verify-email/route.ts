import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { confirmEmailWithToken, sendEmailVerification } from "@/lib/email-verification";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";

/** The link in the confirmation email. Works signed out, so it can be opened on any device. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const confirmed = await confirmEmailWithToken(url.searchParams.get("token") ?? "");
  return NextResponse.redirect(new URL(`/verify-email?status=${confirmed ? "confirmed" : "invalid"}`, url), 303);
}

/** Sends a new confirmation link to the signed-in user. */
export async function POST(req: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.isGuest) return NextResponse.json({ error: "Guest workspaces have no email to confirm." }, { status: 400 });
  if (user.emailVerifiedAt) return NextResponse.json({ error: "Your email is already confirmed." }, { status: 409 });

  const limit = await consumeRateLimit(RATE_LIMITS.verifyEmailResendUser, user.id);
  if (!limit.allowed) return rateLimitedResponse("confirmation emails", limit);

  const result = await sendEmailVerification(user, new URL(req.url).origin);
  if (result.status === "failed") return NextResponse.json({ error: result.message }, { status: 502 });
  return NextResponse.json({ message: result.status === "sent" ? `We sent a link to ${user.email}. It expires in 24 hours.` : result.message });
}
