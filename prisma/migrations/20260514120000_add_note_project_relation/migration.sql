-- Add optional project relation for notes
ALTER TABLE "Note"
ADD COLUMN "projectId" TEXT;

ALTER TABLE "Note"
ADD CONSTRAINT "Note_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Note_projectId_idx" ON "Note"("projectId");
