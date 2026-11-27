"use client";

import type { ReactNode } from "react";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipDetail } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { GUEST_LIMITS, guestLeft, type GuestLimitKind, type GuestUsage } from "@/lib/guest-limits-core";
import { avatarColor } from "@/lib/project-color";
import { openGuestLogin, openGuestSignup } from "@/lib/workspace-events";

function GuestAvatar({ userId, className }: { userId: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 place-items-center rounded-full font-bold text-white", className)}
      style={{ backgroundColor: avatarColor(userId) }}
    >
      G
    </span>
  );
}

/** One limit as words and pips: a filled pip for each one left, like lives in a game. */
function GuestMeter({ kind, label, usage }: { kind: GuestLimitKind; label: string; usage: GuestUsage }) {
  const left = guestLeft(usage, kind);
  return (
    <div className="grid min-w-0 gap-1.5">
      <p className="flex items-baseline justify-between gap-1.5 text-xs">
        <span className="truncate font-medium">{label}</span>
        <span className={cn("shrink-0 whitespace-nowrap", left ? "text-muted" : "font-medium text-warning")}>{left} left</span>
      </p>
      <span aria-hidden="true" className="flex gap-[0.1875rem]">
        {Array.from({ length: GUEST_LIMITS[kind] }, (_, index) => (
          <span key={index} className={cn("h-1.5 min-w-0 max-w-3 flex-1 rounded-full", index < left ? "bg-accent" : "bg-line")} />
        ))}
      </span>
    </div>
  );
}

/**
 * The guest profile (#458, design 2C): where an account's profile row sits, a guest sees what their
 * workspace holds and how to keep it. Settings and Trash keep their place beside the name.
 */
export function GuestProfileCard({
  userId,
  usage,
  settings,
  trash,
  className,
}: {
  userId: string;
  usage: GuestUsage;
  /** The settings and theme menu's button. */
  settings: ReactNode;
  trash?: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label="Guest workspace" className={cn("@container grid gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-3 shadow-card max-lg:px-3", className)}>
      {/* Sized so "Guest workspace" and its line fit the sidebar's default 224 px width. */}
      <div className="flex items-center gap-1.5 max-lg:gap-2">
        <GuestAvatar userId={userId} className="h-6 w-6 text-2xs max-lg:h-8 max-lg:w-8 max-lg:text-xs" />
        <div className="grid min-w-0 flex-1">
          <p className="truncate text-[0.8125rem] font-semibold leading-5 max-lg:text-sm">Guest workspace</p>
          <p className="truncate text-2xs leading-4 text-muted max-lg:text-xs">Saved on this browser</p>
        </div>
        {trash}
        {settings}
      </div>
      <div className="grid grid-cols-1 gap-x-3 gap-y-2 @[11rem]:grid-cols-2">
        <GuestMeter kind="tasks" label="Tasks" usage={usage} />
        <GuestMeter kind="events" label="Events" usage={usage} />
      </div>
      <p className="text-xs leading-4 text-muted">The AI and inviting people need an account.</p>
      <div className="flex flex-col gap-2 @[12.5rem]:flex-row">
        <button
          type="button"
          onClick={() => openGuestSignup("signup")}
          className={cn(uiPrimaryButtonClass, "shine flex-1 px-3 font-semibold max-lg:min-h-11")}
        >
          Sign up free
        </button>
        {/* Over the page, like Sign up (#543): logging in comes back to it. */}
        <button type="button" onClick={openGuestLogin} className={cn(uiButtonClass, "px-3 max-lg:min-h-11")}>
          Log in
        </button>
      </div>
    </section>
  );
}

/**
 * In the phone top bar (#461, design A): the avatar and the tasks left, beside the menu button, and
 * the card opens below. When the page's name moves into the bar, the words fold into the avatar.
 */
export function GuestProfileChip({ folded, ...props }: Parameters<typeof GuestProfileCard>[0] & { folded: boolean }) {
  const left = guestLeft(props.usage, "tasks");
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex h-10 min-w-0 shrink-0 items-center gap-2 rounded-[0.625rem] pl-1 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-hover",
          folded ? "pr-1" : "pr-2.5",
        )}
      >
        <GuestAvatar userId={props.userId} className="h-7 w-7 text-2xs" />
        <span
          className={cn(
            "grid min-w-0 overflow-hidden transition-[max-width,opacity] duration-200 motion-reduce:transition-none",
            folded ? "max-w-0 opacity-0" : "max-w-40 opacity-100",
          )}
        >
          <span className="truncate text-[0.8125rem] font-semibold leading-4">Guest</span>
          <span className={cn("truncate text-[0.71875rem] leading-4", left ? "text-muted" : "font-medium text-warning")}>
            {left ? `${left} task${left === 1 ? "" : "s"} left` : "No tasks left"}
          </span>
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[18.75rem] border-0 bg-transparent shadow-none">
        <GuestProfileCard {...props} className="shadow-raised" />
      </PopoverContent>
    </Popover>
  );
}

/** On the icon rail (#415) the guest profile is the avatar, and the card opens beside it. */
export function GuestProfileRail(props: Parameters<typeof GuestProfileCard>[0]) {
  return (
    <Popover>
      <Tooltip
        content={
          <>
            Guest workspace <TooltipDetail>Sign up free</TooltipDetail>
          </>
        }
      >
        <PopoverTrigger className="relative grid h-9 w-9 place-items-center rounded-lg outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-hover">
          <GuestAvatar userId={props.userId} className="h-7 w-7 text-2xs" />
          <span aria-hidden="true" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-sunken" />
          <span className="sr-only">Guest workspace</span>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="right" align="end" sideOffset={10} className="w-72 border-0 bg-transparent shadow-none">
        <GuestProfileCard {...props} className="shadow-raised" />
      </PopoverContent>
    </Popover>
  );
}
