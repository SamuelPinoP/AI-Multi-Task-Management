"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "@/components/ui/toaster";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

export const QUICK_ADD_INPUT_ID = "quick-add-input";

type QuickAddProps = {
  /** Called after the item is created, for pages that hold their own list. */
  onAdded?: () => void;
  placeholder?: string;
  /** The input's accessible name. */
  label?: string;
  /** Where to POST; the typed text is sent as `field`. */
  endpoint?: string;
  field?: string;
  successMessage?: string;
  /** Where the toast's Edit action goes for the new item. */
  editHref?: (id: string) => string;
};

/** One-line capture (Home, Tasks, Projects): type and press Enter. Creates a task by default. */
export function QuickAdd({
  onAdded,
  placeholder = "Add a task and press Enter",
  label = "Add a task",
  endpoint = "/api/tasks",
  field = "title",
  successMessage = "Task added",
  editHref = (id) => `/tasks?task=${id}`,
}: QuickAddProps = {}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: trimmed }),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !body?.id) {
        toast.error(body?.error ?? "Could not add it. Try again.");
        return;
      }
      const id = body.id;
      setText("");
      notifyWorkspaceChanged();
      onAdded?.();
      router.refresh();
      toast.success(successMessage, {
        description: trimmed,
        action: { label: "Edit", onClick: () => router.push(editHref(id)) },
      });
    } catch {
      toast.error("Could not add it. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 transition-colors focus-within:border-accent focus-within:ring-4 focus-within:ring-accent-soft"
    >
      <Plus aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
      <label htmlFor={QUICK_ADD_INPUT_ID} className="sr-only">
        {label}
      </label>
      <input
        id={QUICK_ADD_INPUT_ID}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        maxLength={200}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-muted"
      />
      <kbd className="hidden rounded border border-line px-1.5 font-sans text-[10px] text-muted sm:inline">Enter</kbd>
    </form>
  );
}
