import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  // The Spark mark (DES-07): an SVG for the browser tab, with app/favicon.ico as the fallback.
  icons: { icon: { url: "/icons/icon.svg", type: "image/svg+xml" }, apple: "/icons/apple-touch-icon.png" },
};

// Geist for the interface and Geist Mono for counts, times and keyboard hints (DES-08).
// next/font downloads them at build time and serves them from the app, so pages make no
// requests to Google, and its size-adjusted fallback keeps text from jumping as they load.
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

// The installed app's title bar follows the canvas color of each theme.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0f0e" },
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
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
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
