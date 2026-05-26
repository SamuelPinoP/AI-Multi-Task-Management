CREATE TYPE "ProjectMemberNoteVisibility" AS ENUM ('TEAM', 'PRIVATE');

ALTER TABLE "ProjectMemberNote"
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "visibility" "ProjectMemberNoteVisibility" NOT NULL DEFAULT 'TEAM';

UPDATE "ProjectMemberNote" n
SET "createdByUserId" = p."userId"
FROM "ProjectMember" m
JOIN "Project" p ON p."id" = m."projectId"
WHERE n."memberId" = m."id";

ALTER TABLE "ProjectMemberNote"
ALTER COLUMN "createdByUserId" SET NOT NULL;

CREATE INDEX "ProjectMemberNote_createdByUserId_idx" ON "ProjectMemberNote"("createdByUserId");

ALTER TABLE "ProjectMemberNote" ADD CONSTRAINT "ProjectMemberNote_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
