import type { Prisma } from "@prisma/client";

/**
 * The database a change goes through: Prisma itself, or the client of an interactive transaction,
 * so several changes can apply together or not at all (#310).
 */
export type Db = Prisma.TransactionClient;
