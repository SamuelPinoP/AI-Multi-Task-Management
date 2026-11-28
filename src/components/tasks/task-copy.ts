"use client";

import { toast } from "@/components/ui/toaster";
import { formatTaskNumber, taskBranchName, taskNumberPath } from "@/lib/task-number";

async function copy(text: string, message: string, description?: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message, description ? { description } : undefined);
  } catch {
    toast.error("Could not copy it. The browser didn't allow it.");
  }
}

/**
 * Copy ID, Copy link and Copy branch name (#486, design 5B), for a task's menus. The link is the
 * task's permanent address, /t/142, which keeps working wherever the task moves.
 */
export function taskCopyActions(task: { number: number; title: string }) {
  const id = formatTaskNumber(task.number);
  return {
    copyId: () => copy(id, `Copied ${id}`),
    copyLink: () => copy(`${window.location.origin}${taskNumberPath(task.number)}`, `Copied the link to ${id}`),
    copyBranch: () => {
      const branch = taskBranchName(task.number, task.title);
      return copy(branch, "Copied the branch name", branch);
    },
  };
}
