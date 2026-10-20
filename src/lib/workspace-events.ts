/**
 * Window events that keep the app shell's sidebar counts in sync with changes
 * made on a page (the shell refetches /api/workspace-nav when they fire).
 */
export const WORKSPACE_CHANGED_EVENT = "workspace:changed";

/** Fired by the shell's New task dialog, so the Tasks page can refetch. */
export const TASK_CREATED_EVENT = "workspace:task-created";

/** Call after creating, completing, deleting or restoring a task or project. */
export function notifyWorkspaceChanged() {
  window.dispatchEvent(new Event(WORKSPACE_CHANGED_EVENT));
}
