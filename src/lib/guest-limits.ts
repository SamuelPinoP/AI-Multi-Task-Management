import "server-only";
import { NextResponse } from "next/server";
import {
  accountRequiredRefusal,
  guestHasRoom,
  guestLimitRefusal,
  type GuestLimitKind,
  type GuestUsage,
} from "@/lib/guest-limits-core";
import { prisma } from "@/lib/prisma";

/** What the guest made themselves, trashed items included, so trashing frees nothing for long (#458). */
function ownWhere(userId: string) {
  return { userId, isStarter: false };
}

function countOwn(kind: GuestLimitKind, userId: string) {
  const where = ownWhere(userId);
  switch (kind) {
    case "tasks":
      return prisma.task.count({ where });
    case "events":
      return prisma.event.count({ where });
    case "notes":
      return prisma.note.count({ where });
    case "projects":
      return prisma.project.count({ where });
  }
}

/** The guest's counts for the guest profile; null for accounts, which have no limits. */
export async function getGuestUsage(user: { id: string; isGuest: boolean }): Promise<GuestUsage | null> {
  if (!user.isGuest) return null;
  const [tasks, events, notes, projects] = await Promise.all([
    countOwn("tasks", user.id),
    countOwn("events", user.id),
    countOwn("notes", user.id),
    countOwn("projects", user.id),
  ]);
  return { tasks, events, notes, projects };
}

/**
 * For a guest asking to make `adding` more than their workspace holds, the 403 to answer;
 * null when it fits, and always for accounts.
 */
export async function guestLimitResponse(user: { id: string; isGuest: boolean }, kind: GuestLimitKind, adding = 1) {
  if (!user.isGuest) return null;
  const used = await countOwn(kind, user.id);
  if (guestHasRoom({ tasks: 0, events: 0, notes: 0, projects: 0, [kind]: used }, kind, adding)) return null;
  return NextResponse.json(guestLimitRefusal(kind), { status: 403 });
}

/** For a guest, the 403 that says only accounts can do this; null for accounts. */
export function accountRequiredResponse(user: { isGuest: boolean }, reason: Parameters<typeof accountRequiredRefusal>[0]) {
  return user.isGuest ? NextResponse.json(accountRequiredRefusal(reason), { status: 403 }) : null;
}
