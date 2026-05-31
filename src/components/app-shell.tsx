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

function TopBarLink({
  href,
  label,
  exact,
  variant = "primary",
}: NavLinkItem & { variant?: "primary" | "tool" }) {
  const pathname = usePathname();
  const active = isActive(pathname, href, exact);
  const activeClass =
    variant === "tool"
      ? "border-zinc-900 bg-zinc-900 text-white shadow-sm shadow-zinc-300/70 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 dark:shadow-none"
      : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900";
  const inactiveClass =
    variant === "tool"
      ? "border-zinc-200 bg-white/80 text-zinc-700 hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 rounded-full px-3 py-2 text-sm font-medium transition ${
        variant === "tool" ? "border" : ""
      } ${active ? activeClass : inactiveClass}`}
    >
      {label}
    </Link>
  );
}

function SidebarNavigation({ pathname }: { pathname: string }) {
  return (
    <aside className="hidden min-h-[calc(100vh-4.25rem)] w-80 shrink-0 border-r border-zinc-200/80 bg-white/85 px-5 py-6 shadow-[12px_0_30px_-28px_rgba(39,39,42,0.55)] dark:border-zinc-800/80 dark:bg-zinc-950/75 lg:block xl:w-[22rem]">
      <nav
        className="sticky top-24 flex min-h-[calc(100vh-10rem)] flex-col gap-4"
        aria-label="Main workspace navigation"
      >
        {workspaceLinks.map((link) => {
          const active = isActive(pathname, link.href, link.exact);

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`group relative flex min-h-24 flex-1 items-center overflow-hidden rounded-3xl border px-6 py-6 text-left text-xl font-semibold tracking-tight transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 dark:focus-visible:outline-zinc-300 ${
                active
                  ? "border-zinc-900 bg-zinc-900 text-white shadow-xl shadow-zinc-300/70 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 dark:shadow-none"
                  : "border-zinc-200 bg-white text-zinc-800 shadow-sm shadow-zinc-200/60 hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-zinc-50 hover:shadow-lg hover:shadow-zinc-200/80 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100 dark:shadow-none dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              <span
                className={`absolute inset-y-6 left-0 w-1.5 rounded-r-full transition ${
                  active
                    ? "bg-white/90 dark:bg-zinc-950/80"
                    : "bg-transparent group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700"
                }`}
                aria-hidden="true"
              />
              <span className="relative">{link.label}</span>
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
  const isPublicPage = publicPaths.has(pathname);
  const displayName = currentUser?.isGuest
    ? "Guest Workspace"
    : currentUser?.name || currentUser?.email;
  const showWorkspaceShell = Boolean(currentUser && !isPublicPage);

  useEffect(() => {
    if (!currentUser && !isPublicPage) {
      router.replace("/login");
    }
  }, [currentUser, isPublicPage, router]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-[104rem] items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href={currentUser ? "/" : "/login"}
            className="min-w-0 max-w-[13rem] shrink truncate font-semibold tracking-tight sm:max-w-none sm:shrink-0"
          >
            AI-Multi Task-Management
          </Link>

          {currentUser ? (
            <div className="hidden min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap rounded-full px-1 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden lg:flex">
              <div className="shrink-0">
                <GlobalCommandCenter />
              </div>

              <nav
                className="flex shrink-0 items-center gap-1"
                aria-label="Global navigation"
              >
                {topLinks.map((link) => (
                  <TopBarLink key={link.href} {...link} />
                ))}
              </nav>

              <nav
                className="ml-1 flex shrink-0 items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50/90 p-1 dark:border-zinc-800 dark:bg-zinc-950/50"
                aria-label="Secondary tools"
              >
                {toolLinks.map((link) => (
                  <TopBarLink key={link.href} {...link} variant="tool" />
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
              <Link
                href="/logout"
                className="shrink-0 rounded-full px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Logout
              </Link>
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
        <div className="mx-auto flex w-full max-w-[104rem] items-start">
          <SidebarNavigation pathname={pathname} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
