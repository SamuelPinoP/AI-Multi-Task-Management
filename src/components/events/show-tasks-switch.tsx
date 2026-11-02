"use client";

import { uiButtonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useShowTasks } from "@/lib/show-tasks";

/** The Calendar's "Show tasks" switch: the Agenda and Month tabs share it, and the browser remembers it. */
export function ShowTasksSwitch({ className }: { className?: string }) {
  const [showTasks, setShowTasks] = useShowTasks();
  return (
    <button type="button" role="switch" aria-checked={showTasks} onClick={() => setShowTasks(!showTasks)} className={cn(uiButtonClass, "px-3", className)}>
      <span aria-hidden="true" className={cn("relative h-4 w-7 shrink-0 rounded-full transition-colors", showTasks ? "bg-accent" : "bg-zinc-300 dark:bg-zinc-600")}>
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-3 w-3 rounded-full shadow-sm transition-transform motion-reduce:transition-none",
            showTasks ? "translate-x-3 bg-accent-ink" : "bg-white",
          )}
        />
      </span>
      Show tasks
    </button>
  );
}
