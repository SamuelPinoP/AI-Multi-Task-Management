"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CornerDownRight, GripVertical } from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { asTreeNodeColor, COLOR_LABELS, COLOR_TONES, TREE_NODE_COLORS } from "./tree-colors";
import type { DropTarget } from "./tree-move";
import type { CreateIntent, NestedNode, TreeNode, TreeNodeColor } from "./types";

const MIN_WIDTH = 180;
const MAX_WIDTH = 520;
const MIN_HEIGHT = 140;
const MAX_HEIGHT = 420;

function clampSize(width: number, height: number) {
  return {
    width: Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH),
    height: Math.min(Math.max(height, MIN_HEIGHT), MAX_HEIGHT),
  };
}

/** One node's card, then its children in a row below it, joined by connector lines. */
export function TreeNodeRow({
  node,
  draggingId,
  dropTarget,
  createIntent,
  onCreateIntent,
  onCreateNode,
  onRename,
  onColorChange,
  onDescriptionChange,
  onResize,
  onDelete,
  onMoveRequest,
}: {
  node: NestedNode;
  draggingId: string | null;
  dropTarget: DropTarget | null;
  createIntent: CreateIntent | null;
  onCreateIntent: (intent: CreateIntent | null) => void;
  onCreateNode: (intent: CreateIntent, title: string) => Promise<void>;
  onRename: (node: TreeNode, title: string) => Promise<void>;
  onColorChange: (node: TreeNode, color: TreeNodeColor) => Promise<void>;
  onDescriptionChange: (node: TreeNode, description: string) => Promise<void>;
  onResize: (node: TreeNode, width: number, height: number) => Promise<void>;
  onDelete: (node: TreeNode) => void;
  onMoveRequest: (node: TreeNode) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.title);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(node.description ?? "");
  const [sizeDraft, setSizeDraft] = useState({
    width: node.width || 240,
    height: node.height || 160,
  });
  const isRoot = node.parentId === null;
  // The handle drags the node with its subtree; the whole card is a place to drop (TREE-02).
  // The API never moves the root, so it has no handle.
  const { attributes: handleAttributes, listeners: handleListeners, setNodeRef: setHandleRef } = useDraggable({
    id: node.id,
    disabled: isRoot,
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: node.id });
  const dropZone = dropTarget?.nodeId === node.id ? dropTarget.zone : null;
  async function save() {
    const title = draft.trim();
    setEditing(false);
    if (title && title !== node.title) await onRename(node, title);
    else setDraft(node.title);
  }
  async function saveDescription() {
    setEditingDescription(false);
    if (descriptionDraft.trim() !== (node.description ?? "")) {
      await onDescriptionChange(node, descriptionDraft);
    }
  }
  function beginResize(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = sizeDraft.width;
    const startHeight = sizeDraft.height;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      setSizeDraft(clampSize(startWidth + moveEvent.clientX - startX, startHeight + moveEvent.clientY - startY));
    };
    const handleUp = (upEvent: globalThis.PointerEvent) => {
      target.releasePointerCapture(upEvent.pointerId);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      const size = clampSize(startWidth + upEvent.clientX - startX, startHeight + upEvent.clientY - startY);
      setSizeDraft(size);
      void onResize(node, size.width, size.height);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  const nodeColor = asTreeNodeColor(node.color);
  const tone = COLOR_TONES[nodeColor];
  // Root cards are filled with the node color and carry white text; the others are surfaces with a colored edge.
  const cardTone = isRoot
    ? `${tone.fill} border-transparent text-white`
    : `bg-surface text-ink dark:shadow-none ${tone.border}`;
  const ringTone =
    dropZone === "child"
      ? "ring-2 ring-accent ring-offset-2 ring-offset-canvas"
      : isRoot
        ? "ring-1 ring-black/5 dark:ring-white/10"
        : "ring-1 ring-transparent";
  const activeCreate = createIntent?.anchorNodeId === node.id ? createIntent : null;

  return (
    <div
      className={`relative flex shrink-0 flex-col items-center transition-opacity ${draggingId === node.id ? "opacity-40" : ""}`}
    >
      <article
        ref={setDropRef}
        style={{
          width: `clamp(220px, calc(100vw - 3rem), ${sizeDraft.width}px)`,
          minHeight: sizeDraft.height,
        }}
        className={`group relative flex flex-col overflow-visible rounded-2xl border p-3 shadow-lg shadow-zinc-900/5 transition-[border,box-shadow,transform] duration-200 sm:p-4 ${cardTone} ${ringTone}`}
      >
        {isRoot ? null : (
          <span className={`absolute inset-x-0 top-0 h-1.5 rounded-t-2xl ${tone.fill}`} aria-hidden="true" />
        )}
        {dropZone === "before" || dropZone === "after" ? (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-2 w-1 rounded-full bg-accent ring-4 ring-accent/20 ${dropZone === "before" ? "-left-3" : "-right-3"}`}
          />
        ) : null}
        {isRoot ? null : (
          <button
            ref={setHandleRef}
            type="button"
            {...handleAttributes}
            {...handleListeners}
            aria-label={`Move ${node.title}`}
            title="Drag to move this node and everything under it"
            className="absolute left-2 top-2 z-10 flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded-xl text-muted transition hover:bg-surface-hover hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent/40 active:cursor-grabbing"
          >
            <GripVertical aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-xl border border-danger/30 bg-surface text-sm font-bold text-danger shadow-sm transition hover:bg-danger-soft focus:outline-none focus:ring-2 focus:ring-danger/40"
          title={isRoot ? "Delete tree page" : "Delete node"}
          aria-label={isRoot ? "Delete tree page" : "Delete node"}
          onClick={() => onDelete(node)}
        >
          ×
        </button>
        <div className={`flex items-start justify-between gap-3 pr-6 ${isRoot ? "" : "pl-6"}`}>
          <div className="min-w-0 flex-1 text-center">
            {editing ? (
              <input
                autoFocus
                aria-label="Node title"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => void save()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void save();
                  if (event.key === "Escape") {
                    setDraft(node.title);
                    setEditing(false);
                  }
                }}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-center text-base font-semibold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraft(node.title);
                  setEditing(true);
                }}
                className={`line-clamp-2 min-h-12 w-full rounded-xl px-2 py-1 text-center text-base font-bold leading-snug tracking-tight transition focus:outline-none focus:ring-2 ${isRoot ? "text-white hover:bg-white/10 focus:ring-white/50" : "text-ink hover:bg-surface-hover focus:ring-accent/40"}`}
                title="Click to edit"
              >
                {node.title}
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex-1">
          {editingDescription ? (
            <textarea
              autoFocus
              aria-label="Node description"
              value={descriptionDraft}
              onChange={(event) => setDescriptionDraft(event.target.value)}
              onBlur={() => void saveDescription()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setDescriptionDraft(node.description ?? "");
                  setEditingDescription(false);
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void saveDescription();
              }}
              className="min-h-16 w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm leading-5 text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
              placeholder="Description..."
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setDescriptionDraft(node.description ?? "");
                setEditingDescription(true);
              }}
              className={`min-h-10 w-full rounded-xl px-3 py-2 text-left text-sm leading-5 transition focus:outline-none focus:ring-2 ${isRoot ? "text-white hover:bg-white/10 focus:ring-white/50" : "text-muted hover:bg-surface-hover focus:ring-accent/40"}`}
            >
              {node.description?.trim() ? node.description : "Description..."}
            </button>
          )}
        </div>
        <div className="mt-auto flex flex-wrap justify-center gap-1.5 pt-4">
          <button
            type="button"
            className={iconButtonClass}
            title="Add child"
            aria-label="Add child"
            onClick={() =>
              onCreateIntent({
                parentId: node.id,
                fallback: "Child node",
                inheritColor: nodeColor,
                anchorNodeId: node.id,
                mode: "child",
              })
            }
          >
            +
          </button>
          {!isRoot && (
            <button
              type="button"
              className={siblingButtonClass}
              title="Add sibling"
              aria-label="Add sibling"
              onClick={() =>
                onCreateIntent({
                  parentId: node.parentId,
                  fallback: "Sibling node",
                  sortOrder: node.sortOrder + 1,
                  inheritColor: nodeColor,
                  anchorNodeId: node.id,
                  mode: "sibling",
                })
              }
            >
              <span aria-hidden="true" className="text-xs leading-none">⎇</span>
              <span>Sibling</span>
            </button>
          )}
          {!isRoot && (
            <button
              type="button"
              className={iconButtonClass}
              title="Move to…"
              aria-label="Move to…"
              onClick={() => onMoveRequest(node)}
            >
              <CornerDownRight aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPaletteOpen((open) => !open)}
              aria-expanded={paletteOpen}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm transition hover:scale-105 focus:outline-none focus:ring-2 ${isRoot ? "border-white/40 bg-white/15 focus:ring-white/50" : "border-line bg-surface focus:ring-accent/40"}`}
              title="Change node color"
              aria-label="Change node color"
            >
              <span className={`h-4 w-4 rounded-full ring-1 ring-white/60 ${tone.fill}`} />
            </button>
            {paletteOpen && (
              <ColorPalette
                selected={nodeColor}
                onSelect={(color) => {
                  setPaletteOpen(false);
                  void onColorChange(node, color);
                }}
              />
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label="Resize node"
          title="Resize node"
          onPointerDown={beginResize}
          className={`absolute bottom-1.5 right-1.5 h-4 w-4 rounded-br-[0.9rem] border-b-2 border-r-2 opacity-70 transition hover:opacity-100 ${isRoot ? "border-white/60 hover:border-white" : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-600 dark:hover:border-zinc-300"}`}
        />
        {activeCreate && (
          <CreateNodePopover
            key={`${activeCreate.anchorNodeId}-${activeCreate.mode}-${activeCreate.sortOrder ?? "child"}`}
            intent={activeCreate}
            onCreate={onCreateNode}
            onCancel={() => onCreateIntent(null)}
          />
        )}
      </article>
      {node.children.length > 0 && (
        <div className="relative mt-12 flex items-start justify-center gap-6 pt-6 sm:gap-8">
          <span className={`absolute -top-12 left-1/2 h-12 w-px -translate-x-1/2 ${connectorClass}`} aria-hidden="true" />
          <span
            className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-zinc-300 dark:border-zinc-700"
            aria-hidden="true"
          />
          {node.children.length > 1 && (
            <span className={`absolute left-[calc(7.5rem)] right-[calc(7.5rem)] top-0 h-px ${connectorClass}`} aria-hidden="true" />
          )}
          {node.children.map((child) => (
            <div key={child.id} className="relative flex justify-center">
              <span className={`absolute -top-6 left-1/2 h-6 w-px -translate-x-1/2 ${connectorClass}`} aria-hidden="true" />
              <TreeNodeRow
                node={child}
                draggingId={draggingId}
                dropTarget={dropTarget}
                createIntent={createIntent}
                onCreateIntent={onCreateIntent}
                onCreateNode={onCreateNode}
                onRename={onRename}
                onColorChange={onColorChange}
                onDescriptionChange={onDescriptionChange}
                onResize={onResize}
                onDelete={onDelete}
                onMoveRequest={onMoveRequest}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** What follows the pointer while dragging: the node's title and how many nodes come along. */
export function DragPreview({ node, carried }: { node: TreeNode; carried: number }) {
  const tone = COLOR_TONES[asTreeNodeColor(node.color)];
  return (
    <div className="flex w-max max-w-64 cursor-grabbing items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink shadow-2xl shadow-zinc-950/20">
      <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${tone.fill}`} />
      <span className="truncate">{node.title}</span>
      {carried > 0 ? (
        <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
          +{carried} {carried === 1 ? "node" : "nodes"}
        </span>
      ) : null}
    </div>
  );
}

function CreateNodePopover({
  intent,
  onCreate,
  onCancel,
}: {
  intent: CreateIntent;
  onCreate: (intent: CreateIntent, title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(intent.fallback);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.select());
  }, []);
  async function submit() {
    const next = title.trim();
    if (next) await onCreate(intent, next);
  }
  const label = `Create ${intent.mode === "child" ? "child" : "sibling"}`;
  return (
    <div className="absolute left-1/2 top-[calc(100%+0.75rem)] z-30 w-64 -translate-x-1/2 rounded-2xl border border-line bg-raised p-3 text-left text-ink shadow-raised">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <input
        ref={inputRef}
        aria-label={`${label}: title`}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
          if (event.key === "Escape") onCancel();
        }}
        className="w-full rounded-xl border border-line bg-sunken px-3 py-2 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/30"
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted transition hover:bg-surface-hover hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink shadow-sm transition-colors hover:bg-accent-hover"
        >
          Create
        </button>
      </div>
    </div>
  );
}

function ColorPalette({ selected, onSelect }: { selected: TreeNodeColor; onSelect: (color: TreeNodeColor) => void }) {
  return (
    <div className="absolute right-0 top-9 z-40 grid w-44 grid-cols-3 gap-2 rounded-2xl border border-line bg-raised p-2 shadow-raised">
      {TREE_NODE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onSelect(color)}
          title={COLOR_LABELS[color]}
          aria-label={COLOR_LABELS[color]}
          aria-pressed={selected === color}
          className={`flex h-9 items-center justify-center rounded-xl border transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-accent/40 ${selected === color ? "border-ink ring-2 ring-zinc-300 dark:ring-zinc-600" : "border-line"}`}
        >
          <span className={`h-5 w-5 rounded-full ${COLOR_TONES[color].fill}`} />
        </button>
      ))}
    </div>
  );
}

const connectorClass = "bg-zinc-300 dark:bg-zinc-700";

const iconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-sm font-bold text-ink shadow-sm transition hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent/40";

const siblingButtonClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-bold text-ink shadow-sm transition hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent/40";
