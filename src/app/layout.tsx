import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { ServiceWorkerRegistration } from "@/components/pwa";
import { ThemeInitScript, ThemeProvider } from "@/components/theme-provider";
import { TimeZoneCookie } from "@/components/time-zone-cookie";
import { Toaster } from "@/components/ui/toaster";
import { getCurrentUser } from "@/lib/auth";
import { parseSidebarProjects, SIDEBAR_COLLAPSED_COOKIE, SIDEBAR_PROJECTS_COOKIE } from "@/lib/sidebar-state";
import { getWorkspaceNav } from "@/lib/workspace-nav";

export const metadata: Metadata = {
  title: "AI Multi",
  description: "AI productivity app for notes, tasks, and events.",
  applicationName: "AI Multi",
  appleWebApp: { capable: true, title: "AI Multi", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

// The installed app's title bar follows the canvas color of each theme.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1413" },
  ],
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
  const sidebarProjectsOpen = parseSidebarProjects(cookieStore.get(SIDEBAR_PROJECTS_COOKIE)?.value);

  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="h-full flex flex-col bg-canvas text-ink">
        <ThemeInitScript />
        <TimeZoneCookie />
        <ServiceWorkerRegistration signedIn={Boolean(currentUser)} />
        <ThemeProvider>
          <AppShell
            currentUser={currentUser}
            initialNav={initialNav}
            initialSidebarCollapsed={sidebarCollapsed}
            initialProjectsOpen={sidebarProjectsOpen}
          >
            {children}
          </AppShell>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
