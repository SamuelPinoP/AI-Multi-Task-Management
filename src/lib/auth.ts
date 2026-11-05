import "server-only";

import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authPageHref, confirmEmailHref } from "@/lib/auth-links";
import { prisma } from "@/lib/prisma";
import { getSafeRedirectPath } from "@/lib/safe-redirect";
import { renewedSessionEnd, sessionEndsAt, sessionLimit } from "@/lib/session-lifetime";

import { DEMO_USER_EMAIL, GUEST_USER_EMAIL_DOMAIN, REQUEST_PATH_HEADER, SESSION_COOKIE_NAME } from "@/lib/auth-constants";

export { DEMO_USER_EMAIL, GUEST_USER_EMAIL_DOMAIN, SESSION_COOKIE_NAME };
export { getSafeRedirectPath };
const PASSWORD_KEYLEN = 64;

type SessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
  expires: Date;
};

function envFlagEnabled(name: string, defaultValue = true) {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === undefined || value === "") return defaultValue;
  return !["0", "false", "no", "off"].includes(value);
}

export function isGuestLoginEnabled() {
  return envFlagEnabled("GUEST_LOGIN_ENABLED");
}

export function isPublicSignupEnabled() {
  return envFlagEnabled("SIGNUP_ENABLED");
}

export type AuthUser = {
  id: string;
  name: string | null;
  email: string;
  isGuest: boolean;
  /** Null until the user confirms their email (#130). */
  emailVerifiedAt: Date | null;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function timingSafeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a, "hex");
  const bBuffer = Buffer.from(b, "hex");
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function normalizeAuthEmail(email: string) {
  return normalizeEmail(email);
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, PASSWORD_KEYLEN).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function createSecureToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSecureToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function verifyPassword(password: string, storedHash: string | null | undefined) {
  if (!storedHash) return false;
  const [algorithm, salt, hash] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, PASSWORD_KEYLEN).toString("hex");
  return timingSafeEqual(candidate, hash);
}

/**
 * The session cookie lasts as long as its session can, a year (#354). The
 * server ends the session sooner: after 30 days without use, or when it's
 * logged out. See src/lib/session-lifetime.ts.
 */
export function getSessionCookieOptions(cookieExpiresAt: Date): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.max(0, Math.floor((cookieExpiresAt.getTime() - Date.now()) / 1000)),
    expires: cookieExpiresAt,
  };
}

// The database stores only a SHA-256 fingerprint of each session token; the
// token itself lives in the browser cookie. A copy of the database therefore
// can't be used to log in as anyone.
export async function createSessionRecord(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();

  await prisma.session.create({
    data: {
      token: hashSecureToken(token),
      userId,
      createdAt: now,
      expiresAt: sessionEndsAt(now, now),
    },
  });

  return { token, cookieExpiresAt: sessionLimit(now) };
}

export async function createSession(userId: string) {
  const { token, cookieExpiresAt } = await createSessionRecord(userId);

  const cookieStore = await cookies();
  cookieStore.set(
    SESSION_COOKIE_NAME,
    token,
    getSessionCookieOptions(cookieExpiresAt),
  );
}

export async function createGuestUser() {
  if (!isGuestLoginEnabled()) {
    throw new Error("Guest login is disabled.");
  }

  const guestId = crypto.randomUUID();
  return prisma.user.create({
    data: {
      email: `guest-${guestId}@${GUEST_USER_EMAIL_DOMAIN}`,
      name: "Guest Workspace",
      isGuest: true,
    },
    select: { id: true },
  });
}

export async function createGuestSession() {
  const user = await createGuestUser();
  await createSession(user.id);
}

export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token: hashSecureToken(token) } });
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
}

/**
 * Whether the account has to confirm its email before it may use the app (#350).
 * Guest workspaces have no email to confirm.
 */
export function mustConfirmEmail(user: Pick<AuthUser, "isGuest" | "emailVerifiedAt">) {
  return !user.isGuest && !user.emailVerifiedAt;
}

/**
 * Whoever the session cookie belongs to, whether or not their email is
 * confirmed. Only the "Check your email" page and its routes need the
 * unconfirmed ones; everything else calls getCurrentUser().
 */
export async function getSessionUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token: hashSecureToken(token) },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      user: { select: { id: true, name: true, email: true, isGuest: true, emailVerifiedAt: true } },
    },
  });

  if (!session) return null;

  const now = new Date();
  if (session.expiresAt <= now) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  // Using the app keeps the session going (#354), with at most one write a day. Matching
  // the old end makes simultaneous requests write it once.
  const renewedEnd = renewedSessionEnd(session, now);
  if (renewedEnd) {
    await prisma.session.updateMany({
      where: { id: session.id, expiresAt: session.expiresAt },
      data: { expiresAt: renewedEnd },
    });
  }

  return session.user;
}

/**
 * The signed-in user. An account whose email isn't confirmed yet counts as
 * signed out, in every page and API route, until it is (#350).
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const user = await getSessionUser();
  return user && !mustConfirmEmail(user) ? user : null;
}

/**
 * The signed-in user, or off to log in. A session that has ended (unused for a
 * month, or logged out from another device) comes back to this page after
 * logging in: src/proxy.ts passes on the address that was asked for. An
 * account waiting for its email to be confirmed goes to "Check your email",
 * which continues here once it is (#350).
 */
export async function requirePageUser() {
  const user = await getSessionUser();
  if (user && !mustConfirmEmail(user)) return user;
  const next = getSafeRedirectPath((await headers()).get(REQUEST_PATH_HEADER));
  redirect(user ? confirmEmailHref({ next }) : authPageHref("login", { next }));
}

/** How many devices the user is signed in on, this one included (#354). */
export async function countActiveSessions(userId: string) {
  return prisma.session.count({ where: { userId, expiresAt: { gt: new Date() } } });
}

/** Logs the user out of every other device at once; returns how many were signed in. */
export async function endOtherSessions(userId: string) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return 0;
  const { count } = await prisma.session.deleteMany({
    where: { userId, token: { not: hashSecureToken(token) }, expiresAt: { gt: new Date() } },
  });
  return count;
}

export async function requireApiUser() {
  return getCurrentUser();
}
