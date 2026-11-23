"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { CLICK_SLOP_PX, clickTo, dragTo, keyTo, shownWidth, type PanelLimits, type PanelSize } from "@/lib/panel-resize";

/**
 * The draggable right edge of a resizable panel (#414), a focusable separator after the WAI-ARIA
 * window splitter: drag it to resize, click it to collapse or open the panel, or use ← → Home End
 * and Enter. Put it inside the panel, which must be `relative`; it straddles the panel's right border.
 * Panels whose limits have no collapsed width never collapse, and a click does nothing there.
 *
 * `onResize` gets every new size while dragging (`done` false) and the final one (`done` true),
 * when the caller saves it.
 */
export function ResizeHandle({
  label,
  controls,
  size,
  limits,
  collapsedText,
  onResize,
  className,
}: {
  /** The separator's name, e.g. "Resize sidebar". */
  label: string;
  /** The id of the panel it resizes. */
  controls: string;
  size: PanelSize;
  limits: PanelLimits;
  /** What screen readers hear for the collapsed state, e.g. "Icons only"; only for panels that collapse. */
  collapsedText?: string;
  onResize: (size: PanelSize, done: boolean) => void;
  className?: string;
}) {
  const drag = useRef<{ left: number; startX: number; moved: boolean; rootPx: number; restore: number; last: PanelSize } | null>(null);
  // Whether the press that just ended was a drag, so the click that follows it doesn't also toggle.
  const dragged = useRef(false);
  const frame = useRef(0);
  const toggled = clickTo(size, limits);

  // A drag cut short (the panel unmounts, say on a route change) still lets go of the page.
  useEffect(
    () => () => {
      window.cancelAnimationFrame(frame.current);
      delete document.documentElement.dataset.panelResizing;
    },
    [],
  );

  function start(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const panel = event.currentTarget.parentElement;
    if (!panel) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragged.current = false;
    drag.current = {
      left: panel.getBoundingClientRect().left,
      startX: event.clientX,
      moved: false,
      rootPx: Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
      restore: size.width,
      last: size,
    };
    // No width animation while following the pointer, and the resize pointer everywhere.
    panel.dataset.resizing = "";
    document.documentElement.dataset.panelResizing = "";
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    // A press that stays within a few pixels is a click; the panel only follows once it's a drag.
    if (!current.moved) {
      if (Math.abs(event.clientX - current.startX) < CLICK_SLOP_PX) return;
      current.moved = true;
    }
    const next = dragTo((event.clientX - current.left) / current.rootPx, limits, current.restore);
    if (next.width === current.last.width && next.collapsed === current.last.collapsed) return;
    current.last = next;
    // One update per frame, however fast the pointer reports.
    window.cancelAnimationFrame(frame.current);
    frame.current = window.requestAnimationFrame(() => onResize(next, false));
  }

  function end(event: React.PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    dragged.current = current.moved;
    window.cancelAnimationFrame(frame.current);
    delete event.currentTarget.parentElement?.dataset.resizing;
    delete document.documentElement.dataset.panelResizing;
    if (current.moved) onResize(current.last, true);
  }

  /**
   * A click without a drag collapses the panel or opens it again (Samuel, November 21: "a simple
   * click is enough"). A double-click counts once, so it doesn't close what its first click opened.
   */
  function click(event: React.MouseEvent<HTMLDivElement>) {
    const wasDrag = dragged.current;
    dragged.current = false;
    if (wasDrag || event.detail > 1 || !toggled) return;
    onResize(toggled, true);
  }

  const px = (rem: number) => Math.round(rem * 16);
  const now = shownWidth(size, limits);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={px(limits.collapsed ?? limits.min)}
      aria-valuemax={px(limits.max)}
      aria-valuenow={px(now)}
      aria-valuetext={size.collapsed && collapsedText ? collapsedText : `${px(now)} pixels wide`}
      tabIndex={0}
      title={toggled ? `Drag to resize. Click to ${size.collapsed ? "expand" : "collapse"}.` : "Drag to resize."}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onClick={click}
      onKeyDown={(event) => {
        const next = keyTo(event.key, size, limits);
        if (!next) return;
        event.preventDefault();
        onResize(next, true);
      }}
      className={cn(
        // 8 px to grab, centred on the border; the accent line shows on hover, focus and while dragging.
        "group absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-[0.1875rem] w-0.5 bg-transparent transition-colors delay-100 duration-150 group-hover:bg-accent group-focus-visible:bg-accent group-active:bg-accent group-active:delay-0"
      />
    </div>
  );
}
