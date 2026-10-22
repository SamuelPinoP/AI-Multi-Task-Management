import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { pushConfig } from "@/lib/notifications";
import { isValidPushSubscription } from "@/lib/notifications-core";
import { prisma } from "@/lib/prisma";

// Browser push (SMART-08). The browser asks the user, subscribes with the
// public VAPID key, and sends its subscription here.

/** The public key browsers subscribe with, or null while push isn't set up. */
export async function GET() {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ publicKey: pushConfig()?.publicKey ?? null });
}

/** Saves this browser's subscription for the signed-in user. A browser belongs to whoever signed in last. */
export async function POST(req: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!pushConfig()) return NextResponse.json({ error: "Browser notifications aren't set up on this server." }, { status: 503 });
  const body: unknown = await req.json().catch(() => null);
  if (!isValidPushSubscription(body)) return NextResponse.json({ error: "Invalid push subscription" }, { status: 400 });
  const data = { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth };
  await prisma.pushSubscription.upsert({ where: { endpoint: body.endpoint }, update: data, create: { ...data, endpoint: body.endpoint } });
  return NextResponse.json({ subscribed: true }, { status: 201 });
}

/** Forgets this browser: when the user turns push off, or before signing out. */
export async function DELETE(req: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { endpoint?: unknown };
  if (typeof body.endpoint !== "string") return NextResponse.json({ error: "Endpoint is required" }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: user.id } });
  return NextResponse.json({ subscribed: false });
}
