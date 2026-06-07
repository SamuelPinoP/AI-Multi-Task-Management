-- Keep the deployed database aligned with prisma/schema.prisma.
-- The Note.projectId relation is not declared with @@index in the Prisma schema.
DROP INDEX IF EXISTS "Note_projectId_idx";
