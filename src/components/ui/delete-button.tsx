import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * The delete button (CAL-02): a trash can whose lid lifts on hover, a soft red
 * that fills on hover with a light sweep, press feedback and a spinner while
 * the request runs. Motion only plays when the user hasn't asked for less.
 *
 * - "soft" (default) sits quietly on cards and in forms.
 * - "solid" is the confirming button in a dialog.
 *
 * Colors meet 4.5:1 in both themes: white on --danger in light mode, the dark
 * canvas on the lighter dark-mode --danger.
 */
type DeleteButtonProps = ComponentProps<"button"> & {
  variant?: "soft" | "solid";
  size?: "sm" | "md";
  /** Shows the spinner and `loadingLabel`, and disables the button. */
  loading?: boolean;
  loadingLabel?: string;
  /** The trash icon; off for confirmations that don't delete anything. */
  icon?: boolean;
};

const variants = {
  soft: "border border-danger/25 bg-danger-soft text-danger hover:border-danger hover:bg-danger hover:text-white hover:shadow-lg hover:shadow-danger/25 dark:hover:text-canvas",
  solid: "border border-danger bg-danger text-white shadow-md shadow-danger/20 hover:shadow-lg hover:shadow-danger/35 dark:text-canvas",
} as const;

const sizes = {
  sm: "h-7 gap-1 rounded-full px-2.5 text-xs [&_svg]:h-3.5 [&_svg]:w-3.5",
  md: "h-9 gap-1.5 rounded-lg px-4 text-sm [&_svg]:h-4 [&_svg]:w-4",
} as const;

/** Lucide's Trash2, with the lid in its own group so it can lift. */
function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 overflow-visible">
      <g className="origin-bottom-left transition-[translate,rotate] duration-200 ease-out [transform-box:fill-box] motion-safe:group-hover/delete:-translate-y-[2px] motion-safe:group-hover/delete:-rotate-[14deg] motion-safe:group-focus-visible/delete:-translate-y-[2px] motion-safe:group-focus-visible/delete:-rotate-[14deg]">
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </g>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="shrink-0 motion-safe:animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.25} strokeWidth={3} />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

export function DeleteButton({
  variant = "soft",
  size = "md",
  loading = false,
  loadingLabel = "Deleting...",
  icon = true,
  disabled,
  className,
  children = "Delete",
  type = "button",
  ...props
}: DeleteButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "group/delete relative isolate inline-flex shrink-0 select-none items-center justify-center overflow-hidden whitespace-nowrap font-semibold",
        "transition-[background-color,border-color,color,box-shadow,translate,scale] duration-200 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger",
        "motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0 motion-safe:active:scale-[0.96]",
        // A light sweep across the button on hover.
        "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:-translate-x-full before:bg-linear-to-r before:from-transparent before:via-white/25 before:to-transparent motion-safe:before:transition-transform motion-safe:before:duration-500 motion-safe:hover:before:translate-x-full",
        "disabled:pointer-events-none disabled:opacity-60",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : icon ? <TrashIcon /> : null}
      {loading ? loadingLabel : children}
    </button>
  );
}
