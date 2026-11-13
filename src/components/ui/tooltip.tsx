"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A name beside an icon-only control (#414): the sidebar's icon rail and the Chats photo column.
 * It shows on hover after a short pause, and at once on keyboard focus. The control keeps its own
 * accessible name, so the tooltip is hidden from screen readers. It's drawn in a portal, so a
 * scrolling rail doesn't clip it, and Escape, a click, scrolling or resizing hides it (WCAG 1.4.13).
 *
 * Wrap one control (a component may render hidden helpers beside it); the tooltip sits to its right.
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const wrapper = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<{ rect: DOMRect; instant: boolean } | null>(null);

  useEffect(() => {
    if (!shown) return;
    const hide = () => setShown(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [shown]);

  function show(target: EventTarget, instant: boolean) {
    const box = wrapper.current;
    // Events from portals bubble through React, so an open menu's own items don't count as the control.
    if (!box || !(target instanceof Node) || !box.contains(target)) return;
    const control = [...box.children].find((element) => element.getClientRects().length > 0);
    if (control) setShown({ rect: control.getBoundingClientRect(), instant });
  }

  return (
    <span
      ref={wrapper}
      className="contents"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") show(event.target, false);
      }}
      onPointerLeave={() => setShown(null)}
      onPointerDown={() => setShown(null)}
      onFocus={(event) => {
        if (event.target.matches(":focus-visible")) show(event.target, true);
      }}
      onBlur={() => setShown(null)}
    >
      {children}
      {shown
        ? createPortal(
            <span
              aria-hidden="true"
              data-tooltip=""
              className="pointer-events-none fixed z-[60] flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-surface shadow-lg [animation:ui-tooltip-in_120ms_ease-out_both]"
              style={{ left: shown.rect.right + 10, top: shown.rect.top + shown.rect.height / 2, animationDelay: shown.instant ? "0ms" : "250ms" }}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

/** A key hint inside a tooltip, such as N for New task. */
export function TooltipKey({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-current px-1 font-mono text-2xs leading-4 opacity-75">{children}</kbd>;
}

/** The quieter second part of a tooltip, such as "2 new". */
export function TooltipDetail({ children }: { children: ReactNode }) {
  return <span className="opacity-70">{children}</span>;
}
