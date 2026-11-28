"use client";

import { ListFilter, SlidersHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { uiPrimaryButtonClass } from "@/components/ui";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import type { Label } from "@/lib/labels";
import { PRIORITIES, priorityLabels, type Priority } from "@/lib/priority";
import { projectColor } from "@/lib/project-color";

export type TaskSort = "DUE_DATE_ASC" | "DUE_DATE_DESC" | "NEWEST" | "OLDEST";

const sortLabels: [TaskSort, string][] = [
  ["DUE_DATE_ASC", "Due soonest"],
  ["DUE_DATE_DESC", "Due latest"],
  ["NEWEST", "Newest"],
  ["OLDEST", "Oldest"],
];

/** Stands for "no project" among the projects a list is filtered by. */
export const NO_PROJECT = "none";

/** Empty sets mean "any". A task shows when it matches one of the chosen values in each set. */
export type TaskFilters = {
  priorities: ReadonlySet<Priority>;
  projects: ReadonlySet<string>;
  labels: ReadonlySet<string>;
};

export const noTaskFilters: TaskFilters = { priorities: new Set(), projects: new Set(), labels: new Set() };

export function taskFilterCount(filters: TaskFilters) {
  return filters.priorities.size + filters.projects.size + filters.labels.size;
}

/** The header's buttons (#520, design 1D): the height of the search field beside them. */
export const listToolbarButtonClass =
  "inline-flex h-8.5 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[0.84375rem] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0";

/** Personal labels first, then each project's, under its name. */
function groupLabels(labels: readonly Label[], projects: readonly { id: string; name: string }[]) {
  const groups = new Map<string, Label[]>();
  for (const label of labels) groups.set(label.projectId ?? "", [...(groups.get(label.projectId ?? "") ?? []), label]);
  return [...groups]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0))
    .map(([projectId, items]) => ({
      key: projectId || "personal",
      name: projectId ? (projects.find((project) => project.id === projectId)?.name ?? "Project") : "Personal",
      items,
    }));
}

/** Ticking an item keeps the menu open, so several can be picked in a row. */
function keepOpen(event: Event) {
  event.preventDefault();
}

/**
 * Filter (#520): priorities, projects and labels in one menu, each a box to tick, as in Linear.
 * The button counts the filters in use.
 */
