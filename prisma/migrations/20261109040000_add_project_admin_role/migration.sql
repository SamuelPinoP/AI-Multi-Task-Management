-- Admins manage a project's members (#385). Additive: one enum value. It
-- stays alone in this migration, since Postgres can't use a new enum value in
-- the transaction that adds it.

-- AlterEnum
ALTER TYPE "ProjectMemberRole" ADD VALUE 'ADMIN';
