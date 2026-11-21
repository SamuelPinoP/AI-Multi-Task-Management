import "server-only";

// Creating a project: the rules of POST /api/projects in one place (#310), so the AI assistant's
// changes follow them too. A template's starter tasks and events (SMART-11) stay in the route,
// which adds them in the same transaction.
import type { Project } from "@prisma/client";
import { createActivity } from "@/lib/activity";
import type { Db } from "@/lib/db-client";
import { isPriority, type Priority } from "@/lib/priority";
import { prisma } from "@/lib/prisma";
import { refuse, type WriteActor, type WriteResult } from "@/lib/writes";

export type ProjectCreateData = {
  name: string;
  description: string | null;
  color: string | null;
  priority: Priority;
};

/** The body of POST /api/projects, less its template: the project's fields, or the message for a 400. */
export function parseProjectCreateBody(body: Record<string, unknown>): { data: ProjectCreateData } | { error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "Name is required" };
  if (body.priority !== undefined && !isPriority(body.priority)) return { error: "Invalid priority" };
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const color = typeof body.color === "string" ? body.color.trim() : "";
  return {
    data: { name, description: description || null, color: color || null, priority: isPriority(body.priority) ? body.priority : "NONE" },
  };
}

export async function createProject(actor: WriteActor, input: ProjectCreateData, db: Db = prisma): Promise<WriteResult<Project>> {
  const name = input.name.trim();
  if (!name) return refuse(400, "Name is required");

  const project = await db.project.create({
    data: { name, description: input.description, color: input.color, priority: input.priority, userId: actor.id },
  });
  await createActivity(
    {
      userId: actor.id,
      action: "CREATED_PROJECT",
      message: `Created project: “${project.name}”`,
      entityType: "PROJECT",
      entityId: project.id,
      projectId: project.id,
    },
    db,
  );
  // A new project has nothing dated yet, so no calendar feed changes.
  return { ok: true, value: project, followUp: {} };
}
