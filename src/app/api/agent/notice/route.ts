import { NextResponse } from "next/server";
import { AI_NOTICE_VERSION, parseNoticeAgreement } from "@/lib/ai/notice";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function account() {
  const user = await requireApiUser();
  if (!user) return { response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  if (user.isGuest) return { response: NextResponse.json({ error: "Create an account to use the AI assistant." }, { status: 403 }) };
  return { user };
}

/**
 * Agrees to the AI assistant's data notice (#307; the chat panel shows it, #308):
 * `{ version }`, the AI_NOTICE_VERSION the person was shown. From then on, the assistant
 * may send a model provider what each question needs.
 */
export async function POST(request: Request) {
  const { user, response } = await account();
  if (!user) return response;

  const agreement = parseNoticeAgreement(await request.json().catch(() => null));
  if ("error" in agreement) return NextResponse.json({ error: agreement.error, version: AI_NOTICE_VERSION }, { status: 409 });

  const acceptedAt = new Date();
  await prisma.user.update({ where: { id: user.id }, data: { aiNoticeAcceptedAt: acceptedAt } });
  return NextResponse.json({ accepted: true, version: AI_NOTICE_VERSION, acceptedAt: acceptedAt.toISOString() });
}

/** Withdraws the agreement: nothing more is sent until the person agrees again. */
export async function DELETE() {
  const { user, response } = await account();
  if (!user) return response;

  await prisma.user.update({ where: { id: user.id }, data: { aiNoticeAcceptedAt: null } });
  return NextResponse.json({ accepted: false });
}
