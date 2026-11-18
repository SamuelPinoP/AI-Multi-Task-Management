// The AI assistant's chat history (#452): what the routes send and accept, and
// the rules that need no database, so they're unit tested on their own. The
// database side is in ./chat-history.ts; the chat in the browser turns these
// into its conversation (./chat-client.ts).
import { MAX_CHAT_TITLE_CHARS, MAX_CHATS, MAX_MESSAGES } from "@/lib/ai/chat-limits";
import type { Source } from "@/lib/ai/tools/define";
import { getSafeRedirectPath } from "@/lib/safe-redirect";

/** Who wrote a stored message: the person, a model, or the rule-based planner (AgentChatRole). */
export type ChatRole = "USER" | "ASSISTANT" | "PLANNER";

/** A chat in the list, `GET /api/agent/chats`: the newest first. */
export type ChatSummary = {
  id: string;
  title: string;
  /** When its latest message was stored, as an ISO string. */
  updatedAt: string;
};

/** A stored message, as `GET /api/agent/chats/[id]` sends it, oldest first. */
export type StoredMessage = {
  id: string;
  role: ChatRole;
  content: string;
  /** What the answer linked to; [] for questions. */
  sources: Source[];
  createdAt: string;
};

export type StoredChat = ChatSummary & { messages: StoredMessage[] };

/** Missing chats and other people's chats get the same answer, so nobody learns another chat exists. */
export const CHAT_NOT_FOUND_MESSAGE = "Chat not found.";
export const CHAT_FULL_MESSAGE = `Start a new chat: one can hold up to ${MAX_MESSAGES} messages.`;

/**
 * The chats past the newest `max`, which go when a new one is saved (#452): the newest are those
 * whose latest message is the most recent, as the list shows them; ties go by id.
 */
export function chatsPastLimit(chats: Array<{ id: string; updatedAt: Date }>, max = MAX_CHATS) {
  return [...chats]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(max)
    .map((chat) => chat.id);
}

/** A new name for a chat, `{ title }`: spaces collapsed, not empty, at most MAX_CHAT_TITLE_CHARS. */
export function parseChatTitle(body: unknown): { title: string } | { error: string } {
  const raw = typeof body === "object" && body !== null ? (body as { title?: unknown }).title : undefined;
  const title = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!title) return { error: "Give the chat a name." };
  if (title.length > MAX_CHAT_TITLE_CHARS) return { error: `Keep the name under ${MAX_CHAT_TITLE_CHARS} characters.` };
  return { title };
}

const SOURCE_KINDS = new Set<Source["kind"]>(["task", "event", "project", "note", "goal"]);

/**
 * A message's links as stored (a JSON column), keeping only well-formed ones on internal paths:
 * whatever the column holds, the chat never links anywhere else.
 */
export function storedSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Source[] => {
    if (!item || typeof item !== "object") return [];
    const { kind, id, title, href } = item as Record<string, unknown>;
    if (typeof kind !== "string" || !SOURCE_KINDS.has(kind as Source["kind"])) return [];
    if (typeof id !== "string" || typeof title !== "string" || typeof href !== "string") return [];
    if (getSafeRedirectPath(href) !== href) return [];
    return [{ kind: kind as Source["kind"], id, title, href }];
  });
}
