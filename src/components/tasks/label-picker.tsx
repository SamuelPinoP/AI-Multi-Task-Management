"use client";

import { Check, Pencil, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { cleanLabelName, labelNameKey, LABEL_NAME_MAX } from "@/lib/labels";
import { LabelManagerDialog } from "./label-manager";
import { createLabel, labelsInScope, loadLabels, useLabels, type LabelScopeKey } from "./label-store";

/**
 * Picks a task's labels (#276), like Linear's label menu: type to find one,
 * click to add or remove it, and the menu stays open for the next. Typing a
 * new name offers to create it. "Edit labels" renames, recolors and deletes.
 */
export function LabelPicker({
  scope,
  scopeName,
  selectedIds,
  onChange,
  canEdit = true,
  children,
}: {
  /** The project id the task is in, or "none" for a personal task. */
  scope: LabelScopeKey;
  /** "Personal" or the project's name, for the Edit labels dialog. */
  scopeName: string;
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  /** Viewers see the labels but can't create or edit them. */
  canEdit?: boolean;
  /** The trigger button. */
  children: ReactNode;
}) {
  const all = useLabels();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);

  const labels = labelsInScope(all ?? [], scope);
  const selected = new Set(selectedIds);
  const name = cleanLabelName(query);
  const exists = name ? labels.some((label) => labelNameKey(label.name) === labelNameKey(name)) : true;

  function toggle(id: string) {
    onChange(selected.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  }

  async function create() {
    if (!name || creating) return;
    setCreating(true);
    const result = await createLabel(name, scope);
    setCreating(false);
    if (!result.label) {
      toast.error(result.error ?? "Could not create the label.");
      return;
    }
    setQuery("");
    if (!selected.has(result.label.id)) onChange([...selectedIds, result.label.id]);
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void loadLabels();
          else setQuery("");
        }}
      >
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent className="w-64 p-0">
          <Command loop label={canEdit ? "Find or create a label" : "Find a label"}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              maxLength={LABEL_NAME_MAX}
              placeholder={canEdit ? "Find or create a label…" : "Find a label…"}
              className="h-10"
            />
            <CommandList className="max-h-64 p-1">
              <CommandEmpty className="py-4">{all === null ? "Loading labels…" : canEdit ? "No labels yet. Type a name to create one." : "No labels here yet."}</CommandEmpty>
              {labels.length ? (
                <CommandGroup>
                  {labels.map((label) => {
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
                          {/* The item styles every svg as a muted 16px icon; this one stays a small white check. */}
                          {checked ? <Check className="h-3! w-3! text-accent-ink!" /> : null}
                        </span>
                        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
                        <span className="min-w-0 flex-1 truncate">{label.name}</span>
                        <span className="sr-only">{checked ? ", added" : ""}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}
              {canEdit && name && !exists ? (
                <CommandItem forceMount value={`create ${name}`} onSelect={() => void create()} disabled={creating} className="gap-2.5 py-1.5">
                  <Plus />
                  <span className="min-w-0 flex-1 truncate">Create label “{name}”</span>
                </CommandItem>
              ) : null}
            </CommandList>
            {canEdit ? (
              <div className="border-t border-line p-1">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setManaging(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                  Edit labels…
                </button>
              </div>
            ) : null}
          </Command>
        </PopoverContent>
      </Popover>
      <LabelManagerDialog open={managing} onOpenChange={setManaging} scope={scope} scopeName={scopeName} />
    </>
  );
}
