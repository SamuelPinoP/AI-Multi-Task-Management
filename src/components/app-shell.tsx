"use client";

import {
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  Compass,
  Download,
  FolderKanban,
  Gauge,
  House,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  MessageSquareText,
  MessagesSquare,
  Moon,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
  Search,
  Settings,
  SquareCheckBig,
  SquareKanban,
  Sun,
  Target,
  Trash2,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AccentMenuItems } from "@/components/accent-menu";
import { useAiDock } from "@/components/ai/ai-chat-provider";
import { AiDock } from "@/components/ai/ai-dock";
import { AiSpark } from "@/components/ai/ai-spark";
import { LogoMark } from "@/components/brand/logo-mark";
import { CommandPalette } from "@/components/command-palette";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { GuestProfileCard, GuestProfileChip, GuestProfileRail } from "@/components/guest/guest-profile";
import { GuestSignupDialog } from "@/components/guest/guest-signup-dialog";
import { MobileMenuButton, MobileMenuContext, type MobileMenu } from "@/components/mobile-menu";
import { NewTaskDialog } from "@/components/new-task-dialog";
import { NotificationsMenu } from "@/components/notifications-menu";
import { ProjectSheet, type ProjectInput } from "@/components/projects/project-sheet";
import { clearOfflineData, OfflineBanner, promptInstall, useInstallPrompt } from "@/components/pwa";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { TextSizeMenuItems } from "@/components/text-size-menu";
import { ThemeToggle, useTheme } from "@/components/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { uiPrimaryButtonClass } from "@/components/ui";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { Tooltip, TooltipDetail, TooltipKey } from "@/components/ui/tooltip";
import { isFullHeightPage, isNavItemActive, pageTitleFor, type NavMatch } from "@/lib/app-nav";
import { authPageHref, confirmEmailHref } from "@/lib/auth-links";
import { cn } from "@/lib/cn";
import { getSafeRedirectPath } from "@/lib/safe-redirect";
import { isAskAiShortcut, isTypingTarget, resolveShortcut } from "@/lib/shortcuts";
import { calendarNavItem } from "@/lib/calendar-view";
import { formatUnreadCount } from "@/lib/chats";
import { savePanelCookies, shownWidth, SIDEBAR_LIMITS, type PanelSize } from "@/lib/panel-resize";
import { avatarColor, projectColor } from "@/lib/project-color";
import {
  SIDEBAR_COLLAPSED_COOKIE,
  SIDEBAR_PROJECTS_COOKIE,
  SIDEBAR_WIDTH_COOKIE,
  serializeSidebarProjects,
  type SidebarProjectsOpen,
} from "@/lib/sidebar-state";
import { applyProjectPhotoChange } from "@/lib/project-photo-client";
import { useCalendarView } from "@/lib/use-calendar-view";
import { useRefreshOnReturn } from "@/lib/use-page-activity";
import { guestHasRoom, type GuestLimitKind, type GuestSignupReason } from "@/lib/guest-limits-core";
import {
  notifyWorkspaceChanged,
  OPEN_GUEST_SIGNUP_EVENT,
  OPEN_NEW_TASK_EVENT,
  OPEN_SEARCH_EVENT,
  openGuestSignup,
  openSearch,
  quickAddInProject,
  WORKSPACE_CHANGED_EVENT,
  type NewTaskDraft,
} from "@/lib/workspace-events";
import type { WorkspaceNav, WorkspaceNavProject } from "@/lib/workspace-nav";

type ShellUser = {
  id: string;
  name: string | null;
  email: string;
  isGuest: boolean;
  /** Listed in ADMIN_EMAILS, so owner-only pages such as Free-tier usage open (#286). Decided on the server. */
  isAppAdmin: boolean;
} | null;

type NavItem = NavMatch & {
  label: string;
  icon: LucideIcon;
  count?: number;
  /** An accent badge, such as chats with new messages; `label` says it in words. */
  badge?: { value: number; label: string };
};

