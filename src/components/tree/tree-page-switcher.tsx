"use client";

import { type MouseEvent, useState } from "react";
import { uiPrimaryButtonClass } from "@/components/ui";
import { treePageHref } from "./tree-layout";
import type { TreePage } from "./types";

/** The row of tree pages: each is a link to /tree/<id>, and a double-click renames it. */
export function TreePageSwitcher({
  pages,
  activePage,
  onSelect,
  onCreate,
  onRename,
}: {
  pages: TreePage[];
  activePage: TreePage | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (pageId: string, title: string) => Promise<void>;
}) {
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function beginEdit(page: TreePage) {
    setEditingPageId(page.id);
    setDraft(page.title);
  }

  async function save(page: TreePage) {
    const title = draft.trim();
    setEditingPageId(null);
    if (title && title !== page.title) await onRename(page.id, title);
    else setDraft(page.title);
  }

  function select(event: MouseEvent<HTMLAnchorElement>, page: TreePage) {
    // A modified click opens the link in a new tab or window as usual.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelect(page.id);
  }

  return (
    <nav aria-label="Tree pages" className="rounded-2xl border border-line bg-surface/85 p-2.5 shadow-card backdrop-blur sm:p-3">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <button type="button" onClick={onCreate} className={`${uiPrimaryButtonClass} shrink-0 shadow-sm`}>
          New Tree Page
        </button>
        {pages.map((page) => {
          const selected = activePage?.id === page.id;
          const pillClass = `max-w-[12rem] shrink-0 truncate rounded-full border px-3 py-2 text-sm font-semibold transition sm:max-w-56 sm:px-4 ${selected ? "border-zinc-950 bg-zinc-950 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950" : "border-line bg-surface/90 text-zinc-700 hover:border-zinc-300 hover:bg-surface-hover dark:text-zinc-200"}`;
          return editingPageId === page.id ? (
            <input
              key={page.id}
              autoFocus
              aria-label="Tree page name"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void save(page)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void save(page);
                if (event.key === "Escape") {
                  setDraft(page.title);
                  setEditingPageId(null);
                }
              }}
              className={`${pillClass} outline-none ring-2 ring-accent`}
            />
          ) : (
            <a
              key={page.id}
              href={treePageHref(page.id)}
              onClick={(event) => select(event, page)}
              onDoubleClick={() => beginEdit(page)}
              aria-current={selected ? "page" : undefined}
              title="Click to switch. Double-click to rename."
              className={pillClass}
            >
              {page.title}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
