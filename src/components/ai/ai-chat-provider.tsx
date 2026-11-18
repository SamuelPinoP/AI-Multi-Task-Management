"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentStatus, ChatEvent } from "@/lib/ai/chat";
import {
  allowanceIn,
  applyChatEvent,
  chatTitle,
  createEventReader,
  emptyAnswer,
  INTERRUPTED_MESSAGE,
  OFFLINE_MESSAGE,
  requestMessages,
  type ChatAnswer,
  type ChatTurn,
} from "@/lib/ai/chat-client";
import { toast } from "@/components/ui/toaster";
import { MAX_MESSAGE_CHARS } from "@/lib/ai/chat-limits";
import type { AiDock } from "@/lib/ai/dock";
import { AI_NOTICE_VERSION } from "@/lib/ai/notice";

/** A conversation with the assistant. Until chat history is stored (#452), they last as long as the tab. */
export type AiChat = { id: string; title: string; turns: ChatTurn[] };

/** The data notice, shown in place of an answer until the person agrees (#307). */
export type AiNoticeState = { open: boolean; agreeing: boolean; error: string | null };

type AiChatContextValue = {
  /** Guests can't use the assistant; the chat says so instead. */
  enabled: boolean;
  /** This tab's chats, the latest first. */
  chats: AiChat[];
  /** The open chat, or null for a new one. */
  current: AiChat | null;
  /** From GET /api/agent/status, then kept up to date by each answer; null until it arrives. */
  status: AgentStatus | null;
  /** An answer is arriving. */
  busy: boolean;
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
  openChat: (id: string) => void;
  notice: AiNoticeState;
  /** Agrees to the data notice, then sends the question that was waiting. */
  agree: () => void;
  /** "Not now": the question goes back into the message box. */
  dismissNotice: () => void;
  /** Reads the status once; the chat calls it when it shows. */
  loadStatus: () => void;
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

/**
 * The AI assistant's chat (#308), around the app shell in the root layout, so the conversation
 * stays as people move between pages. The AI page and the AI bar on every other page show it.
 * It talks to POST /api/agent/chat, folding the streamed events into the answer
 * (src/lib/ai/chat-client.ts). It also holds where the AI bar is (`useAiDock()`).
 */
export function AiChatProvider({ enabled, initialDock, children }: { enabled: boolean; initialDock: AiDock; children: ReactNode }) {
  const [chats, setChats] = useState<AiChat[]>([]);
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
      const earlier = (existing?.turns ?? []).filter((item) => item.id !== retryOf?.turnId);
      const messages = requestMessages(earlier, question);

      const chatId = existing?.id ?? newId();
      const created = !existing;
      // The chat goes to the top of the list, with the question at its end (a retry replaces the failed one).
      setChats((list) => {
        const chat = list.find((item) => item.id === chatId);
        const next: AiChat = chat
          ? { ...chat, turns: [...chat.turns.filter((item) => item.id !== retryOf?.turnId), turn] }
          : { id: chatId, title: chatTitle(question), turns: [turn] };
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
            chat.id === chatId ? { ...chat, turns: chat.turns.map((item) => (item.id === turnId ? { ...item, answer } : item)) } : chat,
          ),
        );
      };

      const controller = new AbortController();
      streams.current.add(controller);
      try {
        const response = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
          if (response.status === 403 && body?.code === "notice_required") {
            // Not agreed yet (or agreed before the notice changed): take the question back and show the notice.
            setChats((list) =>
              list.flatMap((chat) => {
                if (chat.id !== chatId) return [chat];
                const turns = chat.turns.filter((item) => item.id !== turnId);
                return turns.length ? [{ ...chat, turns }] : [];
              }),
            );
            if (created) showChat(null);
            setStatus((current) => (current ? { ...current, noticeAccepted: false } : current));
            pending.current = question;
            setNotice({ open: true, agreeing: false, error: null });
            return;
          }
          update((answer) => ({ ...answer, done: true, error: body?.error ?? "Something went wrong. Try again in a moment." }));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const lines = createEventReader();
        const apply = (events: ChatEvent[]) => {
          if (!events.length) return;
          events.forEach(learn);
          update((answer) => events.reduce(applyChatEvent, answer));
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
      const turn = chatsRef.current.find((chat) => chat.id === chatId)?.turns.find((item) => item.id === turnId);
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
    },
    [putBack, showChat],
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
  const value = useMemo<AiChatContextValue>(
    () => ({
      enabled,
      chats,
      current,
      status,
      busy,
      announcement,
      draft,
      setDraft,
      ask,
      retry,
      newChat,
      openChat,
      notice,
      agree: () => void agree(),
      dismissNotice: putBack,
      loadStatus,
    }),
    [enabled, chats, current, status, busy, announcement, draft, ask, retry, newChat, openChat, notice, agree, putBack, loadStatus],
  );
  const dockValue = useMemo<AiDockContextValue>(() => ({ dock, setDock }), [dock, setDock]);

  return (
    <AiDockContext.Provider value={dockValue}>
      <AiChatContext.Provider value={value}>{children}</AiChatContext.Provider>
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
