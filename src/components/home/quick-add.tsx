"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "@/components/ui/toaster";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

export const QUICK_ADD_INPUT_ID = "quick-add-input";

/** One-line task capture (Home, Tasks): type a title and press Enter. */
export function QuickAdd({ onAdded, placeholder = "Add a task and press Enter" }: { onAdded?: () => void; placeholder?: string } = {}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !body?.id) {
        toast.error(body?.error ?? "Could not add the task. Try again.");
        return;
      }
      const taskId = body.id;
      setTitle("");
      notifyWorkspaceChanged();
      onAdded?.();
      router.refresh();
      toast.success("Task added", {
        description: trimmed,
        action: { label: "Edit", onClick: () => router.push(`/tasks?task=${taskId}`) },
      });
    } catch {
      toast.error("Could not add the task. Check your connection and try again.");
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
        Add a task
      </label>
      <input
        id={QUICK_ADD_INPUT_ID}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={placeholder}
        maxLength={200}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-muted"
      />
      <kbd className="hidden rounded border border-line px-1.5 font-sans text-[10px] text-muted sm:inline">Enter</kbd>
    </form>
  );
}
