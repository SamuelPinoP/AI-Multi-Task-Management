"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * A floating panel anchored to a button (Radix Popover), styled like the
 * dropdown menus. Pickers with a search box use it: a menu would steal the
 * typing for its own type-ahead.
 */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({ className, align = "start", sideOffset = 6, ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-line bg-raised text-sm text-ink shadow-raised outline-none data-[state=open]:animate-[ui-pop-in_120ms_ease-out]",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
