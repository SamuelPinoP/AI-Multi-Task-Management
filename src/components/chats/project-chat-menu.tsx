"use client";

import { ChevronRight, LayoutDashboard, MoreHorizontal, SquareKanban, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { uiButtonClass } from "@/components/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";

/** A bordered square for the chat header's icon buttons; the open or pressed state turns it accent. */
export const chatHeaderIconButtonClass = cn(
  uiButtonClass,
  "h-9 w-9 shrink-0 p-0 text-ink data-[state=open]:border-accent/35 data-[state=open]:bg-accent-soft data-[state=open]:text-accent aria-pressed:border-accent/35 aria-pressed:bg-accent-soft aria-pressed:text-accent",
);

function MenuRow({ href, icon: Icon, title, detail }: { href: string; icon: LucideIcon; title: string; detail: string }) {
  return (
    <DropdownMenuItem asChild className="cursor-pointer gap-3 py-2">
      <Link href={href}>
        <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft">
          <Icon className="text-accent!" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">{title}</span>
          <span className="truncate text-xs text-muted">{detail}</span>
        </span>
        <ChevronRight aria-hidden="true" />
      </Link>
    </DropdownMenuItem>
  );
}

/**
 * The ⋯ menu in a project chat's header (#408, design 1B): the project's board and its page,
 * each row saying where it goes. They used to be two buttons in the header.
 */
export function ProjectChatMenu({ projectId, projectName }: { projectId: string; projectName: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="More" title="More" className={chatHeaderIconButtonClass}>
        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-1.5">
        <DropdownMenuLabel className="truncate text-2xs font-semibold uppercase tracking-wider">{projectName}</DropdownMenuLabel>
        <MenuRow href={`/projects/${projectId}/board`} icon={SquareKanban} title="Board" detail="Tasks by status" />
        <MenuRow href={`/projects/${projectId}`} icon={LayoutDashboard} title="Project" detail="Overview, people and files" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
