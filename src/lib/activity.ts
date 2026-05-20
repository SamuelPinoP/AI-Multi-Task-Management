import { prisma } from "@/lib/prisma";

export type ActivityAction =
  | "CREATED_NOTE"
  | "CREATED_TASK"
  | "COMPLETED_TASK"
  | "CREATED_EVENT"
  | "CREATED_PROJECT"
  | "DELETED_ITEM"
  | "RESTORED_ITEM";

export type ActivityEntityType = "NOTE" | "TASK" | "EVENT" | "PROJECT";

type CreateActivityInput = {
  userId: string;
  action: ActivityAction;
  message: string;
  entityType: ActivityEntityType;
  entityId?: string;
  projectId?: string | null;
};

export async function createActivity(input: CreateActivityInput) {
  try {
    await prisma.activity.create({
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
