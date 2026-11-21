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

  // Personal labels first, then each project's, under its name.
  const labelGroups = new Map<string, Label[]>();
  for (const label of labels) labelGroups.set(label.projectId ?? "", [...(labelGroups.get(label.projectId ?? "") ?? []), label]);
  const orderedLabelGroups = [...labelGroups].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0));

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
          orderedLabelGroups.map(([projectId, items]) => (
            <div key={projectId || "personal"} role="group" aria-label={projectId ? (projects.find((project) => project.id === projectId)?.name ?? "Project") : "Personal"}>
              {orderedLabelGroups.length > 1 ? (
                <p aria-hidden="true" className="px-2.5 pb-0.5 pt-1 text-2xs text-muted">
                  {projectId ? (projects.find((project) => project.id === projectId)?.name ?? "Project") : "Personal"}
                </p>
              ) : null}
              {items.map((label) => (
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
  onSortChange,
  onShowDescriptionsChange,
}: {
  sort: TaskSort;
  showDescriptions: boolean;
  onSortChange: (sort: TaskSort) => void;
  onShowDescriptionsChange: (show: boolean) => void;
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
