"use client";

import { Search } from "lucide-react";
import { uiButtonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { openSearch } from "@/lib/workspace-events";

/**
 * Home's search button, left of Plan my day and as tall (#410, design 3A). It opens the
 * same search as Ctrl+K, now that no page has the bar that held it.
 */
export function HomeSearchButton() {
  return (
    <button type="button" onClick={openSearch} aria-label="Search" title="Search (Ctrl+K)" className={cn(uiButtonClass, "h-8.5 w-8.5 shrink-0 p-0")}>
      <Search aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