export function TaskFilterMenu({
  filters,
  projects,
  labels,
  onChange,
}: {
  filters: TaskFilters;
  projects: readonly { id: string; name: string; color: string | null }[];
  labels: readonly Label[];
  onChange: (filters: TaskFilters) => void;
}) {
  const count = taskFilterCount(filters);

  function toggle<Key extends keyof TaskFilters>(key: Key, value: string, on: boolean) {
    const next = new Set<string>(filters[key] as ReadonlySet<string>);
    if (on) next.add(value);
    else next.delete(value);
    onChange({ ...filters, [key]: next });
  }

  const labelGroups = groupLabels(labels, projects);

  return (
    // Not modal: the list behind updates as boxes are ticked, and stays readable and clickable.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={count ? `Filter, ${count} on` : undefined}
        className={cn(
          listToolbarButtonClass,
          count ? "border-accent/55 bg-accent-soft text-accent" : "border-line bg-surface text-ink hover:bg-surface-hover",
        )}
      >
        <ListFilter aria-hidden="true" className={count ? "text-accent" : "text-muted"} />
        Filter
        {count ? (
          <span className="grid h-4.5 min-w-4.5 place-items-center rounded-full bg-accent px-1 text-2xs font-bold text-accent-ink">{count}</span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label="Filter tasks by"
        className="max-h-[min(34rem,var(--radix-dropdown-menu-content-available-height))] w-64 overflow-y-auto"
      >
        <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wider">Priority</DropdownMenuLabel>
        {PRIORITIES.map((priority) => (
          <DropdownMenuCheckboxItem
            key={priority}
            checked={filters.priorities.has(priority)}
            onCheckedChange={(on) => toggle("priorities", priority, on === true)}
            onSelect={keepOpen}
          >
            {priorityLabels[priority]}
          </DropdownMenuCheckboxItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wider">Project</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={filters.projects.has(NO_PROJECT)}
          onCheckedChange={(on) => toggle("projects", NO_PROJECT, on === true)}
          onSelect={keepOpen}
        >
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-dashed border-muted" />
          No project
        </DropdownMenuCheckboxItem>
        {projects.map((project) => (
          <DropdownMenuCheckboxItem
            key={project.id}
            checked={filters.projects.has(project.id)}
            onCheckedChange={(on) => toggle("projects", project.id, on === true)}
            onSelect={keepOpen}
          >
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(project) }} />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
          </DropdownMenuCheckboxItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wider">Labels</DropdownMenuLabel>
        {labels.length ? (
          labelGroups.map((group) => (
            <div key={group.key} role="group" aria-label={group.name}>
              {labelGroups.length > 1 ? (
                <p aria-hidden="true" className="px-2.5 pb-0.5 pt-1 text-2xs text-muted">
                  {group.name}
                </p>
              ) : null}
              {group.items.map((label) => (
                <DropdownMenuCheckboxItem
                  key={label.id}
                  checked={filters.labels.has(label.id)}
                  onCheckedChange={(on) => toggle("labels", label.id, on === true)}
                  onSelect={keepOpen}
                >
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
                  <span className="min-w-0 flex-1 truncate">{label.name}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </div>
          ))
        ) : (
          <p className="px-2.5 pb-2 pt-0.5 text-xs text-muted">No labels yet. Add them from a task.</p>
        )}

        {count ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(noTaskFilters)}>Clear filters</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Display (#520): how the list is sorted, and whether rows show their descriptions. */
export function TaskDisplayMenu({
  sort,
  showDescriptions,
  showTaskIds,
  onSortChange,
  onShowDescriptionsChange,
  onShowTaskIdsChange,
}: {
  sort: TaskSort;
  showDescriptions: boolean;
  /** Each task's number after its title, AM-142 (#486): on unless it's turned off. */
  showTaskIds: boolean;
  onSortChange: (sort: TaskSort) => void;
  onShowDescriptionsChange: (show: boolean) => void;
  onShowTaskIdsChange: (show: boolean) => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className={cn(listToolbarButtonClass, "border-line bg-surface text-ink hover:bg-surface-hover")}>
        <SlidersHorizontal aria-hidden="true" className="text-muted" />
        Display
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wider">Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup aria-label="Sort by" value={sort} onValueChange={(value) => onSortChange(value as TaskSort)}>
          {sortLabels.map(([value, label]) => (
            <DropdownMenuRadioItem key={value} value={value} onSelect={keepOpen}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wider">Show</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={showDescriptions} onCheckedChange={(on) => onShowDescriptionsChange(on === true)} onSelect={keepOpen}>
          Descriptions
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={showTaskIds} onCheckedChange={(on) => onShowTaskIdsChange(on === true)} onSelect={keepOpen}>
          Task ID
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The phone sheet's chips (#521, design 2A): 36px tall, a thumb's width apart. */
const sheetChipClass =
  "inline-flex h-9 max-w-full shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent";

function SheetChip({ on, children, ...props }: { on: boolean; children: React.ReactNode } & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(sheetChipClass, on ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-ink")}
      {...props}
    >
      {children}
    </button>
  );
}

function SheetGroupLabel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="-mb-1 mt-1 text-2xs font-semibold uppercase tracking-wider text-muted">
      {children}
    </p>
  );
}

/**
 * Filter and sort on phones (#521, design 2A): the computer's Filter and Display menus as one sheet
 * of chips, from the bottom where a thumb reaches. The list behind updates as chips are tapped;
 * "Show N tasks" closes the sheet, and Clear resets it.
 */
export function TaskFilterSheet({
  open,
  onOpenChange,
  filters,
  onChange,
  sort,
  onSortChange,
  showTaskIds,
  onShowTaskIdsChange,
  projects,
  labels,
  resultCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: TaskFilters;
  onChange: (filters: TaskFilters) => void;
  sort: TaskSort;
  onSortChange: (sort: TaskSort) => void;
  /** The computer's Display → Task ID (#486). */
  showTaskIds: boolean;
  onShowTaskIdsChange: (show: boolean) => void;
  projects: readonly { id: string; name: string; color: string | null }[];
  labels: readonly Label[];
  /** How many tasks the list shows with these filters. */
  resultCount: number;
}) {
  function toggle<Key extends keyof TaskFilters>(key: Key, value: string) {
    const next = new Set<string>(filters[key] as ReadonlySet<string>);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange({ ...filters, [key]: next });
  }
  const labelGroups = groupLabels(labels, projects);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideClose className="gap-3 px-4 pb-0 pt-2">
        <span aria-hidden="true" className="mx-auto h-1 w-9 shrink-0 rounded-full bg-line" />
        <SheetTitle className="text-[1.0625rem] font-bold leading-6">Filter and sort</SheetTitle>
        <SheetDescription className="sr-only">The list shows tasks that match a chip in each group you pick from.</SheetDescription>

        <SheetGroupLabel id="filter-sheet-priority">Priority</SheetGroupLabel>
        <div role="group" aria-labelledby="filter-sheet-priority" className="flex flex-wrap gap-2">
          {PRIORITIES.map((priority) => (
            <SheetChip key={priority} on={filters.priorities.has(priority)} aria-pressed={filters.priorities.has(priority)} onClick={() => toggle("priorities", priority)}>
              {priorityLabels[priority]}
            </SheetChip>
          ))}
        </div>

        <SheetGroupLabel id="filter-sheet-project">Project</SheetGroupLabel>
        <div role="group" aria-labelledby="filter-sheet-project" className="flex flex-wrap gap-2">
          <SheetChip on={filters.projects.has(NO_PROJECT)} aria-pressed={filters.projects.has(NO_PROJECT)} onClick={() => toggle("projects", NO_PROJECT)}>
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-dashed border-current" />
            No project
          </SheetChip>
          {projects.map((project) => (
            <SheetChip key={project.id} on={filters.projects.has(project.id)} aria-pressed={filters.projects.has(project.id)} onClick={() => toggle("projects", project.id)}>
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(project) }} />
              <span className="truncate">{project.name}</span>
            </SheetChip>
          ))}
        </div>

        <SheetGroupLabel id="filter-sheet-labels">Labels</SheetGroupLabel>
        {labels.length ? (
          <div role="group" aria-labelledby="filter-sheet-labels" className="grid gap-2">
            {labelGroups.map((group) => (
              <div key={group.key} role="group" aria-label={group.name} className="flex flex-wrap items-center gap-2">
                {labelGroups.length > 1 ? <span aria-hidden="true" className="w-full text-2xs text-muted">{group.name}</span> : null}
                {group.items.map((label) => (
                  <SheetChip key={label.id} on={filters.labels.has(label.id)} aria-pressed={filters.labels.has(label.id)} onClick={() => toggle("labels", label.id)}>
                    <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
                    <span className="truncate">{label.name}</span>
                  </SheetChip>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No labels yet. Add them from a task.</p>
        )}

        <SheetGroupLabel id="filter-sheet-sort">Sort</SheetGroupLabel>
        <div role="radiogroup" aria-labelledby="filter-sheet-sort" className="flex flex-wrap gap-2">
          {sortLabels.map(([value, label]) => (
            <SheetChip key={value} role="radio" on={sort === value} aria-checked={sort === value} onClick={() => onSortChange(value)}>
              {label}
            </SheetChip>
          ))}
        </div>

        <SheetGroupLabel id="filter-sheet-show">Show</SheetGroupLabel>
        <div role="group" aria-labelledby="filter-sheet-show" className="flex flex-wrap gap-2">
          <SheetChip on={showTaskIds} aria-pressed={showTaskIds} onClick={() => onShowTaskIdsChange(!showTaskIds)}>
            Task ID
          </SheetChip>
        </div>

        {/* Stays in reach while a long list of projects or labels scrolls. */}
        <div className="sticky bottom-0 -mx-4 mt-1 flex items-center gap-2.5 bg-raised px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">
          <button
            type="button"
            onClick={() => {
              onChange(noTaskFilters);
              onSortChange("DUE_DATE_ASC");
            }}
            className="-ml-1 rounded-lg px-1 py-2.5 text-[0.9375rem] font-semibold text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear
          </button>
          <span aria-hidden="true" className="flex-1" />
          <button type="button" onClick={() => onOpenChange(false)} className={cn(uiPrimaryButtonClass, "h-11 px-4.5 text-[0.9375rem]")}>
            Show {resultCount} task{resultCount === 1 ? "" : "s"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
