import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Turns a guest workspace into an account, keeping everything in it (#459): the same user stops
 * being a guest and gets the new account's details. Its guest sessions end, so the account starts
 * its own. Its sign-up date becomes today, the day the account began. Null when the user isn't a
 * guest any more (the daily cleanup deleted it, or another tab signed up first).
 */
export async function upgradeGuest(
  guestId: string,
  data: Pick<Prisma.UserUpdateInput, "email" | "name" | "username" | "passwordHash" | "emailVerifiedAt" | "oauthAccounts">,
): Promise<{ id: string; email: string } | null> {
  try {
    const [user] = await prisma.$transaction([
      prisma.user.update({
        where: { id: guestId, isGuest: true },
        data: { ...data, isGuest: false, createdAt: new Date() },
        select: { id: true, email: true },
      }),
      prisma.session.deleteMany({ where: { userId: guestId } }),
    ]);
    return user;
  } catch (error) {
    // No such guest: P2025 is Prisma's "record to update not found".
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return null;
    throw error;
  }
}
