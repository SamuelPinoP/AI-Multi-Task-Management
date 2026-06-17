import { NotificationCenter } from "@/components/notification-center";
import { requirePageUser } from "@/lib/auth";
import { buildNotificationsForUser } from "@/lib/notifications";

export default async function NotificationsPage() {
  const user = await requirePageUser();
  const notifications = await buildNotificationsForUser(user);
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <NotificationCenter initialNotifications={notifications.map((notification) => ({ ...notification, createdAt: notification.createdAt.toISOString(), readAt: notification.readAt?.toISOString() ?? null }))} />
      </div>
    </main>
  );
}
