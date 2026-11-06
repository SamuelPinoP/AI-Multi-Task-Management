"use client";

import { Check, ChevronDown, Tag } from "lucide-react";
import { useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import type { Label } from "@/lib/labels";

/**
 * Filters a list by labels (#276): shows tasks with any of the chosen labels.
 * Labels are grouped by owner: personal ones, then each project's.
 */
export function LabelFilter({
  labels,
  projects,
  selected,
  onChange,
  className,
}: {
  labels: readonly Label[];
  /** Names for the project groups. */
  projects: readonly { id: string; name: string }[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const groups = new Map<string, Label[]>();
  for (const label of labels) {
    const key = label.projectId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), label]);
  }
  const ordered = [...groups].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0));
  const count = [...selected].filter((id) => labels.some((label) => label.id === id)).length;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/25",
            count ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink",
            className,
          )}
        >
          <Tag aria-hidden="true" className="h-4 w-4 shrink-0" />
          {count ? `Labels: ${count}` : "Labels"}
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <Command loop label="Filter by label">
          <CommandInput placeholder="Filter by label…" className="h-10" />
          <CommandList className="max-h-72 p-1">
            <CommandEmpty className="py-4">{labels.length ? "No label matches." : "No labels yet. Add them from a task."}</CommandEmpty>
            {ordered.map(([projectId, items]) => (
              <CommandGroup key={projectId || "personal"} heading={projectId ? (projects.find((project) => project.id === projectId)?.name ?? "Project") : "Personal"}>
                {items.map((label) => {
                  const checked = selected.has(label.id);
                  return (
                    <CommandItem key={label.id} value={`${label.name} ${label.id}`} onSelect={() => toggle(label.id)} className="gap-2.5 py-1.5">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px]",
                          checked ? "border-accent bg-accent text-accent-ink" : "border-muted",
                        )}
                      >
                        {checked ? <Check className="h-3! w-3! text-accent-ink!" /> : null}
                      </span>
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
                      <span className="min-w-0 flex-1 truncate">{label.name}</span>
                      <span className="sr-only">{checked ? ", filtering" : ""}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
          {count ? (
            <div className="border-t border-line p-1">
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
              >
                Clear label filter
              </button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
