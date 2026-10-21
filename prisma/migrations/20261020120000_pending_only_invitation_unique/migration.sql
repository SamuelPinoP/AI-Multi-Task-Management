-- DropIndex
DROP INDEX "ProjectInvitation_projectId_invitedEmail_status_key";

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInvitation_projectId_invitedEmail_key" ON "ProjectInvitation"("projectId", "invitedEmail") WHERE (status = 'PENDING');
