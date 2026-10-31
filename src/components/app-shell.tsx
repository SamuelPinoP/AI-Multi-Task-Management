"use client";

import {
  CalendarDays,
  ChevronRight,
  Download,
  FolderKanban,
  House,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  MessagesSquare,
  Moon,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sparkles,
  SquareCheckBig,
  SquareKanban,
  Sun,
  Target,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { LogoMark } from "@/components/brand/logo-mark";
import { CommandPalette } from "@/components/command-palette";
import { NewTaskDialog } from "@/components/new-task-dialog";
import { NotificationsMenu } from "@/components/notifications-menu";
import { ProjectSheet, type ProjectInput } from "@/components/projects/project-sheet";
import { clearOfflineData, OfflineBanner, promptInstall, useInstallPrompt } from "@/components/pwa";
import { EmailVerificationBanner } from "@/components/email-verification";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { ThemeToggle, useTheme } from "@/components/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { isNavItemActive, pageTitleFor, type NavMatch } from "@/lib/app-nav";
import { cn } from "@/lib/cn";
import { isTypingTarget, resolveShortcut } from "@/lib/shortcuts";
import { calendarNavItem } from "@/lib/calendar-view";
import { formatUnreadCount } from "@/lib/chats";
import { paletteColor, projectColor } from "@/lib/project-color";
import {
  SIDEBAR_COLLAPSED_COOKIE,
  SIDEBAR_PROJECTS_COOKIE,
  serializeSidebarProjects,
  type SidebarProjectsOpen,
} from "@/lib/sidebar-state";
import { useCalendarView } from "@/lib/use-calendar-view";
import { useRefreshOnReturn } from "@/lib/use-page-activity";
import { notifyWorkspaceChanged, WORKSPACE_CHANGED_EVENT } from "@/lib/workspace-events";
import type { WorkspaceNav, WorkspaceNavProject } from "@/lib/workspace-nav";

type ShellUser = {
  id: string;
  name: string | null;
  email: string;
  isGuest: boolean;
  emailVerifiedAt: Date | null;
} | null;

type NavItem = NavMatch & {
  label: string;
  icon: LucideIcon;
  count?: number;
  /** An accent badge, such as chats with new messages; `label` says it in words. */
  badge?: { value: number; label: string };
};

const publicPaths = new Set(["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email"]);

function firstName(user: NonNullable<ShellUser>) {
  if (user.isGuest) return "Guest";
  return (user.name || user.email).trim().split(/[\s@]/)[0] || "You";
}

function initial(user: NonNullable<ShellUser>) {
  return firstName(user).charAt(0).toUpperCase();
}

/** One Calendar item for the agenda and the month (DES-13): it opens the view used last and is active on both. */
function useCalendarItem(): NavItem {
  return { ...calendarNavItem(useCalendarView()), label: "Calendar", icon: CalendarDays };
}

/**
 * A visual count; the link's aria-label says it in words. The space keeps the
 * visible text "Tasks 2", not "Tasks2", so the label stays part of the name.
 */
function Count({ value }: { value: number }) {
  return (
    <>
      {" "}
      <span aria-hidden="true" className="ml-auto font-mono text-2xs tabular-nums text-muted">
        {value}
      </span>
    </>
  );
}

/** An accent count for something new; like Count, the space keeps the label part of the name. */
function Badge({ value }: { value: number }) {
  return (
    <>
      {" "}
      <span
        aria-hidden="true"
        className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 font-mono text-2xs font-bold tabular-nums text-accent-ink"
      >
        {formatUnreadCount(value)}
      </span>
    </>
  );
}

function SidebarLink({
  item,
  pathname,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const active = isNavItemActive(pathname, item);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={
        collapsed
          ? undefined
          : item.badge
            ? `${item.label}, ${item.badge.label}`
            : item.count
              ? `${item.label}, ${item.count} open`
              : undefined
      }
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-hover",
        active && "bg-surface font-semibold shadow-[0_0_0_1px_var(--line)] hover:bg-surface",
        collapsed && "justify-center px-0 py-2",
      )}
    >
      <Icon aria-hidden="true" className={cn("h-4 w-4 shrink-0", active ? "text-accent" : "text-muted")} />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
      {!collapsed && item.badge ? <Badge value={item.badge.value} /> : null}
      {!collapsed && !item.badge && item.count ? <Count value={item.count} /> : null}
    </Link>
  );
}

