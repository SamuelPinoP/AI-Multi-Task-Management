import { guestRefusalReason, type GuestSignupReason } from "@/lib/guest-limits-core";

/**
 * Window events that keep the app shell's sidebar counts in sync with changes
 * made on a page (the shell refetches /api/workspace-nav when they fire).
 */
export const WORKSPACE_CHANGED_EVENT = "workspace:changed";

/** Fired by the shell's New task dialog, so the Tasks page can refetch. */
export const TASK_CREATED_EVENT = "workspace:task-created";

/** Asks the shell to open its New task pop-up (#362), optionally in a project: `detail: { projectId }`. */
export const OPEN_NEW_TASK_EVENT = "workspace:open-new-task";

export function openNewTask(draft: { projectId?: string } = {}) {
  window.dispatchEvent(new CustomEvent(OPEN_NEW_TASK_EVENT, { detail: draft }));
}

/**
 * Puts the cursor in the page's quick add with a project already picked (#520): a project's + on
 * the Tasks page. `detail: { projectId }`, where "" means no project.
 */
export const QUICK_ADD_IN_PROJECT_EVENT = "workspace:quick-add-in-project";

export function quickAddInProject(projectId: string) {
  window.dispatchEvent(new CustomEvent<{ projectId: string }>(QUICK_ADD_IN_PROJECT_EVENT, { detail: { projectId } }));
}

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
