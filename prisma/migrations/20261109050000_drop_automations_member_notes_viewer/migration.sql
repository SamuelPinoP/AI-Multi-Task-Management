-- Drops what #383, #384 and #385 left behind (#388), once no deployed code
-- reads it: project automations and their two enums, member notes and their
-- enum, and the Viewer role. This deletes the saved automation rules and
-- member notes, which the owner asked to remove. Generated with
-- `prisma migrate diff --script`, plus the first two statements.

-- A Viewer row written by the old deployment while #385 deployed becomes an
-- Editor, like every other viewer did; the new enum has no VIEWER.
UPDATE "ProjectMember" SET "role" = 'EDITOR', "updatedAt" = (now() AT TIME ZONE 'utc') WHERE "role" = 'VIEWER';
UPDATE "ProjectInvitation" SET "role" = 'EDITOR', "updatedAt" = (now() AT TIME ZONE 'utc') WHERE "role" = 'VIEWER';

-- AlterEnum
BEGIN;
CREATE TYPE "ProjectMemberRole_new" AS ENUM ('OWNER', 'EDITOR', 'ADMIN');
ALTER TABLE "public"."ProjectInvitation" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "public"."ProjectMember" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "ProjectMember" ALTER COLUMN "role" TYPE "ProjectMemberRole_new" USING ("role"::text::"ProjectMemberRole_new");
ALTER TABLE "ProjectInvitation" ALTER COLUMN "role" TYPE "ProjectMemberRole_new" USING ("role"::text::"ProjectMemberRole_new");
ALTER TYPE "ProjectMemberRole" RENAME TO "ProjectMemberRole_old";
ALTER TYPE "ProjectMemberRole_new" RENAME TO "ProjectMemberRole";
DROP TYPE "public"."ProjectMemberRole_old";
ALTER TABLE "ProjectInvitation" ALTER COLUMN "role" SET DEFAULT 'EDITOR';
ALTER TABLE "ProjectMember" ALTER COLUMN "role" SET DEFAULT 'EDITOR';
COMMIT;

-- DropForeignKey
ALTER TABLE "ProjectAutomation" DROP CONSTRAINT "ProjectAutomation_memberId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectAutomation" DROP CONSTRAINT "ProjectAutomation_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectMemberNote" DROP CONSTRAINT "ProjectMemberNote_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectMemberNote" DROP CONSTRAINT "ProjectMemberNote_memberId_fkey";

-- DropTable
DROP TABLE "ProjectAutomation";

-- DropTable
DROP TABLE "ProjectMemberNote";

-- DropEnum
DROP TYPE "AutomationAction";

-- DropEnum
DROP TYPE "AutomationTrigger";

-- DropEnum
DROP TYPE "ProjectMemberNoteVisibility";
