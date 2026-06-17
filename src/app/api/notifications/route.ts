import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { buildNotificationsForUser, markAllNotificationsRead, setNotificationState } from "@/lib/notifications";

export async function GET() {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const notifications = await buildNotificationsForUser(user);
    return NextResponse.json({ notifications, unreadCount: notifications.filter((notification) => !notification.readAt).length });
  } catch (error) {
    console.error("GET /api/notifications error:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (body.action === "MARK_ALL_READ") {
      const updated = await markAllNotificationsRead(user);
      return NextResponse.json({ updated });
    }
    const sourceKey = typeof body.sourceKey === "string" ? body.sourceKey : "";
    if (!sourceKey) return NextResponse.json({ error: "sourceKey is required" }, { status: 400 });
    if (body.action !== "MARK_READ" && body.action !== "DISMISS") {
      return NextResponse.json({ error: "Unsupported notification action" }, { status: 400 });
    }
    const notification = await setNotificationState(user, sourceKey, { read: true, dismiss: body.action === "DISMISS" });
    if (!notification) return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    return NextResponse.json({ notification });
  } catch (error) {
    console.error("PATCH /api/notifications error:", error);
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 });
  }
}
