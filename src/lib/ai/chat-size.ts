// The size of the AI bar's open chat (#308, round 3): 760 × 560 px to start, resized from its top
// edge (400 to 720 px tall) and its top corners (600 to 960 px wide, staying centered, so a corner
// moves both sides). Sizes are in rem, so the Text size setting scales the chat with everything
// else; the pointer gives pixels, which the caller divides by the root font size. The chosen size
// is remembered in the browser, per device.

export type ChatSize = { width: number; height: number };

export const CHAT_SIZE = {
  initial: { width: 47.5, height: 35 },
  minWidth: 37.5,
  maxWidth: 60,
  minHeight: 25,
  maxHeight: 45,
} as const;

/** One press of ↑ or ↓ on the top edge, in rem (24 px at the default text size). */
export const CHAT_SIZE_STEP = 1.5;

/** Where the browser keeps the size (localStorage). */
export const CHAT_SIZE_KEY = "ai-multi-ai-chat-size";

/** Rounds to 1/16 rem, a pixel at the default text size, so saved values stay short. */
function roundRem(rem: number) {
  return Math.round(rem * 16) / 16;
}

function clamp(value: number, min: number, max: number) {
  return roundRem(Math.min(max, Math.max(min, value)));
}

export function clampChatSize(size: ChatSize): ChatSize {
  return {
    width: clamp(size.width, CHAT_SIZE.minWidth, CHAT_SIZE.maxWidth),
    height: clamp(size.height, CHAT_SIZE.minHeight, CHAT_SIZE.maxHeight),
  };
}

/** What's being dragged: the top edge changes the height; a top corner changes the height and the width. */
export type ChatEdge = "top" | "top-left" | "top-right";

/**
 * The size after dragging `edge` by `dx`, `dy` rem from where the drag started (`start`). Up makes
 * it taller. The chat stays centered, so moving a corner by `dx` changes the width by twice that:
 * the left corner grows it leftward, the right one rightward.
 */
export function dragChatSize(edge: ChatEdge, start: ChatSize, dx: number, dy: number): ChatSize {
  const width = edge === "top-left" ? start.width - 2 * dx : edge === "top-right" ? start.width + 2 * dx : start.width;
  return clampChatSize({ width, height: start.height - dy });
}

/**
 * The top edge's keys, after the WAI-ARIA window splitter: ↑ and ↓ step the height by
 * CHAT_SIZE_STEP, Home and End go to the lowest and the tallest, and Enter brings back the size it
 * opens at, like a double-click. Other keys return null.
 */
export function keyChatSize(key: string, size: ChatSize): ChatSize | null {
  switch (key) {
    case "ArrowUp":
      return clampChatSize({ ...size, height: size.height + CHAT_SIZE_STEP });
    case "ArrowDown":
      return clampChatSize({ ...size, height: size.height - CHAT_SIZE_STEP });
    case "Home":
      return { ...size, height: CHAT_SIZE.minHeight };
    case "End":
      return { ...size, height: CHAT_SIZE.maxHeight };
    case "Enter":
      return { ...CHAT_SIZE.initial };
    default:
      return null;
  }
}

/** A saved size read back within the limits, or the size it opens at when it's missing or malformed. */
export function parseChatSize(saved: string | null | undefined): ChatSize {
  try {
    const value = JSON.parse(saved ?? "") as Partial<ChatSize> | null;
    if (value && Number.isFinite(value.width) && Number.isFinite(value.height)) {
      return clampChatSize({ width: value.width as number, height: value.height as number });
    }
  } catch {
    // Not JSON: the default below.
  }
  return { ...CHAT_SIZE.initial };
}
