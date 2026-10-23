"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { currentIndex, moveParentOptions, movePositions, type TreeMove } from "./tree-move";
import type { DeleteIntent, TreeNode, TreePage } from "./types";

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

const selectClass =
  "mt-1.5 w-full rounded-xl border border-line bg-sunken px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/20";

/** "Move to…" (TREE-03): the same moves as dragging, picked from two lists (WCAG 2.5.7). */
export function MoveNodeDialog({
  node,
  nodes,
  onCancel,
  onMove,
}: {
  node: TreeNode;
  nodes: TreeNode[];
  onCancel: () => void;
  onMove: (move: TreeMove) => void;
}) {
  const parents = moveParentOptions(nodes, node.id);
  const [parentId, setParentId] = useState(node.parentId ?? parents[0]?.id ?? "");
  const [index, setIndex] = useState(currentIndex(nodes, node.id));
  const positions = parentId ? movePositions(nodes, node.id, parentId) : [];
  const unchanged = parentId === node.parentId && index === currentIndex(nodes, node.id);

  function chooseParent(next: string) {
    setParentId(next);
    // Back under the current parent, keep the current place; anywhere else, go last.
    setIndex(next === node.parentId ? currentIndex(nodes, node.id) : movePositions(nodes, node.id, next).length - 1);
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!unchanged && parentId) onMove({ nodeId: node.id, parentId, index });
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-xl">Move “{node.title}”</DialogTitle>
            <DialogDescription>Everything under it moves too.</DialogDescription>
          </DialogHeader>
          <label className="block text-sm font-medium text-muted">
            Put it under
            <select value={parentId} onChange={(event) => chooseParent(event.target.value)} className={selectClass}>
              {parents.map((option) => (
                <option key={option.id} value={option.id}>
                  {/* Non-breaking spaces indent each level; an <option> can only hold text. */}
                  {"\u00a0\u00a0\u00a0".repeat(option.depth)}
                  {option.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-muted">
            Position
            <select value={index} onChange={(event) => setIndex(Number(event.target.value))} className={selectClass}>
              {positions.map((position) => (
                <option key={position.index} value={position.index}>
                  {position.label}
                </option>
              ))}
            </select>
          </label>
          <DialogFooter>
            <button type="button" onClick={onCancel} className={uiButtonClass}>
              Cancel
            </button>
            <button type="submit" disabled={unchanged} className={uiPrimaryButtonClass}>
              Move
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
