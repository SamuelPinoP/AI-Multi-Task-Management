"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DeleteChatsDialog, RenameChatDialog } from "@/components/ai/ai-chat-dialogs";
import type { AgentStatus, ChatEvent } from "@/lib/ai/chat";
import {
  allowanceIn,
  applyChatEvent,
  chatTitle,
  createEventReader,
  emptyAnswer,
  INTERRUPTED_MESSAGE,
  OFFLINE_MESSAGE,
  turnsFromMessages,
  type ChatAnswer,
  type ChatTurn,
} from "@/lib/ai/chat-client";
import { chatsPastLimit, type ChatSummary, type StoredChat } from "@/lib/ai/chat-history-core";
import { toast } from "@/components/ui/toaster";
import { MAX_MESSAGE_CHARS } from "@/lib/ai/chat-limits";
import type { AiDock } from "@/lib/ai/dock";
import { AI_NOTICE_VERSION } from "@/lib/ai/notice";
import type { ProposalView } from "@/lib/ai/proposals";

/**
 * A conversation with the assistant. Each person's latest chats are stored on the server (#452);
 * a chat started here joins them once its first answer has arrived and been stored.
 */
export type AiChat = {
  /** This tab's key for it: the server's id for a chat from the list, one made here for a chat started here. */
  id: string;
  /** The server's id once its first answer is stored; null until then (or if storing it failed). */
  serverId: string | null;
  title: string;
  /** When its latest message was stored (an ISO string): the list's order and its day groups. */
  updatedAt: string;
  /** The conversation; null for a chat from the list until it's opened and its messages arrive. */
  turns: ChatTurn[] | null;
};

/** The data notice, shown in place of an answer until the person agrees (#307). */
export type AiNoticeState = { open: boolean; agreeing: boolean; error: string | null };

/** The person's stored chats: loaded when a list of chats first shows (#452). */
export type AiChatListState = "idle" | "loading" | "ready" | "error";

type AiChatContextValue = {
  /** Guests can't use the assistant; the chat says so instead. */
  enabled: boolean;
  /** The person's chats, the latest first: the stored ones, and any started here. */
  chats: AiChat[];
  /** The open chat, or null for a new one. */
  current: AiChat | null;
  /** From GET /api/agent/status, then kept up to date by each answer; null until it arrives. */
  status: AgentStatus | null;
  /** An answer is arriving, or the open chat's messages are. */
  busy: boolean;
  /** The open chat is one from the list whose messages are still on their way. */
  opening: boolean;
  /**
   * For screen readers, in a polite status region: "AI Multi is answering…", then "AI Multi: " and
   * the whole answer once it has arrived. The streamed pieces aren't announced one by one.
   */
  announcement: string;
  /** The message box's text, shared wherever the chat shows. */
  draft: string;
  setDraft: (draft: string) => void;
  /** Sends a question, or holds it for the data notice. Empty questions, and new ones while an answer arrives, are ignored. */
  ask: (question: string) => void;
  /** Asks a question whose answer failed again. */
  retry: (turnId: string) => void;
  newChat: () => void;
  /** Shows a chat, loading its messages first if it's one from the list. */
  openChat: (id: string) => void;
  /** Whether the stored chats have arrived. */
  listState: AiChatListState;
  /** Reads the stored chats once (again after a failure); the lists of chats call it when they show. */
  loadChats: () => void;
  /** Opens the dialog that renames a stored chat. */
  renameChat: (id: string) => void;
  /** Asks before deleting a stored chat. */
  deleteChat: (id: string) => void;
  /** Asks before deleting every chat. */
  deleteAllChats: () => void;
  notice: AiNoticeState;
  /** Agrees to the data notice, then sends the question that was waiting. */
  agree: () => void;
  /** "Not now": the question goes back into the message box. */
  dismissNotice: () => void;
  /** Reads the status once; the chat calls it when it shows. */
  loadStatus: () => void;
  /**
   * Shows where a proposal stands now in the answer that made it, after the person applied or
   * cancelled it (#310), and tells screen readers what happened.
   */
  replaceProposal: (proposal: ProposalView, announcement: string) => void;
};

