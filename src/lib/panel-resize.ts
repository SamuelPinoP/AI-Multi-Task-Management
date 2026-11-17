/**
 * Panels resized by dragging their right edge (#414): the sidebar, the Chats list, and the
 * AI page's list of chats (#308). Widths are in rem, so the Text size setting scales them
 * with everything else; the pointer gives pixels, which the edge divides by the root font size.
 *
 * Dragged past its narrowest open width, a panel that can collapse snaps to its collapsed
 * width (the sidebar's icon rail, the Chats list's photo column), as VS Code collapses a
 * panel. One without a collapsed width stops at its narrowest.
 */

export type PanelLimits = {
  /** The narrowest open width, in rem. */
  min: number;
  /** The widest, in rem. */
  max: number;
  /** The width it opens at, and what a double-click on the edge restores, in rem. */
  initial: number;
  /** The width when collapsed, in rem. Leave it out for a panel that never collapses. */
  collapsed?: number;
};

/** The sidebar (#415): 224 px by default; 176 px still shows "AI Multi" beside the logo and Collapse. */
export const SIDEBAR_LIMITS = { min: 11, max: 22.5, initial: 14, collapsed: 3.5 } satisfies PanelLimits;

/** The Chats list (#416): 310 px by default (design 2B), 240 to 480 px, or a 72 px column of photos. */
export const CHAT_LIST_LIMITS = { min: 15, max: 30, initial: 19.375, collapsed: 4.5 } satisfies PanelLimits;

/** The AI page's list of chats (#308, round 3): 264 px by default, 220 to 360 px; it never collapses. */
export const AI_CHAT_LIST_LIMITS: PanelLimits = { min: 13.75, max: 22.5, initial: 16.5 };

/** Cookie that remembers the width the AI page's list of chats was dragged to, in rem. */
export const AI_CHAT_LIST_WIDTH_COOKIE = "ai-chats-width";

/** Where a panel is: its open width, and whether it's collapsed (the width comes back when it opens). */
export type PanelSize = { width: number; collapsed: boolean };

/** One press of an arrow key on the edge, in rem (16 px at the default text size). */
export const KEYBOARD_STEP = 1;

/** Rounds to 1/16 rem, a pixel at the default text size, so cookie values stay short. */
export function roundRem(rem: number) {
  return Math.round(rem * 16) / 16;
}

export function clampWidth(rem: number, limits: PanelLimits) {
  return roundRem(Math.min(limits.max, Math.max(limits.min, rem)));
}

/**
 * The width it collapses at: halfway between the collapsed width and the narrowest open one.
 * A panel that never collapses has none.
 */
export function snapPoint(limits: PanelLimits) {
  return limits.collapsed === undefined ? null : (limits.collapsed + limits.min) / 2;
}

/**
 * Where dragging the edge to `pointer` (rem from the panel's left side) leaves the panel.
 * Short of the snap point it collapses, keeping `restore` (the width the drag started from)
 * for when it opens again; beyond it, the panel follows the pointer between min and max.
 */
export function dragTo(pointer: number, limits: PanelLimits, restore: number): PanelSize {
  const snap = snapPoint(limits);
  if (snap !== null && pointer < snap) return { width: restore, collapsed: true };
  return { width: clampWidth(pointer, limits), collapsed: false };
}

/**
 * The edge's keys, after the WAI-ARIA window splitter: ← and → step by KEYBOARD_STEP (← at the
 * narrowest collapses, → when collapsed opens at the narrowest), Home collapses, End opens it all
 * the way, and Enter collapses or brings back the width it had. Other keys return null.
 *
 * A panel that never collapses stops at its narrowest instead: Home goes there, and Enter brings
 * back the width it opens at, like a double-click.
 */
export function keyTo(key: string, size: PanelSize, limits: PanelLimits): PanelSize | null {
  if (limits.collapsed === undefined) {
    switch (key) {
      case "ArrowLeft":
        return { width: clampWidth(size.width - KEYBOARD_STEP, limits), collapsed: false };
      case "ArrowRight":
        return { width: clampWidth(size.width + KEYBOARD_STEP, limits), collapsed: false };
      case "Home":
        return { width: limits.min, collapsed: false };
      case "End":
        return { width: limits.max, collapsed: false };
      case "Enter":
        return { width: limits.initial, collapsed: false };
      default:
        return null;
    }
  }
  switch (key) {
    case "ArrowLeft":
      if (size.collapsed) return null;
      if (size.width <= limits.min) return { width: size.width, collapsed: true };
      return { width: clampWidth(size.width - KEYBOARD_STEP, limits), collapsed: false };
    case "ArrowRight":
      if (size.collapsed) return { width: limits.min, collapsed: false };
      return { width: clampWidth(size.width + KEYBOARD_STEP, limits), collapsed: false };
    case "Home":
      return { width: size.width, collapsed: true };
    case "End":
      return { width: limits.max, collapsed: false };
    case "Enter":
      return { width: size.width, collapsed: !size.collapsed };
    default:
      return null;
  }
}

/** A width cookie's value, or the initial width when it's missing or malformed. */
export function parseWidth(value: string | undefined, limits: PanelLimits) {
  const rem = Number(value);
  return value && Number.isFinite(rem) ? clampWidth(rem, limits) : limits.initial;
}

/** What the panel shows as its width right now, in rem. */
export function shownWidth(size: PanelSize, limits: PanelLimits) {
  return size.collapsed && limits.collapsed !== undefined ? limits.collapsed : size.width;
}

const COOKIE_OPTIONS = "path=/; max-age=31536000; samesite=lax";

/** Remembers a panel's state for a year, so the server renders it the same way next time. */
export function savePanelCookies(widthCookie: string, collapsedCookie: string, size: PanelSize) {
  document.cookie = `${widthCookie}=${size.width}; ${COOKIE_OPTIONS}`;
  document.cookie = `${collapsedCookie}=${size.collapsed ? "1" : "0"}; ${COOKIE_OPTIONS}`;
}

/** The same for a panel that never collapses: only its width. */
export function savePanelWidthCookie(widthCookie: string, width: number) {
  document.cookie = `${widthCookie}=${width}; ${COOKIE_OPTIONS}`;
}
