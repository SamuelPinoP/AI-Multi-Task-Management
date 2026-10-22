import { NextResponse } from "next/server";
import { runDailyCleanup } from "@/lib/daily-cleanup";
import { prisma } from "@/lib/prisma";
import { deleteProjectChatAttachments } from "@/lib/project-chat-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called daily by Vercel Cron (vercel.json), after the backup. It only deletes
// what has already expired or can no longer be signed in to, and a repeat call
// finds nothing new, so the route is safe without a secret; if CRON_SECRET is
// set, it is required (Vercel sends it as a bearer token).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDailyCleanup({ db: prisma, deleteStoredObjects: deleteProjectChatAttachments });
    console.log("daily_cleanup_done", result);
    return NextResponse.json(result);
  } catch (error) {
    console.error("daily_cleanup_failed", { error: error instanceof Error ? error.message : "Unknown error" });
    return NextResponse.json({ error: "The daily cleanup failed." }, { status: 500 });
  }
}
