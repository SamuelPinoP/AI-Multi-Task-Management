import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkUsername, USERNAME_TAKEN_MESSAGE } from "@/lib/username";

// The signed-in user's own account settings, from the Account page (#351).

/** Sets or changes the username, which can then be used to log in instead of the email. */
export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (user.isGuest) {
      return NextResponse.json({ error: "Guest workspaces can't have a username. Create an account to choose one." }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as { username?: unknown } | null;
    const { username, error } = checkUsername(typeof body?.username === "string" ? body.username : "");
    if (error) return NextResponse.json({ error }, { status: 400 });

    const owner = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (owner && owner.id !== user.id) return NextResponse.json({ error: USERNAME_TAKEN_MESSAGE }, { status: 409 });

    try {
      await prisma.user.update({ where: { id: user.id }, data: { username } });
    } catch (updateError) {
      // Someone else took it between the check and the update.
      if (updateError instanceof Prisma.PrismaClientKnownRequestError && updateError.code === "P2002") {
        return NextResponse.json({ error: USERNAME_TAKEN_MESSAGE }, { status: 409 });
      }
      throw updateError;
    }
    return NextResponse.json({ username });
  } catch (error) {
    console.error("PATCH /api/account error:", error);
    return NextResponse.json({ error: "Failed to save the username" }, { status: 500 });
  }
}
