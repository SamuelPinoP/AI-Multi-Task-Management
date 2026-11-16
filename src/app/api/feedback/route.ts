import { NextResponse } from "next/server";
import { parseAdminEmails } from "@/lib/app-admin-core";
import { requireApiUser } from "@/lib/auth";
import { sendFeedbackEmail } from "@/lib/email";
import { parseFeedback } from "@/lib/feedback-core";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";

const NOT_SENT = "Your feedback couldn't be sent. Try again in a minute.";

/**
 * Send feedback (#430): emails the message to every address in ADMIN_EMAILS, with the sender's
 * name, username and email, and whether they may be emailed about it. Nothing is stored. Only
 * signed-in accounts can send, guests can't, and each person gets RATE_LIMITS.feedbackUser.
 */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.isGuest) return NextResponse.json({ error: "Create an account to send feedback." }, { status: 403 });

  const feedback = parseFeedback(await request.json().catch(() => null));
  if ("error" in feedback) return NextResponse.json({ error: feedback.error }, { status: 400 });

  const recipients = [...parseAdminEmails(process.env.ADMIN_EMAILS)];
  if (recipients.length === 0) return NextResponse.json({ error: NOT_SENT }, { status: 503 });

  const limit = await consumeRateLimit(RATE_LIMITS.feedbackUser, user.id);
  if (!limit.allowed) return rateLimitedResponse("messages", limit);

  const sender = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true, username: true, email: true } });
  if (!sender) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const origin = request.headers.get("origin") ?? undefined;
  const results = await Promise.allSettled(
    recipients.map((to) => sendFeedbackEmail({ to, userId: user.id, ...sender, ...feedback, fallbackOrigin: origin })),
  );
  // Sent to at least one admin, or email is off here (local servers and tests): the person is done.
  const delivered = results.some((result) => result.status === "fulfilled" && result.value.status !== "failed");
  if (!delivered) {
    console.warn("Feedback email failed.", { recipients: recipients.length });
    return NextResponse.json({ error: NOT_SENT }, { status: 502 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
