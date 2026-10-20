"use client";

import { Check } from "lucide-react";
import { useState, type FormEvent } from "react";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";

export type ProjectStatus = "ACTIVE" | "COMPLETED" | "ARCHIVED";

export type ProjectInput = { name: string; description: string; color: string; status: ProjectStatus };

export type EditableProject = { id: string; name: string; description: string | null; color: string | null; status: ProjectStatus };

export const projectStatusLabels: Record<ProjectStatus, string> = { ACTIVE: "Active", COMPLETED: "Completed", ARCHIVED: "Archived" };

const swatches = [
  { value: "#0f9488", name: "Teal" },
  { value: "#2563eb", name: "Blue" },
  { value: "#7c3aed", name: "Violet" },
  { value: "#db2777", name: "Pink" },
  { value: "#e11d48", name: "Red" },
  { value: "#d97706", name: "Amber" },
  { value: "#65a30d", name: "Green" },
  { value: "#64748b", name: "Slate" },
];

const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25";

/** Create or edit a project in a side sheet; `onSubmit` returns an error message or null. */
export function ProjectSheet({
  open,
  onOpenChange,
  project,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: EditableProject | null;
  onSubmit: (input: ProjectInput) => Promise<string | null>;
}) {
  const [input, setInput] = useState<ProjectInput>({ name: "", description: "", color: "", status: "ACTIVE" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const formKey = open ? (project?.id ?? "new") : null;
  if (formKey !== loadedFor) {
    setLoadedFor(formKey);
    setInput(
      project
        ? { name: project.name, description: project.description ?? "", color: project.color ?? "", status: project.status }
        : { name: "", description: "", color: "", status: "ACTIVE" },
    );
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!input.name.trim()) {
      setError("Give the project a name.");
      return;
    }
    setSaving(true);
    setError(null);
    const message = await onSubmit({ ...input, name: input.name.trim(), description: input.description.trim() });
    setSaving(false);
    if (message) setError(message);
    else onOpenChange(false);
  }

  const customColor = input.color && !swatches.some((swatch) => swatch.value === input.color);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{project ? "Edit project" : "New project"}</SheetTitle>
          <SheetDescription>
            {project ? "Change the details, then save." : "Invite teammates from the project page after you create it."}
          </SheetDescription>
        </SheetHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-1.5 text-sm font-medium">
            Name
            <input
              value={input.name}
              onChange={(event) => setInput((current) => ({ ...current, name: event.target.value }))}
              placeholder="e.g. Capstone demo, Research sprint"
              maxLength={120}
              autoFocus
              className={fieldClass}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Description
            <textarea
              value={input.description}
              onChange={(event) => setInput((current) => ({ ...current, description: event.target.value }))}
              placeholder="What is this project trying to accomplish?"
              rows={4}
              className={fieldClass}
            />
          </label>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Color</legend>
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Color">
              <button
                type="button"
                role="radio"
                aria-checked={!input.color}
                onClick={() => setInput((current) => ({ ...current, color: "" }))}
                className={cn(
                  "h-7 rounded-full border px-2.5 text-xs transition-colors",
                  !input.color ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-muted hover:text-ink",
                )}
              >
                Automatic
              </button>
              {swatches.map((swatch) => (
                <button
                  key={swatch.value}
                  type="button"
                  role="radio"
                  aria-checked={input.color === swatch.value}
                  aria-label={swatch.name}
                  title={swatch.name}
                  onClick={() => setInput((current) => ({ ...current, color: swatch.value }))}
                  className="grid h-7 w-7 place-items-center rounded-full ring-offset-2 ring-offset-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  style={{ backgroundColor: swatch.value }}
                >
                  {input.color === swatch.value ? <Check aria-hidden="true" className="h-4 w-4 text-white" /> : null}
                </button>
              ))}
              <label
                className={cn(
                  "relative grid h-7 w-7 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed",
                  customColor ? "border-transparent" : "border-muted",
                )}
                style={customColor ? { backgroundColor: input.color } : undefined}
                title="Custom color"
              >
                <span className="sr-only">Custom color</span>
                {customColor ? <Check aria-hidden="true" className="h-4 w-4 text-white" /> : <span aria-hidden="true" className="text-xs text-muted">+</span>}
                <input
                  type="color"
                  value={input.color || "#0f9488"}
                  onChange={(event) => setInput((current) => ({ ...current, color: event.target.value }))}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
            </div>
          </fieldset>
          {project ? (
            <label className="grid gap-1.5 text-sm font-medium">
              Status
              <select
                value={input.status}
                onChange={(event) => setInput((current) => ({ ...current, status: event.target.value as ProjectStatus }))}
                className={fieldClass}
              >
                {(Object.keys(projectStatusLabels) as ProjectStatus[]).map((status) => (
                  <option key={status} value={status}>{projectStatusLabels[status]}</option>
                ))}
              </select>
            </label>
          ) : null}
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className={uiPrimaryButtonClass}>
              {saving ? "Saving..." : project ? "Save changes" : "Create project"}
            </button>
            <button type="button" onClick={() => onOpenChange(false)} disabled={saving} className={uiButtonClass}>
              Cancel
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
