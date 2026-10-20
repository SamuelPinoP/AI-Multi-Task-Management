import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { ThemeInitScript, ThemeProvider } from "@/components/theme-provider";
import { TimeZoneCookie } from "@/components/time-zone-cookie";
import { Toaster } from "@/components/ui/toaster";
import { getCurrentUser } from "@/lib/auth";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/lib/sidebar-state";
import { getWorkspaceNav } from "@/lib/workspace-nav";

export const metadata: Metadata = {
  title: "AI Multi",
  description: "AI productivity app for notes, tasks, and events.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const currentUser = await getCurrentUser();
  const [initialNav, cookieStore] = await Promise.all([
    currentUser ? getWorkspaceNav(currentUser) : null,
    cookies(),
  ]);
  const sidebarCollapsed = cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";

  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="h-full flex flex-col bg-canvas text-ink">
        <ThemeInitScript />
        <TimeZoneCookie />
        <ThemeProvider>
          <AppShell currentUser={currentUser} initialNav={initialNav} initialSidebarCollapsed={sidebarCollapsed}>
            {children}
          </AppShell>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
