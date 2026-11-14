import { cookies } from "next/headers";
import { ChatsHub, type SelectedChat } from "@/components/chats/chats-hub";
import { requirePageUser } from "@/lib/auth";
import { CHATS_LIST_COMPACT_COOKIE, CHATS_LIST_WIDTH_COOKIE, sortDirectChats } from "@/lib/chats";
import { getChatSummaries, openProjectChat } from "@/lib/chats-data";
import { getDirectChatSummaries, getTeammates, openDirectChat } from "@/lib/direct-chats";
import { CHAT_LIST_LIMITS, parseWidth } from "@/lib/panel-resize";

type ChatsPageProps = {
  searchParams: Promise<{ project?: string; person?: string }>;
};

/**
 * The Chats hub (SIDE-02): every project chat, then every direct chat (#387),
 * unread first. `?project=` opens a project's chat beside the list, `?person=`
 * your chat with someone you share a project with.
 */
export default async function ChatsPage({ searchParams }: ChatsPageProps) {
  const user = await requirePageUser();
  const { project, person } = await searchParams;

  // Open the chat first: that marks it read, so the list's counts already leave it out.
  let selected: SelectedChat | null = null;
  if (project) {
    const chat = await openProjectChat(project, user);
    if (chat) selected = { kind: "project", chat };
  } else if (person) {
    const chat = await openDirectChat(person, user);
    if (chat) selected = { kind: "person", chat };
  }
  const [chats, teammates, cookieStore] = await Promise.all([getChatSummaries(user), getTeammates(user.id), cookies()]);
  const directs = sortDirectChats(await getDirectChatSummaries(user, teammates));
  // Read here so the first paint already has the list at its width, or as photos, without a jump (#416).
  const list = {
    width: parseWidth(cookieStore.get(CHATS_LIST_WIDTH_COOKIE)?.value, CHAT_LIST_LIMITS),
    collapsed: cookieStore.get(CHATS_LIST_COMPACT_COOKIE)?.value === "1",
  };

  return (
    <ChatsHub
      chats={chats}
      directs={directs}
      teammates={teammates}
      selected={selected}
      currentUser={{ name: user.name, email: user.email }}
      initialList={list}
    />
  );
}
