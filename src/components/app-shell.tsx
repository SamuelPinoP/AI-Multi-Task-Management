"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ThemeToggle } from "./theme-provider";
import { GlobalCommandCenter } from "./global-command-center";

const primaryLinks = [
  { href: "/", label: "Dashboard" },
  { href: "/today", label: "Today" },
  { href: "/notes", label: "Notes" },
  { href: "/tasks", label: "Tasks" },
  { href: "/events", label: "Events" },
  { href: "/projects", label: "Projects" },
  { href: "/roadmap", label: "Roadmap" },
];

const utilityLinks = [
  { href: "/planner", label: "Planner" },
  { href: "/trash", label: "Trash" },
];

const publicPaths = new Set(["/login", "/signup"]);

type ShellUser = { name: string | null; email: string } | null;

export function AppShell({ children, currentUser }: { children: React.ReactNode; currentUser: ShellUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublicPage = publicPaths.has(pathname);

  useEffect(() => {
    if (!currentUser && !isPublicPage) {
      router.replace("/login");
    }
  }, [currentUser, isPublicPage, router]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href={currentUser ? "/" : "/login"} className="shrink-0 font-semibold">AI-Multi Task-Management</Link>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            {currentUser ? <div className="shrink-0"><GlobalCommandCenter /></div> : null}

            {currentUser ? <nav className="hidden min-w-0 flex-1 items-center gap-1 md:flex">
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {primaryLinks.map((link) => {
                  const active = pathname === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`shrink-0 rounded-lg px-2.5 py-2 text-sm transition ${
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

              <div className="ml-1 flex shrink-0 items-center gap-1 border-l border-zinc-200 pl-2 dark:border-zinc-700">
                {utilityLinks.map((link) => {
                  const active = pathname === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`shrink-0 rounded-lg px-2.5 py-2 text-sm transition ${
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
            </nav> : null}

            {currentUser ? (
              <div className="hidden shrink-0 items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 lg:flex">
                <span className="max-w-28 truncate font-medium">{currentUser.name || currentUser.email}</span>
                {currentUser.name ? <span className="max-w-36 truncate text-zinc-500 dark:text-zinc-400">{currentUser.email}</span> : null}
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
          <nav className="flex items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {[...primaryLinks, ...utilityLinks].map((link) => {
              const active = pathname === link.href;
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
