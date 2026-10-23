"use client";

import { AtSign, Bell, BellOff, BellRing, CalendarClock, FolderKanban, UserCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { currentPushSubscription, pushSupported, turnOffPush, turnOnPush } from "@/lib/push-client";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

type InboxItem = {
  id: string;
  type: "TASK_ASSIGNED" | "MENTION" | "TASK_DUE_SOON";
  title: string;
  body: string | null;
  url: string | null;
  readAt: string | null;
  createdAt: string;
};

const TYPE_ICONS = { TASK_ASSIGNED: UserCheck, MENTION: AtSign, TASK_DUE_SOON: CalendarClock } as const;

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "5 minutes ago", "yesterday", "3 days ago". */
function timeAgo(iso: string) {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [["second", 60], ["minute", 60], ["hour", 24], ["day", 7], ["week", 5]];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return relativeTime.format(value, unit);
    value = Math.round(value / size);
  }
  return relativeTime.format(Math.round(value / 4.35), "month");
}

/**
 * The bell in the top bar (SMART-08): project invitations, the inbox of
 * assignments, mentions and due-soon reminders, and the switch for browser
 * notifications on this device.
 */
export function NotificationsMenu({ pendingInvitations, unreadNotifications }: { pendingInvitations: number; unreadNotifications: number }) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [unread, setUnread] = useState(unreadNotifications);
  // null: push isn't available here (not set up on the server, or this browser can't).
  const [push, setPush] = useState<{ publicKey: string; on: boolean; busy: boolean } | null>(null);
  const [lastSeenCount, setLastSeenCount] = useState(unreadNotifications);

  // The shell's count wins when it changes (a new notification since the menu last loaded).
  if (unreadNotifications !== lastSeenCount) {
    setLastSeenCount(unreadNotifications);
    setUnread(unreadNotifications);
  }

  async function load() {
    try {
      const [inbox, keys] = await Promise.all([
        fetch("/api/notifications", { cache: "no-store" }).then((response) => (response.ok ? response.json() : Promise.reject())),
        fetch("/api/push", { cache: "no-store" }).then((response) => (response.ok ? response.json() : { publicKey: null })),
      ]);
      setItems((inbox as { notifications: InboxItem[] }).notifications);
      setUnread((inbox as { unread: number }).unread);
      const publicKey = (keys as { publicKey: string | null }).publicKey;
      if (publicKey && pushSupported()) {
        const subscription = await currentPushSubscription().catch(() => null);
        setPush({ publicKey, on: Boolean(subscription) && Notification.permission === "granted", busy: false });
      }
    } catch {
      setItems((current) => current ?? []);
    }
  }

  async function markRead(ids?: string[]) {
    const response = await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids ? { ids } : {}),
    }).catch(() => null);
    if (!response?.ok) return;
    const now = new Date().toISOString();
    setItems((current) => current?.map((item) => (!ids || ids.includes(item.id) ? { ...item, readAt: item.readAt ?? now } : item)) ?? null);
    setUnread(((await response.json()) as { unread: number }).unread);
    notifyWorkspaceChanged();
  }

  async function togglePush() {
    if (!push) return;
    setPush({ ...push, busy: true });
    try {
      if (push.on) await turnOffPush();
      else await turnOnPush(push.publicKey);
      setPush({ ...push, on: !push.on, busy: false });
      toast.success(push.on ? "Browser notifications are off" : "Browser notifications are on", {
        description: push.on ? "This device won't get them any more." : "This device gets assignments, mentions and due-soon reminders.",
      });
    } catch (error) {
      setPush({ ...push, busy: false });
      toast.error(error instanceof Error ? error.message : "Couldn't change browser notifications.");
    }
  }

  const total = pendingInvitations + unread;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void load();
      }}
    >
      <DropdownMenuTrigger
        aria-label={total ? `Notifications, ${total} new` : "Notifications"}
        className="relative grid h-8 w-8 place-items-center rounded-lg text-muted outline-none transition-colors hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Bell aria-hidden="true" className="h-4 w-4" />
        {total ? (
          <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border-2 border-surface bg-project-3" />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1rem)]">
        <div className="flex items-center justify-between gap-2">
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          {unread ? (
            <DropdownMenuItem
              className="px-2 py-1 text-xs font-medium text-accent"
              onSelect={(event) => {
                event.preventDefault();
                void markRead();
              }}
            >
              Mark all as read
            </DropdownMenuItem>
          ) : null}
        </div>
        {pendingInvitations ? (
          <DropdownMenuItem asChild>
            <Link href="/projects">
              <FolderKanban />
              {pendingInvitations} project invitation{pendingInvitations === 1 ? "" : "s"} waiting for you
            </Link>
          </DropdownMenuItem>
        ) : null}
        <div className="max-h-96 overflow-y-auto">
          {items === null ? (
            <p className="px-2.5 pb-3 pt-1 text-sm text-muted">Loading...</p>
          ) : items.length === 0 ? (
            pendingInvitations ? null : <p className="px-2.5 pb-3 pt-1 text-sm text-muted">You&apos;re all caught up.</p>
          ) : (
            items.map((item) => {
              const Icon = TYPE_ICONS[item.type];
              return (
                <DropdownMenuItem key={item.id} asChild className="items-start">
                  <Link href={item.url ?? "/"} onClick={() => (item.readAt ? undefined : void markRead([item.id]))}>
                    <Icon className="mt-0.5" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className={item.readAt ? "text-muted" : "font-semibold"}>{item.title}</span>
                      {item.body ? <span className="line-clamp-2 text-xs text-muted">{item.body}</span> : null}
                      <span className="text-xs text-muted">{timeAgo(item.createdAt)}</span>
                    </span>
                    {item.readAt ? null : (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent">
                        <span className="sr-only">Unread</span>
                      </span>
                    )}
                  </Link>
                </DropdownMenuItem>
              );
            })
          )}
        </div>
        {push ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={push.busy}
              onSelect={(event) => {
                event.preventDefault();
                void togglePush();
              }}
            >
              {push.on ? <BellOff /> : <BellRing />}
              {push.busy ? "Working..." : push.on ? "Turn off browser notifications" : "Turn on browser notifications"}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
