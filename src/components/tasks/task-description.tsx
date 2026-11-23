"use client";

import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MarkdownText } from "@/components/markdown-text";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import {
  checklistProgress,
  cleanSectionTitle,
  parseDescription,
  SECTION_TITLE_MAX,
  serializeDescription,
  setChecklistItem,
  type DescriptionSection,
} from "@/lib/description-sections";

/** Sections that start folded: the person's own words at the end of a ticket (#433). */
const FOLDED_AT_FIRST = new Set(["original request"]);

/** The section being edited: one that exists, by index, or a new one. */
type Editing = { index: number | "new"; title: string; body: string };

const VARIANTS = {
  /** The task's page. */
  page: { heading: "text-[1.0625rem] leading-6", body: "text-[0.9375rem] leading-[1.625rem]", gap: "gap-4" },
  /** A draft ticket beside the AI chat. */
  draft: { heading: "text-[0.9375rem] leading-6", body: "text-sm leading-[1.375rem]", gap: "gap-3" },
};

const iconButtonClass =
  "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted outline-none transition-colors hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40 max-sm:h-11 max-sm:w-11";

/** Each section's key for what's folded: its title, and which one of that title it is. */
function sectionKeys(sections: DescriptionSection[]) {
  const seen = new Map<string, number>();
  return sections.map((section) => {
    const title = section.title.toLowerCase();
    const count = seen.get(title) ?? 0;
    seen.set(title, count + 1);
    return `${title}#${count}`;
  });
}

function ProgressBadge({ done, total }: { done: number; total: number }) {
  return (
    <span className={cn("shrink-0 rounded-full px-1.5 font-mono text-xs font-medium tabular-nums leading-5", done === total ? "bg-success-soft text-success" : "bg-sunken text-muted")}>
      {done} of {total}
    </span>
  );
}

/**
 * A task's description (#433). A plain one is the text field it always was. One in sections, such
 * as a ticket the AI wrote, shows each section formatted, under its title: the arrow beside the
 * title folds it and opens it again, the pencil edits it, with its title, and the bin removes it
 * while it's being edited. "Add a section" adds one, such as "Cost" with a down payment and a
 * monthly cost, to any description. Checklist boxes tick. Every change saves the whole description
 * through `onSave`, which says whether it was saved.
 */
