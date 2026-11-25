import "server-only";

import crypto from "node:crypto";
import type { AiDockState, SignInMethod } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authPageHref, confirmEmailHref } from "@/lib/auth-links";
import { prisma } from "@/lib/prisma";
import { getSafeRedirectPath } from "@/lib/safe-redirect";
import { renewedSessionEnd, sessionEndsAt, sessionLimit } from "@/lib/session-lifetime";
import { countryFromHeader, describeDevice, isLastActiveStale, lastActiveStaleBefore } from "@/lib/sign-in-history-core";
import { TIME_ZONE_COOKIE, timeZoneToSave } from "@/lib/user-time";

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

/** How a session started, for the sign-in history on the owner-only Users page. */
export type SignInDetails = {
  method: SignInMethod;
  /** The first session of an account that was just made. */
  newAccount?: boolean;
};

// The database stores only a SHA-256 fingerprint of each session token; the
// token itself lives in the browser cookie. A copy of the database therefore
// can't be used to log in as anyone.
//
// Every session also records a sign-in: when, how, the kind of device and the
// country Vercel reports, never the IP address or the whole user agent.
export async function createSessionRecord(userId: string, signIn: SignInDetails) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const requestHeaders = await headers();

  await prisma.$transaction([
    prisma.session.create({
      data: {
        token: hashSecureToken(token),
        userId,
        createdAt: now,
        expiresAt: sessionEndsAt(now, now),
      },
    }),
    prisma.signInEvent.create({
      data: {
        userId,
        method: signIn.method,
        newAccount: signIn.newAccount ?? false,
        device: describeDevice(requestHeaders.get("user-agent")),
        country: countryFromHeader(requestHeaders.get("x-vercel-ip-country")),
        createdAt: now,
      },
    }),
    prisma.user.update({ where: { id: userId }, data: { lastActiveAt: now } }),
  ]);

  return { token, cookieExpiresAt: sessionLimit(now) };
}

export async function createSession(userId: string, signIn: SignInDetails) {
  const { token, cookieExpiresAt } = await createSessionRecord(userId, signIn);

  const cookieStore = await cookies();
  cookieStore.set(
    SESSION_COOKIE_NAME,
    token,
    getSessionCookieOptions(cookieExpiresAt),
  );
  if (signIn.method !== "GUEST") cookieStore.set(...signedInBeforeCookie());
}

/**
 * Remembers that this browser has signed in to an account (#460), so `/` sends it to log in
 * instead of making a new guest workspace when its session has ended. It holds no identity.
 */
export const SIGNED_IN_BEFORE_COOKIE = "ai_multi_signed_in_before";

export function signedInBeforeCookie() {
  return [
    SIGNED_IN_BEFORE_COOKIE,
    "1",
    { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 400 * 24 * 60 * 60 },
  ] as const;
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
  await createSession(user.id, { method: "GUEST", newAccount: true });
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
 * unconfirmed ones; everything else calls getCurrentUser(). It also brings
 * where the AI bar shows (#308), which the root layout needs on every page,
 * so that costs no second query.
 */
export async function getSessionUser(): Promise<(AuthUser & { aiDock: AiDockState | null }) | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token: hashSecureToken(token) },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      user: {
        select: { id: true, name: true, email: true, isGuest: true, emailVerifiedAt: true, lastActiveAt: true, aiDock: true, timeZone: true },
      },
    },
  });

  if (!session) return null;

  const now = new Date();
  if (session.expiresAt <= now) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  const { lastActiveAt, timeZone: savedTimeZone, ...user } = session.user;
  const writes: Promise<unknown>[] = [];
  // Using the app keeps the session going (#354), with at most one write a day. Matching
  // the old end makes simultaneous requests write it once.
  const renewedEnd = renewedSessionEnd(session, now);
  if (renewedEnd) {
    writes.push(
      prisma.session.updateMany({
        where: { id: session.id, expiresAt: session.expiresAt },
        data: { expiresAt: renewedEnd },
      }),
    );
  }
  // The Users page's "last active", at most one write an hour, inside a request that's awake anyway.
  if (isLastActiveStale(lastActiveAt, now)) {
    writes.push(
      prisma.user.updateMany({
        where: { id: user.id, OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: lastActiveStaleBefore(now) } }] },
        data: { lastActiveAt: now },
      }),
    );
  }
  // The browser's zone, for AI apps connected over MCP, which send no cookie (#478). Written only when it
  // changes; matching the old value makes simultaneous requests write it once.
  const timeZone = timeZoneToSave(savedTimeZone, cookieStore.get(TIME_ZONE_COOKIE)?.value);
  if (timeZone) {
    writes.push(
      prisma.user.updateMany({
        where: { id: user.id, OR: [{ timeZone: null }, { timeZone: { not: timeZone } }] },
        data: { timeZone },
      }),
    );
  }
  await Promise.all(writes);

  return user;
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
