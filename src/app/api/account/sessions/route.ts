import { NextResponse } from "next/server";
import { endOtherSessions, requireApiUser } from "@/lib/auth";

// "Log out of other devices" on the Account page (#354). Sessions last up to a
// year, so this ends every other one of the account at once; this browser stays.
export async function DELETE() {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (user.isGuest) {
      return NextResponse.json({ error: "A guest workspace is only signed in on this device." }, { status: 403 });
    }
    return NextResponse.json({ loggedOut: await endOtherSessions(user.id) });
  } catch (error) {
    console.error("DELETE /api/account/sessions error:", error);
    return NextResponse.json({ error: "Failed to log out of the other devices" }, { status: 500 });
  }
}
