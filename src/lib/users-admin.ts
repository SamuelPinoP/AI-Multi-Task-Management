import "server-only";

import type { ActivityAction, SignInMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { latestOf, sessionLastUsed, type MadeCounts } from "@/lib/users-admin-core";

/**
 * The data behind the owner-only Users page: every account with dates and counts, never the
 * content of what people wrote. Guests are left out. It's read when the page opens, never polled.
 */

export type UserListEntry = {
  id: string;
  name: string | null;
  username: string | null;
  email: string;
  signedUpAt: Date;
  confirmedAt: Date | null;
  hasPassword: boolean;
  hasGoogle: boolean;
  /** Sign-ins recorded in the history (kept a year; none before it existed). */
  signIns: number;
  lastSignInAt: Date | null;
  /** The latest sign of use: the last-active date, the sessions, or the last action. */
  lastActiveAt: Date | null;
  /** Days with a sign-in, a new session or a logged action. */
  activeDays: number;
  made: MadeCounts;
};

const MADE_COUNTS_SELECT = {
  tasks: true,
  notes: true,
  events: true,
  projects: true,
  projectComments: true,
  directMessages: true,
  oauthAccounts: true,
} as const;

function madeFrom(counts: { tasks: number; notes: number; events: number; projects: number; projectComments: number; directMessages: number }): MadeCounts {
  return {
    tasks: counts.tasks,
    notes: counts.notes,
    events: counts.events,
    projects: counts.projects,
    messages: counts.projectComments + counts.directMessages,
  };
}

/** Distinct days with a sign-in, a session start or a logged action, per account. */
async function activeDaysByUser(userId?: string) {
  const rows = userId
    ? await prisma.$queryRaw<Array<{ userId: string; days: number }>>`
        SELECT "userId", count(DISTINCT day)::int AS days FROM (
          SELECT "userId", "createdAt"::date AS day FROM "Activity" WHERE "userId" = ${userId}
          UNION SELECT "userId", "createdAt"::date FROM "SignInEvent" WHERE "userId" = ${userId}
          UNION SELECT "userId", "createdAt"::date FROM "Session" WHERE "userId" = ${userId}
        ) AS active GROUP BY "userId"`
    : await prisma.$queryRaw<Array<{ userId: string; days: number }>>`
        SELECT "userId", count(DISTINCT day)::int AS days FROM (
          SELECT "userId", "createdAt"::date AS day FROM "Activity"
          UNION SELECT "userId", "createdAt"::date FROM "SignInEvent"
          UNION SELECT "userId", "createdAt"::date FROM "Session"
        ) AS active GROUP BY "userId"`;
  return new Map(rows.map((row) => [row.userId, Number(row.days)]));
}

/**
 * Every account that isn't a guest, newest first, and when the oldest sign-in still kept was recorded:
 * sign-ins from before the history existed, or older than a year, aren't counted.
 */
export async function getUserList(): Promise<{ users: UserListEntry[]; signInsSince: Date | null }> {
  const [users, withPassword, sessions, signIns, actions, activeDays, oldestSignIn] = await Promise.all([
    prisma.user.findMany({
      where: { isGuest: false },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        createdAt: true,
        emailVerifiedAt: true,
        lastActiveAt: true,
        _count: { select: MADE_COUNTS_SELECT },
      },
    }),
    // Only whether there is a password; the hashes never leave the database.
    prisma.user.findMany({ where: { isGuest: false, passwordHash: { not: null } }, select: { id: true } }),
    prisma.session.groupBy({ by: ["userId"], _max: { createdAt: true, expiresAt: true } }),
    prisma.signInEvent.groupBy({ by: ["userId"], _count: { _all: true }, _max: { createdAt: true } }),
    prisma.activity.groupBy({ by: ["userId"], _max: { createdAt: true } }),
    activeDaysByUser(),
    prisma.signInEvent.aggregate({ _min: { createdAt: true } }),
  ]);

  const passwordIds = new Set(withPassword.map((user) => user.id));
  const sessionsByUser = new Map(sessions.map((row) => [row.userId, row._max]));
  const signInsByUser = new Map(signIns.map((row) => [row.userId, row]));
  const lastActionByUser = new Map(actions.map((row) => [row.userId, row._max.createdAt]));

  const entries = users.map((user) => {
    const session = sessionsByUser.get(user.id);
    const signIn = signInsByUser.get(user.id);
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      signedUpAt: user.createdAt,
      confirmedAt: user.emailVerifiedAt,
      hasPassword: passwordIds.has(user.id),
      hasGoogle: user._count.oauthAccounts > 0,
      signIns: signIn?._count._all ?? 0,
      lastSignInAt: signIn?._max.createdAt ?? null,
      lastActiveAt: latestOf(
        user.lastActiveAt,
        signIn?._max.createdAt,
        sessionLastUsed(session?.createdAt, session?.expiresAt),
        lastActionByUser.get(user.id),
      ),
      activeDays: activeDays.get(user.id) ?? 0,
      made: madeFrom(user._count),
    };
  });
  return { users: entries, signInsSince: oldestSignIn._min.createdAt };
}

