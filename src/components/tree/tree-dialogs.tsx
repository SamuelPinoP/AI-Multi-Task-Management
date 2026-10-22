"use client";

import { useRef } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DeleteIntent, TreePage } from "./types";

export function NewTreePageDialog({
  title,
  error,
  loading,
  onTitleChange,
  onCancel,
  onCreate,
}: {
  title: string;
  error: string;
  loading: boolean;
  onTitleChange: (value: string) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canCreate = title.trim().length > 0 && !loading;

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !loading) onCancel(); }}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          // Select the suggested name, so typing replaces it.
          event.preventDefault();
          inputRef.current?.select();
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canCreate) onCreate();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-xl">New tree page</DialogTitle>
            <DialogDescription>Name the page that will hold this tree and its root node.</DialogDescription>
          </DialogHeader>
          <div>
            <input
              ref={inputRef}
              aria-label="Tree page name"
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              className="w-full rounded-xl border border-line bg-sunken px-4 py-3 text-base font-semibold text-ink outline-none transition focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/20"
              placeholder="Tree page name"
            />
            {error ? <p className="mt-2 text-sm text-warning">{error}</p> : null}
          </div>
          <DialogFooter>
            <button type="button" onClick={onCancel} disabled={loading} className={uiButtonClass}>
              Cancel
            </button>
            <button type="submit" disabled={!canCreate} className={uiPrimaryButtonClass}>
              {loading ? "Creating…" : "Create"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteTreePageDialog({
  page,
  loading,
  onCancel,
  onConfirm,
}: {
  page: TreePage;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open
      title="Delete this tree page?"
      message={`“${page.title}” and all nodes inside that tree page will be deleted. This action cannot be undone.`}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function DeleteNodeDialog({
  intent,
  loading,
  onCancel,
  onConfirm,
}: {
  intent: DeleteIntent;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const message = intent.message ?? "This node will be removed from the tree.";
  return (
    <ConfirmDialog
      open
      title={`Delete “${intent.node.title}”?`}
      message={intent.hasChildren || intent.hasSiblings ? `${message} This action cannot be undone.` : message}
      confirmLabel="Delete node"
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
