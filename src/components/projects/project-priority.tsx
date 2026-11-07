"use client";

import { useState } from "react";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { PRIORITY_MENU_ORDER, priorityLabels, type Priority } from "@/lib/priority";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

const chipClass = "inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700";

/**
 * The project's priority on its page (#361): a small select for Owners and
 * Editors, saved at once; plain text for Viewers. It orders the project's
 * group on the Tasks page.
 */
export function ProjectPriority({ projectId, initialPriority, canEdit }: { projectId: string; initialPriority: Priority; canEdit: boolean }) {
  const [priority, setPriority] = useState(initialPriority);
  const [saving, setSaving] = useState(false);

  if (!canEdit) return <span className={chipClass}>Priority: {priorityLabels[priority]}</span>;

  async function change(next: Priority) {
    const previous = priority;
    setPriority(next);
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: next }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not change the priority.");
      }
      notifyWorkspaceChanged();
      toast.success(next === "NONE" ? "Priority cleared" : `Priority set to ${priorityLabels[next]}`);
    } catch (error) {
      setPriority(previous);
      toast.error(error instanceof Error ? error.message : "Could not change the priority.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className={cn(chipClass, "focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25")}>
      Priority:
      <select
        value={priority}
        disabled={saving}
        onChange={(event) => void change(event.target.value as Priority)}
        className="cursor-pointer bg-transparent font-semibold text-ink outline-none disabled:opacity-60"
      >
        {PRIORITY_MENU_ORDER.map((value) => (
          <option key={value} value={value}>{priorityLabels[value]}</option>
        ))}
      </select>
    </label>
  );
}