export type UserDetail = UserListEntry & {
  /** Devices signed in right now. */
  signedInNow: number;
  /** Projects shared with them by someone else. */
  sharedProjects: number;
  signInHistory: Array<{ id: string; method: SignInMethod; newAccount: boolean; device: string | null; country: string | null; at: Date }>;
  activityCounts: Array<{ action: ActivityAction; count: number }>;
  recentActions: Array<{ id: string; action: ActivityAction; at: Date }>;
};

/** How many sign-ins and actions the person page lists. */
export const DETAIL_LIST_SIZE = 25;

/** One account in full, or null when there's no such account (or it's a guest). */
export async function getUserDetail(id: string, now = new Date()): Promise<UserDetail | null> {
  const user = await prisma.user.findFirst({
    where: { id, isGuest: false },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      createdAt: true,
      emailVerifiedAt: true,
      lastActiveAt: true,
      _count: { select: { ...MADE_COUNTS_SELECT, signInEvents: true } },
    },
  });
  if (!user) return null;

  const [passwordCount, session, signedInNow, sharedProjects, signInHistory, activityCounts, recentActions, activeDays] = await Promise.all([
    prisma.user.count({ where: { id, passwordHash: { not: null } } }),
    prisma.session.aggregate({ where: { userId: id }, _max: { createdAt: true, expiresAt: true } }),
    prisma.session.count({ where: { userId: id, expiresAt: { gt: now } } }),
    prisma.projectMember.count({ where: { userId: id, project: { userId: { not: id } } } }),
    prisma.signInEvent.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: DETAIL_LIST_SIZE,
      select: { id: true, method: true, newAccount: true, device: true, country: true, createdAt: true },
    }),
    prisma.activity.groupBy({ by: ["action"], where: { userId: id }, _count: { _all: true } }),
    // The kind of action and when, never its message: messages hold titles.
    prisma.activity.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: DETAIL_LIST_SIZE,
      select: { id: true, action: true, createdAt: true },
    }),
    activeDaysByUser(id),
  ]);

  const lastSignInAt = signInHistory[0]?.createdAt ?? null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    signedUpAt: user.createdAt,
    confirmedAt: user.emailVerifiedAt,
    hasPassword: passwordCount > 0,
    hasGoogle: user._count.oauthAccounts > 0,
    signIns: user._count.signInEvents,
    lastSignInAt,
    lastActiveAt: latestOf(
      user.lastActiveAt,
      lastSignInAt,
      sessionLastUsed(session._max.createdAt, session._max.expiresAt),
      recentActions[0]?.createdAt,
    ),
    activeDays: activeDays.get(id) ?? 0,
    made: madeFrom(user._count),
    signedInNow,
    sharedProjects,
    signInHistory: signInHistory.map(({ createdAt, ...signIn }) => ({ ...signIn, at: createdAt })),
    activityCounts: activityCounts.map((row) => ({ action: row.action, count: row._count._all })),
    recentActions: recentActions.map(({ createdAt, ...action }) => ({ ...action, at: createdAt })),
  };
}
