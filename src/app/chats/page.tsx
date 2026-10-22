import { ChatsHub } from "@/components/chats/chats-hub";
import { requirePageUser } from "@/lib/auth";
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
  const chats = await getChatSummaries(user);

  return <ChatsHub chats={chats} selected={selected} currentUser={{ name: user.name, email: user.email }} />;
}
