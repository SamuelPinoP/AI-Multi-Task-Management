import "server-only";
import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { dueSoonNotifications, mentionedUserIds, pushPayload, type NewNotification } from "@/lib/notifications-core";

// The notification inbox and browser push (SMART-08). Notifications are rows
// in the database first; push only tells the browsers a user turned it on for.

/** How many notifications the bell's menu shows. */
export const INBOX_LIMIT = 30;
const DAY_MS = 86_400_000;
// A push service that doesn't answer shouldn't hold up a request or the cron run.
const PUSH_TIMEOUT_MS = 10_000;

/** The VAPID keys that sign push messages. Push stays off until both are set. */
export function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  // Push services want a way to reach the sender: an https URL or a mailto: address.
  const baseUrl = process.env.APP_BASE_URL?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || (baseUrl?.startsWith("https://") ? baseUrl : "mailto:noreply@example.com");
  return { publicKey, privateKey, subject };
}

type CreatedNotification = { id: string; userId: string; title: string; body: string | null; url: string | null };

/** Sends each new notification to every browser its user turned push on for, and forgets browsers that left. */
async function sendPush(notifications: CreatedNotification[]) {
  const config = pushConfig();
  if (!config || notifications.length === 0) return;
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: [...new Set(notifications.map((notification) => notification.userId))] } },
    select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
  });
  if (subscriptions.length === 0) return;

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const gone = new Set<string>();
  await Promise.all(
    notifications.flatMap((notification) =>
      subscriptions
        .filter((subscription) => subscription.userId === notification.userId)
        .map(async (subscription) => {
          try {
            await webpush.sendNotification(
              { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
              pushPayload(notification),
              { TTL: DAY_MS / 1000, timeout: PUSH_TIMEOUT_MS },
            );
          } catch (error) {
            const status = (error as { statusCode?: number }).statusCode;
            // 404 and 410: the browser unsubscribed or the subscription expired.
            if (status === 404 || status === 410) gone.add(subscription.id);
            else console.warn("Push notification failed.", { status: status ?? "no response" });
          }
        }),
    ),
  );
  if (gone.size) await prisma.pushSubscription.deleteMany({ where: { id: { in: [...gone] } } });
}

/** Adds notifications to the inbox (skipping repeats of the same dedupe key) and pushes the new ones. */
export async function createNotifications(inputs: NewNotification[]) {
  if (inputs.length === 0) return [];
  const created = await prisma.notification.createManyAndReturn({
    data: inputs.map((input) => ({
      userId: input.userId,
      type: input.type,
      title: input.title.slice(0, 200),
      body: input.body ? input.body.slice(0, 500) : null,
      url: input.url ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })),
    skipDuplicates: true,
    select: { id: true, userId: true, title: true, body: true, url: true },
  });
  await sendPush(created);
  return created;
}

function personName(person: { name: string | null; email: string }) {
  return person.name?.trim() || person.email;
}

/** "Ana assigned you a task", unless Ana assigned it to herself or the assignee has no account. */
export async function notifyTaskAssigned({
  task,
  actor,
}: {
  task: { id: string; title: string; assigneeId: string | null; project: { name: string } | null };
  actor: { id: string; name: string | null; email: string };
}) {
  if (!task.assigneeId) return;
  const member = await prisma.projectMember.findUnique({ where: { id: task.assigneeId }, select: { userId: true } });
  if (!member?.userId || member.userId === actor.id) return;
  await createNotifications([
    {
      userId: member.userId,
      type: "TASK_ASSIGNED",
      title: `${personName(actor)} assigned you a task`,
      body: task.project ? `“${task.title}” in ${task.project.name}` : `“${task.title}”`,
      url: `/tasks?task=${task.id}`,
    },
  ]);
}

/** "Ana mentioned you in Launch" for each project member a chat message @-mentions. */
export async function notifyMentions({
  project,
  author,
  message,
}: {
  project: { id: string; name: string; userId: string };
  author: { id: string; name: string | null; email: string };
  message: string;
}) {
  if (!message.includes("@")) return;
  const [owner, members] = await Promise.all([
    prisma.user.findUnique({ where: { id: project.userId }, select: { id: true, name: true, email: true } }),
    prisma.projectMember.findMany({
      where: { projectId: project.id, userId: { not: null } },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);
  const people = new Map<string, { userId: string; name: string | null; email: string }>();
  for (const person of [owner, ...members.map((member) => member.user)]) {
    if (person && person.id !== author.id) people.set(person.id, { userId: person.id, name: person.name, email: person.email });
  }
  const mentioned = mentionedUserIds(message, [...people.values()]);
  const snippet = message.length > 160 ? `${message.slice(0, 157).trimEnd()}...` : message;
  await createNotifications(
    mentioned.map((userId) => ({
      userId,
      type: "MENTION" as const,
      title: `${personName(author)} mentioned you in ${project.name}`,
      body: snippet,
      url: `/chats?project=${project.id}`,
    })),
  );
}

/** The daily "due today / due tomorrow" reminders (/api/cron/reminders). Running it twice adds nothing. */
export async function sendDueReminders(now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null, status: { not: "DONE" }, dueDate: { gte: today, lt: new Date(today.getTime() + 2 * DAY_MS) } },
    take: 2000,
    select: {
      id: true,
      title: true,
      dueDate: true,
      userId: true,
      assignee: { select: { userId: true } },
      project: { select: { name: true } },
    },
  });
  const created = await createNotifications(
    dueSoonNotifications(
      tasks.flatMap((task) =>
        task.dueDate
          ? [
              {
                id: task.id,
                title: task.title,
                dueDate: task.dueDate,
                ownerId: task.userId,
                assigneeUserId: task.assignee?.userId ?? null,
                projectName: task.project?.name ?? null,
              },
            ]
          : [],
      ),
      now,
    ),
  );
  return { dueTasks: tasks.length, notified: created.length };
}
