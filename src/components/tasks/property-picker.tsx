"use client";

import { Check } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { matchPickerOption } from "@/lib/picker-match";

export type PickerOption<T extends string = string> = {
  /** What onSelect receives; "" works for "none" choices like Unassigned. */
  value: T;
  label: string;
  /** Shown before the label: a status ring, a project's color, an avatar. */
  icon?: ReactNode;
  /** More words the search matches besides the label. */
  keywords?: readonly string[];
};

/**
 * Picks one value for a task property, like Linear's pickers (#352, #362):
 * type to narrow the list, arrows and Enter to choose, Escape to close. The
 * current value has a check and is highlighted when the picker opens;
 * choosing it again changes nothing.
 */
export function PropertyPicker<T extends string>({
  label,
  options,
  value,
  onSelect,
  heading,
  emptyText = "Nothing matches.",
  modal = false,
  align = "start",
  children,
}: {
  /** Names the search box, for example "Change priority". */
  label: string;
  options: readonly PickerOption<T>[];
  /** The current value, if any. */
  value?: T | "" | null;
  onSelect: (value: T) => void;
  /** A heading over the options, like "Members of Launch website". */
  heading?: string;
  /** Shown when nothing matches the search, or when there are no options. */
  emptyText?: string;
  /** Inside a dialog: a click outside closes only this picker, not the dialog too (#362). */
  modal?: boolean;
  align?: "start" | "center" | "end";
  /** The trigger button. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const current = options.findIndex((option) => option.value === (value ?? ""));

  const items = options.map((option, index) => {
    const selected = index === current;
    return (
      <CommandItem
        key={`${index}:${option.value}`}
        value={`option-${index}`}
        keywords={[option.label, ...(option.keywords ?? [])]}
        onSelect={() => {
          setOpen(false);
          if (!selected) onSelect(option.value);
        }}
        className="gap-2.5 py-1.5"
      >
        {option.icon}
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {/* The item styles every svg as a muted 16px icon; the check stays accent-colored. */}
        {selected ? <Check aria-hidden="true" className="text-accent!" /> : null}
        <span className="sr-only">{selected ? ", current" : ""}</span>
      </CommandItem>
    );
  });

  return (
    <Popover modal={modal} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-0">
        <Command
          loop
          label={label}
          defaultValue={current >= 0 ? `option-${current}` : undefined}
          filter={(_value, search, keywords) => matchPickerOption(search, keywords)}
        >
          <CommandInput placeholder={`${label}…`} className="h-10" />
          <CommandList className="max-h-64 p-1">
            <CommandEmpty className="py-4">{emptyText}</CommandEmpty>
            {heading && options.length ? <CommandGroup heading={heading}>{items}</CommandGroup> : items}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
