-- Rename the collaborator role to Editor and persist invited roles.
ALTER TYPE "ProjectMemberRole" RENAME VALUE 'MEMBER' TO 'EDITOR';
ALTER TABLE "ProjectInvitation" ADD COLUMN "role" "ProjectMemberRole" NOT NULL DEFAULT 'EDITOR';
