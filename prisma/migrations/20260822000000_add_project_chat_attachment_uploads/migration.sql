CREATE TABLE "ProjectChatAttachmentUpload" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "storageProvider" "ProjectChatStorageProvider" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectChatAttachmentUpload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectChatAttachmentUpload_storageKey_key" ON "ProjectChatAttachmentUpload"("storageKey");

CREATE INDEX "ProjectChatAttachmentUpload_projectId_userId_idx" ON "ProjectChatAttachmentUpload"("projectId", "userId");

CREATE INDEX "ProjectChatAttachmentUpload_expiresAt_idx" ON "ProjectChatAttachmentUpload"("expiresAt");

ALTER TABLE "ProjectChatAttachmentUpload" ADD CONSTRAINT "ProjectChatAttachmentUpload_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectChatAttachmentUpload" ADD CONSTRAINT "ProjectChatAttachmentUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
