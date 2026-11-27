import "server-only";

// How connected AI apps' changes reach the database (#479): the write tools
// (src/lib/ai/tools/change-tools.ts) say what to change, and this runs it through the app's shared
// write functions, as the person via the app, in one transaction. A refused write rolls the whole
// change back, so an app never leaves half of one behind. The calendar feeds and notifications wait
// until it has committed, as for the in-app assistant's proposals (src/lib/ai/proposals-server.ts).
import type { ToolWriter, Writes } from "@/lib/ai/tools/writer";
import type { Db } from "@/lib/db-client";
import { createEvent, trashEvent, updateEvent } from "@/lib/event-writes";
import { createNote, trashNote, updateNote } from "@/lib/note-writes";
import { prisma } from "@/lib/prisma";
import { createProject } from "@/lib/project-writes";
import { addTaskComment } from "@/lib/task-comments-server";
import { addSourceLink, createTask, findTaskForSourceLink, trashTask, updateTask } from "@/lib/task-writes";
import { runFollowUps, type FollowUp, type WriteActor, type WriteRefusal, type WriteResult } from "@/lib/writes";

// A batch of tasks makes several inserts each; Prisma's 5-second default is tight on a cold database.
const CHANGE_TRANSACTION = { maxWait: 10_000, timeout: 20_000 };

/** A write the app's rules refused: the transaction rolls back. */
class Refused extends Error {
  constructor(readonly refusal: WriteRefusal) {
    super(refusal.error);
  }
}

const noteTitle = (note: { title: string }) => note.title || "Untitled note";

/** The shared write functions for `actor`, inside the transaction `db` belongs to. */
function writesFor(actor: WriteActor, db: Db, followUps: FollowUp[]): Writes {
  const take = <Value>(result: WriteResult<Value>): Value => {
    if (!result.ok) throw new Refused(result);
    followUps.push(result.followUp);
    return result.value;
  };
  return {
    async createTask(input) {
      const task = take(await createTask(actor, input, db));
      return { id: task.id, title: task.title, projectId: task.projectId };
    },
    async updateTask(id, input) {
      const task = take(await updateTask(actor, id, input, db));
      return { id: task.id, title: task.title };
    },
    async trashTask(id) {
      const task = take(await trashTask(actor, id, db));
      return { id: task.id, title: task.title };
    },
    addSourceLink: (taskId, url) => addSourceLink(taskId, url, db),
    findTaskForSourceLink: (url, projectId) => findTaskForSourceLink(actor.id, url, projectId, db),
    async addComment(taskId, body) {
      const comment = take(await addTaskComment(actor, taskId, body, db));
      return { id: comment.id };
    },
    async createProject({ name, description }) {
      const project = take(await createProject(actor, { name, description, color: null, priority: "NONE" }, db));
      return { id: project.id, name: project.name };
    },
    async createEvent(input) {
      const event = take(await createEvent(actor, input, db));
      return { id: event.id, title: event.title };
    },
    async updateEvent(id, input) {
      const event = take(await updateEvent(actor, id, input, db));
      return { id: event.id, title: event.title };
    },
    async trashEvent(id) {
      const event = take(await trashEvent(actor, id, db));
      return { id: event.id, title: event.title };
    },
    async createNote(input) {
      const note = take(await createNote(actor, input, db));
      return { id: note.id, title: noteTitle(note) };
    },
    async updateNote(id, input) {
      const note = take(await updateNote(actor, id, input, db));
      return { id: note.id, title: noteTitle(note) };
    },
    async trashNote(id) {
      const note = take(await trashNote(actor, id, db));
      return { id: note.id, title: noteTitle(note) };
    },
  };
}

/** Changes made as `actor`, the person via their connected AI app (`actor.via`), each in one transaction. */
export function mcpWriter(actor: WriteActor): ToolWriter {
  return {
    async apply(change) {
      const followUps: FollowUp[] = [];
      try {
        const value = await prisma.$transaction((tx) => change(writesFor(actor, tx, followUps)), CHANGE_TRANSACTION);
        runFollowUps(actor, followUps);
        return { ok: true, value };
      } catch (error) {
        if (error instanceof Refused) return error.refusal;
        throw error;
      }
    },
  };
}
