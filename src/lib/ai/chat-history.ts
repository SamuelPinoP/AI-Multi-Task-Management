import "server-only";

// The AI assistant's chat history in the database (#452): each person's latest
// MAX_CHATS chats, read, renamed and deleted only by their owner. Every query
// names the owner, so another person's chat behaves exactly like a missing one.
// The rules that need no database are in ./chat-history-core.ts.
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import type { StoredAnswer } from "@/lib/ai/chat";
import { chatTitle } from "@/lib/ai/chat-client";
import { chatsPastLimit, storedSources, type ChatRole, type ChatSummary, type StoredChat } from "@/lib/ai/chat-history-core";
import { MAX_CHATS, MODEL_HISTORY } from "@/lib/ai/chat-limits";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** The account behind an AI route, or the response to send: 401 when signed out, 403 for guests. */
export async function agentAccount() {
  const user = await requireApiUser();
  if (!user) return { response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  if (user.isGuest) return { response: NextResponse.json({ error: "Create an account to use the AI assistant." }, { status: 403 }) };
  return { user };
}

const SUMMARY_SELECT = { id: true, title: true, updatedAt: true } as const;

function summary(chat: { id: string; title: string; updatedAt: Date }): ChatSummary {
  return { id: chat.id, title: chat.title, updatedAt: chat.updatedAt.toISOString() };
}

// Oldest first; within one instant a question before its answer (USER sorts first in AgentChatRole).
const MESSAGE_ORDER = [{ createdAt: "asc" }, { role: "asc" }] satisfies Prisma.AgentChatMessageOrderByWithRelationInput[];

/** The person's chats, the newest first: at most MAX_CHATS, since saving another deletes the oldest. */
export async function listChats(userId: string): Promise<ChatSummary[]> {
  const chats = await prisma.agentChat.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: MAX_CHATS,
    select: SUMMARY_SELECT,
  });
  return chats.map(summary);
}

/** One of the person's chats with all its messages; opening it starts its 90 days again. */
export async function openChat(userId: string, chatId: string, now = new Date()): Promise<StoredChat | null> {
  const chat = await prisma.agentChat.findFirst({
    where: { id: chatId, userId },
    select: { ...SUMMARY_SELECT, messages: { orderBy: MESSAGE_ORDER, select: { id: true, role: true, content: true, sources: true, createdAt: true } } },
  });
  if (!chat) return null;
  await prisma.agentChat.updateMany({ where: { id: chat.id, userId }, data: { openedAt: now } });
  return {
    ...summary(chat),
    messages: chat.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      sources: storedSources(message.sources),
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

export async function renameChat(userId: string, chatId: string, title: string): Promise<ChatSummary | null> {
  const renamed = await prisma.agentChat.updateMany({ where: { id: chatId, userId }, data: { title } });
  if (!renamed.count) return null;
  const chat = await prisma.agentChat.findFirst({ where: { id: chatId, userId }, select: SUMMARY_SELECT });
  return chat ? summary(chat) : null;
}

export async function deleteChat(userId: string, chatId: string) {
  const deleted = await prisma.agentChat.deleteMany({ where: { id: chatId, userId } });
  return deleted.count > 0;
}

export async function deleteAllChats(userId: string) {
  const deleted = await prisma.agentChat.deleteMany({ where: { userId } });
  return deleted.count;
}

/** A stored chat a new question continues: how many messages it holds, and its latest ones for the model. */
export type ContinuedChat = { id: string; messageCount: number; history: Array<{ role: ChatRole; content: string }> };

export async function chatToContinue(userId: string, chatId: string): Promise<ContinuedChat | null> {
  const chat = await prisma.agentChat.findFirst({
    where: { id: chatId, userId },
    select: {
      id: true,
      _count: { select: { messages: true } },
      messages: { orderBy: [{ createdAt: "desc" }, { role: "desc" }], take: MODEL_HISTORY, select: { role: true, content: true } },
    },
  });
  if (!chat) return null;
  return { id: chat.id, messageCount: chat._count.messages, history: chat.messages.reverse() };
}

/**
 * Stores a question and the answer the person saw (#452): in the chat it continues, or in a new chat
 * named after the question. A new chat past the person's MAX_CHATS deletes their oldest. Null when
 * the chat it continues was deleted while the answer was on its way.
 */
export async function saveExchange({
  userId,
  chatId,
  question,
  askedAt,
  answer,
}: {
  userId: string;
  chatId: string | null;
  question: string;
  askedAt: Date;
  answer: StoredAnswer;
}): Promise<ChatSummary | null> {
  // At least a millisecond after the question, so the two always sort in the order they were written.
  const answeredAt = new Date(Math.max(Date.now(), askedAt.getTime() + 1));
  const messages = [
    { role: "USER" as const, content: question, createdAt: askedAt },
    { role: answer.role, content: answer.content, sources: answer.sources, createdAt: answeredAt },
  ];

  if (chatId) {
    try {
      const chat = await prisma.agentChat.update({
        where: { id: chatId, userId },
        data: { updatedAt: answeredAt, openedAt: answeredAt, messages: { create: messages } },
        select: SUMMARY_SELECT,
      });
      return summary(chat);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return null;
      throw error;
    }
  }

  const chat = await prisma.agentChat.create({
    data: { userId, title: chatTitle(question), createdAt: askedAt, updatedAt: answeredAt, openedAt: answeredAt, messages: { create: messages } },
    select: SUMMARY_SELECT,
  });
  const chats = await prisma.agentChat.findMany({ where: { userId }, select: { id: true, updatedAt: true } });
  const older = chatsPastLimit(chats);
  if (older.length) await prisma.agentChat.deleteMany({ where: { userId, id: { in: older } } });
  return summary(chat);
}
