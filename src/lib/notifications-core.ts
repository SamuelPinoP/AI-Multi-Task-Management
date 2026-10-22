// Pure parts of the notification inbox (SMART-08): who a chat message
// mentions, which tasks need a "due soon" reminder, and the push payload.
// src/lib/notifications.ts does the database and push work.

export type NotificationKind = "TASK_ASSIGNED" | "MENTION" | "TASK_DUE_SOON";

export type NewNotification = {
  userId: string;
  type: NotificationKind;
  title: string;
  body?: string | null;
  url?: string | null;
  dedupeKey?: string | null;
};

const DAY_MS = 86_400_000;
// A name ends where letters, digits and underscores stop, in any script.
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** The names "@" can be followed by for a person: full name, first name and the email's local part. */
function mentionNames(person: { name: string | null; email: string }) {
  const names = new Set<string>();
  const fullName = person.name?.trim().toLowerCase().replace(/\s+/g, " ");
  if (fullName) {
    names.add(fullName);
    names.add(fullName.split(" ")[0]);
  }
  names.add(person.email.split("@")[0].toLowerCase());
  // One-letter names would match far too much.
  return [...names].filter((name) => name.length >= 2);
}

/**
 * The people a chat message mentions with "@Name", "@First" or "@emailname",
 * matched without regard to case. "@ana" doesn't match "Anabel".
 */
export function mentionedUserIds(message: string, people: { userId: string; name: string | null; email: string }[]) {
  const text = message.toLowerCase().replace(/\s+/g, " ");
  const found = new Set<string>();
  for (const person of people) {
    for (const name of mentionNames(person)) {
      let index = text.indexOf(`@${name}`);
      while (index !== -1) {
        const before = text[index - 1];
        const after = text[index + name.length + 1];
        if ((!before || !WORD_CHAR.test(before)) && (!after || !WORD_CHAR.test(after))) {
          found.add(person.userId);
          break;
        }
        index = text.indexOf(`@${name}`, index + 1);
      }
      if (found.has(person.userId)) break;
    }
  }
  return [...found];
}

/** `YYYY-MM-DD` of a stored due date (midnight UTC of the chosen day). */
function dayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

/**
 * "Due today" and "due tomorrow" reminders, for the assignee if the task has
 * one with an account, otherwise for its owner. `today` is the run's UTC date;
 * one reminder per task and due date, whatever the time of the run.
 */
export function dueSoonNotifications(
  tasks: { id: string; title: string; dueDate: Date; ownerId: string; assigneeUserId: string | null; projectName: string | null }[],
  now: Date,
): NewNotification[] {
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getTime() + DAY_MS));
  return tasks.flatMap((task) => {
    const due = dayKey(task.dueDate);
    if (due !== today && due !== tomorrow) return [];
    return [
      {
        userId: task.assigneeUserId ?? task.ownerId,
        type: "TASK_DUE_SOON" as const,
        title: `Due ${due === today ? "today" : "tomorrow"}: ${task.title}`,
        body: task.projectName ? `In ${task.projectName}` : null,
        url: `/tasks?task=${task.id}`,
        dedupeKey: `due:${task.id}:${due}`,
      },
    ];
  });
}

/** What the service worker shows; it ignores anything else (public/sw.js). */
export function pushPayload(notification: { id: string; title: string; body: string | null; url: string | null }) {
  return JSON.stringify({
    title: notification.title,
    body: notification.body ?? "",
    url: notification.url ?? "/",
    // Same tag, same notification: a repeat delivery replaces it instead of stacking.
    tag: notification.id,
  });
}

/** Only https push services are accepted, with a sane length, so the server never posts anywhere odd. */
export function isValidPushSubscription(value: unknown): value is { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (!value || typeof value !== "object") return false;
  const { endpoint, keys } = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== "string" || endpoint.length > 2000) return false;
  try {
    if (new URL(endpoint).protocol !== "https:") return false;
  } catch {
    return false;
  }
  const isKey = (key: unknown, max: number) => typeof key === "string" && key.length > 0 && key.length <= max && /^[A-Za-z0-9_-]+=*$/.test(key);
  return isKey(keys?.p256dh, 200) && isKey(keys?.auth, 100);
}
