import type { Db } from "@/lib/db-client";
import { prisma } from "@/lib/prisma";

export type ActivityAction =
  | "CREATED_NOTE"
  | "CREATED_TASK"
  | "COMPLETED_TASK"
  | "CREATED_EVENT"
  | "CREATED_PROJECT"
  | "COMMENTED"
  | "DELETED_ITEM"
  | "RESTORED_ITEM"
  /** A task changed through the AI assistant (#310). */
  | "UPDATED_TASK";

export type ActivityEntityType = "NOTE" | "TASK" | "EVENT" | "PROJECT";

type CreateActivityInput = {
  userId: string;
  action: ActivityAction;
  message: string;
  entityType: ActivityEntityType;
  entityId?: string;
  projectId?: string | null;
};

/**
 * Adds an entry to Activity. A failure is only logged, since the change itself went through. `db`
 * is a transaction's client when the change is one of several (#310); there, Postgres ends the
 * whole transaction after a failed statement, so nothing in it applies.
 */
export async function createActivity(input: CreateActivityInput, db: Db = prisma) {
  try {
    await db.activity.create({
      data: {
        action: input.action,
        message: input.message,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        projectId: input.projectId ?? null,
        userId: input.userId,
      },
    });
  } catch (error) {
    console.error("Failed to create activity:", error);
  }
}
