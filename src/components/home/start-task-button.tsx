"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveTaskStatus } from "@/components/home/save-task-status";
import { toast } from "@/components/ui/toaster";
import type { HomeFocusTask } from "@/lib/home-data";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

/** Suggested next's Start (DES-10): marks the task In progress, then opens it. */
export function StartTaskButton({ task, href, className }: { task: HomeFocusTask; href: string; className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const started = task.status === "IN_PROGRESS";
  const label = started ? "Continue" : "Start";

  async function start() {
    setPending(true);
    try {
      if (!started) {
        await saveTaskStatus(task, "IN_PROGRESS");
        notifyWorkspaceChanged();
        toast.success("Task started", { description: task.title });
      }
      router.push(href);
    } catch (error) {
      setPending(false);
      toast.error(error instanceof Error ? error.message : "Could not start the task.");
    }
  }

  return (
    <button type="button" onClick={() => void start()} disabled={pending} aria-label={`${label} ${task.title}`} className={className}>
      {label}
    </button>
  );
}
