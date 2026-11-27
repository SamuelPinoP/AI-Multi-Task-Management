// How a connected AI app's change reaches the database (#479): the app's own write functions
// (src/lib/*-writes.ts) for one person, in one transaction. The "write" tools only say what to
// change; src/lib/mcp/writes-server.ts runs it, so the tools stay free of server code, and unit
// tests pass a stand-in. Types only.
import type { EventCreateData, EventUpdateData } from "@/lib/event-fields";
import type { NoteData } from "@/lib/note-writes";
import type { TaskCreateData, TaskUpdateData } from "@/lib/schemas/task";
import type { WriteRefusal } from "@/lib/writes";

/** An item a change made or changed: enough to name it and link to it. */
export type WrittenItem = { id: string; title: string };

/**
 * The shared write functions, each for the person and inside the change's transaction. Each one
 * returns what it wrote, or throws the app's refusal, which rolls back the whole change.
 */
export type Writes = {
  createTask(input: TaskCreateData): Promise<WrittenItem & { projectId: string | null }>;
  updateTask(id: string, input: TaskUpdateData): Promise<WrittenItem>;
  trashTask(id: string): Promise<WrittenItem>;
  /** Records the web address a new task comes from. */
  addSourceLink(taskId: string, url: string): Promise<void>;
  /**
   * The task already made for `url` in the same place (project `projectId`, or the person's own
   * tasks when null), if they can see one. It locks the address until the change ends, so two calls
   * at once can't both add a task for it.
   */
  findTaskForSourceLink(url: string, projectId: string | null): Promise<WrittenItem | null>;
  addComment(taskId: string, body: string): Promise<{ id: string }>;
  createProject(input: { name: string; description: string | null }): Promise<{ id: string; name: string }>;
  createEvent(input: EventCreateData): Promise<WrittenItem>;
  updateEvent(id: string, input: EventUpdateData): Promise<WrittenItem>;
  trashEvent(id: string): Promise<WrittenItem>;
  createNote(input: NoteData): Promise<WrittenItem>;
  updateNote(id: string, input: NoteData): Promise<WrittenItem>;
  trashNote(id: string): Promise<WrittenItem>;
};

export type ToolWriter = {
  /**
   * Runs `change` in one transaction: every write in it, or, when the app refuses one, none of
   * them, with that refusal. What waits for the commit (calendar feeds, notifications) runs after.
   */
  apply<Value>(change: (writes: Writes) => Promise<Value>): Promise<{ ok: true; value: Value } | WriteRefusal>;
};
