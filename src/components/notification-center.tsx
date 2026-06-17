"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";

type NotificationItem = { id: string; sourceKey: string; kind: string; title: string; body: string; href: string; createdAt: string; readAt: string | null };

function formatWhen(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function NotificationCenter({ initialNotifications }: { initialNotifications: NotificationItem[] }) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState("");
  const unreadCount = useMemo(() => notifications.filter((notification) => !notification.readAt).length, [notifications]);

  async function loadNotifications() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load notifications");
      const data = await res.json();
      setNotifications(data.notifications ?? []);
    } catch {
      setError("Could not load notifications. Please try again.");
    } finally { setLoading(false); }
  }
  async function updateNotification(sourceKey: string, action: "MARK_READ" | "DISMISS") {
    try {
      setUpdating(`${action}:${sourceKey}`);
      const res = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceKey, action }) });
      if (!res.ok) throw new Error("Failed to update notification");
      await loadNotifications();
    } catch { setError("Could not update that notification."); } finally { setUpdating(null); }
  }
  async function markAllRead() {
    try {
      setUpdating("all");
      const res = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "MARK_ALL_READ" }) });
      if (!res.ok) throw new Error("Failed to mark all read");
      await loadNotifications();
    } catch { setError("Could not mark notifications as read."); } finally { setUpdating(null); }
  }

  return <>
    <header className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Notification Center</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Reminders and workspace updates</h1><p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">Track due tasks, upcoming events, invitations, project chat, and planner prompts without email or external services.</p></div><button className={uiPrimaryButtonClass} onClick={markAllRead} disabled={unreadCount === 0 || updating === "all"}>{updating === "all" ? "Updating…" : `Mark all read (${unreadCount})`}</button></div>
    </header>
    {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">{error}</div> : null}
    <section className="rounded-[2rem] border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70 sm:p-4">
      {loading ? <div className="space-y-3 p-3">{[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />)}</div> : notifications.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700"><div className="text-4xl">🔔</div><h2 className="mt-3 text-lg font-semibold">All caught up</h2><p className="mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">New reminders and project updates will appear here when they need your attention.</p></div> : <div className="divide-y divide-zinc-200 dark:divide-zinc-800">{notifications.map((notification) => <article key={notification.sourceKey} className={`flex flex-col gap-3 px-2 py-4 sm:flex-row sm:items-start sm:justify-between ${notification.readAt ? "opacity-75" : ""}`}><Link href={notification.href} className="min-w-0 flex-1 rounded-2xl p-2 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60"><div className="flex flex-wrap items-center gap-2">{!notification.readAt ? <span className="h-2.5 w-2.5 rounded-full bg-blue-500" aria-label="Unread" /> : null}<h2 className="font-semibold text-zinc-950 dark:text-zinc-50">{notification.title}</h2><span className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">{notification.kind.replaceAll("_", " ")}</span></div><p className="mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{notification.body}</p><p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">{formatWhen(notification.createdAt)}</p></Link><div className="flex shrink-0 gap-2 px-2 sm:px-0">{!notification.readAt ? <button className={uiButtonClass} onClick={() => updateNotification(notification.sourceKey, "MARK_READ")} disabled={updating?.endsWith(notification.sourceKey)}>Mark read</button> : null}<button className={uiButtonClass} onClick={() => updateNotification(notification.sourceKey, "DISMISS")} disabled={updating?.endsWith(notification.sourceKey)}>Dismiss</button></div></article>)}</div>}
    </section>
  </>;
}