/**
 * Where the AI bar shows on the person's pages, saved per account (#308). A context of its own, so
 * the app shell, which needs only this, doesn't render again for every word of an answer.
 */
type AiDockContextValue = {
  dock: AiDock;
  /** Changes it at once and saves it; if saving fails, it goes back to what's saved and says so. */
  setDock: (dock: AiDock) => void;
};

const AiChatContext = createContext<AiChatContextValue | null>(null);
const AiDockContext = createContext<AiDockContextValue | null>(null);

let lastId = 0;
function newId() {
  lastId += 1;
  return `${Date.now().toString(36)}-${lastId}`;
}

const CLOSED_NOTICE: AiNoticeState = { open: false, agreeing: false, error: null };

/** Shown under a question sent to a chat the server no longer has: deleted in another tab, or by the 90-day cleanup. */
const CHAT_GONE_MESSAGE = "This chat no longer exists. Start a new chat to ask again.";

type ChatDialog = { kind: "rename" | "delete"; chatId: string } | { kind: "deleteAll" };

function newestFirst(chats: AiChat[]) {
  return [...chats].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function fromSummary(chat: ChatSummary): AiChat {
  return { id: chat.id, serverId: chat.id, title: chat.title, updatedAt: chat.updatedAt, turns: null };
}

const chatUrl = (serverId: string) => `/api/agent/chats/${encodeURIComponent(serverId)}`;

/**
 * The AI assistant's chat (#308), around the app shell in the root layout, so the conversation
 * stays as people move between pages. The AI page and the AI bar on every other page show it.
 * It talks to POST /api/agent/chat, folding the streamed events into the answer
 * (src/lib/ai/chat-client.ts), and to /api/agent/chats for the person's stored chats (#452),
 * whose rename and delete dialogs it shows. It also holds where the AI bar is (`useAiDock()`).
 */
export function AiChatProvider({ enabled, initialDock, children }: { enabled: boolean; initialDock: AiDock; children: ReactNode }) {
  const [chats, setChats] = useState<AiChat[]>([]);
  const [listState, setListState] = useState<AiChatListState>("idle");
  const [dock, setDockState] = useState<AiDock>(initialDock);
  const dockRef = useRef(initialDock);
  // What the server has, and the saves in order, so the last choice is the one that sticks.
  const savedDock = useRef(initialDock);
  const dockSaves = useRef<Promise<void>>(Promise.resolve());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<AiNoticeState>(CLOSED_NOTICE);
  const [dialog, setDialog] = useState<ChatDialog | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // The latest values, for callbacks that run after a render: building a request, checking the notice.
  const chatsRef = useRef(chats);
  const currentRef = useRef(currentId);
  const statusRef = useRef(status);
  useEffect(() => {
    chatsRef.current = chats;
    currentRef.current = currentId;
    statusRef.current = status;
  }, [chats, currentId, status]);

  const busyRef = useRef(false);
  const pending = useRef<string | null>(null);
  const statusLoad = useRef<"idle" | "loading" | "done">("idle");
  const listLoad = useRef<"idle" | "loading" | "done">("idle");
  // Stored chats whose messages are on their way, so a second click doesn't ask again.
  const opening = useRef(new Set<string>());
  const streams = useRef(new Set<AbortController>());

  // Leaving the app (a full navigation, logging out) stops any answer still arriving.
  useEffect(() => {
    const open = streams.current;
    return () => {
      for (const stream of open) stream.abort();
    };
  }, []);

  const showChat = useCallback((id: string | null) => {
    currentRef.current = id;
    setCurrentId(id);
  }, []);

  /** Takes a chat out of the list, and out of view if it was open. */
  const forget = useCallback(
    (id: string) => {
      setChats((list) => list.filter((chat) => chat.id !== id));
      if (currentRef.current === id) showChat(null);
    },
    [showChat],
  );

  /** Learns what the stream says about the allowance and who answers. */
  const learn = useCallback((event: ChatEvent) => {
    const allowance = allowanceIn(event);
    if (!allowance) return;
    setStatus((current) => {
      const mode =
        event.type === "start"
          ? event.mode === "agent"
            ? ({ mode: "agent" } as const)
            : ({ mode: "planner", reason: event.reason } as const)
          : current && current.mode === "planner"
            ? ({ mode: "planner", reason: current.reason } as const)
            : ({ mode: "agent" } as const);
      // A stream only comes back once the notice is agreed to.
      return { ...mode, noticeAccepted: true, allowance };
    });
  }, []);

  const send = useCallback(
    async (question: string, retryOf?: { chatId: string; turnId: string }) => {
      busyRef.current = true;
      setBusy(true);
      setAnnouncement("AI Multi is answering…");

      const turnId = newId();
      const turn: ChatTurn = { id: turnId, question, answer: emptyAnswer() };
      const existingId = retryOf?.chatId ?? currentRef.current;
      const existing = existingId ? chatsRef.current.find((chat) => chat.id === existingId) : undefined;
      const chatId = existing?.id ?? newId();
      const created = !existing;
      const sentAt = new Date().toISOString();
      // The chat goes to the top of the list, with the question at its end (a retry replaces the failed one).
      setChats((list) => {
        const chat = list.find((item) => item.id === chatId);
        const next: AiChat = chat
          ? { ...chat, updatedAt: sentAt, turns: [...(chat.turns ?? []).filter((item) => item.id !== retryOf?.turnId), turn] }
          : { id: chatId, serverId: null, title: chatTitle(question), updatedAt: sentAt, turns: [turn] };
        return [next, ...list.filter((item) => item.id !== chatId)];
      });
      if (created || currentRef.current !== chatId) showChat(chatId);

      // The answer is folded here too, so the announcement can read it once it's complete.
      let latest = turn.answer;
      const update = (change: (answer: ChatAnswer) => ChatAnswer) => {
        latest = change(latest);
        const answer = latest;
        setChats((list) =>
          list.map((chat) =>
            chat.id === chatId ? { ...chat, turns: (chat.turns ?? []).map((item) => (item.id === turnId ? { ...item, answer } : item)) } : chat,
          ),
        );
      };

      /** The server stored the question and its answer: the chat is now (or still) one of the person's stored chats. */
      const adopt = (stored: ChatSummary) =>
        setChats((list) => {
          // Deleted here while the answer arrived.
          if (!list.some((chat) => chat.id === chatId)) return list;
          const next = list
            // A list that arrived meanwhile may hold the same chat under the server's id.
            .filter((chat) => chat.id === chatId || chat.serverId !== stored.id)
            .map((chat) => (chat.id === chatId ? { ...chat, serverId: stored.id, title: stored.title, updatedAt: stored.updatedAt } : chat));
          // The server keeps each person's latest MAX_CHATS, so a new chat pushes the oldest out.
          const saved = next.flatMap((chat) => (chat.serverId ? [{ id: chat.id, updatedAt: new Date(chat.updatedAt) }] : []));
          const past = new Set(chatsPastLimit(saved));
          return newestFirst(next.filter((chat) => !past.has(chat.id)));
        });

      const controller = new AbortController();
      streams.current.add(controller);
      try {
        const response = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(existing?.serverId ? { chatId: existing.serverId, message: question } : { message: question }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
          if (response.status === 403 && body?.code === "notice_required") {
            // Not agreed yet (or agreed before the notice changed): take the question back and show the notice.
            setChats((list) =>
              list.flatMap((chat) => {
                if (chat.id !== chatId) return [chat];
                const turns = (chat.turns ?? []).filter((item) => item.id !== turnId);
                return turns.length || chat.serverId ? [{ ...chat, turns }] : [];
              }),
            );
            if (created) showChat(null);
            setStatus((current) => (current ? { ...current, noticeAccepted: false } : current));
            pending.current = question;
            setNotice({ open: true, agreeing: false, error: null });
            return;
          }
          const error = response.status === 404 ? CHAT_GONE_MESSAGE : (body?.error ?? "Something went wrong. Try again in a moment.");
          update((answer) => ({ ...answer, done: true, error }));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const lines = createEventReader();
        const apply = (events: ChatEvent[]) => {
          if (!events.length) return;
          events.forEach(learn);
          update((answer) => events.reduce(applyChatEvent, answer));
          for (const event of events) if (event.type === "done" && event.chat) adopt(event.chat);
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          apply(lines.push(decoder.decode(value, { stream: true })));
        }
        apply(lines.push(decoder.decode()));
        apply(lines.end());
        // A stream that closes without its last event was cut off.
        update((answer) => (answer.done ? answer : { ...answer, done: true, error: answer.error ?? INTERRUPTED_MESSAGE }));
      } catch {
        if (!controller.signal.aborted) update((answer) => ({ ...answer, done: true, error: answer.error ?? OFFLINE_MESSAGE }));
      } finally {
        streams.current.delete(controller);
        busyRef.current = false;
        setBusy(false);
        setAnnouncement(`AI Multi: ${latest.error ?? [latest.notice, latest.text].filter(Boolean).join(" ")}`);
      }
    },
    [learn, showChat],
  );

  const ask = useCallback(
    (raw: string) => {
      const question = raw.trim().slice(0, MAX_MESSAGE_CHARS);
      if (!question || !enabled || busyRef.current) return;
      // A stored chat continues only once its messages are here.
      const open = chatsRef.current.find((chat) => chat.id === currentRef.current);
      if (open && open.turns === null) return;
      setDraft("");
      if (statusRef.current?.noticeAccepted === false) {
        pending.current = question;
        setNotice({ open: true, agreeing: false, error: null });
        return;
      }
      void send(question);
    },
    [enabled, send],
  );

  const retry = useCallback(
    (turnId: string) => {
      const chatId = currentRef.current;
      const turn = chatsRef.current.find((chat) => chat.id === chatId)?.turns?.find((item) => item.id === turnId);
      if (!chatId || !turn || !turn.answer.error || busyRef.current) return;
      void send(turn.question, { chatId, turnId });
    },
    [send],
  );

  const putBack = useCallback(() => {
    const question = pending.current;
    pending.current = null;
    setNotice(CLOSED_NOTICE);
    if (question) setDraft((current) => current || question);
  }, []);

  const newChat = useCallback(() => {
    putBack();
    showChat(null);
  }, [putBack, showChat]);

  const openChat = useCallback(
    (id: string) => {
      putBack();
      showChat(id);
      const chat = chatsRef.current.find((item) => item.id === id);
      const serverId = chat?.serverId;
      if (!chat || chat.turns || !serverId || opening.current.has(id)) return;
      opening.current.add(id);
      void (async () => {
        try {
          const response = await fetch(chatUrl(serverId), { cache: "no-store" });
          if (response.status === 404) {
            forget(id);
            toast.error("That chat no longer exists", { description: "It was deleted, maybe in another tab." });
            return;
          }
          if (!response.ok) throw new Error(String(response.status));
          const stored = (await response.json()) as StoredChat;
          const turns = turnsFromMessages(stored.messages);
          setChats((list) => list.map((item) => (item.id === id ? { ...item, title: stored.title, turns } : item)));
        } catch {
          // Back to a new chat, so the box works; the chat stays in the list to try again.
          if (currentRef.current !== id) return;
          showChat(null);
          toast.error("That chat didn't open", { description: "Check your connection and try again." });
        } finally {
          opening.current.delete(id);
        }
      })();
    },
    [forget, putBack, showChat],
  );

  const loadChats = useCallback(() => {
    if (!enabled || listLoad.current !== "idle") return;
    listLoad.current = "loading";
    setListState("loading");
    void (async () => {
      try {
        const response = await fetch("/api/agent/chats", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const { chats: stored } = (await response.json()) as { chats: ChatSummary[] };
        // Chats started here are already in the list, with their conversation.
        setChats((list) => {
          const known = new Set(list.flatMap((chat) => (chat.serverId ? [chat.serverId] : [])));
          return newestFirst([...list, ...stored.filter((chat) => !known.has(chat.id)).map(fromSummary)]);
        });
        listLoad.current = "done";
        setListState("ready");
      } catch {
        // Offline, say: the list says so, and asks again the next time it shows.
        listLoad.current = "idle";
        setListState("error");
      }
    })();
  }, [enabled]);

  const renameChat = useCallback((id: string) => {
    setDialogError(null);
    setDialog({ kind: "rename", chatId: id });
  }, []);

  const deleteChat = useCallback((id: string) => {
    setDialogError(null);
    setDialog({ kind: "delete", chatId: id });
  }, []);

  const deleteAllChats = useCallback(() => {
    setDialogError(null);
    setDialog({ kind: "deleteAll" });
  }, []);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setDialogError(null);
  }, []);

  async function saveTitle(id: string, title: string) {
    const serverId = chatsRef.current.find((chat) => chat.id === id)?.serverId;
    if (!serverId) return closeDialog();
    setDialogBusy(true);
    try {
      const response = await fetch(chatUrl(serverId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const body = (await response.json().catch(() => null)) as (ChatSummary & { error?: string }) | null;
      if (response.status === 404) {
        forget(id);
        closeDialog();
        toast.error("That chat no longer exists", { description: "It was deleted, maybe in another tab." });
        return;
      }
      if (!response.ok || !body) {
        setDialogError(body?.error ?? "That didn't save. Try again.");
        return;
      }
      setChats((list) => list.map((chat) => (chat.id === id ? { ...chat, title: body.title } : chat)));
      closeDialog();
      toast.success("Chat renamed");
    } catch {
      setDialogError(OFFLINE_MESSAGE);
    } finally {
      setDialogBusy(false);
    }
  }

  /** Deletes on the server, then here; the dialog closes either way, and a toast says how it went. */
  async function confirmDeletion(url: string | null, done: () => void, failed: string) {
    setDialogBusy(true);
    try {
      const response = url ? await fetch(url, { method: "DELETE" }) : null;
      // Already gone is as good as deleted.
      if (response && !response.ok && response.status !== 404) throw new Error(String(response.status));
      done();
    } catch {
      toast.error(failed, { description: "Check your connection and try again." });
    } finally {
      closeDialog();
      setDialogBusy(false);
    }
  }

  const deleteOne = (chat: AiChat) =>
    confirmDeletion(
      chat.serverId ? chatUrl(chat.serverId) : null,
      () => {
        forget(chat.id);
        toast.success("Chat deleted", { description: chat.title });
      },
      "The chat wasn't deleted",
    );

  const deleteAll = () =>
    confirmDeletion(
      "/api/agent/chats",
      () => {
        setChats([]);
        showChat(null);
        toast.success("All chats deleted");
      },
      "Your chats weren't deleted",
    );

  const agree = useCallback(async () => {
    setNotice({ open: true, agreeing: true, error: null });
    try {
      const response = await fetch("/api/agent/notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: AI_NOTICE_VERSION }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setNotice({ open: true, agreeing: false, error: body?.error ?? "That didn't save. Try again." });
        return;
      }
    } catch {
      setNotice({ open: true, agreeing: false, error: OFFLINE_MESSAGE });
      return;
    }
    setStatus((current) => (current ? { ...current, noticeAccepted: true } : current));
    if (statusRef.current) statusRef.current = { ...statusRef.current, noticeAccepted: true };
    setNotice(CLOSED_NOTICE);
    const question = pending.current;
    pending.current = null;
    if (question && !busyRef.current) void send(question);
  }, [send]);

  const loadStatus = useCallback(() => {
    if (!enabled || statusLoad.current !== "idle") return;
    statusLoad.current = "loading";
    void (async () => {
      try {
        const response = await fetch("/api/agent/status", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const loaded = (await response.json()) as AgentStatus;
        // An answer that arrived meanwhile knows better.
        setStatus((current) => current ?? loaded);
        statusLoad.current = "done";
      } catch {
        // Offline, say: try again the next time the chat shows.
        statusLoad.current = "idle";
      }
    })();
  }, [enabled]);

  const replaceProposal = useCallback((proposal: ProposalView, said: string) => {
    const holds = (turn: ChatTurn) => turn.answer.proposal?.id === proposal.id;
    setChats((list) =>
      list.map((chat) =>
        chat.turns?.some(holds) ? { ...chat, turns: chat.turns.map((turn) => (holds(turn) ? { ...turn, answer: { ...turn.answer, proposal } } : turn)) } : chat,
      ),
    );
    setAnnouncement(said);
  }, []);

  const setDock = useCallback((next: AiDock) => {
    if (next === dockRef.current) return;
    dockRef.current = next;
    setDockState(next);
    dockSaves.current = dockSaves.current.then(async () => {
      try {
        const response = await fetch("/api/agent/dock", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dock: next }),
        });
        if (!response.ok) throw new Error(String(response.status));
        savedDock.current = next;
      } catch {
        // Unless a later choice already replaced this one, show what's saved again.
        if (dockRef.current !== next) return;
        dockRef.current = savedDock.current;
        setDockState(savedDock.current);
        toast.error("The AI bar's place wasn't saved", { description: "Check your connection and try again." });
      }
    });
  }, []);

  const current = chats.find((chat) => chat.id === currentId) ?? null;
  const openingCurrent = current !== null && current.turns === null;
  const value = useMemo<AiChatContextValue>(
    () => ({
      enabled,
      chats,
      current,
      status,
      busy: busy || openingCurrent,
      opening: openingCurrent,
      announcement,
      draft,
      setDraft,
      ask,
      retry,
      newChat,
      openChat,
      listState,
      loadChats,
      renameChat,
      deleteChat,
      deleteAllChats,
      notice,
      agree: () => void agree(),
      dismissNotice: putBack,
      loadStatus,
      replaceProposal,
    }),
    [
      enabled,
      chats,
      current,
      status,
      busy,
      openingCurrent,
      announcement,
      draft,
      ask,
      retry,
      newChat,
      openChat,
      listState,
      loadChats,
      renameChat,
      deleteChat,
      deleteAllChats,
      notice,
      agree,
      putBack,
      loadStatus,
      replaceProposal,
    ],
  );
  const dockValue = useMemo<AiDockContextValue>(() => ({ dock, setDock }), [dock, setDock]);

  const dialogChat = dialog && dialog.kind !== "deleteAll" ? (chats.find((chat) => chat.id === dialog.chatId) ?? null) : null;

  return (
    <AiDockContext.Provider value={dockValue}>
      <AiChatContext.Provider value={value}>
        {children}
        {dialog?.kind === "rename" && dialogChat ? (
          <RenameChatDialog
            title={dialogChat.title}
            saving={dialogBusy}
            error={dialogError}
            onCancel={closeDialog}
            onSave={(title) => void saveTitle(dialogChat.id, title)}
          />
        ) : null}
        <DeleteChatsDialog
          open={dialog?.kind === "deleteAll" || (dialog?.kind === "delete" && dialogChat !== null)}
          all={dialog?.kind === "deleteAll"}
          title={dialogChat?.title ?? ""}
          deleting={dialogBusy}
          onCancel={closeDialog}
          onConfirm={() => {
            if (dialog?.kind === "deleteAll") void deleteAll();
            else if (dialog?.kind === "delete" && dialogChat) void deleteOne(dialogChat);
          }}
        />
      </AiChatContext.Provider>
    </AiDockContext.Provider>
  );
}

export function useAiDock() {
  const context = useContext(AiDockContext);
  if (!context) throw new Error("useAiDock must be used inside AiChatProvider");
  return context;
}

export function useAiChat() {
  const context = useContext(AiChatContext);
  if (!context) throw new Error("useAiChat must be used inside AiChatProvider");
  return context;
}