const publicPaths = new Set(["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/privacy", "/terms"]);

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
        className="ml-auto inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1.5 font-mono text-2xs font-bold tabular-nums text-accent-ink"
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
  const name = item.badge ? `${item.label}, ${item.badge.label}` : item.count ? `${item.label}, ${item.count} open` : undefined;

  if (collapsed) {
    // The icon rail (#415, design 1A): the icon alone, its name in a tooltip, and the new-messages count on it.
    return (
      <Tooltip
        content={
          <>
            {item.label}
            {item.badge ? <TooltipDetail>{item.badge.value} new</TooltipDetail> : item.count ? <TooltipDetail>{item.count} open</TooltipDetail> : null}
          </>
        }
      >
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          aria-label={name ?? item.label}
          className={cn(
            "relative grid h-8 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-ink",
            active && "bg-surface text-accent shadow-[0_0_0_1px_var(--line)] hover:bg-surface hover:text-accent",
          )}
        >
          <Icon aria-hidden="true" className="h-4 w-4" />
          {item.badge ? (
            <span
              aria-hidden="true"
              className={cn(
                "absolute left-[1.3125rem] top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[0.625rem] font-bold leading-none tabular-nums text-accent-ink ring-2",
                active ? "ring-surface" : "ring-sunken",
              )}
            >
              {formatUnreadCount(item.badge.value)}
            </span>
          ) : null}
        </Link>
      </Tooltip>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={name}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-hover",
        active && "bg-surface font-semibold shadow-[0_0_0_1px_var(--line)] hover:bg-surface",
      )}
    >
      <Icon aria-hidden="true" className={cn("h-4 w-4 shrink-0", active ? "text-accent" : "text-muted")} />
      <span className="truncate">{item.label}</span>
      {item.badge ? <Badge value={item.badge.value} /> : null}
      {!item.badge && item.count ? <Count value={item.count} /> : null}
    </Link>
  );
}

