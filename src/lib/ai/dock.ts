// Where the AI bar is on a person's pages (#308): at the bottom of every page, minimized to a ✦
// button, or hidden (it then waits on the AI page). Saved per account in User.aiDock, so it's the
// same on every device. No server imports: the shell and the AI page use these names too.
import type { AiDockState } from "@prisma/client";
import { z } from "zod";

export const AI_DOCKS = ["open", "minimized", "hidden"] as const;

export type AiDock = (typeof AI_DOCKS)[number];

/** PUT /api/agent/dock's body. */
export const aiDockRequestSchema = z.strictObject({ dock: z.enum(AI_DOCKS) });

const STORED: Record<AiDock, AiDockState> = { open: "OPEN", minimized: "MINIMIZED", hidden: "HIDDEN" };

/** The saved state as the app shows it. Never chosen (null) shows the bar. */
export function aiDockFromStored(value: AiDockState | null | undefined): AiDock {
  if (value === "MINIMIZED") return "minimized";
  if (value === "HIDDEN") return "hidden";
  return "open";
}

export function aiDockToStored(dock: AiDock): AiDockState {
  return STORED[dock];
}
