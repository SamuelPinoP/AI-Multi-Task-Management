import { NextResponse } from "next/server";
import { sendDueReminders } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called daily by Vercel Cron (vercel.json) at 13:00 UTC, 9 AM in New York.
// It adds "due today" and "due tomorrow" reminders to the inbox and pushes
// them (SMART-08). Each task and due date gets one reminder, so a repeat call
// adds nothing and the route is safe without a secret; if CRON_SECRET is set,
// it is required (Vercel sends it as a bearer token).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendDueReminders();
    console.log("due_reminders_done", result);
    return NextResponse.json(result);
  } catch (error) {
    console.error("due_reminders_failed", { error: error instanceof Error ? error.message : "Unknown error" });
    return NextResponse.json({ error: "The reminders failed." }, { status: 500 });
  }
}
