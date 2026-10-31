"use client";

import { Check } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { ACCENTS, accentName } from "@/lib/accent";

/**
 * The account menu's accent colors (DES-15): a row of swatches under Theme.
 * Picking one keeps the menu open, so each color can be tried on the page
 * behind it.
 */
export function AccentMenuItems() {
  const { accent, setAccent } = useTheme();

  return (
    <>
      <DropdownMenuLabel className="flex items-center">
        Accent color
        <span className="ml-auto text-ink">{accentName(accent)}</span>
      </DropdownMenuLabel>
      <DropdownMenuGroup aria-label="Accent color" className="flex gap-1 px-1.5 pb-1">
        {ACCENTS.map((option) => (
          <DropdownMenuItem
            key={option.id}
            role="menuitemradio"
            aria-checked={accent === option.id}
            aria-label={option.name}
            title={option.name}
            textValue={option.name}
            onSelect={(event) => {
              event.preventDefault();
              setAccent(option.id);
            }}
            className="h-8 w-8 justify-center rounded-full p-0 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:text-accent-ink"
          >
            {/* data-accent gives the swatch its own palette, so bg-accent is that color. */}
            <span data-accent={option.id} className="grid h-5 w-5 place-items-center rounded-full bg-accent">
              {accent === option.id ? <Check aria-hidden="true" strokeWidth={3} /> : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </>
  );
}
