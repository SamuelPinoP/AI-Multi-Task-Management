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

type SidebarLink = NavLinkItem & {
  description: string;
  icon: string;
};

const topLinks: NavLinkItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/today", label: "Today" },
];

const navSections: { title: string; eyebrow: string; links: SidebarLink[] }[] =
  [
    {
      title: "Workspace",
      eyebrow: "Create and manage",
      links: [
        {
          href: "/notes",
          label: "Notes",
          description: "Ideas, docs, and context",
          icon: "✦",
        },
        {
          href: "/tasks",
          label: "Tasks",
          description: "Priorities, due dates, owners",
          icon: "✓",
          exact: true,
        },
        {
          href: "/events",
          label: "Events",
          description: "Schedules and planning",
          icon: "◷",
          exact: true,
        },
        {
          href: "/projects",
          label: "Projects",
          description: "Teams and workspaces",
          icon: "▣",
        },
        {
          href: "/events/calendar",
          label: "Calendar",
          description: "Timeline and event view",
          icon: "◫",
        },
      ],
    },
    {
      title: "Tools",
      eyebrow: "Plan, review, recover",
      links: [
        {
          href: "/tasks/board",
          label: "Task Board",
          description: "Kanban lanes for active work",
          icon: "▤",
        },
        {
          href: "/planner",
          label: "Planner",
          description: "Weekly goals and focus",
          icon: "◇",
        },
        {
          href: "/roadmap",
          label: "Roadmap",
          description: "Long-range project direction",
          icon: "↗",
        },
        {
          href: "/trash",
          label: "Trash",
          description: "Restore deleted items",
          icon: "⌫",
        },
      ],
    },
  ];

const mobileLinks: NavLinkItem[] = [
  ...topLinks,
  ...navSections.flatMap((section) => section.links),
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
    <aside className="hidden min-h-[calc(100vh-4.25rem)] w-80 shrink-0 border-r border-zinc-200/80 bg-white/80 px-5 py-6 shadow-[12px_0_30px_-28px_rgba(39,39,42,0.55)] dark:border-zinc-800/80 dark:bg-zinc-950/70 lg:block xl:w-[21rem]">
      <div className="sticky top-24 space-y-6">
        <div className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
            Navigation
          </p>
          <h2 className="mt-2 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            Workspace menu
          </h2>
          <p className="mt-1 text-sm leading-5 text-zinc-600 dark:text-zinc-300">
            All primary areas and planning tools are available here.
          </p>
        </div>

        <nav className="space-y-6" aria-label="Main workspace navigation">
          {navSections.map((section) => (
            <section
              key={section.title}
              aria-labelledby={`${section.title.toLowerCase()}-navigation-heading`}
            >
              <div className="mb-2 flex items-end justify-between gap-3 px-1">
                <h3
                  id={`${section.title.toLowerCase()}-navigation-heading`}
                  className="text-sm font-semibold text-zinc-950 dark:text-zinc-50"
                >
                  {section.title}
                </h3>
                <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">
                  {section.eyebrow}
                </span>
              </div>

              <div className="space-y-2 rounded-3xl border border-zinc-200 bg-white p-2 shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900/55 dark:shadow-none">
                {section.links.map((link) => {
                  const active = isActive(pathname, link.href, link.exact);

                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      className={`group flex items-center gap-3 rounded-2xl px-3 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 dark:focus-visible:outline-zinc-300 ${
                        active
                          ? "bg-zinc-900 text-white shadow-md shadow-zinc-300/70 dark:bg-zinc-100 dark:text-zinc-950 dark:shadow-none"
                          : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-50"
                      }`}
                    >
                      <span
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-base font-semibold transition ${
                          active
                            ? "bg-white/15 text-white ring-1 ring-white/20 dark:bg-zinc-950/10 dark:text-zinc-950 dark:ring-zinc-950/10"
                            : "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200 group-hover:bg-white dark:bg-zinc-950 dark:text-zinc-200 dark:ring-zinc-800 dark:group-hover:bg-zinc-900"
                        }`}
                        aria-hidden="true"
                      >
                        {link.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">
                          {link.label}
                        </span>
                        <span
                          className={`mt-0.5 block truncate text-xs leading-5 ${active ? "text-zinc-200 dark:text-zinc-700" : "text-zinc-500 dark:text-zinc-400"}`}
                        >
                          {link.description}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
      </div>
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
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-[88rem] items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href={currentUser ? "/" : "/login"}
            className="min-w-0 shrink truncate font-semibold tracking-tight sm:shrink-0"
          >
            AI-Multi Task-Management
          </Link>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            {currentUser ? (
              <div className="shrink-0">
                <GlobalCommandCenter />
              </div>
            ) : null}

            {currentUser ? (
              <nav
                className="hidden shrink-0 items-center gap-1 md:flex"
                aria-label="Global navigation"
              >
                {topLinks.map((link) => (
                  <NavLink
                    key={link.href}
                    href={link.href}
                    label={link.label}
                  />
                ))}
              </nav>
            ) : null}

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
                  <span className="max-w-36 truncate text-zinc-500 dark:text-zinc-400">
                    {currentUser.email}
                  </span>
                ) : null}
              </div>
            ) : null}

            {currentUser ? (
              <Link
                href="/logout"
                className="shrink-0 rounded-lg px-2.5 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
        <div className="mx-auto flex w-full max-w-[92rem] items-start">
          <SidebarNavigation pathname={pathname} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
