import { cookies } from "next/headers";
import { ChatsHub } from "@/components/chats/chats-hub";
import { requirePageUser } from "@/lib/auth";
import { CHATS_LIST_COOKIE } from "@/lib/chats";
import { getChatSummaries, openProjectChat } from "@/lib/chats-data";

type ChatsPageProps = {
  searchParams: Promise<{ project?: string }>;
};

/** The Chats hub (SIDE-02): every project chat, unread first; `?project=` opens one beside the list. */
export default async function ChatsPage({ searchParams }: ChatsPageProps) {
  const user = await requirePageUser();
  const { project } = await searchParams;

  // Open the chat first: that marks it read, so the list's counts already leave it out.
  const selected = project ? await openProjectChat(project, user) : null;
  const [chats, cookieStore] = await Promise.all([getChatSummaries(user), cookies()]);
  // Read here so the first paint already has the list shown or hidden, without a flash.
  const listOpen = cookieStore.get(CHATS_LIST_COOKIE)?.value === "1";

  return <ChatsHub chats={chats} selected={selected} currentUser={{ name: user.name, email: user.email }} initialListOpen={listOpen} />;
}
