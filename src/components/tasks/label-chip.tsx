import { cn } from "@/lib/cn";
import type { Label } from "@/lib/labels";

/** A label as a small chip: a color dot and the name, so it never depends on color alone (#276). */
export function LabelChip({ label, className }: { label: Pick<Label, "name" | "color">; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-40 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-xs font-medium text-ink",
        className,
      )}
    >
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

/** Up to `max` chips, then "+N" with the rest named for screen readers and in the tooltip. */
export function LabelChips({ labels, max = 2, className }: { labels: Label[]; max?: number; className?: string }) {
  if (!labels.length) return null;
  const shown = labels.slice(0, max);
  const rest = labels.slice(max);
  return (
    <span className={cn("flex min-w-0 shrink-0 items-center gap-1", className)}>
      <span className="sr-only">Labels: </span>
      {shown.map((label) => (
        <LabelChip key={label.id} label={label} />
      ))}
      {rest.length ? (
        <span title={rest.map((label) => label.name).join(", ")} className="shrink-0 text-xs font-medium text-muted">
          <span aria-hidden="true">+{rest.length}</span>
          <span className="sr-only">and {rest.map((label) => label.name).join(", ")}</span>
        </span>
      ) : null}
    </span>
  );
}
