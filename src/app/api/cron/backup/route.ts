import { NextResponse } from "next/server";
import { runScheduledBackup } from "@/lib/database-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called daily by Vercel Cron (vercel.json). Repeat calls within 20 hours do
// nothing, so the route is safe without a secret; if CRON_SECRET is set, it is
// required (Vercel sends it as a bearer token).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runScheduledBackup();
    if (result.status === "created") {
      console.log("database_backup_created", { key: result.key, bytes: result.bytes, deleted: result.deleted });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("database_backup_failed", { error: error instanceof Error ? error.message : "Unknown error" });
    return NextResponse.json({ error: "The database backup failed." }, { status: 500 });
  }
}
