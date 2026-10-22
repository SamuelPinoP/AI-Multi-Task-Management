import "server-only";
import { createSecureToken, hashSecureToken } from "@/lib/auth";
import { sendEmailVerificationEmail, type EmailDeliveryResult } from "@/lib/email";
import { prisma } from "@/lib/prisma";

// Email verification (#130): invitations are matched by email address, so only
// someone who proved they own the address may answer them.

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Creates a confirmation link for the user's email and sends it. Earlier links keep working until they expire. */
export async function sendEmailVerification(user: { id: string; email: string }, fallbackOrigin?: string): Promise<EmailDeliveryResult> {
  const token = createSecureToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hashSecureToken(token),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    },
  });
  const baseUrl = (process.env.APP_BASE_URL?.trim() || fallbackOrigin || "http://localhost:3000").replace(/\/+$/, "");
  return sendEmailVerificationEmail({
    to: user.email,
    verifyUrl: `${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`,
  });
}

/**
 * Marks the email the link was sent to as confirmed and retires the user's other links.
 * Returns false for an unknown or expired link.
 */
export async function confirmEmailWithToken(token: string) {
  if (!token) return false;
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashSecureToken(token) },
    select: { userId: true, expiresAt: true },
  });
  if (!record || record.expiresAt <= new Date()) return false;

  await prisma.$transaction([
    prisma.user.updateMany({ where: { id: record.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerificationToken.deleteMany({ where: { userId: record.userId } }),
  ]);
  return true;
}

export const EMAIL_NOT_CONFIRMED_ERROR =
  "Confirm your email address before answering invitations. Use the link we emailed you, or get a new one from the banner at the top of the page.";
