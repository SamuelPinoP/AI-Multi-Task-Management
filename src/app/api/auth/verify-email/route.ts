import { NextResponse } from "next/server";
import { type AuthUser, getSafeRedirectPath, getSessionUser, mustConfirmEmail } from "@/lib/auth";
import { confirmEmailHref } from "@/lib/auth-links";
import {
  ALREADY_CONFIRMED_MESSAGE,
  changeConfirmationEmail,
  type ConfirmationEmailResult,
  confirmEmailWithToken,
  sendConfirmationEmail,
} from "@/lib/email-verification";

/**
 * The link in the confirmation email. Works signed out, so it can be opened on
 * any device. In the browser that signed up, the account is ready to use, so
 * it carries on to where it was going (#350); elsewhere the page says how it went.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = getSafeRedirectPath(url.searchParams.get("next"));
  const userId = await confirmEmailWithToken(url.searchParams.get("token") ?? "");
  if (userId && (await getSessionUser())?.id === userId) return NextResponse.redirect(new URL(next, url), 303);
  return NextResponse.redirect(new URL(confirmEmailHref({ status: userId ? "confirmed" : "invalid", next }), url), 303);
}

type Waiting = { user: AuthUser; refusal?: undefined } | { user?: undefined; refusal: NextResponse };

/** The signed-in account that's waiting for its email to be confirmed, or why there isn't one. */
async function waitingAccount(): Promise<Waiting> {
  const user = await getSessionUser();
  if (!user) return { refusal: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  if (user.isGuest) return { refusal: NextResponse.json({ error: "Guest workspaces have no email to confirm." }, { status: 400 }) };
  // Confirmed from another tab or device: `code` tells the page to move on.
  if (!mustConfirmEmail(user)) return { refusal: NextResponse.json({ error: ALREADY_CONFIRMED_MESSAGE, code: "confirmed" }, { status: 409 }) };
  return { user };
}

async function readBody(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; next?: unknown } | null;
  return {
    email: typeof body?.email === "string" ? body.email : "",
    next: getSafeRedirectPath(typeof body?.next === "string" ? body.next : null),
    origin: new URL(request.url).origin,
  };
}

/** 200 when the email went out, 429 with Retry-After while the account must wait, 502 when it couldn't be sent. */
function emailResponse(result: ConfirmationEmailResult, extra: Record<string, unknown> = {}) {
  const { status, message, retryAfterSeconds } = result;
  if (status === "sent" || status === "disabled") return NextResponse.json({ message, retryAfterSeconds, ...extra });
  return NextResponse.json(
    { error: message, retryAfterSeconds, ...extra },
    status === "limited" ? { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } } : { status: 502 },
  );
}

/** "Resend email": another link, a minute after the last, at most 5 an hour and 10 a day. */
export async function POST(request: Request) {
  const waiting = await waitingAccount();
  if (waiting.refusal) return waiting.refusal;
  const { next, origin } = await readBody(request);
  return emailResponse(await sendConfirmationEmail(waiting.user, { next, origin }));
}

/** "Wrong address?": moves the unconfirmed account to another address and sends a link there. */
export async function PATCH(request: Request) {
  const waiting = await waitingAccount();
  if (waiting.refusal) return waiting.refusal;
  const { email, next, origin } = await readBody(request);
  const result = await changeConfirmationEmail(waiting.user, email, { next, origin });
  if ("error" in result) return NextResponse.json({ error: result.error, code: result.code }, { status: result.httpStatus });
  return emailResponse(result, { email: result.email });
}
