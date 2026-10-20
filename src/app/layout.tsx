import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { ThemeInitScript, ThemeProvider } from "@/components/theme-provider";
import { TimeZoneCookie } from "@/components/time-zone-cookie";
import { Toaster } from "@/components/ui/toaster";
import { getCurrentUser } from "@/lib/auth";

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

  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="h-full flex flex-col bg-canvas text-ink">
        <ThemeInitScript />
        <TimeZoneCookie />
        <ThemeProvider>
          <AppShell currentUser={currentUser}>{children}</AppShell>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
