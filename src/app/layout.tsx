import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { ThemeInitScript, ThemeProvider } from "@/components/theme-provider";
import { getCurrentUser } from "@/lib/auth";
import { getUnreadNotificationCount } from "@/lib/notifications";

export const metadata: Metadata = {
  title: "AI-Multi Task-Management",
  description: "AI productivity app for notes, tasks, and events.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const currentUser = await getCurrentUser();
  const unreadNotificationCount = currentUser ? await getUnreadNotificationCount(currentUser) : 0;

  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <ThemeInitScript />
        <ThemeProvider>
          <AppShell currentUser={currentUser} unreadNotificationCount={unreadNotificationCount}>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
