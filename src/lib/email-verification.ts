import "server-only";
import { Prisma } from "@prisma/client";
import { createSecureToken, hashSecureToken, normalizeAuthEmail } from "@/lib/auth";
import { sendEmailVerificationEmail } from "@/lib/email";
import {
  CONFIRMATION_LINK_TTL_MS,
  confirmationLinkUrl,
  isUsableEmail,
  RESEND_COOLDOWN_SECONDS,
  resendTooSoonMessage,
  secondsUntilResend,
  tooManyConfirmationEmailsMessage,
} from "@/lib/email-confirmation-core";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, consumeRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";

// Email confirmation (#130). An account can't be used until someone opens the
// link sent to its address, which proves they own it (#350). Sending follows
// what professional apps do: a minute between emails, with a countdown, and
// at most 5 an hour and 10 a day per account, against Gmail's 500 a day for
// the whole app.

export type ConfirmationEmailResult = {
  /** "disabled" where no email provider is set up: local servers, previews and CI. */
  status: "sent" | "disabled" | "failed" | "limited";
  message: string;
  /** Seconds until another email may be asked for; 0 when it may be right away. */
  retryAfterSeconds: number;
};

type Recipient = { id: string; email: string };
type LinkOptions = { /** Where the link continues to, such as the invitations. */ next: string; origin?: string };

/** The newest link sent to the account, if any: when it went out and when it stops working. */
export async function newestConfirmationLink(userId: string) {
  return prisma.emailVerificationToken.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, expiresAt: true },
  });
}

function confirmationUrl(token: string, { next, origin }: LinkOptions) {
  return confirmationLinkUrl(process.env.APP_BASE_URL?.trim() || origin || "http://localhost:3000", token, next);
}

/**
 * Counts one email against the account's hourly and daily caps. Returns how
 * long to wait instead when either is used up; a refusal isn't counted.
 */
async function takeEmailAllowance(userId: string) {
  const caps = [RATE_LIMITS.confirmationEmailsHour, RATE_LIMITS.confirmationEmailsDay];
  const checks = await Promise.all(caps.map((rule) => checkRateLimit(rule, userId)));
  const waits = checks.filter((check) => !check.allowed).map((check) => check.retryAfterSeconds);
  if (waits.length) return Math.max(...waits);
  await Promise.all(caps.map((rule) => consumeRateLimit(rule, userId)));
  return 0;
}

/** Makes a link, sends it, and forgets it again if the email didn't go out. */
async function deliverLink(user: Recipient, options: LinkOptions): Promise<ConfirmationEmailResult> {
  const token = createSecureToken();
  // Set here rather than by the column's default, whose time zone is the database's:
  // the wait before the next email is counted from it.
  const sentAt = new Date();
  const link = await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hashSecureToken(token),
      createdAt: sentAt,
      expiresAt: new Date(sentAt.getTime() + CONFIRMATION_LINK_TTL_MS),
    },
    select: { id: true },
  });
  const result = await sendEmailVerificationEmail({ to: user.email, verifyUrl: confirmationUrl(token, options) });
  if (result.status === "failed") {
    // Nobody has this link, so it mustn't hold up the next try.
    await prisma.emailVerificationToken.deleteMany({ where: { id: link.id } });
    return { status: "failed", message: "We couldn't send the email just now. Try again in a moment.", retryAfterSeconds: 0 };
  }
  return {
    status: result.status,
    message: result.status === "sent" ? `We sent a new link to ${user.email}.` : result.message,
    retryAfterSeconds: RESEND_COOLDOWN_SECONDS,
  };
}

/**
 * Sends a confirmation link to the account's address: when it signs up, and
 * each time "Resend email" is pressed. Earlier links keep working until they
 * expire, so whichever email arrives first will do.
 */
export async function sendConfirmationEmail(user: Recipient, options: LinkOptions): Promise<ConfirmationEmailResult> {
  const wait = secondsUntilResend((await newestConfirmationLink(user.id))?.createdAt, new Date());
  if (wait > 0) return { status: "limited", message: resendTooSoonMessage(wait), retryAfterSeconds: wait };

  const capWait = await takeEmailAllowance(user.id);
  if (capWait > 0) return { status: "limited", message: tooManyConfirmationEmailsMessage(capWait), retryAfterSeconds: capWait };

  return deliverLink(user, options);
}

/** `code: "confirmed"` tells the page the email was confirmed meanwhile, so it can move on. */
export type ChangeEmailResult =
  | { error: string; httpStatus: 400 | 409; code?: "confirmed" }
  | (ConfirmationEmailResult & { email: string });

const EMAIL_TAKEN_MESSAGE = "An account with that email already exists.";
export const ALREADY_CONFIRMED_MESSAGE = "Your email is already confirmed.";

/**
 * "Wrong address?" on the Check your email page: moves an unconfirmed account
 * to another address and sends a link there. Links sent to the old address
 * stop working. No wait after the last email, since it goes somewhere new,
 * but it counts against the account's caps.
 */
export async function changeConfirmationEmail(user: Recipient, typedEmail: string, options: LinkOptions): Promise<ChangeEmailResult> {
  const email = normalizeAuthEmail(typedEmail);
  if (!isUsableEmail(email)) return { error: "Enter a valid email address.", httpStatus: 400 };
  if (email === normalizeAuthEmail(user.email)) {
    return { error: "That's the address we sent the link to. If it hasn't arrived, use Resend email.", httpStatus: 400 };
  }
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) return { error: EMAIL_TAKEN_MESSAGE, httpStatus: 409 };

  const capWait = await takeEmailAllowance(user.id);
  if (capWait > 0) {
    return { status: "limited", message: tooManyConfirmationEmailsMessage(capWait), retryAfterSeconds: capWait, email: user.email };
  }

  try {
    await prisma.$transaction([
      // Only while it's unconfirmed: a confirmed address is never swapped this way.
      prisma.user.update({ where: { id: user.id, emailVerifiedAt: null }, data: { email } }),
      prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } }),
    ]);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Someone took the address between the check and now.
      if (error.code === "P2002") return { error: EMAIL_TAKEN_MESSAGE, httpStatus: 409 };
      // The email was confirmed in the meantime, from a link opened elsewhere.
      if (error.code === "P2025") return { error: ALREADY_CONFIRMED_MESSAGE, httpStatus: 409, code: "confirmed" };
    }
    throw error;
  }

  const result = await deliverLink({ id: user.id, email }, options);
  return { ...result, email, message: result.status === "sent" ? `We sent a link to ${email}.` : result.message };
}

/**
 * Confirms the email a link was sent to, retires the account's other links and
 * returns the account's id; null for an unknown or expired link. The link
 * itself keeps working until it expires, so opening it twice (an email
 * scanner may open it first) still says the email is confirmed.
 */
export async function confirmEmailWithToken(token: string) {
  if (!token) return null;
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashSecureToken(token) },
    select: { id: true, userId: true, expiresAt: true },
  });
  if (!record || record.expiresAt <= new Date()) return null;

  await prisma.$transaction([
    prisma.user.updateMany({ where: { id: record.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerificationToken.deleteMany({ where: { userId: record.userId, id: { not: record.id } } }),
  ]);
  return record.userId;
}

/** Guests have no email to confirm, so they can't answer invitations (#221). */
export const EMAIL_NOT_CONFIRMED_ERROR = "Only accounts with a confirmed email can answer invitations.";
