"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ThemeToggle } from "./theme-provider";
import { GlobalCommandCenter } from "./global-command-center";

type NavLinkItem = {
  href: string;
  label: string;
  exact?: boolean;
};

const workspaceLinks: NavLinkItem[] = [
  { href: "/notes", label: "Notes" },
  { href: "/tasks", label: "Tasks", exact: true },
  { href: "/events", label: "Events", exact: true },
  { href: "/projects", label: "Projects" },
  { href: "/events/calendar", label: "Calendar" },
];

const topLinks: NavLinkItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/today", label: "Today" },
];

const toolLinks: NavLinkItem[] = [
  { href: "/tasks/board", label: "Task Board" },
  { href: "/planner", label: "Planner" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/trash", label: "Trash" },
];

const mobileLinks: NavLinkItem[] = [
  ...topLinks,
  ...workspaceLinks,
  ...toolLinks,
];

const publicPaths = new Set(["/login", "/signup"]);

type ShellUser = {
  name: string | null;
  email: string;
  isGuest: boolean;
} | null;

function isActive(pathname: string, href: string, exact = false) {
  if (href === "/" || exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function TopBarLink({ href, label, exact }: NavLinkItem) {
  const pathname = usePathname();
  const active = isActive(pathname, href, exact);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 rounded-full border px-3 py-2 text-sm font-medium transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 dark:focus-visible:outline-zinc-300 ${
        active
          ? "border-zinc-900 bg-zinc-900 text-white shadow-sm shadow-zinc-300/60 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 dark:shadow-none"
          : "border-zinc-200 bg-white/80 text-zinc-700 hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      }`}
    >
      {label}
    </Link>
  );
}

function SidebarNavigation({ pathname }: { pathname: string }) {
  return (
    <aside className="hidden h-full w-80 shrink-0 p-4 lg:block xl:w-[22rem]">
      <nav
        className="flex h-full flex-col gap-4 rounded-[2rem] border border-zinc-200/70 bg-white/55 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/45"
        aria-label="Main workspace navigation"
      >
        {workspaceLinks.map((link) => {
          const active = isActive(pathname, link.href, link.exact);

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`group flex flex-1 items-center justify-center rounded-[1.75rem] border px-6 py-7 text-center text-2xl font-semibold tracking-tight transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 dark:focus-visible:outline-zinc-300 ${
                active
                  ? "border-zinc-300 bg-white text-zinc-950 shadow-sm shadow-zinc-200/70 ring-1 ring-zinc-300/70 dark:border-zinc-700 dark:bg-zinc-800/95 dark:text-white dark:shadow-none dark:ring-zinc-700/80"
                  : "border-zinc-200/70 bg-zinc-100/70 text-zinc-800 hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-800/80 dark:bg-zinc-900/70 dark:text-zinc-100 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/80 dark:hover:text-white"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function AppShell({
  children,
  currentUser,
}: {
  children: React.ReactNode;
  currentUser: ShellUser;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoggedOutLanding = !currentUser && pathname === "/";
  const isPublicPage = publicPaths.has(pathname) || isLoggedOutLanding;
  const displayName = currentUser?.isGuest
    ? "Guest Workspace"
    : currentUser?.name || currentUser?.email;
  const showWorkspaceShell = Boolean(currentUser && !isPublicPage);

  useEffect(() => {
    if (!currentUser && !isPublicPage) {
      router.replace("/login");
    }
  }, [currentUser, isPublicPage, router]);

  const shellLayoutClass = showWorkspaceShell
    ? "flex min-h-screen flex-col overflow-x-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 lg:h-screen lg:overflow-hidden"
    : "flex min-h-screen flex-col overflow-x-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100";

  return (
    <div className={shellLayoutClass}>
      <header className="sticky top-0 z-20 shrink-0 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-[104rem] items-center gap-3 px-4 py-3 sm:px-6">
          {currentUser ? (
            <div className="hidden min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap rounded-full px-1 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden lg:flex">
              <div className="shrink-0">
                <GlobalCommandCenter />
              </div>

              <nav
                className="flex shrink-0 items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50/90 p-1 dark:border-zinc-800 dark:bg-zinc-950/50"
                aria-label="Top tools"
              >
                {[...topLinks, ...toolLinks].map((link) => (
                  <TopBarLink key={link.href} {...link} />
                ))}
              </nav>
            </div>
          ) : (
            <div className="min-w-0 flex-1" />
          )}

          <div className="flex shrink-0 items-center justify-end gap-2">
            {currentUser ? (
              <div className="hidden shrink-0 items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 xl:flex">
                {currentUser.isGuest ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    Guest
                  </span>
                ) : null}
                <span className="max-w-36 truncate font-medium">
                  {displayName}
                </span>
                {!currentUser.isGuest && currentUser.name ? (
                  <span className="hidden max-w-36 truncate text-zinc-500 dark:text-zinc-400 2xl:inline">
                    {currentUser.email}
                  </span>
                ) : null}
              </div>
            ) : null}

            {currentUser ? (
              <form action="/api/auth/logout" method="post" className="shrink-0">
                <button
                  type="submit"
                  className="rounded-full px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Logout
                </button>
              </form>
            ) : null}

            <div className="shrink-0">
              <ThemeToggle />
            </div>
          </div>
        </div>

        {currentUser ? (
          <div className="border-t border-zinc-200 px-4 py-2 lg:hidden dark:border-zinc-800 sm:px-6">
            <div className="mb-2">
              <GlobalCommandCenter />
            </div>
            <nav
              className="flex items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              aria-label="Mobile navigation"
            >
              {mobileLinks.map((link) => {
                const active = isActive(pathname, link.href, link.exact);

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`shrink-0 rounded-xl border px-3 py-2 text-sm shadow-sm transition ${
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
          </div>
        ) : null}
      </header>

      {showWorkspaceShell ? (
        <div className="mx-auto flex w-full max-w-[104rem] flex-1 items-stretch lg:min-h-0">
          <SidebarNavigation pathname={pathname} />
          <main className="min-w-0 flex-1 lg:h-full lg:overflow-y-auto">
            {children}
          </main>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
