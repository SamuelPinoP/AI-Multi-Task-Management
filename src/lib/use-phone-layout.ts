"use client";

import { useSyncExternalStore } from "react";
import { PHONE_LAYOUT_QUERY } from "@/lib/workspace-events";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE_LAYOUT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True below 640px, where the Tasks page uses its phone layout (#521, design 2A), the same width as
 * Tailwind's `max-sm:`. For what CSS alone can't switch: which row to draw, and which menu items
 * to offer. The server renders the computer's layout; the page swaps on its first render in the
 * browser, before its tasks have loaded.
 */
export function usePhoneLayout() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_LAYOUT_QUERY).matches,
    () => false,
  );
}