function GroupLabel({ children, collapsed }: { children: React.ReactNode; collapsed: boolean }) {
  if (collapsed) return <div className="mx-3 my-2 h-px bg-line" aria-hidden="true" />;
  return (
    <p className="flex items-center justify-between px-2.5 pb-1 pt-4 text-2xs font-semibold uppercase tracking-[0.08em] text-muted">
      {children}
    </p>
  );
}

/** A project in the sidebar: its link, plus Overview, Board and Chat when opened. */
function SidebarProject({
  project,
  pathname,
  open,
  chatUnread,
  onToggle,
  onNavigate,
}: {
  project: WorkspaceNavProject;
  pathname: string;
  open: boolean;
  /** Unread messages in this project's chat. */
  chatUnread: number;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const href = `/projects/${project.id}`;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  // The sidebar renders twice (the rail and the phone sheet), so ids come from useId.
  const pagesId = useId();
  const pages: Array<{ href: string; label: string; icon: LucideIcon; unread?: number }> = [
    { href, label: "Overview", icon: LayoutDashboard },
    { href: `${href}/board`, label: "Board", icon: SquareKanban },
    { href: `${href}/chat`, label: "Chat", icon: MessagesSquare, unread: chatUnread },
  ];
  // Closed, the project row stands in for its pages, so it carries their highlight and the chat dot.
  const linkLabel = [
    project.name,
    project.openTasks ? `${project.openTasks} open tasks` : "",
    chatUnread && !open ? `${chatUnread} unread chat message${chatUnread === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(", ");

  return (
    <div>
      <div
        className={cn(
          "group flex items-center rounded-lg transition-colors hover:bg-surface-hover",
          active && !open && "bg-surface shadow-[0_0_0_1px_var(--line)] hover:bg-surface",
        )}
      >
        <Link
          href={href}
          onClick={onNavigate}
          aria-current={active && !open ? "page" : undefined}
          aria-label={linkLabel === project.name ? undefined : linkLabel}
          className={cn("flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-2.5 text-sm", active && "font-semibold")}
        >
          <span
            aria-hidden="true"
            className="mx-1 h-2 w-2 shrink-0 rounded-[3px]"
            style={{ backgroundColor: projectColor(project) }}
          />
          <span className="truncate">{project.name}</span>
          {chatUnread && !open ? (
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          ) : null}
          {project.openTasks ? <Count value={project.openTasks} /> : null}
        </Link>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={pagesId}
          aria-label={`${project.name} pages`}
          title={open ? "Hide pages" : "Show pages"}
          className="mx-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted opacity-70 transition hover:bg-line/60 hover:text-ink hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn("h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")}
          />
        </button>
      </div>

      {/* Opens by growing the grid row; inert keeps the links of a closed project out of the tab order. */}
      <div
        id={pagesId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div role="group" aria-label={`${project.name} pages`} className="ml-[1.125rem] flex flex-col gap-px border-l border-line py-1 pl-2">
            {pages.map((page) => {
              const pageActive = pathname === page.href;
              const Icon = page.icon;
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  onClick={onNavigate}
                  aria-current={pageActive ? "page" : undefined}
                  aria-label={page.unread ? `${page.label}, ${page.unread} unread` : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:bg-surface-hover hover:text-ink",
                    pageActive && "bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--line)] hover:bg-surface",
                  )}
                >
                  <Icon aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0", pageActive && "text-accent")} />
                  <span className="truncate">{page.label}</span>
                  {page.unread ? (
                    <>
                      {" "}
                      <span aria-hidden="true" className="ml-auto rounded-full bg-accent px-1.5 py-px font-mono text-2xs font-bold tabular-nums text-accent-ink">
                        {formatUnreadCount(page.unread)}
                      </span>
                    </>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Sidebar({
  user,
  nav,
  pathname,
  collapsed,
  projectsOpen,
  onToggleCollapsed,
  onToggleProject,
  onNewTask,
  onNewProject,
  onNavigate,
}: {
  user: NonNullable<ShellUser>;
  nav: WorkspaceNav;
  pathname: string;
  collapsed: boolean;
  projectsOpen: SidebarProjectsOpen;
  onToggleCollapsed?: () => void;
  onToggleProject: (projectId: string, open: boolean) => void;
  onNewTask: () => void;
  onNewProject: () => void;
  onNavigate?: () => void;
}) {
  const mainItems: NavItem[] = [
    { href: "/", label: "Home", icon: House },
    { href: "/today", label: "My day", icon: Sun },
    {
      href: "/chats",
      label: "Chats",
      icon: MessagesSquare,
      badge: nav.unreadChats
        ? { value: nav.unreadChats, label: `${nav.unreadChats} with new messages` }
        : undefined,
    },
  ];
  const workItems: NavItem[] = [
    { href: "/tasks", label: "Tasks", icon: SquareCheckBig, exact: true, count: nav.openTasks },
    useCalendarItem(),
    { href: "/notes", label: "Notes", icon: NotebookPen },
    { href: "/board", label: "Boards", icon: SquareKanban, match: ["/tasks/board", "/tree"] },
  ];
  const toolItems: NavItem[] = [
    { href: "/planner", label: "Planner", icon: Sparkles },
    { href: "/goals", label: "Goals", icon: Target },
    { href: "/roadmap", label: "Roadmap", icon: MapIcon },
  ];
  const workspaceName = user.isGuest ? "Guest workspace" : `${firstName(user)}'s workspace`;
  const linkProps = { pathname, collapsed, onNavigate };

  // relative keeps the collapsed sidebar's hidden labels inside this scroller, as on main.
  return (
    <nav aria-label="Workspace" className="relative flex h-full flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-2.5 py-3 [scrollbar-width:thin]">
      <div className={cn("flex items-center gap-2.5 px-1.5 pb-3", collapsed && "justify-center px-0")}>
        <LogoMark className="h-8 w-8 shrink-0" />
        {collapsed ? (
          <span className="sr-only">AI Multi</span>
        ) : (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">AI Multi</p>
            <p className="truncate text-xs text-muted">{workspaceName}</p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onNewTask}
        title={collapsed ? "New task" : undefined}
        className={cn(
          "mb-2 flex items-center gap-2 rounded-lg bg-accent px-2.5 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover",
          collapsed && "justify-center px-0",
        )}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
        {collapsed ? (
          <span className="sr-only">New task</span>
        ) : (
          <>
            New task
            <kbd aria-hidden="true" className="ml-auto rounded border border-current px-1 font-mono text-2xs opacity-75">N</kbd>
          </>
        )}
      </button>

      {mainItems.map((item) => <SidebarLink key={item.href} item={item} {...linkProps} />)}

      <GroupLabel collapsed={collapsed}>Work</GroupLabel>
      {workItems.map((item) => <SidebarLink key={item.href} item={item} {...linkProps} />)}

      <GroupLabel collapsed={collapsed}>
        <Link href="/projects" onClick={onNavigate} className="hover:text-ink">Projects</Link>
        <button type="button" onClick={onNewProject} className="rounded p-0.5 hover:bg-surface-hover hover:text-ink" title="Create a project">
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="sr-only">Create a project</span>
        </button>
      </GroupLabel>
      {collapsed ? (
        <SidebarLink item={{ href: "/projects", label: "Projects", icon: FolderKanban }} {...linkProps} />
      ) : nav.projects.length ? (
        <>
          {nav.projects.map((project) => {
            const href = `/projects/${project.id}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            // Until the user opens or closes it, a project is open while one of its pages is showing.
            const open = projectsOpen[project.id] ?? active;
            return (
              <SidebarProject
                key={project.id}
                project={project}
                pathname={pathname}
                open={open}
                chatUnread={project.unreadChat}
                onToggle={() => onToggleProject(project.id, !open)}
                onNavigate={onNavigate}
              />
            );
          })}
          {nav.activeProjectCount > nav.projects.length ? (
            <Link href="/projects" onClick={onNavigate} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-hover hover:text-ink">
              All {nav.activeProjectCount} projects
            </Link>
          ) : null}
        </>
      ) : (
        <button type="button" onClick={onNewProject} className="rounded-lg px-2.5 py-1.5 text-left text-xs text-muted hover:bg-surface-hover hover:text-ink">
          No projects yet. Create one
        </button>
      )}

      <GroupLabel collapsed={collapsed}>Tools</GroupLabel>
      {toolItems.map((item) => <SidebarLink key={item.href} item={item} {...linkProps} />)}

      {/* Trash is rarely needed, so it waits at the bottom next to Collapse (DES-13); collapsed, it stacks above it. */}
      <div className={cn("mt-auto flex gap-0.5 pt-3", collapsed ? "flex-col" : "items-center")}>
        <div className={cn("min-w-0", !collapsed && "flex-1")}>
          <SidebarLink item={{ href: "/trash", label: "Trash", icon: Trash2 }} {...linkProps} />
        </div>
        {onToggleCollapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "grid shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-ink",
              collapsed ? "py-2" : "h-8 w-8",
            )}
          >
            {collapsed ? <PanelLeftOpen aria-hidden="true" className="h-4 w-4" /> : <PanelLeftClose aria-hidden="true" className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
    </nav>
  );
}

function UserMenu({ user, onShowShortcuts }: { user: NonNullable<ShellUser>; onShowShortcuts: () => void }) {
  const { theme, setTheme } = useTheme();
  const logoutForm = useRef<HTMLFormElement>(null);
  const installPrompt = useInstallPrompt();

  return (
    <>
      <form ref={logoutForm} action="/api/auth/logout" method="post" className="hidden" />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Account menu"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white outline-none ring-offset-2 ring-offset-surface focus-visible:ring-2 focus-visible:ring-accent"
          style={{ backgroundColor: paletteColor(user.id) }}
        >
          {initial(user)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-ink">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">{user.isGuest ? "Guest workspace" : user.name || user.email}</span>
              {user.isGuest ? <span className="rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-semibold text-warning">Guest</span> : null}
            </span>
            {user.isGuest ? (
              <span className="mt-0.5 block text-xs font-normal text-muted">Keep this browser session to keep access.</span>
            ) : (
              <span className="mt-0.5 block truncate text-xs font-normal text-muted">{user.email}</span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setTheme("light")} aria-checked={theme === "light"} role="menuitemradio">
            <Sun />
            Light
            {theme === "light" ? <span className="ml-auto text-xs text-accent">On</span> : null}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTheme("dark")} aria-checked={theme === "dark"} role="menuitemradio">
            <Moon />
            Dark
            {theme === "dark" ? <span className="ml-auto text-xs text-accent">On</span> : null}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onShowShortcuts}>
            <Keyboard />
            Keyboard shortcuts
            <span className="ml-auto text-xs text-muted">?</span>
          </DropdownMenuItem>
          {installPrompt ? (
            <DropdownMenuItem onSelect={() => void promptInstall(installPrompt)}>
              <Download />
              Install app
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              // Saved offline copies go before the session does.
              void clearOfflineData().finally(() => logoutForm.current?.requestSubmit());
            }}
          >
            <LogOut />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function TopBar({
  user,
  nav,
  pathname,
  onOpenMenu,
  onOpenSearch,
  onShowShortcuts,
}: {
  user: NonNullable<ShellUser>;
  nav: WorkspaceNav;
  pathname: string;
  onOpenMenu: () => void;
  onOpenSearch: () => void;
  onShowShortcuts: () => void;
}) {
  const { parent, title } = pageTitleFor(pathname, nav.projects);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur sm:gap-3 sm:px-5">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open navigation"
        className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink lg:hidden"
      >
        <Menu aria-hidden="true" className="h-5 w-5" />
      </button>
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        {parent ? (
          <>
            <Link href="/projects" className="hidden text-muted hover:text-ink sm:inline">{parent}</Link>
            <span aria-hidden="true" className="hidden text-muted sm:inline">/</span>
          </>
        ) : null}
        {/* On desktop the page's own heading says it; nested pages keep the breadcrumb (DES-10). */}
        <span className={cn("truncate font-bold", !parent && "lg:hidden")}>{title}</span>
      </div>
      <button
        type="button"
        onClick={onOpenSearch}
        className="ml-auto hidden w-full max-w-xs items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm text-muted transition-colors hover:border-zinc-300 sm:flex lg:max-w-sm dark:hover:border-zinc-700"
      >
        <Search aria-hidden="true" className="h-4 w-4" />
        Search or run a command
        <kbd className="ml-auto rounded border border-line px-1.5 font-mono text-2xs">Ctrl K</kbd>
      </button>
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Search"
        className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink sm:hidden"
      >
        <Search aria-hidden="true" className="h-4 w-4" />
      </button>
      <NotificationsMenu pendingInvitations={nav.pendingInvitations} unreadNotifications={nav.unreadNotifications} />
      <UserMenu user={user} onShowShortcuts={onShowShortcuts} />
    </header>
  );
}

function MobileTabs({ pathname, onNewTask }: { pathname: string; onNewTask: () => void }) {
  const tabs: NavItem[] = [
    { href: "/", label: "Home", icon: House },
    { href: "/tasks", label: "Tasks", icon: SquareCheckBig, exact: true },
    useCalendarItem(),
    { href: "/projects", label: "Projects", icon: FolderKanban },
  ];

  const tab = (item: NavItem) => {
    const active = isNavItemActive(pathname, item);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn("grid justify-items-center gap-0.5 py-1 text-2xs", active ? "font-bold text-accent" : "text-muted")}
      >
        <item.icon aria-hidden="true" className="h-5 w-5" />
        {item.label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 items-center border-t border-line bg-surface/95 px-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden"
    >
      {tabs.slice(0, 2).map(tab)}
      <button
        type="button"
        onClick={onNewTask}
        aria-label="New task"
        className="grid h-11 w-11 place-items-center justify-self-center rounded-xl bg-accent text-accent-ink shadow-sm transition-colors hover:bg-accent-hover"
      >
        <Plus aria-hidden="true" className="h-5 w-5" />
      </button>
      {tabs.slice(2).map(tab)}
    </nav>
  );
}

export function AppShell({
  children,
  currentUser,
  initialNav,
  initialSidebarCollapsed,
  initialProjectsOpen,
}: {
  children: React.ReactNode;
  currentUser: ShellUser;
  initialNav: WorkspaceNav | null;
  initialSidebarCollapsed: boolean;
  initialProjectsOpen: SidebarProjectsOpen;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoggedOutLanding = !currentUser && pathname === "/";
  // Share pages (SMART-12) look the same to everyone, signed in or not.
  const isPublicPage = publicPaths.has(pathname) || isLoggedOutLanding || pathname.startsWith("/share/");
  const showWorkspaceShell = Boolean(currentUser && initialNav && !isPublicPage);

  const [nav, setNav] = useState(initialNav);
  const [collapsed, setCollapsed] = useState(initialSidebarCollapsed);
  const [projectsOpen, setProjectsOpen] = useState(initialProjectsOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    if (!currentUser && !isPublicPage) {
      router.replace("/login");
    }
  }, [currentUser, isPublicPage, router]);

  // Keep sidebar counts fresh as the user moves around and after the shell creates something.
  useEffect(() => {
    if (!showWorkspaceShell) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/workspace-nav", { signal: controller.signal, cache: "no-store" });
        if (response.ok) setNav((await response.json()) as WorkspaceNav);
      } catch {
        // Aborted or offline: keep the last counts.
      }
    };
    void refresh();
    window.addEventListener(WORKSPACE_CHANGED_EVENT, refresh);
    return () => {
      controller.abort();
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, refresh);
    };
  }, [pathname, showWorkspaceShell]);

  // Coming back to the page, say after answering something on a phone, picks up changes made
  // elsewhere: the counts here and the page itself when the server renders it.
  useRefreshOnReturn(() => {
    if (!showWorkspaceShell) return;
    notifyWorkspaceChanged();
    router.refresh();
  });

  // Keyboard shortcuts (DES-06): Ctrl/Cmd+K, /, N, ? and "g then a letter"; see @/lib/shortcuts.
  useEffect(() => {
    if (!showWorkspaceShell) return;
    let goPending = false;
    let goTimer: number | undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
        return;
      }
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      // Leave keys alone while a dialog, sheet or menu is open.
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;

      const action = resolveShortcut(event.key, goPending);
      goPending = false;
      window.clearTimeout(goTimer);
      if (!action) return;
      event.preventDefault();
      if (action.type === "start-go") {
        goPending = true;
        goTimer = window.setTimeout(() => (goPending = false), 1500);
      } else if (action.type === "go") {
        router.push(action.href);
      } else if (action.type === "search") {
        setSearchOpen(true);
      } else if (action.type === "new-task") {
        setNewTaskOpen(true);
      } else if (action.type === "help") {
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(goTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [router, showWorkspaceShell]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }

  function toggleProject(projectId: string, open: boolean) {
    const next = { ...projectsOpen, [projectId]: open };
    const value = serializeSidebarProjects(next, nav?.projects.map((project) => project.id) ?? []);
    document.cookie = `${SIDEBAR_PROJECTS_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    setProjectsOpen(next);
  }

  if (!showWorkspaceShell || !currentUser || !nav) {
    return (
      <div className="flex min-h-screen flex-col overflow-x-hidden bg-canvas text-ink">
        <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <LogoMark className="h-7 w-7" />
            AI Multi
          </span>
          <ThemeToggle />
        </header>
        <OfflineBanner />
        {children}
      </div>
    );
  }

  const openNewTask = () => {
    setMenuOpen(false);
    setNewTaskOpen(true);
  };

  const openNewProject = () => {
    setMenuOpen(false);
    setNewProjectOpen(true);
  };

  // The sidebar's "+" creates a project from any page, then opens it.
  async function createProject(input: ProjectInput) {
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.name, description: input.description, color: input.color, templateId: input.templateId }),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !body?.id) return body?.error ?? "Could not create the project.";
      notifyWorkspaceChanged();
      toast.success("Project created", { description: input.name });
      router.push(`/projects/${body.id}`);
      return null;
    } catch {
      return "Could not create the project. Check your connection and try again.";
    }
  }

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-canvas text-ink">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      <aside
        className={cn(
          "hidden shrink-0 border-r border-line bg-sunken transition-[width] duration-200 lg:block",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <Sidebar
          user={currentUser}
          nav={nav}
          pathname={pathname}
          collapsed={collapsed}
          projectsOpen={projectsOpen}
          onToggleCollapsed={toggleCollapsed}
          onToggleProject={toggleProject}
          onNewTask={openNewTask}
          onNewProject={openNewProject}
        />
      </aside>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 bg-sunken p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">All pages and your projects</SheetDescription>
          <Sidebar
            user={currentUser}
            nav={nav}
            pathname={pathname}
            collapsed={false}
            projectsOpen={projectsOpen}
            onToggleProject={toggleProject}
            onNewTask={openNewTask}
            onNewProject={openNewProject}
            onNavigate={() => setMenuOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          user={currentUser}
          nav={nav}
          pathname={pathname}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          onShowShortcuts={() => setShortcutsOpen(true)}
        />
        <OfflineBanner />
        {currentUser.isGuest || currentUser.emailVerifiedAt ? null : <EmailVerificationBanner email={currentUser.email} />}
        {/* relative: hidden (sr-only) text is absolutely positioned, and it scrolls only inside a positioned
            scroller. Otherwise it escapes, and the whole window scrolls beside main, a second scrollbar. */}
        <main id="main-content" className="relative min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-0">
          {children}
        </main>
      </div>

      <MobileTabs pathname={pathname} onNewTask={openNewTask} />

      <CommandPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onNewTask={openNewTask}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} projects={nav.projects} />
      <ProjectSheet open={newProjectOpen} onOpenChange={setNewProjectOpen} onSubmit={createProject} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
