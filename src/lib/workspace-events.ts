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

/** Asks the shell to open search, the Ctrl+K pop-up (#410): Home's search button does. */
export const OPEN_SEARCH_EVENT = "workspace:open-search";

export function openSearch() {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}

/** Call after creating, completing, deleting or restoring a task or project. */
export function notifyWorkspaceChanged() {
  window.dispatchEvent(new Event(WORKSPACE_CHANGED_EVENT));
}
