// The task API's request bodies as Zod schemas (#270, tasks first): POST /api/tasks and
// PATCH /api/tasks/[id] check them, and so do the AI assistant's changes (#310), which go
// through the same create and update functions (src/lib/task-writes.ts). Each check keeps the
// message the routes gave before, so a client sees the same 400 for the same mistake.
import { z } from "zod";
import { PRIORITIES } from "@/lib/priority";
import { RECURRENCE_VALUES } from "@/lib/recurrence";
import { parseTaskDueDateForStorage } from "@/lib/task-date-buckets";
import { TASK_TITLE_MAX } from "@/lib/task-history";

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;

export const TITLE_TOO_LONG = `Keep the title under ${TASK_TITLE_MAX} characters; put the rest in the description.`;

// Zod refuses a key the body leaves out unless its field says what a missing value means. The
// optional fields say it: empty text, no id or no due date (`.default`), or nothing (`.optional`).

/** Text the routes trim; anything that isn't a string counts as empty. */
const trimmedText = z.unknown().transform((value) => (typeof value === "string" ? value.trim() : ""));

/** An id, or null when it's missing, blank or not a string. */
const optionalId = z
  .unknown()
  .transform((value) => (typeof value === "string" ? value.trim() || null : null))
  .default(null);

/** A field the routes treat as left out when it's empty: "", null, undefined or false. */
function unlessEmpty<Schema extends z.ZodType>(schema: Schema) {
  return z.preprocess((value) => (value ? value : undefined), schema.optional());
}

const title = trimmedText.pipe(z.string().min(1, "Title is required").max(TASK_TITLE_MAX, TITLE_TOO_LONG));
const status = z.enum(TASK_STATUSES, { error: "Invalid status" });
const priority = z.enum(PRIORITIES, { error: "Invalid priority" });
const recurrence = z.enum(RECURRENCE_VALUES, { error: "Invalid recurrence" });

/** A due date as `YYYY-MM-DD` (a longer ISO date keeps its first 10 characters), stored as a date only; empty means none. */
const dueDate = z
  .unknown()
  .transform((value, context) => {
    if (!value) return null;
    const parsed = typeof value === "string" ? parseTaskDueDateForStorage(value) : null;
    if (parsed) return parsed;
    context.addIssue({ code: "custom", message: "Invalid due date" });
    return z.NEVER;
  })
  .default(null);

const description = trimmedText.default("");
const labelIds = z.unknown().optional();

/**
 * A new task. Keys are in the order the route used to check them, so the first problem reported is
 * the same. `labelIds` stays unchecked here: resolveTaskLabelIds checks it against the task's scope.
 */
export const taskCreateSchema = z.object({
  title,
  status: unlessEmpty(status),
  priority: unlessEmpty(priority),
  recurrence: unlessEmpty(recurrence),
  dueDate,
  description,
  projectId: optionalId,
  assigneeId: optionalId,
  parentId: optionalId,
  noteId: optionalId,
  labelIds,
});

/** A task's new state: every field, as the task's edit form sends it. */
export const taskUpdateSchema = z.object({
  title,
  status,
  priority,
  recurrence,
  dueDate,
  description,
  projectId: optionalId,
  assigneeId: optionalId,
  labelIds,
});

export type TaskCreateData = z.output<typeof taskCreateSchema>;
export type TaskUpdateData = z.output<typeof taskUpdateSchema>;

/** A request body checked against `schema`: its data, or the first problem's message for a 400. */
export function parseBody<Schema extends z.ZodType>(schema: Schema, body: unknown): { data: z.output<Schema> } | { error: string } {
  // Anything but an object (null, a list, a number) reads as an empty body, so it gets the first field's message.
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const parsed = schema.safeParse(input);
  return parsed.success ? { data: parsed.data } : { error: parsed.error.issues[0]?.message ?? "Invalid request" };
}
