import { cookies } from "next/headers";
import { AiPage } from "@/components/ai/ai-page";
import { requirePageUser } from "@/lib/auth";
import { AI_CHAT_LIST_COLLAPSED_COOKIE, AI_CHAT_LIST_LIMITS, AI_CHAT_LIST_WIDTH_COOKIE, parseWidth } from "@/lib/panel-resize";

/**
 * The AI page (#308): a conversation with the assistant, the person's chats beside it. The chat
 * lives in the app shell; this page only lays it out. The list's width, and whether it's folded to
 * its rail, come from cookies, so the first paint already has them, without a jump.
 */
export default async function AiRoute() {
  const user = await requirePageUser();
  const cookieStore = await cookies();
  const firstName = (user.name || user.email).trim().split(/[\s@]/)[0] || "there";

  return (
    <AiPage
      firstName={firstName}
      initialList={{
        width: parseWidth(cookieStore.get(AI_CHAT_LIST_WIDTH_COOKIE)?.value, AI_CHAT_LIST_LIMITS),
        collapsed: cookieStore.get(AI_CHAT_LIST_COLLAPSED_COOKIE)?.value === "1",
      }}
    />
  );
}
