/** Shapes returned by the /api/tasks and /api/projects endpoints, as the Tasks page uses them. */
export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
export type Priority = "LOW" | "MEDIUM" | "HIGH";
export type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

export type Project = { id: string; name: string; color: string | null };

export type Member = { id: string; name: string; email: string | null; role: "OWNER" | "EDITOR" | "VIEWER" };

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  recurrence: Recurrence;
  projectId: string | null;
  project: Project | null;
  assigneeId?: string | null;
  assignee: Member | null;
  /** SMART-02: the parent task, the subtasks, and the tasks this one waits on. */
  parentId?: string | null;
  subtasks?: RelatedTask[];
  blockedBy?: Array<{ blockedBy: RelatedTask }>;
};

export type RelatedTask = { id: string; title: string; status: TaskStatus };

/** The fields the create and edit forms send to the API. */
export type TaskInput = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string;
  recurrence: Recurrence;
  projectId: string;
  assigneeId: string;
};

export const statusLabels: Record<TaskStatus, string> = { TODO: "To do", IN_PROGRESS: "In progress", DONE: "Done" };
export const priorityLabels: Record<Priority, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
export const recurrenceLabels: Record<Recurrence, string> = {
  NONE: "Does not repeat",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
};
