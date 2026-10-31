import Link from "next/link";
import { cn } from "@/lib/cn";
import { chatPreview, formatUnreadCount, type ChatSummary } from "@/lib/chats";
import { projectColor } from "@/lib/project-color";

/**
 * Home's Team chat (DES-11): the latest message in each shared project, unread
 * first, from the same summaries as the Chats page. Each row opens that chat.
 */
export function TeamChatList({ chats }: { chats: ChatSummary[] }) {
  return (
    <ul className="grid grid-cols-1 gap-0.5">
      {chats.map((chat) => {
        const unread = chat.unread > 0;
        return (
          <li key={chat.projectId}>
            <Link href={`/chats?project=${chat.projectId}`} className="flex gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-surface-hover">
              <span
                aria-hidden="true"
                className="mt-1.5 h-2 w-2 shrink-0 rounded-[3px]"
                style={{ backgroundColor: projectColor({ id: chat.projectId, color: chat.color }) }}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline gap-2">
                  <span className={cn("min-w-0 flex-1 truncate text-[13px]", unread ? "font-bold" : "font-semibold")}>{chat.name}</span>
                  {chat.lastMessage ? (
                    <time dateTime={chat.lastMessage.at} className={cn("shrink-0 text-xs", unread ? "font-bold text-accent" : "text-muted")}>
                      {chat.lastMessage.timeLabel}
                    </time>
                  ) : null}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className={cn("min-w-0 flex-1 truncate text-xs", unread ? "text-ink" : "text-muted")}>{chatPreview(chat)}</span>
                  {unread ? (
                    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 font-mono text-2xs font-bold tabular-nums text-accent-ink">
                      {formatUnreadCount(chat.unread)}
                      <span className="sr-only"> unread message{chat.unread === 1 ? "" : "s"}</span>
                    </span>
                  ) : null}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
