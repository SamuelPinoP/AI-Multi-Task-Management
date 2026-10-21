/**
 * Subtasks and dependencies (SMART-02), shared by the API, the Tasks page,
 * the board and the planner.
 *
 * - A subtask is a task with a `parentId`. Nesting is one level deep, and a
 *   subtask always has its parent's project.
 * - A `TaskDependency` says "taskId can't finish until blockedById is done".
 *   A task is blocked while any of its blockers is open.
 */

type Status = "TODO" | "IN_PROGRESS" | "DONE";
type Related = { id: string; title: string; status: Status };

/** Done and total subtasks, for the progress ring. */
export function subtaskProgress(subtasks: ReadonlyArray<{ status: Status }> | undefined) {
  const list = subtasks ?? [];
  return { done: list.filter((task) => task.status === "DONE").length, total: list.length };
}

/** The blockers that are still open. */
export function openBlockers(blockedBy: ReadonlyArray<{ blockedBy: Related }> | undefined): Related[] {
  return (blockedBy ?? []).map((item) => item.blockedBy).filter((task) => task.status !== "DONE");
}

/**
 * Whether "taskId is blocked by blockedById" would close a loop: true when
 * the blocker is already (directly or through others) waiting on the task.
 * `loadEdges` returns the dependencies whose `taskId` is in the given ids.
 */
export async function createsDependencyCycle(
  taskId: string,
  blockedById: string,
  loadEdges: (taskIds: string[]) => Promise<Array<{ taskId: string; blockedById: string }>>,
) {
  if (taskId === blockedById) return true;
  const seen = new Set([blockedById]);
  let frontier = [blockedById];
  while (frontier.length) {
    const next: string[] = [];
    for (const edge of await loadEdges(frontier)) {
      if (edge.blockedById === taskId) return true;
      if (!seen.has(edge.blockedById)) {
        seen.add(edge.blockedById);
        next.push(edge.blockedById);
      }
    }
    frontier = next;
  }
  return false;
}

/**
 * The Tasks page list: top-level tasks, plus subtasks whose parent isn't in
 * the list (for example, a parent moved to Trash), so nothing disappears.
 */
export function topLevelTasks<T extends { id: string; parentId?: string | null }>(tasks: T[]) {
  const ids = new Set(tasks.map((task) => task.id));
  return tasks.filter((task) => !task.parentId || !ids.has(task.parentId));
}
