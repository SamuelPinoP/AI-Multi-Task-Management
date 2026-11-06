"use client";

import { Check, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { cleanLabelName, LABEL_COLORS, LABEL_NAME_MAX, labelColorName, type Label } from "@/lib/labels";
import { deleteLabel, labelsInScope, updateLabel, useLabels, type LabelScopeKey } from "./label-store";

/** One label's row: rename in place (saved on Enter or leaving the field), pick a color, or delete it. */
function LabelRow({ label, onDelete }: { label: Label; onDelete: (label: Label) => void }) {
  const [name, setName] = useState(label.name);
  const [saving, setSaving] = useState(false);
  const [loadedName, setLoadedName] = useState(label.name);
  if (label.name !== loadedName) {
    setLoadedName(label.name);
    setName(label.name);
  }

  async function save(change: { name?: string; color?: string }) {
    setSaving(true);
    const error = await updateLabel(label.id, change);
    setSaving(false);
    if (error) {
      toast.error(error);
      setName(label.name);
    }
  }

  function saveName() {
    const cleaned = cleanLabelName(name);
    if (!cleaned) {
      setName(label.name);
      toast.error(`A label needs a name of up to ${LABEL_NAME_MAX} characters.`);
      return;
    }
    if (cleaned !== label.name) void save({ name: cleaned });
  }

  return (
    <li className="flex items-center gap-2 py-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Color of ${label.name}: ${labelColorName(label.color)}`}
          disabled={saving}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ backgroundColor: label.color }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          {LABEL_COLORS.map((color) => (
            <DropdownMenuItem key={color.value} onSelect={() => void save({ color: color.value })}>
              <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ backgroundColor: color.value }} />
              {color.name}
              {label.color === color.value ? (
                <>
                  <Check aria-hidden="true" className="ml-auto" />
                  <span className="sr-only">(current color)</span>
                </>
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={saveName}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape" && name !== label.name) {
            event.stopPropagation();
            setName(label.name);
          }
        }}
        maxLength={LABEL_NAME_MAX}
        aria-label={`Name of ${label.name}`}
        disabled={saving}
        className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm text-ink outline-none hover:border-line focus:border-accent focus:ring-2 focus:ring-accent/25"
      />
      <button
        type="button"
        onClick={() => onDelete(label)}
        aria-label={`Delete ${label.name}`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted outline-none hover:bg-danger-soft hover:text-danger focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
      </button>
    </li>
  );
}

/** Rename, recolor or delete the labels of one project, or the personal ones (#276). */
export function LabelManagerDialog({
  open,
  onOpenChange,
  scope,
  scopeName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: LabelScopeKey;
  scopeName: string;
}) {
  const all = useLabels();
  const labels = labelsInScope(all ?? [], scope);
  const [confirm, setConfirm] = useState<Label | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function remove(label: Label) {
    setDeleting(true);
    const error = await deleteLabel(label.id);
    setDeleting(false);
    setConfirm(null);
    if (error) toast.error(error);
    else toast.success("Label deleted", { description: label.name });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit labels</DialogTitle>
            <DialogDescription>
              {scope === "none" ? "Your personal labels, for tasks outside projects." : `Labels of ${scopeName}, shared with its members.`} Changes apply to every task that has the label.
            </DialogDescription>
          </DialogHeader>
          {labels.length ? (
            <ul className={cn("-mx-2 grid divide-y divide-line", deleting && "opacity-60")}>
              {labels.map((label) => (
                <LabelRow key={label.id} label={label} onDelete={setConfirm} />
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted">
              No labels yet. Create one from a task&rsquo;s Labels menu.
            </p>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm ? `Delete “${confirm.name}”?` : "Delete label?"}
        message="Every task with this label loses it. The tasks themselves stay."
        confirmLabel="Delete label"
        loading={deleting}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void remove(confirm);
        }}
      />
    </>
  );
}
