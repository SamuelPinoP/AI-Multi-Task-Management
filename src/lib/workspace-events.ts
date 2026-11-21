import { guestRefusalReason, type GuestSignupReason } from "@/lib/guest-limits-core";
import type { Priority } from "@/lib/priority";

/**
 * Window events that keep the app shell's sidebar counts in sync with changes
 * made on a page (the shell refetches /api/workspace-nav when they fire).
 */
export const WORKSPACE_CHANGED_EVENT = "workspace:changed";

/** Fired by the shell's New task dialog, so the Tasks page can refetch. */
export const TASK_CREATED_EVENT = "workspace:task-created";

/**
 * What the New task pop-up can start with: the project it's added from, or what the phone's add
 * sheet already holds when its "More details" opens the full form (#521).
 */
export type NewTaskDraft = {
  projectId?: string;
  title?: string;
  dueDate?: string;
  priority?: Priority;
  assigneeId?: string;
  labelIds?: string[];
};

/** Asks the shell to open its New task pop-up (#362), optionally with a draft: `detail: NewTaskDraft`. */
export const OPEN_NEW_TASK_EVENT = "workspace:open-new-task";

export function openNewTask(draft: NewTaskDraft = {}) {
  window.dispatchEvent(new CustomEvent(OPEN_NEW_TASK_EVENT, { detail: draft }));
}

/**
 * Opens the Tasks page's quick add (#520, #521): on a computer it puts the cursor in the add box,
 * on a phone it opens the add box as a sheet. A project's + or "New task in …" picks that project
 * first (`detail: { projectId }`, where "" means no project); the phone's + picks none.
 */
export const QUICK_ADD_IN_PROJECT_EVENT = "workspace:quick-add-in-project";

export function quickAddInProject(projectId?: string) {
  window.dispatchEvent(new CustomEvent<{ projectId?: string }>(QUICK_ADD_IN_PROJECT_EVENT, { detail: { projectId } }));
}

/** Below 640px the Tasks page is laid out for phones (#521, design 2A), as Tailwind's `max-sm:`. */
export const PHONE_LAYOUT_QUERY = "(width < 40rem)";

/** Asks the shell to open search, the Ctrl+K pop-up (#410): Home's search button does. */
export const OPEN_SEARCH_EVENT = "workspace:open-search";

export function openSearch() {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}

/** Asks the shell to open the guest's sign-up pop-up (#458), saying why: `detail` is a GuestSignupReason. */
export const OPEN_GUEST_SIGNUP_EVENT = "workspace:open-guest-signup";

export function openGuestSignup(reason: GuestSignupReason = "signup") {
  window.dispatchEvent(new CustomEvent<GuestSignupReason>(OPEN_GUEST_SIGNUP_EVENT, { detail: reason }));
}

/**
 * When an API answer says a guest reached a limit or needs an account, opens the sign-up pop-up
 * instead of an error message, and says so; false for any other answer.
 */
export function openGuestSignupFor(body: unknown) {
  const reason = guestRefusalReason(body);
  if (!reason) return false;
  openGuestSignup(reason);
  return true;
}

/** openGuestSignupFor for a failed fetch, read from a copy so the caller can still read the answer. */
export async function openGuestSignupForResponse(response: Response) {
  if (response.status !== 403) return false;
  return openGuestSignupFor(await response.clone().json().catch(() => null));
}

/** Call after creating, completing, deleting or restoring a task or project. */
export function notifyWorkspaceChanged() {
  window.dispatchEvent(new Event(WORKSPACE_CHANGED_EVENT));
}
