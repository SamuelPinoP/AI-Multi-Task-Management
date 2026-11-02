"use client";

import { useTheme } from "@/components/theme-provider";
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { TEXT_SIZES, textSizeName, type TextSize } from "@/lib/text-size";

/** Each choice shows an "A" at roughly the size it gives body text. */
const glyphClass: Record<TextSize, string> = {
  small: "text-[0.6875rem]",
  default: "text-[0.8125rem]",
  large: "text-[0.9375rem]",
  larger: "text-[1.0625rem]",
};

/**
 * The account menu's text sizes (DES-19): four steps under the accent colors.
 * Picking one keeps the menu open, so each size can be tried on the page
 * behind it.
 */
export function TextSizeMenuItems() {
  const { textSize, setTextSize } = useTheme();

  return (
    <>
      <DropdownMenuLabel className="flex items-center">
        Text size
        <span className="ml-auto text-ink">{textSizeName(textSize)}</span>
      </DropdownMenuLabel>
      <DropdownMenuGroup aria-label="Text size" className="grid grid-cols-4 gap-1 px-1.5 pb-1">
        {TEXT_SIZES.map((option) => {
          const checked = textSize === option.id;
          return (
            <DropdownMenuItem
              key={option.id}
              role="menuitemradio"
              aria-checked={checked}
              aria-label={option.name}
              title={option.name}
              textValue={option.name}
              onSelect={(event) => {
                event.preventDefault();
                setTextSize(option.id);
              }}
              className={cn(
                "h-9 justify-center border p-0",
                checked ? "border-accent bg-accent-soft text-accent data-[highlighted]:bg-accent-soft" : "border-line",
              )}
            >
              <span aria-hidden="true" className={cn("font-semibold leading-none", glyphClass[option.id])}>
                A
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuGroup>
    </>
  );
}
