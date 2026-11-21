"use client";

import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-48 overflow-hidden rounded-xl border border-line bg-raised p-1 text-sm text-ink shadow-raised data-[state=open]:animate-[ui-pop-in_120ms_ease-out]",
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

const itemClass =
  "relative flex cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-2 outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-50 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-muted";

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof MenuPrimitive.Item>) {
  return <MenuPrimitive.Item className={cn(itemClass, className)} {...props} />;
}

/** A ticked box before the item's words, for menus that toggle several things (the Tasks page's Filter, #520). */
export function DropdownMenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem className={cn(itemClass, "group/check", className)} {...props}>
      <span
        aria-hidden="true"
        className="grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px] border-muted group-data-[state=checked]/check:border-accent group-data-[state=checked]/check:bg-accent"
      >
        <Check className="h-3! w-3! text-accent-ink! opacity-0 group-data-[state=checked]/check:opacity-100" strokeWidth={3} />
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

/** One choice among several, shown as a round mark before the words. */
export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem className={cn(itemClass, "group/radio", className)} {...props}>
      <span
        aria-hidden="true"
        className="h-4 w-4 shrink-0 rounded-full border-[1.5px] border-muted group-data-[state=checked]/radio:border-[5px] group-data-[state=checked]/radio:border-accent"
      />
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn("px-2.5 py-1.5 text-xs text-muted", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-line", className)} {...props} />;
}