function GroupLabel({ children, collapsed }: { children: React.ReactNode; collapsed: boolean }) {
  if (collapsed) return <div className="my-2 h-px w-5 shrink-0 bg-line" aria-hidden="true" />;
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
                    "flex items-center gap-2 rounded-md px-2 py-1 text-[0.8125rem] text-muted transition-colors hover:bg-surface-hover hover:text-ink",
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

/**
 * The way to the AI page (#308, design S3): a square ✦ beside New task, or under + on the rail.
 * It's named "AI" for screen readers and shows as selected on the AI page.
 */
function AiTile({ active, guest, onNavigate, className }: { active: boolean; guest: boolean; onNavigate?: () => void; className?: string }) {
  return (
    <Tooltip
      content={
        <>
          Ask AI Multi <TooltipKey>Ctrl J</TooltipKey>
        </>
      }
    >
      <Link
        href="/ai"
        onClick={(event) => {
          // Guests get the sign-up pop-up in place (#458): the AI needs an account.
          if (guest) {
            event.preventDefault();
            openGuestSignup("ai");
          } else onNavigate?.();
        }}
        aria-label="AI"
        aria-current={active ? "page" : undefined}
        className={cn(
          "grid shrink-0 place-items-center rounded-lg border border-accent/20 bg-accent-soft transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_10%,var(--accent-soft))]",
          active && "border-accent bg-[color-mix(in_srgb,var(--accent)_10%,var(--accent-soft))] shadow-[inset_0_0_0_1px_var(--accent)]",
          className,
        )}
      >
        <AiSpark />
      </Link>
    </Tooltip>
  );
}

/** Trash while it holds something (#404, design 2C). The command palette reaches it either way. */
function TrashButton({ count, active, onNavigate }: { count: number; active: boolean; onNavigate?: () => void }) {
  const items = `${count} item${count === 1 ? "" : "s"}`;
  return (
    <Tooltip
      content={
        <>
          Trash <TooltipDetail>{items}</TooltipDetail>
        </>
      }
    >
      <Link
        href="/trash"
        onClick={onNavigate}
        aria-label={`Trash, ${items}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted outline-none transition-colors hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent",
          active && "bg-surface text-accent shadow-[0_0_0_1px_var(--line)] hover:bg-surface",
        )}
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
      </Link>
    </Tooltip>
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
  onShowShortcuts,
  onSendFeedback,
  onNavigate,
  integrations,
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
  onShowShortcuts: () => void;
  onSendFeedback: () => void;
  onNavigate?: () => void;
  integrations: boolean;
}) {
  // Tasks sits with Home and Chats, and My day under Notes (#519).
  const mainItems: NavItem[] = [
    { href: "/", label: "Home", icon: House },
    {
      href: "/chats",
      label: "Chats",
      icon: MessagesSquare,
      badge: nav.unreadChats
        ? { value: nav.unreadChats, label: `${nav.unreadChats} with new messages` }
        : undefined,
    },
    { href: "/tasks", label: "Tasks", icon: SquareCheckBig, exact: true, count: nav.openTasks },
  ];
  const workItems: NavItem[] = [
    useCalendarItem(),
    { href: "/notes", label: "Notes", icon: NotebookPen },
    { href: "/today", label: "My day", icon: Sun },
    { href: "/board", label: "Boards", icon: SquareKanban, match: ["/tasks/board", "/tree"] },
  ];
  const toolItems: NavItem[] = [
    // A compass, so only the AI has sparkles (#308).
    { href: "/planner", label: "Planner", icon: Compass },
    { href: "/goals", label: "Goals", icon: Target },
    { href: "/roadmap", label: "Roadmap", icon: MapIcon },
    // Connecting AI apps (#480, design 1A), only while the MCP server is on.
    ...(integrations ? [{ href: "/integrations", label: "Integrations", icon: Plug }] : []),
  ];
  const linkProps = { pathname, collapsed, onNavigate };
  const aiActive = pathname === "/ai";
  const trash = nav.trashItems ? <TrashButton count={nav.trashItems} active={pathname === "/trash"} onNavigate={onNavigate} /> : null;
  const guestProfile =
    user.isGuest && nav.guest
      ? {
          userId: user.id,
          usage: nav.guest,
          trash,
          settings: (
            <AccountMenu user={user} collapsed={false} variant="gear" onShowShortcuts={onShowShortcuts} onSendFeedback={onSendFeedback} onNavigate={onNavigate} />
          ),
        }
      : null;

  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Workspace" className="flex min-h-0 flex-1 flex-col">
        {/* The top stays put (#308, design S3): the logo, New task and the AI's ✦ are always in view,
            however long the list below grows. relative keeps the rail's hidden "AI Multi" inside it. */}
        <div className={cn("relative flex shrink-0 flex-col gap-0.5 pt-3", collapsed ? "items-center px-0" : "px-2.5")}>
          {collapsed ? (
            <>
              {/* The rail (#415, design 1A): a smaller logo turns into the expand button on hover or focus, as in ChatGPT and Claude. */}
              <Tooltip content="Expand sidebar">
                <button
                  type="button"
                  onClick={onToggleCollapsed}
                  aria-label="Expand sidebar"
                  className="group/logo mb-2 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted outline-none transition-colors hover:bg-surface-hover hover:text-ink focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <LogoMark className="col-start-1 row-start-1 h-7 w-7 transition-opacity duration-150 group-hover/logo:opacity-0 group-focus-visible/logo:opacity-0" />
                  <PanelLeftOpen
                    aria-hidden="true"
                    className="col-start-1 row-start-1 h-4 w-4 opacity-0 transition-opacity duration-150 group-hover/logo:opacity-100 group-focus-visible/logo:opacity-100"
                  />
                </button>
              </Tooltip>
              <span className="sr-only">AI Multi</span>
            </>
          ) : (
            <div className="flex items-center gap-2.5 px-1.5 pb-3">
              <LogoMark className="h-8 w-8 shrink-0" />
              <p className="min-w-0 flex-1 truncate text-sm font-semibold">AI Multi</p>
              {/* Collapse sits by the logo; the bottom bar belongs to the account (#404, design 1B). */}
              {onToggleCollapsed ? (
                <Tooltip content="Collapse sidebar">
                  <button
                    type="button"
                    onClick={onToggleCollapsed}
                    aria-label="Collapse sidebar"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-ink"
                  >
                    <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
                  </button>
                </Tooltip>
              ) : null}
            </div>
          )}

          {collapsed ? (
            <>
              {/* A square that matches the logo's; the tooltip names it and its key. */}
              <Tooltip
                content={
                  <>
                    New task <TooltipKey>N</TooltipKey>
                  </>
                }
              >
                <button
                  type="button"
                  onClick={onNewTask}
                  aria-label="New task"
                  aria-keyshortcuts="N"
                  className="mb-2 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink transition-colors hover:bg-accent-hover"
                >
                  <Plus aria-hidden="true" className="h-4 w-4" />
                </button>
              </Tooltip>
              {/* On the rail the ✦ goes under + (#308). */}
              <AiTile active={aiActive} guest={user.isGuest} onNavigate={onNavigate} className="mb-2.5 h-8 w-8" />
            </>
          ) : (
            <div className="mb-2 flex gap-1.5">
              <button
                type="button"
                onClick={onNewTask}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-accent px-2.5 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
              >
                <Plus aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="truncate">New task</span>
                <kbd aria-hidden="true" className="ml-auto rounded border border-current px-1 font-mono text-2xs opacity-75">N</kbd>
              </button>
              {/* S3 (#308): a square ✦ beside New task, wider on phones where it's tapped. */}
              <AiTile active={aiActive} guest={user.isGuest} onNavigate={onNavigate} className="w-[2.375rem] self-stretch max-lg:w-[3.125rem]" />
            </div>
          )}
        </div>

        {/* relative keeps the collapsed sidebar's hidden labels inside this scroller, as on main. The rail
            centres everything on one axis and hides its scrollbar, which would push the icons off centre. */}
        <div
          className={cn(
            "relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden pb-3",
            collapsed ? "items-center px-0 [scrollbar-width:none]" : "px-2.5 [scrollbar-width:thin]",
          )}
        >
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
        </div>
      </nav>

      {guestProfile ? (
        // A guest's profile (#458, design 2C) takes the account bar's place: what the workspace holds
        // and how to keep it, with settings and Trash beside the name. Guests get no bell.
        <div className={cn("flex shrink-0 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1", collapsed ? "justify-center px-0" : "px-2")}>
          {collapsed ? <GuestProfileRail {...guestProfile} /> : <GuestProfileCard {...guestProfile} className="flex-1" />}
        </div>
      ) : (
        /* The account bar (#404, design 1B): the profile menu, the bell, then Trash while it holds
           something (2C). It sits below the scroller, so it never scrolls away; collapsed, the three stack. */
        <div
          className={cn(
            // relative: the collapsed profile button's hidden words stay positioned inside the bar.
            "relative flex shrink-0 border-t border-line pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2",
            // No gap in a row, so "Settings and theme" fits beside the bell and Trash even in a narrow sidebar.
            collapsed ? "flex-col items-center gap-1 px-0" : "items-center px-2",
          )}
        >
          <AccountMenu user={user} collapsed={collapsed} onShowShortcuts={onShowShortcuts} onSendFeedback={onSendFeedback} onNavigate={onNavigate} />
          <NotificationsMenu pendingInvitations={nav.pendingInvitations} unreadNotifications={nav.unreadNotifications} onNavigate={onNavigate} />
          {trash}
        </div>
      )}
    </div>
  );
}

/**
 * The profile menu, opened from the sidebar's bottom bar (#404): account
 * settings, theme, accent color, text size, shortcuts and log out, as before.
 * The visible words are the button's name; collapsed, they stay for screen readers.
 * In a guest's profile (#458) a gear opens it, and leaving the workspace asks first.
 */
function AccountMenu({
  user,
  collapsed,
  variant = "row",
  folded = false,
  onShowShortcuts,
  onSendFeedback,
  onNavigate,
}: {
  user: NonNullable<ShellUser>;
  collapsed: boolean;
  /** `chip`: the phone top bar's picture and name beside the menu button (#461, design A). */
  variant?: "row" | "gear" | "chip";
  /** The chip's name folds into the picture while the page's name is in the bar. */
  folded?: boolean;
  onShowShortcuts: () => void;
  onSendFeedback: () => void;
  onNavigate?: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const logoutForm = useRef<HTMLFormElement>(null);
  const installPrompt = useInstallPrompt();
  const [leaving, setLeaving] = useState(false);
  const displayName = user.isGuest ? "Guest" : user.name || user.email;
  const logOut = () => {
    // Saved offline copies go before the session does.
    void clearOfflineData().finally(() => logoutForm.current?.requestSubmit());
  };

  const trigger = variant === "gear" ? (
    <DropdownMenuTrigger
      aria-label="Settings and theme"
      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted outline-none transition-colors hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-hover max-lg:h-11 max-lg:w-11"
    >
      <Settings aria-hidden="true" className="h-4 w-4" />
    </DropdownMenuTrigger>
  ) : variant === "chip" ? (
    <DropdownMenuTrigger
      className={cn(
        "flex h-10 min-w-0 shrink-0 items-center gap-2 rounded-[0.625rem] pl-1 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-hover",
        folded ? "pr-1" : "pr-2.5",
      )}
    >
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-2xs font-bold text-white"
        style={{ backgroundColor: avatarColor(user.id) }}
      >
        {initial(user)}
      </span>
      {/* Folded, the name stays for screen readers: the button keeps its name. */}
      <span
        className={cn(
          "truncate text-[0.8125rem] font-semibold text-ink transition-[max-width,opacity] duration-200 motion-reduce:transition-none",
          folded ? "max-w-0 opacity-0" : "max-w-40 opacity-100",
        )}
      >
        {displayName}
      </span>
      <span className="sr-only"> Settings and theme</span>
    </DropdownMenuTrigger>
  ) : (
    <DropdownMenuTrigger
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-hover",
        collapsed ? "p-1" : "flex-1 p-1",
      )}
    >
      {/* The same color as the person's avatar in Chats and members lists, dark enough for white text.
          On the rail it's a little smaller, like the logo (#415). */}
      <span
        aria-hidden="true"
        className={cn("grid shrink-0 place-items-center rounded-full font-bold text-white", collapsed ? "h-7 w-7 text-2xs" : "h-8 w-8 text-xs")}
        style={{ backgroundColor: avatarColor(user.id) }}
      >
        {initial(user)}
      </span>
      <span className={collapsed ? "sr-only" : "grid min-w-0"}>
        <span className="truncate text-sm font-semibold text-ink">{displayName}</span>{" "}
        <span className="truncate text-2xs text-muted">Settings and theme</span>
      </span>
    </DropdownMenuTrigger>
  );

  return (
    <>
      <form ref={logoutForm} action="/api/auth/logout" method="post" className="hidden" />
      <DropdownMenu>
        {variant === "gear" ? (
          <Tooltip content="Settings and theme">{trigger}</Tooltip>
        ) : collapsed ? (
          <Tooltip
            content={
              <>
                {displayName} <TooltipDetail>Settings and theme</TooltipDetail>
              </>
            }
          >
            {trigger}
          </Tooltip>
        ) : (
          trigger
        )}
        <DropdownMenuContent side={variant === "chip" ? "bottom" : "top"} align="start" className="w-64">
          <DropdownMenuLabel className="text-ink">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">{user.isGuest ? "Guest workspace" : user.name || user.email}</span>
              {user.isGuest ? <span className="rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-semibold text-warning">Guest</span> : null}
            </span>
            {user.isGuest ? (
              <span className="mt-0.5 block text-xs font-normal text-muted">Saved on this browser for 30 days after your last visit.</span>
            ) : (
              <span className="mt-0.5 block truncate text-xs font-normal text-muted">{user.email}</span>
            )}
          </DropdownMenuLabel>
          {user.isGuest ? null : (
            <>
              <DropdownMenuItem asChild>
                <Link href="/account" onClick={onNavigate}>
                  <CircleUserRound />
                  Account settings
                </Link>
              </DropdownMenuItem>
              {/* Send feedback (#430), design A: right under Account settings. Guests can't send. */}
              <DropdownMenuItem onSelect={onSendFeedback}>
                <MessageSquareText />
                Send feedback
              </DropdownMenuItem>
            </>
          )}
          {/* Only for the accounts in ADMIN_EMAILS; for everyone else the pages are a 404 (#286). */}
          {user.isAppAdmin ? (
            <>
              <DropdownMenuItem asChild>
                <Link href="/usage" onClick={onNavigate}>
                  <Gauge />
                  Free-tier usage
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/users" onClick={onNavigate}>
                  <UsersRound />
                  Users
                </Link>
              </DropdownMenuItem>
            </>
          ) : null}
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
          <AccentMenuItems />
          <TextSizeMenuItems />
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
          {/* A guest workspace has no password, so leaving it is for good (#458): it asks first. */}
          <DropdownMenuItem onSelect={user.isGuest ? () => setLeaving(true) : logOut}>
            <LogOut />
            {user.isGuest ? "Leave guest workspace" : "Log out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {user.isGuest ? (
        <ConfirmDialog
          open={leaving}
          kind="confirm"
          title="Leave the guest workspace?"
          message="A guest workspace has no password, so you can't come back to it after you leave. Sign up free first to keep your work."
          confirmLabel="Leave"
          onConfirm={logOut}
          onCancel={() => setLeaving(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Whether the page's own title, its first `h1` that takes up room, is on screen in the scrolling
 * page. Pages stream in, so the title is looked for again as the page changes; a page that has
 * loaded without one counts as having its title out of view. Until the page says otherwise, and
 * right after moving to another page, the title counts as on screen.
 */
function usePageTitleInView(pathname: string) {
  const [seen, setSeen] = useState({ pathname, inView: true });

  useEffect(() => {
    const main = document.getElementById("main-content");
    if (!main) return;
    const report = (inView: boolean) =>
      setSeen((current) => (current.pathname === pathname && current.inView === inView ? current : { pathname, inView }));

    let heading: Element | null = null;
    let frame = 0;
    const intersections = new IntersectionObserver((entries) => report(entries[entries.length - 1].isIntersecting), { root: main });
    const findHeading = () => {
      frame = 0;
      // Skips the screen-reader-only headings (1px wide) and the hidden copy of a page still streaming in.
      const visible = Array.from(main.querySelectorAll("h1")).find((element) => element.getBoundingClientRect().width > 1) ?? null;
      if (visible !== heading) {
        if (heading) intersections.unobserve(heading);
        heading = visible;
        if (heading) intersections.observe(heading);
      }
      // Loaded without a title of its own (Tree view, a task's page): the bar names the page.
      if (!heading && !main.querySelector('[aria-busy="true"]')) report(false);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(findHeading);
    };
    schedule();
    const mutations = new MutationObserver(schedule);
    mutations.observe(main, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      intersections.disconnect();
    };
  }, [pathname]);

  return seen.pathname === pathname ? seen.inView : true;
}

/**
 * The bar above the page on phones and tablets: the menu button and where you are. Desktop has
 * none (#410): the sidebar is always there, each page's heading says where you are, and search
 * is Home's button or Ctrl+K. A page's name shows once (#420, design 3A, like iOS large titles):
 * while the page's own title is on screen the bar holds the menu button and the profile, in the
 * page's color and without a line, and the name moves in once the title has scrolled under the bar.
 * The profile sits beside the menu button (#461, design A): a guest's avatar and tasks left, or an
 * account's picture and name, which fold into the picture while the page's name is in the bar.
 * At the right, a guest gets Sign up free and an account gets search.
 */
function TopBar({
  user,
  nav,
  pathname,
  onShowShortcuts,
  onSendFeedback,
  integrations,
}: {
  user: NonNullable<ShellUser>;
  nav: WorkspaceNav;
  pathname: string;
  onShowShortcuts: () => void;
  onSendFeedback: () => void;
  integrations: boolean;
}) {
  const { parent, title } = pageTitleFor(pathname, nav.projects, { appAdmin: user.isAppAdmin, integrations });
  const titleInView = usePageTitleInView(pathname);
  const folded = !titleInView;
  const settings = (
    <AccountMenu user={user} collapsed={false} variant="gear" onShowShortcuts={onShowShortcuts} onSendFeedback={onSendFeedback} />
  );

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1.5 border-b px-3 transition-colors duration-200 motion-reduce:transition-none sm:gap-3 sm:px-5 lg:hidden",
        titleInView ? "border-transparent bg-canvas" : "border-line bg-surface/95 backdrop-blur",
      )}
    >
      <MobileMenuButton />
      {user.isGuest && nav.guest ? (
        <GuestProfileChip
          userId={user.id}
          usage={nav.guest}
          settings={settings}
          trash={nav.trashItems ? <TrashButton count={nav.trashItems} active={pathname === "/trash"} /> : undefined}
          folded={folded}
        />
      ) : (
        <AccountMenu user={user} collapsed={false} variant="chip" folded={folded} onShowShortcuts={onShowShortcuts} onSendFeedback={onSendFeedback} />
      )}
      {/* inert while the title is on screen: no second name for screen readers, and no hidden link to tab to. */}
      <div
        inert={titleInView}
        aria-hidden={titleInView || undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 text-sm transition-[opacity,translate] duration-200 motion-reduce:transition-none",
          titleInView ? "translate-y-1 opacity-0" : "opacity-100",
        )}
      >
        {/* Tablets show a project page's place under Projects (DES-10). */}
        {parent ? (
          <>
            <Link href="/projects" className="hidden text-muted hover:text-ink sm:inline">{parent}</Link>
            <span aria-hidden="true" className="hidden text-muted sm:inline">/</span>
          </>
        ) : null}
        <span className="truncate font-bold">{title}</span>
      </div>
      {user.isGuest ? (
        <button
          type="button"
          onClick={() => openGuestSignup("signup")}
          className={cn(uiPrimaryButtonClass, "shine h-9 shrink-0 px-3 text-[0.8125rem] font-semibold")}
        >
          Sign up free
        </button>
      ) : (
        // On phones, search was only on Home (#410); the bar keeps it on every page.
        <button
          type="button"
          onClick={openSearch}
          aria-label="Search"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <Search aria-hidden="true" className="h-5 w-5" />
        </button>
      )}
    </header>
  );
}

function MobileTabs({
  pathname,
  onNewTask,
  onQuickAdd,
  inFlow,
}: {
  pathname: string;
  onNewTask: () => void;
  /** The + on the Tasks page, which opens the page's add box as a sheet (#521, design 2A). */
  onQuickAdd: () => void;
  inFlow: boolean;
}) {
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
      // Over a scrolling page the bar floats at the bottom; under a full-height page it takes its own row,
      // so the page ends right above it.
      className={cn(
        inFlow ? "shrink-0" : "fixed inset-x-0 bottom-0",
        "z-30 grid grid-cols-5 items-center border-t border-line bg-surface/95 px-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden",
      )}
    >
      {tabs.slice(0, 2).map(tab)}
      <button
        type="button"
        onClick={pathname === "/tasks" ? onQuickAdd : onNewTask}
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
  awaitingEmailConfirmation,
  initialNav,
  initialSidebarCollapsed,
  initialSidebarWidth,
  initialProjectsOpen,
  googleSignIn,
  integrations,
}: {
  children: React.ReactNode;
  currentUser: ShellUser;
  /** Signed in, but the email isn't confirmed yet, so only "Check your email" opens (#350). */
  awaitingEmailConfirmation: boolean;
  initialNav: WorkspaceNav | null;
  initialSidebarCollapsed: boolean;
  /** The width the sidebar was dragged to, in rem (#415). */
  initialSidebarWidth: number;
  initialProjectsOpen: SidebarProjectsOpen;
  /** Whether Sign in with Google is set up, for the guest's sign-up pop-up (#458). */
  googleSignIn: boolean;
  /** Whether the MCP server is on (MCP_ENABLED), so the Integrations page exists and is linked (#480). */
  integrations: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoggedOutLanding = !currentUser && pathname === "/";
  const isPublicPage = publicPaths.has(pathname) || isLoggedOutLanding;
  const showWorkspaceShell = Boolean(currentUser && initialNav && !isPublicPage);
  const fullHeight = isFullHeightPage(pathname);
  // The AI bar (#308): on every page but the AI page, which has its own message box. The chats get
  // the same simple bar on computers (Samuel, November 21); on phones, where their message box takes
  // the bottom of the screen, it waits above that box as the ✦ button. Guests can't use the assistant.
  const aiDock = Boolean(currentUser && !currentUser.isGuest && pathname !== "/ai");
  // Hidden from pages, it leaves nothing to make room for.
  const { dock } = useAiDock();
  const aiBarShown = aiDock && dock !== "hidden";

  const [nav, setNav] = useState(initialNav);
  const [sidebar, setSidebar] = useState<PanelSize>({ width: initialSidebarWidth, collapsed: initialSidebarCollapsed });
  const [projectsOpen, setProjectsOpen] = useState(initialProjectsOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskDraft, setNewTaskDraft] = useState<NewTaskDraft>({});
  const [signup, setSignup] = useState<{ open: boolean; reason: GuestSignupReason }>({ open: false, reason: "signup" });

  // A guest past a limit gets the sign-up pop-up instead of the form (#458).
  const guestUsage = currentUser?.isGuest ? (nav?.guest ?? null) : null;
  const guestFull = useCallback((kind: GuestLimitKind) => Boolean(guestUsage && !guestHasRoom(guestUsage, kind)), [guestUsage]);
  // The window listeners below are set up once and read the latest counts through this: setting them
  // up again whenever the counts refresh would drop a half-typed "g then a letter" shortcut.
  const latestGuestFull = useRef(guestFull);
  useEffect(() => {
    latestGuestFull.current = guestFull;
  }, [guestFull]);
  const isGuest = Boolean(currentUser?.isGuest);

  // The sign-up pop-up opens from anywhere: the guest profile, the AI, an API answer past a limit.
  useEffect(() => {
    const open = (event: Event) => {
      setMenuOpen(false);
      setNewTaskOpen(false);
      setSignup({ open: true, reason: (event as CustomEvent<GuestSignupReason>).detail ?? "signup" });
    };
    window.addEventListener(OPEN_GUEST_SIGNUP_EVENT, open);
    return () => window.removeEventListener(OPEN_GUEST_SIGNUP_EVENT, open);
  }, []);

  // Pages open the same pop-up, sometimes in a project (the Tasks page's project cards).
  useEffect(() => {
    const open = (event: Event) => {
      if (latestGuestFull.current("tasks")) return openGuestSignup("tasks");
      setNewTaskDraft((event as CustomEvent<NewTaskDraft>).detail ?? {});
      setNewTaskOpen(true);
    };
    window.addEventListener(OPEN_NEW_TASK_EVENT, open);
    return () => window.removeEventListener(OPEN_NEW_TASK_EVENT, open);
  }, []);

  // Home's search button opens search (#410), as Ctrl+K and / do everywhere.
  useEffect(() => {
    const open = () => setSearchOpen(true);
    window.addEventListener(OPEN_SEARCH_EVENT, open);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, open);
  }, []);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // What a page needs for a menu button of its own (#420). It changes only with the count: a new value
  // reaching a page that's still hydrating makes React throw away the server's HTML and draw it again.
  const news = nav ? nav.pendingInvitations + nav.unreadNotifications : 0;
  const mobileMenu = useMemo<MobileMenu>(() => ({ open: () => setMenuOpen(true), news }), [news]);

  useEffect(() => {
    if (!currentUser && !isPublicPage) {
      // The session ended (unused for a month, or logged out from another device): log in, then come back here.
      // An unconfirmed email goes to "Check your email" instead, which comes back here once it's confirmed.
      const here = getSafeRedirectPath(`${window.location.pathname}${window.location.search}`);
      router.replace(awaitingEmailConfirmation ? confirmEmailHref({ next: here }) : authPageHref("login", { next: here }));
    }
  }, [awaitingEmailConfirmation, currentUser, isPublicPage, router]);

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
      // Ctrl J asks the AI (#308); a guest gets the sign-up pop-up instead (#458), outside other dialogs.
      if (isGuest && isAskAiShortcut(event) && !document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]')) {
        event.preventDefault();
        openGuestSignup("ai");
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
        if (latestGuestFull.current("tasks")) openGuestSignup("tasks");
        else setNewTaskOpen(true);
      } else if (action.type === "help") {
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(goTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isGuest, router, showWorkspaceShell]);

  // Dragging the edge (#415) updates the width as it goes and saves it when let go; the server reads
  // the cookies, so the next page load starts at the same width.
  function resizeSidebar(next: PanelSize, done: boolean) {
    setSidebar(next);
    if (done) savePanelCookies(SIDEBAR_WIDTH_COOKIE, SIDEBAR_COLLAPSED_COOKIE, next);
  }

  function toggleCollapsed() {
    resizeSidebar({ ...sidebar, collapsed: !sidebar.collapsed }, true);
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
    if (guestFull("tasks")) return openGuestSignup("tasks");
    setNewTaskDraft({});
    setNewTaskOpen(true);
  };

  // On the Tasks page the phone's + opens the page's own add box, as a sheet (#521); a guest with no room left signs up first.
  const openQuickAdd = () => {
    setMenuOpen(false);
    if (guestFull("tasks")) return openGuestSignup("tasks");
    quickAddInProject();
  };

  const openNewProject = () => {
    setMenuOpen(false);
    if (guestFull("projects")) return openGuestSignup("projects");
    setNewProjectOpen(true);
  };

  // The sidebar's "+" creates a project from any page, then opens it.
  async function createProject(input: ProjectInput) {
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.name, description: input.description, color: input.color, priority: input.priority, templateId: input.templateId }),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !body?.id) return body?.error ?? "Could not create the project.";
      // The project exists now, so a failed photo upload is reported without undoing it (#403).
      const photoProblem = await applyProjectPhotoChange(body.id, input.photo);
      notifyWorkspaceChanged();
      toast.success("Project created", { description: input.name });
      if (photoProblem) toast.error("The photo wasn't saved", { description: `${photoProblem} Add it again from Edit project.` });
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

      {/* Any width from where "AI Multi" still fits to 360 px; dragged narrower it snaps to the icon rail (#415). */}
      <aside
        id="app-sidebar"
        className="relative hidden shrink-0 border-r border-line bg-sunken transition-[width] duration-200 data-[resizing]:transition-none lg:block"
        style={{ width: `${shownWidth(sidebar, SIDEBAR_LIMITS)}rem` }}
      >
        <Sidebar
          user={currentUser}
          nav={nav}
          pathname={pathname}
          collapsed={sidebar.collapsed}
          projectsOpen={projectsOpen}
          onToggleCollapsed={toggleCollapsed}
          onToggleProject={toggleProject}
          onNewTask={openNewTask}
          onNewProject={openNewProject}
          onShowShortcuts={() => setShortcutsOpen(true)}
          onSendFeedback={() => setFeedbackOpen(true)}
          integrations={integrations}
        />
        <ResizeHandle
          label="Resize sidebar"
          controls="app-sidebar"
          size={sidebar}
          limits={SIDEBAR_LIMITS}
          collapsedText="Icons only"
          onResize={resizeSidebar}
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
            onShowShortcuts={() => {
              setMenuOpen(false);
              setShortcutsOpen(true);
            }}
            onSendFeedback={() => {
              setMenuOpen(false);
              setFeedbackOpen(true);
            }}
            onNavigate={() => setMenuOpen(false)}
            integrations={integrations}
          />
        </SheetContent>
      </Sheet>

      {/* Pages reach the phone menu through this, for a menu button in a header of their own (#420).
          On phones the bell is inside the menu (#404), so the button shows a dot for anything new. */}
      <MobileMenuContext.Provider value={mobileMenu}>
        {/* relative: the AI bar floats at the bottom of this column, centred over the page (#308). */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* The chats fill the screen with a header that never scrolls away, so it's their only bar (#420). */}
          {fullHeight ? null : (
            <TopBar
              user={currentUser}
              nav={nav}
              pathname={pathname}
              onShowShortcuts={() => setShortcutsOpen(true)}
              onSendFeedback={() => setFeedbackOpen(true)}
              integrations={integrations}
            />
          )}
          <OfflineBanner />
          {/* relative: hidden (sr-only) text is absolutely positioned, and it scrolls only inside a positioned
              scroller. Otherwise it escapes, and the whole window scrolls beside main, a second scrollbar.
              Pages end above the AI bar, and on phones above the bar and the tabs: --page-end is that space,
              which a page's own floating bar keeps clear too (the Tasks page's bulk bar, #520). The chats
              end above the bar on computers too; on phones their tabs take their own row, and the ✦ floats.
              A page whose root has data-page-surface turns main, that space included, its surface color. */}
          <main
            id="main-content"
            className={cn(
              "relative min-h-0 flex-1 overflow-y-auto pb-(--page-end) has-[>[data-page-surface]]:bg-surface",
              fullHeight
                ? aiBarShown
                  ? "[--page-end:0rem] lg:[--page-end:6rem]"
                  : "[--page-end:0rem]"
                : aiBarShown
                  ? "[--page-end:9rem] lg:[--page-end:6rem]"
                  : "[--page-end:6rem] lg:[--page-end:0rem]",
            )}
          >
            {children}
          </main>
          {aiDock ? <AiDock ownComposer={fullHeight} /> : null}
          <MobileTabs pathname={pathname} onNewTask={openNewTask} onQuickAdd={openQuickAdd} inFlow={fullHeight} />
        </div>
      </MobileMenuContext.Provider>

      <CommandPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onNewTask={openNewTask}
        onShowShortcuts={() => setShortcutsOpen(true)}
        integrations={integrations}
      />
      <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} draft={newTaskDraft} />
      <ProjectSheet open={newProjectOpen} onOpenChange={setNewProjectOpen} onSubmit={createProject} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      {currentUser.isGuest ? (
        <GuestSignupDialog
          open={signup.open}
          reason={signup.reason}
          googleSignIn={googleSignIn}
          onOpenChange={(open) => setSignup((current) => ({ ...current, open }))}
        />
      ) : null}
    </div>
  );
}