export function TaskDescription({
  description,
  canEdit,
  onSave,
  variant = "page",
  headingLevel = 2,
  introId = "task-description",
  onEditingChange,
}: {
  description: string;
  canEdit: boolean;
  onSave: (next: string) => Promise<boolean>;
  variant?: keyof typeof VARIANTS;
  headingLevel?: 2 | 3;
  /** The id of the text field a plain description is typed in. */
  introId?: string;
  /** Whether a section is being edited, so a dialog around it can keep Escape for the section. */
  onEditingChange?: (editing: boolean) => void;
}) {
  const ids = useId();
  const style = VARIANTS[variant];
  const Heading = headingLevel === 2 ? "h2" : "h3";

  // The description with the changes made here, until the last of them is saved.
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const latest = useRef<string | null>(null);
  const pending = useRef(0);
  // Saves go one at a time, in order, so two quick changes (two boxes ticked) can't be saved out of
  // order and leave the earlier one as the description.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const current = optimistic ?? description;
  const parsed = parseDescription(current);
  const plain = parsed.sections.length === 0;

  const [introSeen, setIntroSeen] = useState(parsed.intro);
  const [intro, setIntro] = useState(parsed.intro);
  if (parsed.intro !== introSeen) {
    setIntroSeen(parsed.intro);
    setIntro(parsed.intro);
  }

  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  const [editing, setEditingState] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const keys = sectionKeys(parsed.sections);

  function setEditing(next: Editing | null) {
    setEditingState(next);
    setTitleError(false);
    onEditingChange?.(next !== null);
  }

  // Where the keyboard goes once the editor closes: a section's pencil, or Add a section when that
  // section is gone (or was never added).
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    if (editing !== null || focusAfter.current === null) return;
    const target = document.getElementById(focusAfter.current) ?? document.getElementById(`${ids}-add`);
    focusAfter.current = null;
    target?.focus();
  });

  // A removed section's Undo belongs to this description: it goes when the description does, such
  // as when the draft closes and its card is applied.
  const undoToast = useRef<string | number | null>(null);
  useEffect(
    () => () => {
      if (undoToast.current !== null) toast.dismiss(undoToast.current);
    },
    [],
  );

  function closeEditor(focusIndex: number | "new") {
    focusAfter.current = focusIndex === "new" ? `${ids}-add` : `${ids}-edit-${focusIndex}`;
    setEditing(null);
  }

  /** The description to change: with every change made here, even one still saving. */
  const base = () => latest.current ?? description;

  async function commit(next: string) {
    latest.current = next;
    pending.current += 1;
    setOptimistic(next);
    const saved = queue.current.then(() => onSave(next));
    queue.current = saved.catch(() => false);
    let ok = false;
    try {
      ok = await saved;
    } finally {
      pending.current -= 1;
      // Once every change has answered, the saved description is the one to show again.
      if (!pending.current) {
        latest.current = null;
        setOptimistic(null);
      }
    }
    return ok;
  }

  function saveIntro() {
    const { intro: savedIntro, sections } = parseDescription(base());
    if (sections.length === 0) {
      // A plain description saves as it always has.
      const next = intro.trim();
      if (next !== base()) void commit(next);
      return;
    }
    if (intro.trim() !== savedIntro) void commit(serializeDescription({ intro, sections }));
  }

  const folded = (index: number) => FOLDED_AT_FIRST.has(parsed.sections[index].title.toLowerCase()) !== toggled.has(keys[index]);

  function toggleFold(index: number) {
    setToggled((now) => {
      const next = new Set(now);
      if (!next.delete(keys[index])) next.add(keys[index]);
      return next;
    });
  }

  function startEditing(index: number) {
    const section = parsed.sections[index];
    if (folded(index)) toggleFold(index);
    setEditing({ index, title: section.title, body: section.body });
  }

  async function saveSection() {
    if (!editing) return;
    const title = cleanSectionTitle(editing.title);
    if (!title) {
      setTitleError(true);
      return;
    }
    const { intro: savedIntro, sections } = parseDescription(base());
    const section = { title, body: editing.body };
    const next =
      editing.index === "new" ? [...sections, section] : sections.map((existing, index) => (index === editing.index ? section : existing));
    setSaving(true);
    const ok = await commit(serializeDescription({ intro: savedIntro, sections: next }));
    setSaving(false);
    if (ok) closeEditor(editing.index === "new" ? sections.length : editing.index);
  }

  async function removeSection() {
    if (!editing) return;
    if (editing.index === "new") {
      closeEditor("new");
      return;
    }
    const before = base();
    const { intro: savedIntro, sections } = parseDescription(before);
    const removed = sections[editing.index];
    setSaving(true);
    const ok = await commit(serializeDescription({ intro: savedIntro, sections: sections.filter((_, index) => index !== editing.index) }));
    setSaving(false);
    if (!ok) return;
    // The next section's pencil, which now has this one's place.
    closeEditor(editing.index);
    undoToast.current = toast.success("Section removed", {
      description: removed?.title,
      action: { label: "Undo", onClick: () => void commit(before) },
    });
  }

  function check(index: number, line: number, checked: boolean) {
    const { intro: savedIntro, sections } = parseDescription(base());
    const body = sections[index] ? setChecklistItem(sections[index].body, line, checked) : null;
    if (body === null) return;
    void commit(serializeDescription({ intro: savedIntro, sections: sections.map((section, at) => (at === index ? { ...section, body } : section)) }));
  }

  function editorKeys(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void saveSection();
    }
  }

  function editor(section: Editing) {
    const isNew = section.index === "new";
    // The section's saved title, which stays the same while its new one is typed.
    const name = section.index === "new" ? "" : (parsed.sections[section.index]?.title ?? "");
    return (
      <div
        role="group"
        aria-label={isNew ? "New section" : `Editing ${name}`}
        // Escape anywhere in the editor, its buttons too, leaves the section as it was (and on a
        // task's page, keeps Escape from going back to the list).
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          closeEditor(section.index);
        }}
        className="rounded-xl border border-accent/45 bg-surface p-2.5 shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_12%,transparent)]"
      >
        <div className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <label htmlFor={`${ids}-title`} className="sr-only">
              Section title
            </label>
            <input
              id={`${ids}-title`}
              value={section.title}
              onChange={(event) => {
                setEditingState({ ...section, title: event.target.value });
                setTitleError(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !(event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  document.getElementById(`${ids}-body`)?.focus();
                  return;
                }
                editorKeys(event);
              }}
              maxLength={SECTION_TITLE_MAX}
              placeholder="Section title, such as Cost"
              autoFocus={isNew}
              aria-invalid={titleError || undefined}
              aria-describedby={titleError ? `${ids}-title-error` : undefined}
              className={cn(
                "h-9 w-full rounded-lg border border-line bg-surface px-2.5 font-semibold text-ink outline-none placeholder:font-normal placeholder:text-muted focus:border-accent max-sm:h-11 max-sm:text-base",
                style.heading,
                titleError && "border-danger",
              )}
            />
            {titleError ? (
              <p id={`${ids}-title-error`} className="mt-1 text-xs text-danger">
                Give the section a title.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void removeSection()}
            disabled={saving}
            aria-label={isNew ? "Discard the new section" : `Remove ${name}`}
            title={isNew ? "Discard" : "Remove the section"}
            className={cn(iconButtonClass, "h-9 w-9 hover:bg-danger-soft hover:text-danger")}
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <label htmlFor={`${ids}-body`} className="sr-only">
          Section text
        </label>
        <textarea
          id={`${ids}-body`}
          value={section.body}
          onChange={(event) => setEditingState({ ...section, body: event.target.value })}
          onKeyDown={editorKeys}
          autoFocus={!isNew}
          rows={4}
          placeholder="Write anything. Start a line with - for a list, or - [ ] for a checklist."
          className={cn(
            "mt-2 block min-h-24 w-full resize-y rounded-lg border border-line bg-surface px-2.5 py-2 text-ink outline-none [field-sizing:content] placeholder:text-muted focus:border-accent max-sm:text-base",
            style.body,
          )}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void saveSection()} disabled={saving} className={cn(uiPrimaryButtonClass, "h-9 px-3 py-0 max-sm:h-11 max-sm:flex-1")}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => closeEditor(section.index)} disabled={saving} className={cn(uiButtonClass, "h-9 px-3 py-0 max-sm:h-11 max-sm:flex-1")}>
            Cancel
          </button>
          <span className="text-xs text-muted max-sm:hidden">Markdown works here: **bold**, lists, checklists and links.</span>
        </div>
      </div>
    );
  }

  const introField = (
    <div>
      <label htmlFor={introId} className="sr-only">
        Description
      </label>
      <textarea
        id={introId}
        value={intro}
        onChange={(event) => setIntro(event.target.value)}
        onBlur={saveIntro}
        readOnly={!canEdit}
        placeholder={plain ? (canEdit ? "Add a description…" : "No description.") : undefined}
        rows={plain ? 3 : 1}
        className={cn(
          "block w-full resize-y rounded-lg bg-transparent text-ink outline-none [field-sizing:content] placeholder:text-muted focus:ring-2 focus:ring-accent/25",
          variant === "page" ? "text-[0.9375rem] leading-7" : style.body,
          plain && "min-h-24",
        )}
      />
    </div>
  );

  return (
    <div className={cn("grid", style.gap)}>
      {plain || parsed.intro || intro ? introField : null}
      {parsed.sections.map((section, index) => {
        const key = keys[index];
        if (editing && editing.index === index) return <div key={key}>{editor(editing)}</div>;
        const open = !folded(index);
        const progress = checklistProgress(section.body);
        const headingId = `${ids}-heading-${index}`;
        const bodyId = `${ids}-body-${index}`;
        return (
          <section key={key} aria-labelledby={headingId} className="min-w-0">
            <div className="flex items-center gap-1">
              <Heading id={headingId} className="min-w-0 flex-1">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={open ? bodyId : undefined}
                  onClick={() => toggleFold(index)}
                  className={cn(
                    "-ml-1 flex min-h-8 w-full items-center gap-1.5 rounded-lg py-1 pl-1 pr-2 text-left font-semibold text-ink outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent max-sm:min-h-11",
                    style.heading,
                  )}
                >
                  <ChevronRight aria-hidden="true" className={cn("h-4 w-4 shrink-0 text-muted transition-transform motion-reduce:transition-none", open && "rotate-90")} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{section.title}</span>
                  {/* Keeps the count apart from the title in copied text; the layout ignores it. */}
                  {progress.total ? (
                    <>
                      {" "}
                      <ProgressBadge {...progress} />
                    </>
                  ) : null}
                </button>
              </Heading>
              {canEdit ? (
                <button
                  id={`${ids}-edit-${index}`}
                  type="button"
                  onClick={() => startEditing(index)}
                  disabled={editing !== null}
                  aria-label={`Edit ${section.title}`}
                  title="Edit the section"
                  className={iconButtonClass}
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            {open ? (
              <div id={bodyId} className={cn("mt-1 pl-[1.375rem] text-ink", style.body)}>
                {section.body ? (
                  <MarkdownText text={section.body} onCheck={canEdit ? (line, checked) => check(index, line, checked) : undefined} disabled={editing !== null} />
                ) : (
                  <p className="text-muted">Nothing here yet.</p>
                )}
              </div>
            ) : null}
          </section>
        );
      })}
      {editing?.index === "new" ? editor(editing) : null}
      {canEdit && editing === null ? (
        <button
          id={`${ids}-add`}
          type="button"
          onClick={() => setEditing({ index: "new", title: "", body: "" })}
          className="-ml-1 inline-flex min-h-8 w-fit items-center gap-1.5 rounded-lg px-1.5 text-sm font-medium text-muted outline-none transition-colors hover:bg-surface-hover hover:text-accent focus-visible:ring-2 focus-visible:ring-accent max-sm:min-h-11"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add a section
        </button>
      ) : null}
    </div>
  );
}
