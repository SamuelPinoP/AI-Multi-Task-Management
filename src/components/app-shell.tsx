"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ThemeToggle } from "./theme-provider";
import { GlobalCommandCenter } from "./global-command-center";

const topLinks = [
  { href: "/", label: "Dashboard" },
  { href: "/today", label: "Today" },
];

const hubLinks = [
  { href: "/notes", label: "Notes" },
  { href: "/tasks", label: "Tasks" },
  { href: "/events", label: "Events" },
  { href: "/projects", label: "Projects" },
  { href: "/events/calendar", label: "Calendar" },
  { href: "/tasks/board", label: "Task Board" },
  { href: "/planner", label: "Planner" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/trash", label: "Trash" },
];

const publicPaths = new Set(["/login", "/signup"]);

type ShellUser = { name: string | null; email: string; isGuest: boolean } | null;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children, currentUser }: { children: React.ReactNode; currentUser: ShellUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublicPage = publicPaths.has(pathname);
  const displayName = currentUser?.isGuest ? "Guest Workspace" : currentUser?.name || currentUser?.email;

  useEffect(() => {
    if (!currentUser && !isPublicPage) {
      router.replace("/login");
    }
  }, [currentUser, isPublicPage, router]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href={currentUser ? "/" : "/login"} className="shrink-0 font-semibold tracking-tight">AI-Multi Task-Management</Link>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            {currentUser ? <div className="shrink-0"><GlobalCommandCenter /></div> : null}

            {currentUser ? (
              <nav className="hidden shrink-0 items-center gap-1 md:flex" aria-label="Primary navigation">
                {topLinks.map((link) => {
                  const active = isActive(pathname, link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`rounded-lg px-3 py-2 text-sm transition ${
                        active
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
                <details className="group relative">
                  <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 marker:hidden dark:text-zinc-300 dark:hover:bg-zinc-800">
                    Workspace
                    <span className="text-xs transition group-open:rotate-180">⌄</span>
                  </summary>
                  <div className="absolute right-0 mt-2 grid w-72 grid-cols-2 gap-2 rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
                    {hubLinks.map((link) => {
                      const active = isActive(pathname, link.href);
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          className={`rounded-xl px-3 py-2 text-sm transition ${
                            active
                              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                              : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          }`}
                        >
                          {link.label}
                        </Link>
                      );
                    })}
                  </div>
                </details>
              </nav>
            ) : null}

            {currentUser ? (
              <div className="hidden shrink-0 items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 lg:flex">
                {currentUser.isGuest ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">Guest</span> : null}
                <span className="max-w-36 truncate font-medium">{displayName}</span>
                {!currentUser.isGuest && currentUser.name ? <span className="max-w-36 truncate text-zinc-500 dark:text-zinc-400">{currentUser.email}</span> : null}
              </div>
            ) : null}

            {currentUser ? (
              <Link href="/logout" className="shrink-0 rounded-lg px-2.5 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
                Logout
              </Link>
            ) : null}

            <div className="shrink-0">
              <ThemeToggle />
            </div>
          </div>
        </div>

        {currentUser ? <div className="border-t border-zinc-200 px-4 py-2 md:hidden dark:border-zinc-800 sm:px-6">
          <nav className="flex items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden" aria-label="Mobile navigation">
            {[...topLinks, ...hubLinks].map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-sm transition ${
                    active
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div> : null}
      </header>
      {children}
    </div>
  );
}
