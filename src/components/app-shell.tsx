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

const sidebarLinks = [
  { href: "/notes", label: "Notes", description: "Ideas & docs", icon: "✦" },
  { href: "/tasks", label: "Tasks", description: "Priorities & owners", icon: "✓" },
  { href: "/events", label: "Events", description: "Schedules & plans", icon: "◷" },
  { href: "/projects", label: "Projects", description: "Teams & workspaces", icon: "▣" },
  { href: "/events/calendar", label: "Calendar", description: "Timeline view", icon: "◫" },
];

const moreLinks = [
  { href: "/tasks/board", label: "Task Board" },
  { href: "/planner", label: "Planner" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/trash", label: "Trash" },
];

const publicPaths = new Set(["/login", "/signup"]);

type ShellUser = { name: string | null; email: string; isGuest: boolean } | null;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/events") return pathname === "/events";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = isActive(pathname, href);

  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-2 text-sm transition ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </Link>
  );
}

function SidebarNavigation({ pathname }: { pathname: string }) {
  return (
    <aside className="hidden w-72 shrink-0 border-r border-zinc-200/80 bg-white/55 px-4 py-6 dark:border-zinc-800/80 dark:bg-zinc-950/35 lg:block">
      <div className="sticky top-24">
        <div className="mb-4 px-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Workspace</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Primary sections</p>
        </div>
        <nav className="space-y-3" aria-label="Workspace navigation">
          {sidebarLinks.map((link) => {
            const active = isActive(pathname, link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`group flex items-center gap-3 rounded-2xl border p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                  active
                    ? "border-zinc-900 bg-zinc-900 text-white shadow-zinc-300/60 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 dark:shadow-none"
                    : "border-zinc-200 bg-white/90 text-zinc-800 hover:border-zinc-300 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-100 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${
                    active
                      ? "bg-white/15 text-white dark:bg-zinc-950/10 dark:text-zinc-950"
                      : "bg-zinc-100 text-zinc-700 group-hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:group-hover:bg-zinc-700"
                  }`}
                  aria-hidden="true"
                >
                  {link.icon}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{link.label}</span>
                  <span className={`block truncate text-xs ${active ? "text-zinc-200 dark:text-zinc-700" : "text-zinc-500 dark:text-zinc-400"}`}>
                    {link.description}
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

export function AppShell({ children, currentUser }: { children: React.ReactNode; currentUser: ShellUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublicPage = publicPaths.has(pathname);
  const displayName = currentUser?.isGuest ? "Guest Workspace" : currentUser?.name || currentUser?.email;
  const showWorkspaceShell = Boolean(currentUser && !isPublicPage);

  useEffect(() => {
    if (!currentUser && !isPublicPage) {
      router.replace("/login");
    }
  }, [currentUser, isPublicPage, router]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-[88rem] items-center gap-3 px-4 py-3 sm:px-6">
          <Link href={currentUser ? "/" : "/login"} className="shrink-0 font-semibold tracking-tight">AI-Multi Task-Management</Link>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            {currentUser ? <div className="shrink-0"><GlobalCommandCenter /></div> : null}

            {currentUser ? (
              <nav className="hidden shrink-0 items-center gap-1 md:flex" aria-label="Primary navigation">
                {topLinks.map((link) => (
                  <NavLink key={link.href} href={link.href} label={link.label} />
                ))}
                <details className="group relative">
                  <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 marker:hidden dark:text-zinc-300 dark:hover:bg-zinc-800">
                    More
                    <span className="text-xs transition group-open:rotate-180">⌄</span>
                  </summary>
                  <div className="absolute right-0 mt-2 grid w-52 gap-1 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
                    {moreLinks.map((link) => {
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
              <div className="hidden shrink-0 items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 xl:flex">
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

        {currentUser ? <div className="border-t border-zinc-200 px-4 py-2 lg:hidden dark:border-zinc-800 sm:px-6">
          <nav className="flex items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden" aria-label="Mobile navigation">
            {[...topLinks, ...sidebarLinks, ...moreLinks].map((link) => {
              const active = isActive(pathname, link.href);
              const utilityVisibility = topLinks.includes(link) || moreLinks.includes(link) ? "md:hidden" : "";

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-sm shadow-sm transition ${utilityVisibility} ${
                    active
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div> : null}
      </header>

      {showWorkspaceShell ? (
        <div className="mx-auto flex w-full max-w-[88rem] items-start">
          <SidebarNavigation pathname={pathname} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
