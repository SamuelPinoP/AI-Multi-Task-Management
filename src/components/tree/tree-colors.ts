import type { TreeNodeColor } from "./types";

export const TREE_NODE_COLORS = ["blue", "purple", "emerald", "amber", "rose", "slate"] as const;

export const COLOR_LABELS: Record<TreeNodeColor, string> = {
  blue: "Blue",
  purple: "Purple",
  emerald: "Emerald",
  amber: "Amber",
  rose: "Rose",
  slate: "Slate",
};

// The --tree-* tokens in globals.css. Class names are spelled out in full so Tailwind finds them.
export const COLOR_TONES: Record<TreeNodeColor, { fill: string; border: string }> = {
  blue: { fill: "bg-tree-blue", border: "border-tree-blue/35 hover:border-tree-blue/70" },
  purple: { fill: "bg-tree-purple", border: "border-tree-purple/35 hover:border-tree-purple/70" },
  emerald: { fill: "bg-tree-emerald", border: "border-tree-emerald/35 hover:border-tree-emerald/70" },
  amber: { fill: "bg-tree-amber", border: "border-tree-amber/35 hover:border-tree-amber/70" },
  rose: { fill: "bg-tree-rose", border: "border-tree-rose/35 hover:border-tree-rose/70" },
  slate: { fill: "bg-tree-slate", border: "border-tree-slate/35 hover:border-tree-slate/70" },
};

export function asTreeNodeColor(color: string): TreeNodeColor {
  return TREE_NODE_COLORS.includes(color as TreeNodeColor) ? (color as TreeNodeColor) : "blue";
}
