"use server";

import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSafeRedirectPath, hashPassword, isPublicSignupEnabled, normalizeAuthEmail } from "@/lib/auth";
import { authPageHref } from "@/lib/auth-links";
import { sendEmailVerification } from "@/lib/email-verification";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { clientIpFrom, RATE_LIMITS, tooManyAttemptsMessage } from "@/lib/rate-limit-core";
import { checkUsername, USERNAME_TAKEN_MESSAGE } from "@/lib/username";

export type SignupField = "name" | "username" | "email" | "password";

export type SignupState = {
  error: string | null;
  /** The field the error is about, which the form marks and focuses. */
  field?: SignupField;
  /** The email has an account already, so the form offers "Log in instead". */
  emailTaken?: boolean;
  /** What was typed, so a failed attempt doesn't empty the form. Passwords never come back. */
  values: { name: string; username: string; email: string };
};

/**
 * Creates the account, then sends the person to log in. Errors come back to
 * the form (#351) instead of reloading the page, so nothing typed is lost.
 */
export async function signUp(_previous: SignupState, formData: FormData): Promise<SignupState> {
  const name = String(formData.get("name") || "").trim();
  const typedUsername = String(formData.get("username") || "");
  const email = normalizeAuthEmail(String(formData.get("email") || ""));
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");
  // Where to go after logging in, such as the invitations.
  const next = getSafeRedirectPath(String(formData.get("next") || ""));
  const values = { name, username: typedUsername.trim(), email };
  const failed = (error: string, field?: SignupField): SignupState => ({ error, field, values });

  if (!isPublicSignupEnabled()) return failed("Public signup is disabled for this deployment.");
  if (!name) return failed("Enter your name.", "name");
  const { username, error: usernameError } = checkUsername(typedUsername);
  if (usernameError) return failed(usernameError, "username");
  // The login form reads anything with an @ as an email (#351), so every account's email must have one.
  if (!email.includes("@")) return failed("Enter a valid email address.", "email");
  if (password.length < 8) return failed("Password must be at least 8 characters.", "password");
  if (password !== confirmPassword) return failed("Password and confirm password must match.", "password");

  const limit = await consumeRateLimit(RATE_LIMITS.signupIp, clientIpFrom(await headers()));
  if (!limit.allowed) return failed(tooManyAttemptsMessage("sign-ups from this network", limit.retryAfterSeconds));

  const taken = async (): Promise<SignupState | null> => {
    const [emailOwner, usernameOwner] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
      prisma.user.findUnique({ where: { username }, select: { id: true } }),
    ]);
    if (emailOwner) return { ...failed("An account with that email already exists.", "email"), emailTaken: true };
    if (usernameOwner) return failed(USERNAME_TAKEN_MESSAGE, "username");
    return null;
  };

  const alreadyTaken = await taken();
  if (alreadyTaken) return alreadyTaken;

  let user: { id: string; email: string };
  try {
    user = await prisma.user.create({
      data: { name, username, email, passwordHash: hashPassword(password) },
      select: { id: true, email: true },
    });
  } catch (error) {
    // Someone took the email or username between the check and now.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const nowTaken = await taken();
      if (nowTaken) return nowTaken;
    }
    throw error;
  }
  // If this email doesn't go through, the banner in the app sends a new one.
  await sendEmailVerification(user);

  redirect(authPageHref("login", { error: "created", email, next }));
}
